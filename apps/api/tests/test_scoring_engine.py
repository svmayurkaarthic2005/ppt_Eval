import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.scoring.engine import (
    IncompleteSectionError,
    SectionTotal,
    _sum_sections,
    _validate_and_sum,
)

CRITERIA = ["problem_defined", "target_beneficiary", "root_cause", "scope_scale", "evidence"]


def test_complete_section_sums_all_scored_criteria():
    scored = {key: 2 for key in CRITERIA}
    result = _validate_and_sum("problem_understanding", CRITERIA, scored, max_total=10)
    assert result.total == 10
    assert result.criteria_scored == 5
    assert result.criteria_expected == 5


def test_missing_one_criterion_raises_not_a_silently_low_total():
    scored = {key: 2 for key in CRITERIA[:-1]}  # 4 of 5 criteria scored
    with pytest.raises(IncompleteSectionError) as exc_info:
        _validate_and_sum("problem_understanding", CRITERIA, scored, max_total=10)
    assert "evidence" in str(exc_info.value)


def test_missing_all_criteria_raises():
    with pytest.raises(IncompleteSectionError):
        _validate_and_sum("problem_understanding", CRITERIA, {}, max_total=10)


def test_extra_criterion_not_in_template_raises():
    scored = {key: 2 for key in CRITERIA}
    scored["some_stray_key"] = 2  # e.g. a retried LLM call keyed under the wrong criterion
    with pytest.raises(IncompleteSectionError) as exc_info:
        _validate_and_sum("problem_understanding", CRITERIA, scored, max_total=10)
    assert "some_stray_key" in str(exc_info.value)


def test_final_score_sums_four_complete_sections():
    sections = [
        SectionTotal("problem_understanding", total=10, max_total=10, criteria_scored=5, criteria_expected=5),
        SectionTotal("existing_solutions", total=8, max_total=10, criteria_scored=5, criteria_expected=5),
        SectionTotal("proposed_solution_affordability", total=9, max_total=10, criteria_scored=5, criteria_expected=5),
        SectionTotal("execution_plan_timeline", total=7, max_total=10, criteria_scored=5, criteria_expected=5),
    ]
    final = _sum_sections(sections)
    assert final.total == 34
    assert final.max_total == 40


# --- property-based test: any valid combination of per-criterion scores ----
# must sum to exactly the arithmetic sum, never anything else.


@given(scores=st.lists(st.integers(min_value=0, max_value=2), min_size=5, max_size=5))
def test_complete_section_total_always_equals_arithmetic_sum(scores):
    scored = dict(zip(CRITERIA, scores, strict=True))
    result = _validate_and_sum("problem_understanding", CRITERIA, scored, max_total=10)
    assert result.total == sum(scores)
    assert 0 <= result.total <= 10


@given(
    section_scores=st.lists(
        st.lists(st.integers(min_value=0, max_value=2), min_size=5, max_size=5),
        min_size=4,
        max_size=4,
    )
)
def test_final_total_always_equals_sum_of_all_twenty_criteria(section_scores):
    section_names = [
        "problem_understanding",
        "existing_solutions",
        "proposed_solution_affordability",
        "execution_plan_timeline",
    ]
    sections = [
        _validate_and_sum(name, CRITERIA, dict(zip(CRITERIA, scores, strict=True)), max_total=10)
        for name, scores in zip(section_names, section_scores, strict=True)
    ]
    final = _sum_sections(sections)
    assert final.total == sum(s for section in section_scores for s in section)
    assert final.max_total == 40
    assert 0 <= final.total <= 40
