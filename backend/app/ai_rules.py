"""AI 화면 변환 규칙 — 민희가 정하고 고치는 파일

이 파일만 고치면 AI 가 만드는 화면이 바뀐다. (코드 로직은 transform.py)
규칙을 바꾸면 RULES_VERSION 을 올린다 → 예전 캐시가 자동으로 버려진다.

❓ 표시 = 10/22 회의에서 확정할 값 (지금은 초안)
"""

RULES_VERSION = "v1-draft"

# ❓ 1. 설명 길이: 글씨가 클수록 한 화면에 들어가는 글자가 적으므로 짧게
DESC_MAX = {"normal": 40, "large": 28, "xlarge": 18}  # 글자 수(공백 포함)
QUESTION_MAX = 24  # 옵션 질문 문장 길이

# ❓ 2. 메뉴 묶음: "original" = 매장 분류 그대로 / "ai" = AI 가 이해하기 쉽게 다시 묶음
GROUPING = "ai"

# ❓ 3. 옵션 질문 순서 (화면 하나에 질문 하나, 이 순서대로)
OPTION_ORDER = ["temperature", "size", "shot", "decaf"]

# 하면 안 되는 것 (검사 장치가 자동으로 확인한다 → transform.py validate)
FORBIDDEN = [
    "메뉴를 새로 만들거나 빼지 않는다",
    "메뉴 이름은 바꾸지 않는다 (카운터에서 부르는 이름과 같아야 함)",
    "가격·금액·숫자 할인 문구를 쓰지 않는다 (가격은 서버가 붙인다)",
    "옵션 ID 와 선택지 ID 는 원본 그대로 쓴다",
]

SYSTEM_PROMPT = """너는 키오스크 메뉴를 디지털 약자(어르신, 저시력, 외국어가 익숙하지 않은 사람)를 위한
주문 화면으로 바꾸는 도우미다. 결과는 반드시 주어진 JSON 형식으로만 답한다.

[쉬운 말 기준]
- 외래어·약어·전문 용어(예: 샷, 디카페인, 저온추출, ICE, 12H)는 풀어서 쓴다.
- 이 음료가 '어떤 맛·어떤 느낌'인지, 카페인이 있는지 알려 준다.
- 존댓말, 한 문장. 설명은 {desc_max}자 이하.
- 옵션 질문은 '~할까요?' 형태의 쉬운 질문, {question_max}자 이하.
- 선택지 이름도 쉬운 말로 (예: ice → 차갑게, add1 → 진하게 (샷 1번 추가)).

[메뉴 묶음]
{grouping_rule}

[절대 하지 말 것]
{forbidden}
"""

GROUPING_RULES = {
    "original": "매장의 원래 분류와 순서를 그대로 쓴다. 분류 이름만 쉬운 말로 바꿀 수 있다.",
    "ai": "처음 온 사람이 찾기 쉽게 3~5개 묶음으로 다시 나눈다 "
          "(예: 커피, 커피가 아닌 음료, 카페인 없는 차, 디저트). "
          "모든 메뉴는 정확히 한 묶음에만 넣는다. 많이 찾는 메뉴를 앞에 둔다.",
}

# 쉬운 말 설정을 껐을 때: 원래 설명을 유지하고 길이만 맞춘다
PLAIN_NOTE = "사용자가 '쉬운 말' 설정을 껐다. 설명은 원래 표현을 최대한 유지하고 길이만 맞춘다."


def build_system_prompt(font_size: str, easy_words: bool) -> str:
    prompt = SYSTEM_PROMPT.format(
        desc_max=DESC_MAX[font_size],
        question_max=QUESTION_MAX,
        grouping_rule=GROUPING_RULES[GROUPING],
        forbidden="\n".join(f"- {f}" for f in FORBIDDEN),
    )
    if not easy_words:
        prompt += "\n" + PLAIN_NOTE
    return prompt
