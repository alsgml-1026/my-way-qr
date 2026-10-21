"""내 방식 QR — 백엔드 서버 (FastAPI)

실행:  backend 폴더 안에서
       .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8010
       (--reload 는 쓰지 않는다: 코드 수정 후에는 서버를 껐다 켠다)

API (docs/architecture.png 의 단계 기호와 같음)
- A  POST /api/sessions          키오스크가 주문 창구를 연다 → 창구번호(QR 에 넣음)
- B  GET  /api/menu?store=       매장 원본 메뉴 (가격의 유일한 출처)
- C  POST /api/transform         AI 맞춤 화면 (10/21 예정)
- D  POST /api/orders            주문 → 서버가 원본으로 금액 재계산 → 목업 결제 → 주문번호
- E  GET  /api/sessions/{id}     키오스크가 2초마다 주문 완료 여부 확인
-    GET  /api/health, /api/host 개발용
"""
import json
import secrets
import socket
import threading
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

# ───────────────── 매장 데이터 ─────────────────
# data/stores/*.json 하나가 매장(키오스크) 하나. 파일만 추가하면 새 매장이 생긴다.
STORES_DIR = Path(__file__).resolve().parent / "data" / "stores"
STORES: dict[str, dict] = {}
for f in sorted(STORES_DIR.glob("*.json")):
    data = json.loads(f.read_text(encoding="utf-8"))
    STORES[data["id"]] = data
DEFAULT_STORE = "dajeong-cafe"


def get_store(store_id: str) -> dict:
    store = STORES.get(store_id)
    if not store:
        raise HTTPException(404, f"없는 매장이에요: {store_id}")
    return store


app = FastAPI(title="내 방식 QR API", version="0.2.0")


@app.get("/api/health")
def health():
    return {"ok": True, "stores": {k: v["version"] for k, v in STORES.items()}}


# ───────────────── B. 메뉴 ─────────────────
@app.get("/api/menu")
def get_menu(store: str = DEFAULT_STORE):
    return get_store(store)


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
        SESSIONS[sid] = {"store": body.store, "status": "waiting", "order": None, "created": now}
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
    }


# ───────────────── D. 주문 ─────────────────
class OrderLine(BaseModel):
    id: str
    options: dict[str, str] = Field(default_factory=dict)  # 예: {"temperature": "ice", "size": "large"}
    qty: int = Field(1, ge=1, le=20)


class OrderCreate(BaseModel):
    session: str
    items: list[OrderLine] = Field(min_length=1)


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
                 "payment": "mock"}  # 목업 결제: 실제 결제 없이 성공 처리
        s["order"] = order
        s["status"] = "paid"
    return {"orderNo": order["orderNo"], "total": total, "lines": lines}


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
