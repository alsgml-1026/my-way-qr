r"""AI 변환 성공률 측정 — 보고서의 '변환 성공률' 숫자를 만드는 스크립트

실행 (my-way-qr 폴더에서):
  backend\.venv\Scripts\python backend\scripts\check_transform.py          # 설정 6가지 × 1번
  backend\.venv\Scripts\python backend\scripts\check_transform.py 5        # 설정 6가지 × 5번 = 30번
  backend\.venv\Scripts\python backend\scripts\check_transform.py 1 show   # 결과 화면 내용도 출력

'1회 통과율' = AI 첫 답이 검사 6개를 바로 통과한 비율
'최종 성공률' = 다시 시키기(최대 2번)까지 포함해 AI 화면이 나간 비율 (나머지는 원본 화면)
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env", override=True)

from app import ai_rules  # noqa: E402
from app.transform import transform  # noqa: E402

repeat = int(sys.argv[1]) if len(sys.argv) > 1 else 1
show = "show" in sys.argv
store = json.loads((ROOT / "app" / "data" / "stores" / "dajeong-cafe.json").read_text(encoding="utf-8"))

combos = [(f, e) for f in ("normal", "large", "xlarge") for e in (True, False)]
total = first_pass = final_ok = 0
fails = Counter()
times = []

print(f"규칙 {ai_rules.RULES_VERSION} / 매장 {store['store']} / 설정 {len(combos)}가지 × {repeat}번\n")
for font, easy in combos:
    for _ in range(repeat):
        r = transform(store, font, easy, fresh=True)
        total += 1
        times.append(r["elapsedMs"])
        ok = r["source"] == "ai"
        final_ok += ok
        first_pass += ok and r["attempts"] == 1
        for c in r["checks"]:
            if not c["ok"]:
                fails[c["name"]] += 1
        mark = "✅" if ok else "❌"
        print(f"{mark} 글씨={font:<6} 쉬운말={'켬' if easy else '끔'}  시도 {r['attempts']}번  {r['elapsedMs'] / 1000:.1f}초"
              + (f"  ({r['error']})" if r["error"] else ""))
        if not ok and r["checks"]:
            for c in r["checks"]:
                if not c["ok"]:
                    print(f"     - {c['name']}: {c['detail']}")
        if show:
            for g in r["groups"]:
                print(f"   [{g['title']}]")
                for it in g["items"]:
                    print(f"     {it['name']}: {it['desc']}")
            for k, o in r["options"].items():
                print(f"   ? {o['question']}  → " + " / ".join(c["label"] for c in o["choices"]))
            print()

print(f"\n1회 통과율 {first_pass}/{total} ({first_pass / total:.0%})  |  최종 성공률 {final_ok}/{total} ({final_ok / total:.0%})"
      f"  |  평균 {sum(times) / len(times) / 1000:.1f}초")
if fails:
    print("마지막 시도에서 자주 틀린 검사:", ", ".join(f"{k} {v}번" for k, v in fails.most_common()))
