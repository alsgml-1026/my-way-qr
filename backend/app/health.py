"""건강 맞춤 표시 — 메뉴마다 칼로리·성분 태그·알레르기를 붙인다

원칙 (AGENTS.md 1. 서비스 원칙과 같음)
- 의료 판단을 하지 않는다. "당뇨에 위험" 이 아니라 "당 많음 (32g)" 같은 성분 사실만.
- 수치는 메뉴 파일(data/stores/*.json 의 nutrition·allergens)에서만 온다. AI 에는 보내지 않는다.
- 서버는 모든 메뉴에 태그를 붙여 보낼 뿐, 누가 무엇을 조심하는지 모른다.
  고른 항목(당 조심 등)은 폰에만 저장되고, 폰이 자기 설정에 맞는 태그만 강조한다.

기준값을 바꾸면 이 파일만 고치면 된다.
끄기: 환경변수 HEALTH_INFO=0 → 모든 메뉴의 health 가 null, 폰 설정 화면에서도 항목이 사라짐 (기존 화면 그대로)
"""
import os

# 표시 기준 (1잔·1인분, 기본 옵션 기준) — 10/23 확정 (정민희)
# - 당 17g: 식약처 어린이 기호식품 고열량·저영양 판단의 당류 기준(1회 17g), WHO 하루 50g 의 약 1/3
# - 나트륨 600mg: 같은 기준의 식사대용 식품(김밥·컵라면 등) 나트륨 기준, 하루 기준치 2,000mg 의 30%
# - 카페인 1mg: 조심하는 사람(임산부·불면 등)은 적은 양도 알고 싶어 함 → 조금이라도 있으면 양과 함께 표시
#   (성인 하루 400mg 이하 권장)
# ※ 보고서에 쓰기 전 식약처 현행 고시로 숫자 재확인
LIMITS = {
    "sugar": {"min": 17, "unit": "g", "label": "당 많음"},
    "sodium": {"min": 600, "unit": "mg", "label": "나트륨 많음"},
    "caffeine": {"min": 1, "unit": "mg", "label": "카페인 있음"},
}

# 알레르기 (식품 알레르기 표시 대상 중 주문에서 자주 묻는 것). 폰 설정 화면(frontend/src/health.ts)과 ID 를 맞춘다.
ALLERGENS = {
    "milk": "우유",
    "egg": "달걀",
    "wheat": "밀",
    "soy": "대두",
    "peanut": "땅콩",
    "nuts": "견과류",
    "shellfish": "새우·게",
    "pork": "돼지고기",
}


def enabled() -> bool:
    return os.getenv("HEALTH_INFO", "1") != "0"


def check_store(store: dict) -> None:
    """서버가 켜질 때 메뉴 파일의 알레르기 ID 가 위 목록에 있는지 확인 (오타 방지)."""
    for item in store["items"]:
        bad = [a for a in item.get("allergens", []) if a not in ALLERGENS]
        if bad:
            raise ValueError(f"{store['id']} / {item['id']}: 모르는 알레르기 ID {bad} (health.py ALLERGENS 확인)")


def item_health(item: dict) -> dict | None:
    """메뉴 하나의 건강 정보. 메뉴 파일에 영양 정보가 없으면 None (표시하지 않음)."""
    n = item.get("nutrition")
    if not enabled() or (n is None and "allergens" not in item):
        return None
    n = n or {}
    tags = []
    for key, rule in LIMITS.items():
        value = n.get(key)
        if value is not None and value >= rule["min"]:
            tags.append({"id": key, "label": rule["label"], "amount": f"{value:,}{rule['unit']}"})
    return {
        "kcal": n.get("kcal"),
        "tags": tags,
        "allergens": [{"id": a, "name": ALLERGENS[a]} for a in item.get("allergens", [])],
    }
