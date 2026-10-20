"""내 방식 QR — 백엔드 서버 (FastAPI)

실행:  backend/.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8010
       (backend 폴더 안에서 실행)

지금 있는 API
- GET /api/health   서버 상태 확인
- GET /api/menu     가상 카페 원본 메뉴 (가격의 유일한 출처)
- GET /api/host     PC 의 내부망 IP (키오스크 QR 에 넣을 주소 만들 때 사용)
"""
import json
import socket
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATA_DIR = Path(__file__).resolve().parent / "data"
MENU = json.loads((DATA_DIR / "menu.json").read_text(encoding="utf-8"))

app = FastAPI(title="내 방식 QR API", version="0.1.0")


@app.get("/api/health")
def health():
    return {"ok": True, "menu_version": MENU["version"]}


@app.get("/api/menu")
def get_menu():
    return MENU


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
