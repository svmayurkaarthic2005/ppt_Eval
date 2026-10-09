from decimal import Decimal

import pytest

from app.validation.deterministic import (
    ScoreOutOfBoundsError,
    SectionRowCountExceededError,
    check_score_bounds,
    check_section_row_count,
    compute_percentage_change,
    extract_declared_total,
    extract_percentage_claims,
    parse_currency_decimal,
    sum_cost_line_items,
    validate_cost_table,
    validate_numeric_claim,
)


def _row(label: str, amount: str) -> list[dict]:
    return [{"text": label, "value": None}, {"text": amount, "value": None}]


# --- cost validation -------------------------------------------------------


def test_parse_currency_decimal_strips_symbols_and_commas():
    assert parse_currency_decimal("₹1,200.50") == Decimal("1200.50")
    assert parse_currency_decimal("$42") == Decimal(42)
    assert parse_currency_decimal("N/A") is None
    assert parse_currency_decimal("") is None


def test_sum_cost_line_items_excludes_total_row():
    table = [_row("Hosting", "100"), _row("Design", "50"), _row("Total", "150")]
    assert sum_cost_line_items(table) == Decimal(150)


def test_cost_validation_exact_match():
    table = [_row("Hosting", "100"), _row("Design", "50")]
    result = validate_cost_table(table, "Total cost: ₹150", tolerance=Decimal(1))
    assert result.computed_total == Decimal(150)
    assert result.declared_total == Decimal(150)
    assert result.difference == Decimal(0)
    assert result.mismatch is False


def test_cost_validation_within_tolerance_is_not_a_mismatch():
    table = [_row("Hosting", "100.40"), _row("Design", "50")]
    # computed 150.40 vs declared 150 -> within the ₹1 tolerance
    result = validate_cost_table(table, "Total: ₹150", tolerance=Decimal(1))
    assert result.difference == Decimal("0.40")
    assert result.mismatch is False


def test_cost_validation_mismatch_beyond_tolerance():
    table = [_row("Hosting", "100"), _row("Design", "75")]
    result = validate_cost_table(table, "Total: ₹150", tolerance=Decimal(1))
    assert result.computed_total == Decimal(175)
    assert result.declared_total == Decimal(150)
    assert result.difference == Decimal(25)
    assert result.mismatch is True


def test_cost_validation_missing_declared_total_is_not_flagged_as_mismatch():
    table = [_row("Hosting", "100"), _row("Design", "50")]
    result = validate_cost_table(table, "No total mentioned anywhere on this slide.")
    assert result.declared_total is None
    assert result.difference is None
    assert result.mismatch is False


def test_cost_validation_malformed_cells_are_skipped_not_coerced_to_zero():
    table = [_row("Hosting", "100"), _row("Design", "N/A"), _row("Travel", "25")]
    result = validate_cost_table(table, "Total: ₹125")
    # "N/A" contributes nothing (not 0-via-coercion, just skipped), so 100+25=125 matches exactly
    assert result.computed_total == Decimal(125)
    assert result.mismatch is False


def test_extract_declared_total_handles_various_phrasings():
    assert extract_declared_total("Grand Total: $1,000") == Decimal(1000)
    assert extract_declared_total("total cost - 500") == Decimal(500)
    assert extract_declared_total("no mention of money here") is None


# --- numeric claim validation ----------------------------------------------


def test_extract_percentage_claims_word_after_pattern():
    claims = extract_percentage_claims("We achieved a 40% cost reduction this year.")
    assert len(claims) == 1
    assert claims[0].percentage == Decimal(40)
    assert claims[0].direction == "decrease"


def test_extract_percentage_claims_word_before_pattern():
    claims = extract_percentage_claims("We increased engagement by 25%.")
    assert any(c.percentage == Decimal(25) and c.direction == "increase" for c in claims)


def test_claim_validation_exact_match():
    claims = extract_percentage_claims("40% cost reduction")
    result = validate_numeric_claim(claims[0], before=Decimal(100), after=Decimal(60))
    assert result.actual_percentage_change == Decimal(-40)
    assert result.mismatch is False


def test_claim_validation_within_tolerance():
    claims = extract_percentage_claims("40% cost reduction")
    # actual change is -38%, within the default 5-point tolerance of 40%
    result = validate_numeric_claim(claims[0], before=Decimal(100), after=Decimal(62))
    assert result.mismatch is False


def test_claim_validation_mismatch_beyond_tolerance():
    claims = extract_percentage_claims("40% cost reduction")
    # actual change is only -10%, far short of the claimed 40%
    result = validate_numeric_claim(claims[0], before=Decimal(100), after=Decimal(90))
    assert result.mismatch is True
    assert result.reason is not None


def test_claim_validation_direction_mismatch_is_always_a_mismatch():
    claims = extract_percentage_claims("40% cost reduction")
    # data actually shows an increase, not a reduction at all
    result = validate_numeric_claim(claims[0], before=Decimal(100), after=Decimal(140))
    assert result.mismatch is True
    assert "increase" in result.reason


def test_claim_validation_zero_actual_change_is_not_mislabeled_decrease():
    claims = extract_percentage_claims("40% cost reduction")
    # before == after -- a flat metric must be treated as "no change", never
    # silently defaulted to "decrease" just because `0 > 0` is False.
    result = validate_numeric_claim(claims[0], before=Decimal(100), after=Decimal(100))
    assert result.actual_percentage_change == Decimal(0)
    assert result.mismatch is True
    assert "no change" in result.reason


def test_claim_validation_zero_actual_change_within_tolerance_is_not_a_mismatch():
    claims = extract_percentage_claims("3% cost reduction")
    result = validate_numeric_claim(claims[0], before=Decimal(100), after=Decimal(100))
    assert result.mismatch is False


def test_compute_percentage_change_rejects_zero_baseline():
    with pytest.raises(ValueError):
        compute_percentage_change(Decimal(0), Decimal(10))


# --- rubric boundary enforcement -------------------------------------------


def test_check_score_bounds_accepts_valid_range():
    check_score_bounds(0, 2)
    check_score_bounds(2, 2)


def test_check_score_bounds_rejects_negative_or_over_max():
    with pytest.raises(ScoreOutOfBoundsError):
        check_score_bounds(-1, 2)
    with pytest.raises(ScoreOutOfBoundsError):
        check_score_bounds(3, 2)


def test_check_section_row_count_allows_up_to_the_limit():
    check_section_row_count(existing_row_count=4, max_criteria_for_section=5)


def test_check_section_row_count_rejects_exceeding_the_limit():
    with pytest.raises(SectionRowCountExceededError):
        check_section_row_count(existing_row_count=5, max_criteria_for_section=5)
