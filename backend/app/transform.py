"""C. AI 화면 변환 — 원본 메뉴 + 내 설정 → 맞춤 화면 설계도

흐름
  1) 원본 메뉴에서 가격을 뺀 정보만 AI 에 보낸다 (AI 는 가격을 모른다)
  2) AI 는 정해진 JSON 형식(설계도)으로만 답한다 (OpenAI Structured Outputs)
  3) 서버가 검사 8개를 돌린다. 하나라도 틀리면 틀린 이유를 알려 주고 다시 시킨다 (최대 2번 더)
  4) 끝까지 실패하면 원본 메뉴 화면을 그대로 보여 준다 (주문은 항상 가능해야 함)
  5) 통과하면 원본 가격을 서버가 붙이고, 같은 매장·같은 설정이면 캐시에서 바로 준다

규칙 값(설명 길이, 묶음 방식 등)은 ai_rules.py 에 있다.
"""
import json
import os
import re
import threading
import time

from . import ai_rules as R

MAX_RETRY = 2
_cache: dict[tuple, dict] = {}
_cache_lock = threading.Lock()

# ───────────────── AI 가 지켜야 하는 답 형식 ─────────────────
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["groups", "items", "options"],
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["title", "itemIds"],
                "properties": {"title": {"type": "string"}, "itemIds": {"type": "array", "items": {"type": "string"}}},
            },
        },
        "items": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["id", "desc"],
                "properties": {"id": {"type": "string"}, "desc": {"type": "string"}},
            },
        },
        "options": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["key", "question", "choices"],
                "properties": {
                    "key": {"type": "string"},
                    "question": {"type": "string"},
                    "choices": {
                        "type": "array",
                        "items": {
                            "type": "object", "additionalProperties": False,
                            "required": ["id", "label"],
                            "properties": {"id": {"type": "string"}, "label": {"type": "string"}},
                        },
                    },
                },
            },
        },
    },
}


def menu_for_ai(store: dict) -> dict:
    """AI 에 보낼 메뉴. 가격은 전부 뺀다."""
    used = {k for it in store["items"] for k in it["options"]}
    return {
        "store": store["store"],
        "categories": store["categories"],
        "items": [{"id": i["id"], "name": i["name"], "category": i["category"], "desc": i["desc"],
                   "must": [m["fact"] for m in i.get("must", [])],
                   "options": i["options"]} for i in store["items"]],
        "options": {k: {"name": v["name"], "choices": [{"id": c["id"], "name": c["name"]} for c in v["choices"]]}
                    for k, v in store["options"].items() if k in used},
    }


# ───────────────── 검사 장치 (8개) ─────────────────
PRICE_PATTERN = re.compile(r"\d[\d,]*\s*원|₩|\d{3,}")
ENGLISH = re.compile(r"[A-Za-z]")


def validate(store: dict, plan: dict | None, font_size: str, easy_words: bool = True) -> list[dict]:
    checks = []

    def add(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    # 1. 형식
    ok_format = isinstance(plan, dict) and all(isinstance(plan.get(k), list) for k in ("groups", "items", "options"))
    add("형식", ok_format, "" if ok_format else "JSON 형식이 아니에요")
    if not ok_format:
        return checks

    real_ids = [i["id"] for i in store["items"]]
    grouped = [iid for g in plan["groups"] for iid in g.get("itemIds", [])]
    described = [it.get("id") for it in plan["items"]]

    # 2. 원본 메뉴가 모두 한 번씩 들어 있는가
    missing = [i for i in real_ids if grouped.count(i) != 1 or i not in described]
    add("원본 메뉴 모두 포함", not missing, f"빠졌거나 중복: {', '.join(missing)}" if missing else "")

    # 3. 지어낸 메뉴가 없는가
    fake = sorted({i for i in grouped + described if i not in real_ids})
    add("지어낸 메뉴 없음", not fake, f"없는 메뉴: {', '.join(fake)}" if fake else "")

    # 4. 옵션 ID 가 원본과 똑같은가
    used = {k for it in store["items"] for k in it["options"]}
    got = {o.get("key"): o for o in plan["options"]}
    bad = []
    if set(got) != used:
        bad.append(f"옵션 종류가 달라요 (필요: {sorted(used)}, 받음: {sorted(got)})")
    for k in used & set(got):
        want = [c["id"] for c in store["options"][k]["choices"]]
        have = [c.get("id") for c in got[k]["choices"]]
        if sorted(want) != sorted(have):
            bad.append(f"{k} 선택지 ID 가 달라요 (필요: {want}, 받음: {have})")
    add("옵션 ID 일치", not bad, " / ".join(bad))

    # 5. 문구에 가격·숫자 금액이 없는가
    texts = [g["title"] for g in plan["groups"]] + [it.get("desc", "") for it in plan["items"]]
    texts += [o.get("question", "") for o in plan["options"]] + [c.get("label", "") for o in plan["options"] for c in o["choices"]]
    priced = [t for t in texts if PRICE_PATTERN.search(t)]
    add("문구에 가격 없음", not priced, f"가격처럼 보이는 문구: {priced[:3]}" if priced else "")

    # 6. 글씨 크기에 맞는 길이인가
    dmax = R.DESC_MAX[font_size]
    long_desc = [f"{it.get('id')}({len(it.get('desc', ''))}자)" for it in plan["items"] if len(it.get("desc", "")) > dmax]
    long_q = [f"{o.get('key')}({len(o.get('question', ''))}자)" for o in plan["options"] if len(o.get("question", "")) > R.QUESTION_MAX]
    detail = []
    if long_desc:
        detail.append(f"설명이 {dmax}자보다 길어요: {', '.join(long_desc)}")
    if long_q:
        detail.append(f"질문이 {R.QUESTION_MAX}자보다 길어요: {', '.join(long_q)}")
    add("글씨 크기별 길이", not detail, " / ".join(detail))

    # 7. '쉬운 말' 설정이면 어려운 말·영어가 없는가 (설정을 껐으면 통과)
    hard = []
    if easy_words:
        for t in texts:
            words = [w for w in R.HARD_WORDS if w in t]
            if words or ENGLISH.search(t):
                hard.append(f"'{t}' → {', '.join(words) or '영어'}")
    add("어려운 말 없음", not hard, f"어려운 말이 남았어요: {hard[:4]}" if hard else "")

    # 8. 메뉴마다 꼭 남길 정보(must)가 설명에 들어 있는가
    desc_by_id = {it.get("id"): it.get("desc", "") for it in plan["items"]}
    lost = []
    for item in store["items"]:
        for m in item.get("must", []):
            if not any(k in desc_by_id.get(item["id"], "") for k in m["any"]):
                lost.append(f"{item['name']}: '{m['fact']}'")
    add("꼭 남길 정보 포함", not lost, f"빠진 정보: {', '.join(lost)}" if lost else "")
    return checks


# ───────────────── AI 호출 ─────────────────
_client = None


def _openai():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=40)
    return _client


def ask_ai(store: dict, font_size: str, easy_words: bool, feedback: str | None) -> dict | None:
    messages = [
        {"role": "system", "content": R.build_system_prompt(font_size, easy_words)},
        {"role": "user", "content": "아래 메뉴를 바꿔 줘.\n" + json.dumps(menu_for_ai(store), ensure_ascii=False)},
    ]
    if feedback:
        messages.append({"role": "user", "content": "방금 답에 문제가 있었어. 고쳐서 다시 답해 줘:\n" + feedback})
    res = _openai().chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        messages=messages,
        temperature=0.3,
        response_format={"type": "json_schema", "json_schema": {"name": "screen_plan", "strict": True, "schema": SCHEMA}},
    )
    try:
        return json.loads(res.choices[0].message.content or "")
    except json.JSONDecodeError:
        return None


# ───────────────── 화면 만들기 (가격은 여기서 원본으로 붙인다) ─────────────────
def _ordered_option_keys(keys):
    return sorted(keys, key=lambda k: (R.OPTION_ORDER.index(k) if k in R.OPTION_ORDER else 99, k))


def build_screen(store: dict, plan: dict | None) -> dict:
    items = {i["id"]: i for i in store["items"]}
    descs = {it["id"]: it["desc"] for it in plan["items"]} if plan else {}
    opt_text = {o["key"]: o for o in plan["options"]} if plan else {}

    if plan:
        raw_groups = [(g["title"], g["itemIds"]) for g in plan["groups"]]
    else:
        raw_groups = [(c["name"], [i["id"] for i in store["items"] if i["category"] == c["id"]]) for c in store["categories"]]

    groups = []
    for title, ids in raw_groups:
        groups.append({"title": title, "items": [{
            "id": iid, "name": items[iid]["name"], "price": items[iid]["price"],
            "desc": descs.get(iid, items[iid]["desc"]), "originalDesc": items[iid]["desc"],
            "options": _ordered_option_keys(items[iid]["options"]),
        } for iid in ids]})

    used = {k for it in store["items"] for k in it["options"]}
    options = {}
    for k in _ordered_option_keys(used):
        src = store["options"][k]
        ai = opt_text.get(k)
        labels = {c["id"]: c["label"] for c in ai["choices"]} if ai else {}
        options[k] = {
            "name": src["name"],
            "question": ai["question"] if ai else f"{src['name']}을(를) 골라 주세요",
            "choices": [{"id": c["id"], "name": c["name"], "label": labels.get(c["id"], c["name"]), "price": c["price"]}
                        for c in src["choices"]],
        }
    return {"store": store["store"], "storeId": store["id"], "groups": groups, "options": options}


def transform(store: dict, font_size: str, easy_words: bool, fresh: bool = False) -> dict:
    """맞춤 화면을 돌려준다. fresh=True 면 캐시를 쓰지 않는다 (성공률 측정용)."""
    if font_size not in R.DESC_MAX:
        font_size = "large"
    key = (store["id"], store["version"], R.RULES_VERSION, font_size, easy_words)
    if not fresh:
        with _cache_lock:
            hit = _cache.get(key)
        if hit:
            return {**hit, "source": "cache"}

    started = time.time()
    attempts, checks, feedback, error = 0, [], None, None
    plan_ok = None
    if not os.getenv("OPENAI_API_KEY"):
        error = "OPENAI_API_KEY 가 없어요 (backend/.env)"
    else:
        for attempts in range(1, MAX_RETRY + 2):
            try:
                plan = ask_ai(store, font_size, easy_words, feedback)
            except Exception as e:  # 네트워크·키 오류 등 → 원본 화면으로
                error = f"AI 호출 실패: {type(e).__name__}: {e}"[:300]
                break
            checks = validate(store, plan, font_size, easy_words)
            failed = [c for c in checks if not c["ok"]]
            if not failed:
                plan_ok = plan
                break
            feedback = "\n".join(f"- {c['name']}: {c['detail']}" for c in failed)

    result = {
        **build_screen(store, plan_ok),
        "source": "ai" if plan_ok else "original",
        "rulesVersion": R.RULES_VERSION,
        "profile": {"fontSize": font_size, "easyWords": easy_words},
        "attempts": attempts,
        "checks": checks,
        "error": error,
        "elapsedMs": int((time.time() - started) * 1000),
    }
    if plan_ok:
        with _cache_lock:
            _cache[key] = result
    return result


def warm_cache(stores: list[dict]) -> None:
    """서버가 켜질 때 매장마다 설정 6가지 화면을 미리 만들어 둔다 → 첫 손님도 기다리지 않음."""
    if not os.getenv("OPENAI_API_KEY"):
        return
    for store in stores:
        for font in R.DESC_MAX:
            for easy in (True, False):
                r = transform(store, font, easy)
                print(f"[미리 만들기] {store['store']} 글씨={font} 쉬운말={easy} → {r['source']} ({r['elapsedMs']}ms)", flush=True)
