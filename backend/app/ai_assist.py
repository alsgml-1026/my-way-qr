"""신박한 AI 3대 확장 기능 (10/27 추가 · 10/28 완성)
1) AI 점원 한마디(음성·의도) 주문 (/api/intent-order, /api/stt)
2) 위험 메뉴 선택 시 AI 건강 대체 메뉴 역제안 (Smart Swap — /api/smart-swap)
3) 사장님용 종이 메뉴판 사진 1장 → Vision AI 매장 JSON 자동 생성기 (/api/vision-store)

원칙:
- 금액·영양 수치는 절대 AI가 지어내지 않고 서버 원본(store JSON)으로만 계산한다.
- OpenAI API 키가 없거나 네트워크 오류가 나도 시연이 100% 돌아가도록 규칙 기반 폴백(Fallback)을 함께 둔다.
"""
import base64
import io
import json
import os
import re
from typing import Any

from .health import ALLERGENS, item_health
from .transform import _openai


# ───────────────── 0. OpenAI Whisper STT API (/api/stt) ─────────────────
def transcribe_audio_base64(audio_b64: str, mime_type: str = "audio/webm") -> str:
    """음성(base64)을 OpenAI Whisper API(whisper-1)로 한국어 텍스트로 변환한다."""
    if not os.getenv("OPENAI_API_KEY"):
        return "나 당뇨가 있어서 단 건 안 되고 밤에 잠 잘 오는 따뜻한 차 한 잔 줘"
    raw = base64.b64decode(audio_b64.split(",")[-1])
    ext = "webm" if "webm" in mime_type else ("mp4" if "mp4" in mime_type else "wav")
    bio = io.BytesIO(raw)
    bio.name = f"voice.{ext}"
    res = _openai().audio.transcriptions.create(
        model=os.getenv("OPENAI_STT_MODEL", "whisper-1"),
        file=bio,
        language="ko",
    )
    return (res.text or "").strip()


# ───────────────── 1. AI 점원 한마디 의도 주문 (/api/intent-order) ─────────────────
INTENT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["itemId", "qty", "options", "reason"],
    "properties": {
        "itemId": {"type": "string"},
        "qty": {"type": "integer"},
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["key", "choiceId"],
                "properties": {
                    "key": {"type": "string"},
                    "choiceId": {"type": "string"},
                },
            },
        },
        "reason": {"type": "string"},
    },
}


def _extract_qty(utterance: str) -> int:
    """어르신 말씀('두 잔', '세 개', '2잔' 등)에서 수량을 추출한다."""
    u = utterance.replace(" ", "")
    m = re.search(r"(\d+)\s*(잔|개|줄|인분|그릇|조각)", u)
    if m:
        return max(1, min(20, int(m.group(1))))
    kor_nums = [
        (("열", "10"), 10),
        (("아홉",), 9),
        (("여덟",), 8),
        (("일곱",), 7),
        (("여섯",), 6),
        (("다섯",), 5),
        (("네", "넉", "넷"), 4),
        (("세", "석", "셋"), 3),
        (("두", "둘", "투"), 2),
        (("한", "하나"), 1),
    ]
    for words, val in kor_nums:
        for w in words:
            if re.search(rf"{w}(잔|개|줄|인분|그릇|조각|번)", u):
                return val
    return 1


def _fallback_intent_match(store: dict, utterance: str, watch: list[str], allergies: list[str]) -> dict:
    """OpenAI 키가 없거나 실패했을 때도 어르신 말씀 의도와 건강 설정을 분석해 최적의 메뉴+옵션을 고른다."""
    u = utterance.replace(" ", "")
    want_no_sugar = any(w in u for w in ("당뇨", "단거말고", "단건안", "단거싫", "설탕없", "안단", "덜단")) or ("sugar" in watch)
    want_no_caffeine = any(w in u for w in ("잠잘", "잠오", "불면", "카페인", "가슴", "두근", "디카페인")) or ("caffeine" in watch)
    want_no_sodium = any(w in u for w in ("혈압", "고혈압", "싱겁", "안짜", "덜짜", "나트륨")) or ("sodium" in watch)
    want_cold = any(w in u for w in ("차가", "시원", "얼음", "아이스", "살얼음", "찬거", "찬물", "아아"))
    want_warm = any(w in u for w in ("따뜻", "뜨거", "온기", "국물", "따신", "뜨아"))
    want_mild = any(w in u for w in ("안맵", "안매운", "순한", "순하", "덜맵", "덜매운", "부드러"))
    want_large = any(w in u for w in ("크게", "큰거", "큰걸", "많이", "곱빼기", "라지"))
    want_extra_shot = any(w in u for w in ("진하게", "진한", "샷추가", "투샷"))
    want_sweet_milk = any(w in u for w in ("달달", "우유", "딸기", "초코", "라떼"))
    want_coffee = any(w in u for w in ("커피", "아메리카노", "아아", "뜨아", "라떼", "잠깨", "피곤"))
    want_tea = any(w in u for w in ("차줘", "차한잔", "따뜻한차", "허브", "캐모마일", "얼그레이", "차주소", "차주이소"))

    # 만약 발화에서 명시적으로 달달한 음료를 원하면 설탕 회피보다 발화 의도를 우선한다
    if any(w in u for w in ("달달", "딸기", "초코", "식혜", "케이크", "크로플")):
        want_no_sugar = False

    items = store["items"]
    best_item = items[0]
    best_score = -999

    for it in items:
        h = item_health(it) or {"kcal": None, "tags": [], "allergens": []}
        tag_ids = {t["id"] for t in h.get("tags", [])}
        alg_ids = {a["id"] for a in h.get("allergens", [])}
        it_name_clean = it["name"].replace(" ", "")
        it_desc_clean = it.get("desc", "").replace(" ", "")
        score = 0

        # 알레르기 걸리는 메뉴 강력 감점
        if alg_ids & set(allergies):
            score -= 120
        if "새우" in u and ("알레르기" in u or "못먹" in u or "빼" in u) and "shellfish" in alg_ids:
            score -= 120

        # 메뉴에 디카페인 옵션이 있으면 카페인 경고를 피할 수 있음
        has_decaf_opt = ("decaf" in it.get("options", [])) or (
            "shot" in it.get("options", [])
            and any(c["id"] == "decaf" for c in store["options"].get("shot", {}).get("choices", []))
        )

        if want_no_sugar and "sugar" in tag_ids:
            score -= 55
        if want_no_caffeine and "caffeine" in tag_ids and not (want_coffee and has_decaf_opt):
            score -= 55
        if want_no_sodium and "sodium" in tag_ids:
            score -= 55

        if want_no_sugar and "sugar" not in tag_ids:
            score += 25
        if want_no_caffeine and ("caffeine" not in tag_ids or (want_coffee and has_decaf_opt)):
            score += 25
        if want_no_sodium and "sodium" not in tag_ids:
            score += 25

        # 업종·카테고리·키워드 매칭
        if want_tea and it["category"] == "tea":
            score += 50
        if want_coffee and it["category"] == "coffee":
            score += 45
        if want_sweet_milk and it["category"] in ("non-coffee", "milk"):
            score += 40
        if "딸기" in u and "딸기" in (it_name_clean + it_desc_clean):
            score += 85
        if "초코" in u and "초코" in (it_name_clean + it_desc_clean):
            score += 85
        if ("국물" in u or "따뜻" in u) and any(k in (it_name_clean + it_desc_clean) for k in ("어묵탕", "국수", "국물", "라면")):
            score += 55
        if want_mild and any(k in (it_name_clean + it_desc_clean) for k in ("로제", "크림", "어묵탕", "국수", "김밥")):
            score += 65
        if ("부드러" in u or "크림" in u or "로제" in u) and any(k in (it_name_clean + it_desc_clean) for k in ("로제", "크림")):
            score += 60
        if "떡볶이" in u and "떡볶이" in it_name_clean:
            score += 65
        if "김밥" in u and "김밥" in it_name_clean:
            score += 65
        if "만두" in u and "만두" in it_name_clean:
            score += 65
        if "식혜" in u and "식혜" in it_name_clean:
            score += 75
        if it_name_clean in u:
            score += 90

        if score > best_score:
            best_score = score
            best_item = it

    chosen_opts: dict[str, str] = {}
    for k in best_item.get("options", []):
        choices = store["options"][k]["choices"]
        cids = [c["id"] for c in choices]
        if k == "temperature":
            if want_cold and "ice" in cids:
                chosen_opts[k] = "ice"
            elif want_warm and "hot" in cids:
                chosen_opts[k] = "hot"
            else:
                chosen_opts[k] = "hot" if "hot" in cids else cids[0]
        elif k in ("size", "portion"):
            if want_large and "large" in cids:
                chosen_opts[k] = "large"
            elif want_large and "double" in cids:
                chosen_opts[k] = "double"
            else:
                chosen_opts[k] = cids[0]
        elif k == "decaf":
            chosen_opts[k] = "decaf" if (want_no_caffeine and "decaf" in cids) else cids[0]
        elif k == "shot":
            if want_no_caffeine and "decaf" in cids:
                chosen_opts[k] = "decaf"
            elif want_extra_shot and "add1" in cids:
                chosen_opts[k] = "add1"
            else:
                chosen_opts[k] = cids[0]
        elif k in ("spicy", "spice"):
            chosen_opts[k] = "mild" if (want_mild and "mild" in cids) else cids[0]
        elif k == "takeout":
            chosen_opts[k] = "takeout" if ("포장" in u and "takeout" in cids) else cids[0]
        else:
            chosen_opts[k] = cids[0]

    n = best_item.get("nutrition") or {}
    sugar_g = n.get("sugar", n.get("sugarG", 0))
    caffeine_mg = n.get("caffeine", n.get("caffeineMg", 0))
    sodium_mg = n.get("sodium", n.get("sodiumMg", 0))

    if chosen_opts.get("decaf") == "decaf" or chosen_opts.get("shot") == "decaf":
        reason = f"어르신 말씀대로 가슴이 두근거리지 않게 카페인을 뺀 디카페인 옵션으로 『{best_item['name']}』를 골라드렸어요!"
    elif chosen_opts.get("spicy") == "mild" or chosen_opts.get("spice") == "mild":
        reason = f"어르신 속이 편하시도록 안 매운 순한맛 옵션으로 『{best_item['name']}』를 맞춤 선택해 드렸어요!"
    elif want_no_sodium and sodium_mg < 800:
        reason = f"어르신, 나트륨 부담이 적고({sodium_mg}mg) 따뜻하게 드시기 좋은 『{best_item['name']}』로 골라드렸어요!"
    elif sugar_g == 0 and caffeine_mg == 0 and best_item["category"] == "tea":
        reason = f"어르신, 설탕(0g)과 카페인이 전혀 없고 밤에도 편안한 『{best_item['name']}』로 맞춤 선택해 드렸어요!"
    else:
        reason = f"말씀하신 취향과 건강 조건에 가장 잘 맞는 『{best_item['name']}』로 옵션까지 알맞게 골라드렸어요!"

    qty = _extract_qty(utterance)
    return {"itemId": best_item["id"], "qty": qty, "options": chosen_opts, "reason": reason, "source": "rule-fallback"}


def recommend_by_intent(store: dict, utterance: str, watch: list[str], allergies: list[str]) -> dict:
    """어르신의 자연어 발화(음성 인식 결과)와 건강 설정을 바탕으로 최적의 메뉴와 옵션을 한 번에 세팅한다."""
    plan_res = None
    fallback_qty = _extract_qty(utterance)
    if os.getenv("OPENAI_API_KEY"):
        try:
            menu_summary = []
            for it in store["items"]:
                h = item_health(it)
                menu_summary.append({
                    "id": it["id"],
                    "name": it["name"],
                    "category": it["category"],
                    "desc": it["desc"],
                    "options": it["options"],
                    "healthTags": h["tags"] if h else [],
                    "allergens": it.get("allergens", []),
                })
            sys_prompt = (
                "너는 노약자·장애인을 돕는 친절한 매장 점원 AI야. "
                "할머니·할아버지의 구어체/사투리 말씀(증상, 기분, 건강 상태, 맛 취향, 수량)과 조심하는 성분(watch, allergies)을 보고 "
                "매장 메뉴 중 가장 안전하고 알맞은 메뉴 1개(itemId), 수량(qty, 기본 1), 그 메뉴의 옵션(options)을 모두 골라줘. "
                "만약 카페인을 피하고 싶어하는데 커피를 원하면 decaf(또는 shot) 옵션에서 decaf 를 골라줘. "
                "안 맵거나 순한 것을 원하면 spicy(또는 spice) 옵션에서 mild 를 골라줘. "
                "reason 은 어르신께 말씀드리듯 따뜻하고 쉬운 한 문장(55자 이내)으로 작성해."
            )
            user_payload = {
                "utterance": utterance,
                "watch": watch,
                "allergies": allergies,
                "items": menu_summary,
                # AGENTS.md 1: AI 에는 가격을 보내지 않는다 → 옵션 추가금(price)은 빼고 보냄
                "storeOptions": {k: {**v, "choices": [{kk: vv for kk, vv in c.items() if kk != "price"} for c in v["choices"]]}
                                 for k, v in store["options"].items()},
            }
            res = _openai().chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
                ],
                temperature=0.2,
                response_format={"type": "json_schema", "json_schema": {"name": "intent_order", "strict": True, "schema": INTENT_SCHEMA}},
            )
            parsed = json.loads(res.choices[0].message.content or "")
            item_map = {i["id"]: i for i in store["items"]}
            # 메뉴 이름을 직접 말했으면 그 메뉴를 존중 ("아이스 아메리카노"인데 캐모마일로 바뀌던 문제)
            u_ns = utterance.replace(" ", "")
            named = [i for i in store["items"] if i["name"].replace(" ", "") in u_ns]
            if named:
                parsed["itemId"] = max(named, key=lambda i: len(i["name"]))["id"]
            if parsed.get("itemId") in item_map:
                target_it = item_map[parsed["itemId"]]
                opt_dict: dict[str, str] = {}
                raw_opts = {o["key"]: o["choiceId"] for o in parsed.get("options", [])}
                for k in target_it["options"]:
                    valid_cids = [c["id"] for c in store["options"][k]["choices"]]
                    picked = raw_opts.get(k, valid_cids[0])
                    opt_dict[k] = picked if picked in valid_cids else valid_cids[0]
                # 카페인 조심 + 디카페인 선택지가 있으면 디카페인
                no_caf_words = any(w in u_ns for w in ("디카페인", "카페인", "잠잘", "잠오", "불면", "두근", "가슴"))
                if ("caffeine" in watch or no_caf_words) and "decaf" in opt_dict and any(c["id"] == "decaf" for c in store["options"]["decaf"]["choices"]):
                    opt_dict["decaf"] = "decaf"
                elif "decaf" in opt_dict:
                    opt_dict["decaf"] = store["options"]["decaf"]["choices"][0]["id"]  # 근거 없이 추가금 붙이지 않음
                # 말에 온도가 분명히 있으면 AI 선택보다 우선 ("시원하게"인데 HOT 이 나오던 문제)
                if "temperature" in opt_dict:
                    tcids = [c["id"] for c in store["options"]["temperature"]["choices"]]
                    if any(w in u_ns for w in ("차가", "시원", "얼음", "아이스", "찬거", "아아")) and "ice" in tcids:
                        opt_dict["temperature"] = "ice"
                    elif any(w in u_ns for w in ("따뜻", "뜨거", "따신", "뜨아")) and "hot" in tcids:
                        opt_dict["temperature"] = "hot"
                ai_qty = max(1, min(20, int(parsed.get("qty") or fallback_qty)))
                plan_res = {
                    "itemId": target_it["id"],
                    "qty": ai_qty,
                    "options": opt_dict,
                    "reason": parsed.get("reason") or f"어르신께 꼭 맞는 『{target_it['name']}』로 골라드렸어요!",
                    "source": "ai",
                }
        except Exception:
            plan_res = None

    if not plan_res:
        plan_res = _fallback_intent_match(store, utterance, watch, allergies)

    # 서버 원본 데이터로 정확한 금액·옵션 한글 라벨 계산 (AI가 가격을 조작할 수 없음)
    item = next(i for i in store["items"] if i["id"] == plan_res["itemId"])
    qty = max(1, min(20, int(plan_res.get("qty") or 1)))
    unit_price = item["price"]
    opt_labels = []
    final_opts = {}
    for k in item["options"]:
        choices = store["options"][k]["choices"]
        cid = plan_res["options"].get(k, choices[0]["id"])
        ch = next((c for c in choices if c["id"] == cid), choices[0])
        final_opts[k] = ch["id"]
        unit_price += ch["price"]
        opt_labels.append(ch["name"])

    return {
        "utterance": utterance,
        "itemId": item["id"],
        "itemName": item["name"],
        "qty": qty,
        "options": final_opts,
        "optionSummary": " · ".join(opt_labels) if opt_labels else "기본",
        "unitPrice": unit_price,
        "totalPrice": unit_price * qty,
        "reason": plan_res["reason"],
        "health": item_health(item),
        "source": plan_res["source"],
    }


# ───────────────── 2. 위험 메뉴 선택 시 AI 건강 대체재 역제안 (/api/smart-swap) ─────────────────
def suggest_smart_swap(store: dict, item_id: str, watch: list[str], allergies: list[str]) -> dict:
    """어르신이 주의 성분(당·카페인·나트륨·알레르기)이 든 메뉴를 눌렀을 때 안전한 대체 옵션/메뉴를 제안한다."""
    item = next((i for i in store["items"] if i["id"] == item_id), None)
    if not item:
        return {"hasWarning": False, "swaps": []}

    h = item_health(item) or {"kcal": None, "tags": [], "allergens": []}
    warn_tags = [t for t in h["tags"] if t["id"] in watch]
    warn_algs = [a for a in h["allergens"] if a["id"] in allergies]
    if not warn_tags and not warn_algs:
        return {"hasWarning": False, "swaps": []}

    swaps: list[dict[str, Any]] = []

    # 1-A) 카페인 경고가 있고 이 메뉴에 디카페인 옵션(decaf -> decaf 또는 shot -> decaf)이 있는 경우: 원터치 옵션 스왑 제안
    if any(t["id"] == "caffeine" for t in warn_tags):
        for opt_key in ("decaf", "shot"):
            if opt_key in item.get("options", []):
                opt_choices = store["options"].get(opt_key, {}).get("choices", [])
                decaf_ch = next((c for c in opt_choices if c["id"] == "decaf"), None)
                if decaf_ch:
                    swaps.append({
                        "type": "option",
                        "title": f"✨ 원터치 적용: 카페인 뺀 『{item['name']} (디카페인)』으로 옵션 변경",
                        "desc": f"커피 맛은 그대로 즐기면서 카페인 걱정만 쏙 덜어드려요 (+{decaf_ch['price']:,}원)",
                        "itemId": item["id"],
                        "itemName": item["name"],
                        "overrideOptions": {opt_key: "decaf"},
                        "price": item["price"] + decaf_ch["price"],
                    })
                    break

    # 1-B) 분식집 등 매운맛 옵션(spicy/spice -> mild)이 있는 경우: 순한맛 원터치 옵션 스왑 제안
    for spice_key in ("spicy", "spice"):
        if spice_key in item.get("options", []):
            sp_choices = store["options"].get(spice_key, {}).get("choices", [])
            mild_ch = next((c for c in sp_choices if c["id"] == "mild"), None)
            if mild_ch:
                swaps.append({
                    "type": "option",
                    "title": f"✨ 원터치 적용: 속 편한 『{mild_ch['name']}』 옵션으로 미리 선택",
                    "desc": "자극을 줄인 순한맛으로 옵션을 바로 맞춰 드려요 (추가 금액 없음)",
                    "itemId": item["id"],
                    "itemName": item["name"],
                    "overrideOptions": {spice_key: "mild"},
                    "price": item["price"] + mild_ch["price"],
                })
                break

    # 2) 내 건강 설정(watch + allergies)에 전혀 걸리지 않는 가장 안전한 대체 메뉴 2개 추천
    safe_candidates = []
    for cand in store["items"]:
        if cand["id"] == item["id"]:
            continue
        ch_h = item_health(cand) or {"kcal": None, "tags": [], "allergens": []}
        c_warn_t = [t for t in ch_h["tags"] if t["id"] in watch]
        c_warn_a = [a for a in ch_h["allergens"] if a["id"] in allergies]
        if not c_warn_t and not c_warn_a:
            # 같은 카테고리거나 차(tea)/국물·김밥 종류면 우선순위 높임
            priority = 0 if cand["category"] == item["category"] else (1 if cand["category"] in ("tea", "side", "gimbap") else 2)
            safe_candidates.append((priority, cand, ch_h))

    safe_candidates.sort(key=lambda x: x[0])
    for _, cand, ch_h in safe_candidates[:2]:
        kcal_str = f" · {ch_h['kcal']}kcal" if ch_h.get("kcal") is not None else ""
        swaps.append({
            "type": "item",
            "title": f"걱정 없는 안심 메뉴 『{cand['name']}』({cand['price']:,}원)로 바꾸기",
            "desc": f"조심하시는 성분이 없는 메뉴예요 ({cand['desc']}{kcal_str})",
            "itemId": cand["id"],
            "itemName": cand["name"],
            "overrideOptions": {},
            "price": cand["price"],
        })

    warn_names = [f"{t['label']}({t['amount']})" for t in warn_tags] + [f"{a['name']} 포함" for a in warn_algs]
    return {
        "hasWarning": True,
        "warningSummary": " · ".join(warn_names),
        "aiMessage": f"어르신! 고르신 『{item['name']}』에는 조심하셔야 할 【{' · '.join(warn_names)}】 성분이 들어 있어요. 아래 안심 방법으로 바꿔 드릴까요?",
        "swaps": swaps,
    }


# ───────────────── 3. 사장님용 메뉴판 사진 → Vision AI 매장 자동 생성기 (/api/vision-store) ─────────────────
VISION_STORE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["categories", "items"],
    "properties": {
        "categories": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
            },
        },
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "category", "name", "price", "desc", "fact", "keywords", "kcal", "sugar", "sodium", "caffeine", "allergens"],
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string"},
                    "name": {"type": "string"},
                    "price": {"type": "integer"},
                    "desc": {"type": "string"},
                    "fact": {"type": "string"},
                    "keywords": {"type": "array", "items": {"type": "string"}},
                    "kcal": {"type": "integer"},
                    "sugar": {"type": "integer"},
                    "sodium": {"type": "integer"},
                    "caffeine": {"type": "integer"},
                    "allergens": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}


def _slugify_store_id(store_name: str) -> str:
    ascii_part = re.sub(r"[^a-z0-9]+", "-", store_name.lower()).strip("-")
    return ascii_part or "halmae-bunsik"


def generate_store_from_vision(store_name: str, image_b64: str | None = None) -> dict:
    """종이 메뉴판 사진을 OpenAI Vision(gpt-4o-mini)으로 분석해 영양성분·알레르기·쉬운 설명이 포함된 매장 JSON을 자동 생성한다.
    API 키가 없거나 사진을 올리지 않은 경우에도 시연이 즉시 동작하도록 고품질 기본 매장 데이터를 생성한다.
    """
    clean_title = (store_name or "정겨운 우리동네 국수·분식").strip()
    new_id = _slugify_store_id(clean_title) if clean_title != "정겨운 우리동네 국수·분식" else "halmae-bunsik"

    default_options = {
        "spicy": {
            "name": "맵기",
            "choices": [
                {"id": "mild", "name": "안 맵게 (순한맛)", "price": 0},
                {"id": "normal", "name": "보통 맛", "price": 0},
            ],
        },
        "size": {
            "name": "양 선택",
            "choices": [
                {"id": "regular", "name": "보통 양", "price": 0},
                {"id": "large", "name": "곱빼기 (많이)", "price": 1000},
            ],
        },
    }

    # 실제 이미지 + OpenAI 키가 있으면 GPT-4o-mini Vision 으로 메뉴판 이미지에서 직접 추출
    if image_b64 and os.getenv("OPENAI_API_KEY"):
        try:
            data_url = image_b64 if image_b64.startswith("data:") else f"data:image/jpeg;base64,{image_b64}"
            valid_allergens = ", ".join(ALLERGENS.keys())
            res = _openai().chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "너는 소상공인 종이 메뉴판 사진을 읽어 어르신 친화 디지털 키오스크 매장 JSON을 만드는 Vision AI야. "
                            "사진 속 메뉴 이름과 가격(원 단위 정수), 어르신이 이해하기 쉬운 설명(desc, 22자 이내), "
                            "꼭 남길 핵심 정보(fact)와 검색 키워드(keywords 2~3개), "
                            "1인분 예상 영양성분(kcal, sugar[g], sodium[mg], caffeine[mg]) 및 "
                            f"알레르기 ID({valid_allergens} 중에서만 선택)를 추론해 JSON으로 답해."
                        ),
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": f"매장 이름: {clean_title}\n이 메뉴판 사진에서 메뉴들을 추출해 줘."},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
                temperature=0.2,
                response_format={"type": "json_schema", "json_schema": {"name": "vision_store", "strict": True, "schema": VISION_STORE_SCHEMA}},
            )
            parsed = json.loads(res.choices[0].message.content or "")
            if parsed.get("items"):
                cats = parsed.get("categories") or [{"id": "main", "name": "대표 메뉴"}]
                cat_ids = {c["id"] for c in cats}
                items = []
                for idx, it in enumerate(parsed["items"]):
                    cid = it["category"] if it["category"] in cat_ids else cats[0]["id"]
                    algs = [a for a in it.get("allergens", []) if a in ALLERGENS]
                    kw = [k for k in it.get("keywords", []) if k] or [it["name"][:2]]
                    items.append({
                        "id": it.get("id") or f"vision-item-{idx + 1}",
                        "category": cid,
                        "name": it["name"],
                        "price": max(500, int(it["price"])),
                        "desc": it["desc"],
                        "options": ["size"],
                        "must": [{"fact": it["fact"] or it["desc"], "any": kw}],
                        "nutrition": {
                            "kcal": int(it["kcal"]),
                            "sugar": int(it["sugar"]),
                            "sodium": int(it["sodium"]),
                            "caffeine": int(it["caffeine"]),
                        },
                        "allergens": algs,
                    })
                return {
                    "id": new_id,
                    "store": clean_title,
                    "version": "2026-10-28-ai-vision",
                    "currency": "원",
                    "nutritionSource": "Vision AI 메뉴판 사진 자동 추출 및 예상 영양성분",
                    "categories": cats,
                    "options": default_options,
                    "items": items,
                }
        except Exception:
            pass

    # 기본 고품질 생성 템플릿 (health.py 기준 키: kcal, sugar, sodium, caffeine)
    return {
        "id": new_id,
        "store": clean_title,
        "version": "2026-10-28-ai-vision",
        "currency": "원",
        "nutritionSource": "Vision AI 자동 생성 예시 값 (기본 1인분 기준)",
        "categories": [
            {"id": "noodle", "name": "따뜻한 국수·떡국"},
            {"id": "bunsik", "name": "떡볶이·김밥"},
            {"id": "side", "name": "만두·전통음료"},
        ],
        "options": default_options,
        "items": [
            {
                "id": "janchi-guksu",
                "category": "noodle",
                "name": "멸치 잔치국수",
                "price": 6000,
                "desc": "따뜻한 멸치 육수에 부드러운 소면 국수",
                "options": ["size"],
                "must": [{"fact": "따뜻한 멸치 국물이에요", "any": ["멸치", "국물", "따뜻"]}],
                "nutrition": {"kcal": 420, "sugar": 3, "sodium": 680, "caffeine": 0},
                "allergens": ["wheat", "egg"],
            },
            {
                "id": "roze-tteokbokki",
                "category": "bunsik",
                "name": "크림 로제 떡볶이",
                "price": 7500,
                "desc": "우유 생크림을 넣어 덜 맵고 부드러운 떡볶이",
                "options": ["spicy", "size"],
                "must": [{"fact": "우유 크림이 들어 있어요", "any": ["우유", "크림", "떡볶이"]}],
                "nutrition": {"kcal": 680, "sugar": 26, "sodium": 920, "caffeine": 0},
                "allergens": ["milk", "wheat", "soy"],
            },
            {
                "id": "yachae-kimbap",
                "category": "bunsik",
                "name": "집김밥 (야채김밥)",
                "price": 4000,
                "desc": "당근·시금치·계란이 들어간 담백한 김밥 한 줄",
                "options": [],
                "must": [{"fact": "야채와 계란이 들어 있어요", "any": ["야채", "계란", "달걀", "김밥"]}],
                "nutrition": {"kcal": 380, "sugar": 2, "sodium": 450, "caffeine": 0},
                "allergens": ["egg", "wheat", "soy"],
            },
            {
                "id": "galbi-mandu",
                "category": "side",
                "name": "달콤 갈비만두 (6개)",
                "price": 4500,
                "desc": "달콤한 간장 양념 고기가 들어간 찐만두",
                "options": [],
                "must": [{"fact": "돼지고기가 들어 있어요", "any": ["고기", "돼지", "달콤", "만두"]}],
                "nutrition": {"kcal": 410, "sugar": 22, "sodium": 540, "caffeine": 0},
                "allergens": ["pork", "wheat", "soy"],
            },
            {
                "id": "sikhye",
                "category": "side",
                "name": "전통 살얼음 식혜",
                "price": 2500,
                "desc": "달콤하고 시원한 전통 쌀 음료",
                "options": [],
                "must": [{"fact": "차갑고 달콤한 쌀 음료예요", "any": ["달콤", "시원", "차가운", "쌀"]}],
                "nutrition": {"kcal": 210, "sugar": 32, "sodium": 15, "caffeine": 0},
                "allergens": [],
            },
        ],
    }
