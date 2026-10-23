# 작업 규칙 (사람·AI 코딩 도구 공통)

이 저장소는 사람 2명(정민희·황재성)과 AI 코딩 도구 2개(Claude Code·아스트라)가 함께 만든다.
**코드를 고치기 전에 이 파일을 먼저 읽고 지킨다.** (확정 — 2026-10-23, 바꿀 때는 민희 확인)

## 1. 서비스 원칙 (절대 바꾸지 않음)
- 키오스크는 QR만 띄운다 · 폰은 화면만 그린다 · AI는 화면 설계도만 만든다 · **판단(검사·가격·주문)은 전부 서버**
- **AI에는 가격을 보내지 않는다.** 가격은 서버가 원본 메뉴(`backend/app/data/stores/*.json`)에서 붙인다.
- **주문 금액은 서버가 다시 계산한다.** 폰이 보낸 금액은 믿지 않는다 (`POST /api/orders`).
- AI 결과는 검사(`backend/app/transform.py` 의 `validate`)를 통과해야만 화면에 쓴다. 실패하면 원래 메뉴 화면 → **주문은 항상 가능해야 한다.**
- OpenAI 키는 `backend/.env` 에만. 코드·문서·커밋·채팅에 키를 쓰지 않는다.

## 2. 누가 어디를 고치나
| 영역 | 담당 | 파일 |
|---|---|---|
| AI 변환 규칙·지시문·검사 | 민희 | `backend/app/ai_rules.py`, `backend/app/transform.py` |
| 폰 메뉴 화면 | 민희 | `frontend/src/pages/PhoneOrderPage.tsx` |
| 폰 옵션 → 장바구니 → 결제 → 완료 | 황재성 | `frontend/src/pages/` 새 파일 |
| 배포, 서버 정리 | 황재성 | 배포 설정 파일, `backend/app/main.py` |
| 매장 추가 | 황재성 | `backend/app/data/stores/새매장.json` (코드 수정 없이 파일만) |

남의 영역 파일을 고쳐야 하면 PR 설명에 이유를 쓴다.

## 3. 옵션 화면이 지킬 약속
- 질문은 `POST /api/transform` 결과의 `options[key].question`, 선택지는 `choices[].label` 을 쓴다 (AI가 쉬운 말로 바꾼 문장).
- 질문 순서는 `item.options` 배열 순서 그대로 (서버가 이미 정렬해서 준다). **한 화면에 질문 하나.**
- 주문할 때는 옵션 **ID**(`choices[].id`)만 보낸다. 이름·금액은 보내지 않는다.

## 4. Git 작업 방식
- `main` 에 바로 올리지 않는다. 각자 브랜치(`feat/order-flow`, `feat/ai-rules-v3` 등) → PR → **민희가 폰으로 확인 후 합친다.**
- 커밋 메시지는 한국어, 무엇을 왜 바꿨는지.
- 다른 공모전·회사 코드(KAMP, CPT 등)를 섞지 않는다 (공모전 규정).

## 5. 실행·확인
```powershell
# 서버 (backend 폴더)
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8010   # --reload 쓰지 않음
# 화면 (frontend 폴더)
npm run dev        # http://localhost:5180
# AI 변환 성공률 (저장소 폴더)
backend\.venv\Scripts\python backend\scripts\check_transform.py 3
```
PR 전에 확인: `npx tsc -b` 통과 · `/kiosk` QR → 폰 주문 → 키오스크에 주문번호까지 동작.
