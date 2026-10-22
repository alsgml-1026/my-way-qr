"""AI 화면 변환 규칙 — 민희가 정하고 고치는 파일

이 파일만 고치면 AI 가 만드는 화면이 바뀐다. (코드 로직은 transform.py)
규칙을 바꾸면 RULES_VERSION 을 올린다 → 예전 캐시가 자동으로 버려진다.

❓ 표시 = 10/22 회의에서 확정할 값 (지금은 초안)

v1 → v2 (10/22 오전 측정에서 발견한 문제 반영)
- 어려운 말이 남음 (에스프레소, 스팀밀크, 디카페인…)  → HARD_WORDS + 검사 7
- 중요 정보가 빠짐 (딸기라떼 '차갑게만' 등)           → 메뉴 파일의 must + 검사 8
- 꾸밈말·쓸데없는 카페인 안내                         → 지시문 [쓰지 말 것]
- 어색한 질문·선택지 ('사이즈를 선택할까요?')          → OPTION_EXAMPLES
"""

RULES_VERSION = "v2.1-draft"

# ❓ 1. 설명 길이: 글씨가 클수록 한 화면에 들어가는 글자가 적으므로 짧게
#    (v2: 꼭 남길 정보가 들어가야 해서 v1 보다 조금 늘림)
DESC_MAX = {"normal": 40, "large": 30, "xlarge": 22}  # 글자 수(공백 포함)
QUESTION_MAX = 24  # 옵션 질문 문장 길이
# AI 는 한글 글자 수를 정확히 못 센다 → 지시는 이만큼 더 짧게, 검사는 DESC_MAX 그대로
LENGTH_MARGIN = 4

# ❓ 2. 메뉴 묶음: "original" = 매장 분류 그대로 / "ai" = AI 가 이해하기 쉽게 다시 묶음
GROUPING = "ai"

# ❓ 3. 옵션 질문 순서 (화면 하나에 질문 하나, 이 순서대로)
OPTION_ORDER = ["temperature", "size", "shot", "decaf"]

# ❓ 4. '쉬운 말' 설정일 때 쓰면 안 되는 말 (검사 7). 영어 알파벳도 금지.
HARD_WORDS = ["에스프레소", "스팀밀크", "디카페인", "무카페인", "샷", "베이스", "토핑", "파우더",
              "추출", "사이즈", "스트로", "허브티", "논커피"]

# ❓ 5. 옵션 질문·선택지 예시 (AI 가 이 말투를 따라 함)
OPTION_EXAMPLES = """- 온도: '따뜻하게 드릴까요, 차갑게 드릴까요?' → 따뜻하게 / 차갑게
- 크기: '어떤 크기로 드릴까요?' → 보통 크기 / 큰 크기
- 샷: '커피를 더 진하게 할까요?' → 보통으로 / 더 진하게
- 원두: '카페인을 뺄까요?' → 그대로 / 카페인 빼기"""

# 하면 안 되는 것 (검사 장치가 자동으로 확인한다 → transform.py validate)
FORBIDDEN = [
    "메뉴를 새로 만들거나 빼지 않는다",
    "메뉴 이름은 바꾸지 않는다 (카운터에서 부르는 이름과 같아야 함)",
    "가격·금액·숫자 할인 문구를 쓰지 않는다 (가격은 서버가 붙인다)",
    "옵션 ID 와 선택지 ID 는 원본 그대로 쓴다",
    "메뉴의 '꼭 남길 정보(must)'는 빠뜨리지 않는다",
]

SYSTEM_PROMPT = """너는 키오스크 메뉴를 디지털 약자(어르신, 저시력, 외국어가 익숙하지 않은 사람)를 위한
주문 화면으로 바꾸는 도우미다. 결과는 반드시 주어진 JSON 형식으로만 답한다.

[쉬운 말 기준]
- 외래어·약어·영어·전문 용어는 우리말로 풀어 쓴다. 특히 이 말들은 쓰지 않는다: {hard_words}
  (예: 에스프레소 → 진한 커피, 스팀밀크 → 데운 우유, 디카페인 → 카페인을 뺀)
- 어떤 맛인지 한눈에 알게 쓴다. 존댓말 한 문장, {desc_max}자 이하.
- 메뉴에 must(꼭 남길 정보)가 있으면 그 내용을 설명에 반드시 넣는다. 그 메뉴의 다른 말보다 먼저 넣는다.

[쓰지 말 것]
- '조화', '풍미', '특별한' 같은 꾸밈말.
- 커피·홍차가 아닌 메뉴(디저트 등)에 '카페인 없음' 같은 안내. 카페인 안내는 must 에 있을 때만.

[옵션 질문과 선택지] 질문은 {question_max}자 이하, 아래 말투를 따른다.
{option_examples}

[메뉴 묶음]
{grouping_rule}

[절대 하지 말 것]
{forbidden}
"""

GROUPING_RULES = {
    "original": "매장의 원래 분류와 순서를 그대로 쓴다. 분류 이름만 쉬운 말로 바꿀 수 있다.",
    "ai": "처음 온 사람이 찾기 쉽게 3~5개 묶음으로 다시 나눈다 "
          "(예: 커피, 커피가 아닌 음료, 따뜻한 차, 디저트). "
          "모든 메뉴는 정확히 한 묶음에만 넣는다. 많이 찾는 메뉴를 앞에 둔다.",
}

# 쉬운 말 설정을 껐을 때: 원래 설명을 유지하고 길이만 맞춘다 (어려운 말 검사도 안 함)
PLAIN_NOTE = ("사용자가 '쉬운 말' 설정을 껐다. 설명은 원래 표현을 최대한 유지하고 길이만 맞춘다. "
              "[쉬운 말 기준]의 금지 단어는 써도 된다. must 는 여전히 반드시 넣는다.")


def build_system_prompt(font_size: str, easy_words: bool) -> str:
    prompt = SYSTEM_PROMPT.format(
        desc_max=DESC_MAX[font_size] - LENGTH_MARGIN,
        question_max=QUESTION_MAX - LENGTH_MARGIN,
        hard_words=", ".join(HARD_WORDS),
        option_examples=OPTION_EXAMPLES,
        grouping_rule=GROUPING_RULES[GROUPING],
        forbidden="\n".join(f"- {f}" for f in FORBIDDEN),
    )
    if not easy_words:
        prompt += "\n" + PLAIN_NOTE
    return prompt
