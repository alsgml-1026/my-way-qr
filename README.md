# 내 방식 QR — 범용 접근성 프로필 패스

> 2026 AI 라이프 솔루션 챌린지 · 아이디어 5번 구현

키오스크를 이용하기 어려운 사람이 **키오스크에 뜬 QR을 휴대폰으로 스캔**하면,
**AI가 사용자의 접근성 설정(큰 글씨·큰 버튼·쉬운 설명·고대비)에 맞춰 만든 주문 화면**이 휴대폰에서 열리는 웹 시제품입니다.

## 이용 흐름
1. 카페 키오스크 화면에 QR 코드가 표시됩니다.
2. 사용자가 휴대폰으로 QR을 스캔합니다.
3. (처음 한 번) 내 접근성 설정을 고르면 휴대폰에 저장됩니다.
4. AI가 설정에 맞게 변환한 주문 화면이 열립니다.
5. 메뉴·옵션 선택 → 장바구니 → 목업 결제로 주문을 마칩니다.

## 시스템 구조
![시스템 구조도](docs/architecture.png)

> 원본: [`docs/architecture.html`](docs/architecture.html) — 수정 후 Chrome 으로 다시 캡처

## 구성 (예정)
- `frontend/` — React: 키오스크 화면, 설정 화면, 폰 주문 화면
- `backend/` — FastAPI: 메뉴 API, AI 화면 변환 API, 주문 목업 API

## 실행 방법 (개발용)
터미널 2개를 열어 각각 실행합니다.

```powershell
# 1) 서버 (최초 1회: python -m venv backend\.venv ; backend\.venv\Scripts\pip install -r backend\requirements.txt)
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8010

# 2) 화면 (최초 1회: npm install)
cd frontend
npm run dev
```

- PC: http://localhost:5180
- 폰(같은 와이파이): http://<PC의 IP>:5180/m

## 상태
🚧 개발 중 (2026-10-20 시작)
