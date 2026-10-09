from uuid import uuid4

import pytest

from app.calibration.statistics import (
    ResolvedCalibrationPair,
    SectionScorePair,
    mean_absolute_error,
    section_agreement_pct,
    spearman_rank_correlation,
)


def test_mean_absolute_error_exact_match_is_zero():
    assert mean_absolute_error([10, 20, 30], [10, 20, 30]) == 0


def test_mean_absolute_error_averages_absolute_differences():
    # |10-8| + |20-25| + |30-30| = 2 + 5 + 0 = 7, / 3
    assert mean_absolute_error([10, 20, 30], [8, 25, 30]) == pytest.approx(7 / 3)


def test_mean_absolute_error_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        mean_absolute_error([1, 2], [1])


def test_mean_absolute_error_rejects_empty_input():
    with pytest.raises(ValueError):
        mean_absolute_error([], [])


def _pair(scores: list[tuple[str, int, int]]) -> ResolvedCalibrationPair:
    return ResolvedCalibrationPair(
        submission_id=uuid4(),
        section_scores=[SectionScorePair(section_key=k, ai_score=a, human_score=h) for k, a, h in scores],
    )


def test_section_agreement_pct_all_within_tolerance():
    pairs = [_pair([("problem_understanding", 8, 8), ("cost", 6, 7)])]
    assert section_agreement_pct(pairs, tolerance=1) == 100.0


def test_section_agreement_pct_some_outside_tolerance():
    pairs = [_pair([("problem_understanding", 8, 8), ("cost", 6, 9)])]  # second diff = 3, outside tolerance 1
    assert section_agreement_pct(pairs, tolerance=1) == 50.0


def test_section_agreement_pct_boundary_exactly_at_tolerance_counts_as_agreement():
    pairs = [_pair([("cost", 5, 6)])]  # diff == 1 == tolerance
    assert section_agreement_pct(pairs, tolerance=1) == 100.0


def test_section_agreement_pct_rejects_no_data():
    with pytest.raises(ValueError):
        section_agreement_pct([])


def test_spearman_perfect_agreement_is_one():
    assert spearman_rank_correlation([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]) == pytest.approx(1.0)


def test_spearman_perfect_disagreement_is_negative_one():
    assert spearman_rank_correlation([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]) == pytest.approx(-1.0)


def test_spearman_handles_ties_via_average_rank():
    # Two equal AI totals (tied rank) shouldn't crash or distort an otherwise
    # perfect correlation implausibly.
    result = spearman_rank_correlation([1, 2, 2, 4, 5], [10, 20, 20, 40, 50])
    assert result == pytest.approx(1.0)


def test_spearman_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        spearman_rank_correlation([1, 2], [1])


def test_spearman_rejects_fewer_than_two_points():
    with pytest.raises(ValueError):
        spearman_rank_correlation([1], [1])


def test_resolved_calibration_pair_totals_are_sums_of_section_scores():
    pair = _pair([("problem_understanding", 8, 7), ("cost", 6, 6)])
    assert pair.ai_total == 14
    assert pair.human_total == 13
