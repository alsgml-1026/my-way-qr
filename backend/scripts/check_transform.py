r"""AI 변환 성공률 측정 — 보고서의 '변환 성공률' 숫자를 만드는 스크립트

실행 (my-way-qr 폴더에서):
  backend\.venv\Scripts\python backend\scripts\check_transform.py          # 설정 6가지 × 1번
  backend\.venv\Scripts\python backend\scripts\check_transform.py 5        # 설정 6가지 × 5번 = 30번
  backend\.venv\Scripts\python backend\scripts\check_transform.py 1 show   # 결과 화면 내용도 출력
  backend\.venv\Scripts\python backend\scripts\check_transform.py 5 save   # 결과를 docs/samples 에 저장
      → docs/samples/측정기록.csv  (한 번 돌릴 때마다 줄이 쌓임: 날짜·규칙·설정·성공·시도·시간·틀린 검사)
      → docs/samples/AI_변환_샘플.md (설정별 원래 설명 vs AI 설명 — 제출물 '샘플 결과물')

'1회 통과율' = AI 첫 답이 검사를 바로 통과한 비율
'최종 성공률' = 다시 시키기(최대 2번)까지 포함해 AI 화면이 나간 비율 (나머지는 원본 화면)
"""
import csv
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env", override=True)

from app import ai_rules  # noqa: E402
from app.transform import transform  # noqa: E402

repeat = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 1
show = "show" in sys.argv
save = "save" in sys.argv
store = json.loads((ROOT / "app" / "data" / "stores" / "modui-cafe.json").read_text(encoding="utf-8"))
FONT_KO = {"normal": "보통 글씨", "large": "큰 글씨", "xlarge": "아주 큰 글씨"}

combos = [(f, e) for f in ("normal", "large", "xlarge") for e in (True, False)]
total = first_pass = final_ok = 0
fails = Counter()
times = []
rows = []
samples = {}  # 설정별 첫 성공 결과
now = datetime.now().strftime("%Y-%m-%d %H:%M")

print(f"규칙 {ai_rules.RULES_VERSION} / 매장 {store['store']} / 설정 {len(combos)}가지 × {repeat}번\n")
for font, easy in combos:
    for _ in range(repeat):
        r = transform(store, font, easy, fresh=True)
        total += 1
        times.append(r["elapsedMs"])
        ok = r["source"] == "ai"
        final_ok += ok
        first_pass += ok and r["attempts"] == 1
        bad = [c["name"] for c in r["checks"] if not c["ok"]]
        fails.update(bad)
        if ok and (font, easy) not in samples:
            samples[(font, easy)] = r
        rows.append([now, ai_rules.RULES_VERSION, store["id"], font, "켬" if easy else "끔",
                     "성공" if ok else "실패", r["attempts"], r["elapsedMs"], " / ".join(bad), r["error"] or ""])
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

summary = (f"1회 통과율 {first_pass}/{total} ({first_pass / total:.0%})  |  최종 성공률 {final_ok}/{total} ({final_ok / total:.0%})"
           f"  |  평균 {sum(times) / len(times) / 1000:.1f}초")
print("\n" + summary)
if fails:
    print("마지막 시도에서 틀린 검사:", ", ".join(f"{k} {v}번" for k, v in fails.most_common()))

if save:
    out = ROOT.parent / "docs" / "samples"
    out.mkdir(parents=True, exist_ok=True)

    log = out / "측정기록.csv"
    new = not log.exists()
    with log.open("a", newline="", encoding="utf-8-sig") as f:  # utf-8-sig: 엑셀에서 한글 안 깨짐
        w = csv.writer(f)
        if new:
            w.writerow(["측정 시각", "규칙", "매장", "글씨", "쉬운 말", "결과", "시도 횟수", "걸린 시간(ms)", "틀린 검사", "오류"])
        w.writerows(rows)

    md = [f"# AI 화면 변환 샘플 결과 — {store['store']}", "",
          f"- 측정: {now} · 규칙 `{ai_rules.RULES_VERSION}` · 모델 gpt-4o-mini",
          f"- {summary}",
          "- 검사 8개: 형식 · 원본 메뉴 모두 포함 · 지어낸 메뉴 없음 · 옵션 ID 일치 · 문구에 가격 없음 · "
          "글씨 크기별 길이 · 어려운 말 없음 · 꼭 남길 정보 포함", ""]
    for (font, easy), r in samples.items():
        md += [f"## {FONT_KO[font]} · 쉬운 말 {'켬' if easy else '끔'} (설명 {ai_rules.DESC_MAX[font]}자 이하)", "",
               "| 묶음 | 메뉴 | 원래 설명 | AI 설명 |", "|---|---|---|---|"]
        for g in r["groups"]:
            for it in g["items"]:
                md.append(f"| {g['title']} | {it['name']} | {it['originalDesc']} | {it['desc']} |")
        md += ["", "| 옵션 | AI 질문 | 선택지 (원래 → AI) |", "|---|---|---|"]
        for o in r["options"].values():
            md.append(f"| {o['name']} | {o['question']} | " + " / ".join(f"{c['name']} → {c['label']}" for c in o["choices"]) + " |")
        md.append("")
    (out / "AI_변환_샘플.md").write_text("\n".join(md), encoding="utf-8")
    print(f"\n저장: {log}\n저장: {out / 'AI_변환_샘플.md'}")
