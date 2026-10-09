from app.calibration.reliability import derive_reliability_label


def test_high_when_calibration_is_tight_and_no_flags():
    label = derive_reliability_label(
        max_score=40,
        nearest_calibration_mae=1.0,
        consistency_flag_severities=[],
        has_needs_human_review_criterion=False,
    )
    assert label == "HIGH"


def test_medium_when_no_calibration_data_yet_even_with_no_flags():
    # No empirical basis for HIGH confidence without calibration evidence.
    label = derive_reliability_label(
        max_score=40,
        nearest_calibration_mae=None,
        consistency_flag_severities=[],
        has_needs_human_review_criterion=False,
    )
    assert label == "MEDIUM"


def test_review_when_mae_is_large():
    label = derive_reliability_label(
        max_score=40,
        nearest_calibration_mae=8.0,
        consistency_flag_severities=[],
        has_needs_human_review_criterion=False,
    )
    assert label == "REVIEW"


def test_review_when_any_high_severity_flag_present_even_with_perfect_calibration():
    label = derive_reliability_label(
        max_score=40,
        nearest_calibration_mae=0.0,
        consistency_flag_severities=["low", "high"],
        has_needs_human_review_criterion=False,
    )
    assert label == "REVIEW"


def test_medium_when_only_medium_severity_flags_present():
    label = derive_reliability_label(
        max_score=40,
        nearest_calibration_mae=1.0,
        consistency_flag_severities=["medium"],
        has_needs_human_review_criterion=False,
    )
    assert label == "MEDIUM"


def test_needs_human_review_criterion_always_forces_review():
    # Even perfect calibration and zero flags can't override an unscored criterion.
    label = derive_reliability_label(
        max_score=40,
        nearest_calibration_mae=0.0,
        consistency_flag_severities=[],
        has_needs_human_review_criterion=True,
    )
    assert label == "REVIEW"


def test_label_never_derived_from_llm_self_reported_confidence():
    # The function signature itself has no such parameter -- this test
    # documents that constraint so a future edit can't quietly add one.
    import inspect

    params = inspect.signature(derive_reliability_label).parameters
    assert "confidence" not in params
    assert not any("llm" in name.lower() for name in params)
