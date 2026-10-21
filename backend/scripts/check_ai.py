r"""AI 연결 확인 — 키 내용은 화면에 출력하지 않는다.

실행 (backend 폴더에서):  .venv\Scripts\python scripts\check_ai.py
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.stdout.reconfigure(encoding="utf-8")
# override=True: PC 환경변수보다 .env 값을 우선한다 (어느 키를 쓰는지 .env 에서 명확히 정함)
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

key = os.getenv("OPENAI_API_KEY", "").strip()
model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
if not key:
    print("❌ .env 에 OPENAI_API_KEY 가 비어 있어요.")
    sys.exit(1)
print(f"키 확인: {key[:3]}…{key[-4:]} ({len(key)}자) / 모델: {model}")

from openai import OpenAI  # noqa: E402

try:
    res = OpenAI(api_key=key).chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "'12H 저온추출'을 어르신이 이해하기 쉬운 한 문장으로 바꿔 줘."}],
        max_tokens=60,
    )
except Exception as e:  # 키 오류·권한·네트워크
    print(f"❌ 호출 실패: {type(e).__name__}: {e}")
    sys.exit(1)
print("✅ AI 연결 성공")
print("응답 예시:", res.choices[0].message.content.strip())
