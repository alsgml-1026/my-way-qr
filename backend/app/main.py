"""내 방식 QR — 백엔드 서버 (FastAPI)

실행:  backend 폴더 안에서
       .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8010
       (--reload 는 쓰지 않는다: 코드 수정 후에는 서버를 껐다 켠다)

API (docs/architecture.png 의 단계 기호와 같음)
- A  POST /api/sessions          키오스크가 주문 창구를 연다 → 창구번호(QR 에 넣음)
- B  GET  /api/menu?store=       매장 원본 메뉴 (가격의 유일한 출처)
- C  POST /api/transform         AI 맞춤 화면 (원본 메뉴 + 내 설정 → 검사 통과한 설계도 + 원본 가격)
- D  POST /api/orders            주문 → 서버가 원본으로 금액 재계산 → 목업 결제 → 주문번호
- E  GET  /api/sessions/{id}     키오스크가 2초마다 주문 완료 여부 확인
-    POST /api/sessions/{id}/test-start, GET /api/test-results   사용자 테스트 시간 기록 (/kiosk?test)
-    GET  /api/health, /api/host 개발용
"""
import csv
import json
import os
import secrets
import socket
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .ai_assist import generate_store_from_vision, recommend_by_intent, suggest_smart_swap, transcribe_audio_base64
from .health import check_store, enabled as health_enabled, item_health
from .transform import transform as ai_transform, warm_cache

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

# ───────────────── 매장 데이터 ─────────────────
# data/stores/*.json 하나가 매장(키오스크) 하나. 파일만 추가하면 새 매장이 생긴다.
STORES_DIR = Path(__file__).resolve().parent / "data" / "stores"
STORES: dict[str, dict] = {}
for f in sorted(STORES_DIR.glob("*.json")):
    data = json.loads(f.read_text(encoding="utf-8"))
    check_store(data)
    STORES[data["id"]] = data
DEFAULT_STORE = "modui-cafe"


def get_store(store_id: str) -> dict:
    store = STORES.get(store_id)
    if not store:
        raise HTTPException(404, f"없는 매장이에요: {store_id}")
    return store


app = FastAPI(title="내 방식 QR API", version="0.3.0")


# 서버가 켜지면 뒤에서 AI 화면을 미리 만들어 둔다 (끄려면 .env 에 WARM_CACHE=0)
@app.on_event("startup")
def _warm():
    if os.getenv("WARM_CACHE", "1") != "0":
        threading.Thread(target=warm_cache, args=(list(STORES.values()),), daemon=True).start()


@app.get("/api/health")
def health():
    return {"ok": True, "stores": {k: v["version"] for k, v in STORES.items()},
            "features": {"health": health_enabled()}}  # 폰 설정 화면이 건강 항목을 보일지 정함


# ───────────────── B. 메뉴 ─────────────────
@app.get("/api/menu")
def get_menu(store: str = DEFAULT_STORE):
    s = get_store(store)
    # 건강 표시용 태그는 서버가 붙인다 (기준값은 health.py)
    return {**s, "items": [{**i, "health": item_health(i)} for i in s["items"]]}


# ───────────────── C. AI 화면 변환 ─────────────────
class TransformProfile(BaseModel):
    fontSize: str = "large"  # normal | large | xlarge
    easyWords: bool = True
    # bigButtons·highContrast 는 화면(CSS)만 바꾸므로 AI 에 보내지 않는다


class TransformRequest(BaseModel):
    store: str = DEFAULT_STORE
    profile: TransformProfile = Field(default_factory=TransformProfile)
    fresh: bool = False  # True 면 캐시 무시 (성공률 측정용)


@app.post("/api/transform")
def transform_screen(body: TransformRequest):
    store = get_store(body.store)
    # 공개 배포에서는 ALLOW_FRESH=0 → 누구나 캐시를 건너뛰어 AI 비용을 쓰게 하지 않는다
    fresh = body.fresh and os.getenv("ALLOW_FRESH", "1") != "0"
    return ai_transform(store, body.profile.fontSize, body.profile.easyWords, fresh=fresh)


# ───────────────── C-2. 신박한 AI 3대 확장 기능 (음성/의도 주문 · 대체 추천 · 메뉴판 비전) ─────────────────
class SttRequest(BaseModel):
    audioBase64: str
    mimeType: str = "audio/webm"


@app.post("/api/stt")
def stt_endpoint(body: SttRequest):
    text = transcribe_audio_base64(body.audioBase64, body.mimeType)
    return {"text": text}


class IntentOrderRequest(BaseModel):
    store: str = DEFAULT_STORE
    utterance: str = Field(min_length=1, max_length=300)
    watch: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)


@app.post("/api/intent-order")
def intent_order_endpoint(body: IntentOrderRequest):
    store = get_store(body.store)
    return recommend_by_intent(store, body.utterance, body.watch, body.allergies)


class SmartSwapRequest(BaseModel):
    store: str = DEFAULT_STORE
    itemId: str
    watch: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)


@app.post("/api/smart-swap")
def smart_swap_endpoint(body: SmartSwapRequest):
    store = get_store(body.store)
    return suggest_smart_swap(store, body.itemId, body.watch, body.allergies)


class VisionStoreRequest(BaseModel):
    storeName: str = "정겨운 우리동네 국수·분식"
    imageBase64: str | None = None


@app.post("/api/vision-store")
def vision_store_endpoint(body: VisionStoreRequest):
    new_store = generate_store_from_vision(body.storeName, body.imageBase64)
    check_store(new_store)
    STORES[new_store["id"]] = new_store
    return {"ok": True, "store": new_store}


# ───────────────── A·E. 주문 창구(세션) ─────────────────
# 시제품이라 메모리에만 보관한다. 서버를 껐다 켜면 사라진다.
SESSIONS: dict[str, dict] = {}
_lock = threading.Lock()
_order_seq = 0
SESSION_TTL = 60 * 60  # 1시간 지난 창구는 정리


class SessionCreate(BaseModel):
    store: str = DEFAULT_STORE


def _new_session_id() -> str:
    # 헷갈리는 글자(0/O, 1/I)를 뺀 4자리
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(4))


@app.post("/api/sessions")
def create_session(body: SessionCreate):
    get_store(body.store)
    now = time.time()
    with _lock:
        for sid in [k for k, v in SESSIONS.items() if now - v["created"] > SESSION_TTL]:
            del SESSIONS[sid]
        sid = _new_session_id()
        while sid in SESSIONS:
            sid = _new_session_id()
        SESSIONS[sid] = {"store": body.store, "status": "waiting", "order": None, "created": now, "test": None}
    return {"session": sid, "store": body.store}


@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    s = SESSIONS.get(sid)
    if not s:
        raise HTTPException(404, "없는 주문 창구예요")
    order = s["order"]
    return {
        "session": sid,
        "store": s["store"],
        "status": s["status"],  # waiting(주문 대기) | paid(결제 완료)
        "orderNo": order["orderNo"] if order else None,
        "total": order["total"] if order else None,
        "channel": order["channel"] if order else None,  # phone(내 방식 QR) | kiosk(기존 화면)
        "seconds": order.get("seconds") if order else None,  # 사용자 테스트: 시작 → 결제까지 걸린 초
        "test": s["test"],  # 사용자 테스트 진행 중이면 {participant, startedAt}
    }


# ───────────────── D. 주문 ─────────────────
class OrderLine(BaseModel):
    id: str
    options: dict[str, str] = Field(default_factory=dict)  # 예: {"temperature": "ice", "size": "large"}
    qty: int = Field(1, ge=1, le=20)


class OrderCreate(BaseModel):
    session: str
    items: list[OrderLine] = Field(min_length=1)
    # 아래는 사용자 테스트 기록용 (금액 계산에는 쓰지 않음)
    channel: Literal["phone", "kiosk"] = "phone"  # phone = 내 방식 QR, kiosk = 기존 키오스크 화면
    undo: int = Field(0, ge=0, le=999)  # 되돌리기(이전·취소·빼기) 누른 횟수
    profile: TransformProfile | None = None  # 폰 설정(글씨·쉬운 말)


def price_line(store: dict, line: OrderLine) -> dict:
    """원본 메뉴로 한 줄의 금액을 계산한다. 폰이 보낸 금액은 받지도 않는다."""
    item = next((i for i in store["items"] if i["id"] == line.id), None)
    if not item:
        raise HTTPException(400, f"없는 메뉴예요: {line.id}")
    unknown = set(line.options) - set(item["options"])
    if unknown:
        raise HTTPException(400, f"{item['name']}에는 없는 옵션이에요: {', '.join(sorted(unknown))}")

    unit = item["price"]
    chosen = []
    for key in item["options"]:
        choices = store["options"][key]["choices"]
        cid = line.options.get(key, choices[0]["id"])  # 안 고르면 첫 번째(기본값)
        choice = next((c for c in choices if c["id"] == cid), None)
        if not choice:
            raise HTTPException(400, f"{item['name']}의 {store['options'][key]['name']} 선택이 잘못됐어요: {cid}")
        unit += choice["price"]
        chosen.append({"option": key, "choice": cid, "name": choice["name"], "price": choice["price"]})
    return {"id": item["id"], "name": item["name"], "qty": line.qty, "unitPrice": unit,
            "amount": unit * line.qty, "options": chosen}


@app.post("/api/orders")
def create_order(body: OrderCreate):
    global _order_seq
    s = SESSIONS.get(body.session)
    if not s:
        raise HTTPException(404, "주문 창구가 없어요. 키오스크 QR 을 다시 찍어 주세요.")
    store = get_store(s["store"])
    lines = [price_line(store, ln) for ln in body.items]
    total = sum(ln["amount"] for ln in lines)
    with _lock:
        if s["status"] != "waiting":
            raise HTTPException(409, "이미 주문이 끝난 창구예요. 키오스크 QR 을 다시 찍어 주세요.")
        _order_seq += 1
        order = {"orderNo": _order_seq, "total": total, "lines": lines, "paidAt": time.time(),
                 "payment": "mock", "channel": body.channel}  # 목업 결제: 실제 결제 없이 성공 처리
        if s["test"]:
            order["seconds"] = round(order["paidAt"] - s["test"]["startedAt"], 1)
        s["order"] = order
        s["status"] = "paid"
    if s["test"]:
        write_test_result(s, order, body)
    return {"orderNo": order["orderNo"], "total": total, "lines": lines, "seconds": order.get("seconds")}


# ───────────────── 사용자 테스트 기록 (/kiosk?test) ─────────────────
# 진행자가 키오스크에서 '시작'을 누른 순간 → 결제 완료까지 걸린 시간을 서버 시계로 잰다.
# 기존 키오스크 화면과 내 방식 QR 이 같은 창구·같은 메뉴·같은 시계를 쓰므로 공정하게 비교된다.
TEST_LOG = Path(__file__).resolve().parent.parent / "test_results" / "사용자테스트.csv"
TEST_FIELDS = ["시각", "참가자", "매장", "방식", "걸린초", "되돌리기", "금액", "메뉴수", "글씨", "쉬운말"]
CHANNEL_NAMES = {"phone": "내 방식 QR", "kiosk": "기존 키오스크"}
_log_lock = threading.Lock()


class TestStart(BaseModel):
    participant: str = Field(min_length=1, max_length=20)  # 예: P1 (이름 대신 번호)


@app.post("/api/sessions/{sid}/test-start")
def test_start(sid: str, body: TestStart):
    s = SESSIONS.get(sid)
    if not s:
        raise HTTPException(404, "없는 주문 창구예요")
    with _lock:
        if s["status"] != "waiting":
            raise HTTPException(409, "이미 주문이 끝난 창구예요")
        s["test"] = {"participant": body.participant.strip(), "startedAt": time.time()}
    return {"session": sid, **s["test"]}


def write_test_result(s: dict, order: dict, body: OrderCreate) -> None:
    row = {
        "시각": datetime.fromtimestamp(order["paidAt"]).strftime("%Y-%m-%d %H:%M:%S"),
        "참가자": s["test"]["participant"],
        "매장": s["store"],
        "방식": CHANNEL_NAMES[body.channel],
        "걸린초": order["seconds"],
        "되돌리기": body.undo,
        "금액": order["total"],
        "메뉴수": sum(ln["qty"] for ln in order["lines"]),
        "글씨": body.profile.fontSize if body.profile else "",
        "쉬운말": ("켬" if body.profile.easyWords else "끔") if body.profile else "",
    }
    with _log_lock:
        TEST_LOG.parent.mkdir(exist_ok=True)
        new = not TEST_LOG.exists()
        with TEST_LOG.open("a", encoding="utf-8-sig" if new else "utf-8", newline="") as f:  # 엑셀에서 한글이 안 깨지게
            w = csv.DictWriter(f, fieldnames=TEST_FIELDS)
            if new:
                w.writeheader()
            w.writerow(row)


@app.get("/api/test-results")
def test_results(limit: int = 20):
    if not TEST_LOG.exists():
        return []
    with TEST_LOG.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    return rows[-limit:][::-1]  # 최근 것부터


# ───────────────── 개발용 ─────────────────
def lan_ip() -> str:
    """외부로 나가는 기본 네트워크 카드의 IP. 실제로 패킷을 보내지는 않는다."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


@app.get("/api/host")
def get_host():
    return {"ip": lan_ip()}


# ───────────────── 배포용: 화면(frontend/dist)도 이 서버가 내보낸다 ─────────────────
# 개발 때는 dist 가 없으므로 건너뛴다 (화면은 vite 5180 이 맡음).
# 배포에서는 주소 하나로 화면·API 를 모두 쓴다 → 창구·주문번호가 서버 한 대 메모리에 있어 그대로 동작
DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if DIST_DIR.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "없는 주소예요")
        f = (DIST_DIR / path).resolve()
        if path and f.is_file() and DIST_DIR in f.parents:
            return FileResponse(f)
        return FileResponse(DIST_DIR / "index.html")  # /kiosk, /m/cart 같은 화면 주소
