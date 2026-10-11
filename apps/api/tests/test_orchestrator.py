from uuid import uuid4

from app.pipeline.orchestrator import merge_rankings, select_for_stage2


def _candidate(score, flagged=False, manual=False):
    return {
        "submission_id": uuid4(),
        "preliminary_score": score,
        "preliminary_flagged": flagged,
        "manual_review_requested": manual,
    }


def test_select_for_stage2_picks_top_n_by_preliminary_score():
    candidates = [_candidate(score) for score in [10, 40, 20, 35, 5]]
    selected = select_for_stage2(candidates, top_n=2)
    expected = {c["submission_id"] for c in candidates if c["preliminary_score"] in (40, 35)}
    assert selected == expected


def test_select_for_stage2_always_includes_flagged_even_outside_top_n():
    low_flagged = _candidate(1, flagged=True)
    candidates = [low_flagged] + [_candidate(score) for score in [40, 39, 38, 37, 36]]
    selected = select_for_stage2(candidates, top_n=2)
    assert low_flagged["submission_id"] in selected


def test_select_for_stage2_always_includes_manually_requested():
    manual = _candidate(1, manual=True)
    candidates = [manual] + [_candidate(score) for score in [40, 39, 38]]
    selected = select_for_stage2(candidates, top_n=1)
    assert manual["submission_id"] in selected


def test_select_for_stage2_ignores_submissions_without_a_preliminary_score():
    no_score = {
        "submission_id": uuid4(),
        "preliminary_score": None,
        "preliminary_flagged": False,
        "manual_review_requested": False,
    }
    candidates = [no_score, _candidate(40)]
    selected = select_for_stage2(candidates, top_n=5)
    assert no_score["submission_id"] not in selected


def test_select_for_stage2_empty_input_selects_nothing():
    assert select_for_stage2([], top_n=10) == set()


def test_merge_rankings_sorts_by_score_descending_across_both_stages():
    stage1_only = [{"submission_id": uuid4(), "preliminary_score": 20}]
    stage2 = [
        {"submission_id": uuid4(), "final_total": 35, "final_max_total": 40},
        {"submission_id": uuid4(), "final_total": 10, "final_max_total": 40},
    ]
    ranked = merge_rankings(stage1_only, stage2)
    assert [r.score for r in ranked] == [35, 20, 10]


def test_merge_rankings_tags_score_source_correctly():
    s1_id = uuid4()
    s2_id = uuid4()
    ranked = merge_rankings(
        [{"submission_id": s1_id, "preliminary_score": 30}],
        [{"submission_id": s2_id, "final_total": 38, "final_max_total": 40}],
    )
    by_id = {r.submission_id: r for r in ranked}
    assert by_id[s1_id].score_source == "stage1"
    assert by_id[s2_id].score_source == "stage2"


def test_merge_rankings_empty_inputs_yields_empty_list():
    assert merge_rankings([], []) == []


# --- Stage 1 Section Scores Validation Tests ---

import pytest

from app.pipeline.orchestrator import Stage1ValidationError, validate_stage1_section_scores


def test_validate_stage1_section_scores_valid():
    expected_keys = ["problem_understanding", "existing_solutions", "proposed_solution", "feasibility", "execution_plan"]
    scores = [
        {"section_key": "problem_understanding", "score": 8},
        {"section_key": "existing_solutions", "score": 7},
        {"section_key": "proposed_solution", "score": 9},
        {"section_key": "feasibility", "score": 6},
        {"section_key": "execution_plan", "score": 8},
    ]
    total = validate_stage1_section_scores(scores, expected_keys)
    assert total == 38


def test_validate_stage1_section_scores_missing_key():
    expected_keys = ["sec1", "sec2", "sec3"]
    scores = [
        {"section_key": "sec1", "score": 7},
        {"section_key": "sec2", "score": 8},
    ]
    with pytest.raises(Stage1ValidationError, match="Missing required section keys"):
        validate_stage1_section_scores(scores, expected_keys)


def test_validate_stage1_section_scores_unexpected_key():
    expected_keys = ["sec1", "sec2"]
    scores = [
        {"section_key": "sec1", "score": 7},
        {"section_key": "sec2", "score": 8},
        {"section_key": "extra_bonus", "score": 5},
    ]
    with pytest.raises(Stage1ValidationError, match="Unexpected section_key"):
        validate_stage1_section_scores(scores, expected_keys)


def test_validate_stage1_section_scores_duplicate_key():
    expected_keys = ["sec1", "sec2"]
    scores = [
        {"section_key": "sec1", "score": 7},
        {"section_key": "sec1", "score": 8},
    ]
    with pytest.raises(Stage1ValidationError, match="Duplicate section_key"):
        validate_stage1_section_scores(scores, expected_keys)


def test_validate_stage1_section_scores_out_of_bounds():
    expected_keys = ["sec1", "sec2"]
    # Negative score
    with pytest.raises(Stage1ValidationError, match="out of bounds"):
        validate_stage1_section_scores([{"section_key": "sec1", "score": -1}, {"section_key": "sec2", "score": 5}], expected_keys)

    # Score > 10
    with pytest.raises(Stage1ValidationError, match="out of bounds"):
        validate_stage1_section_scores([{"section_key": "sec1", "score": 11}, {"section_key": "sec2", "score": 5}], expected_keys)


def test_validate_stage1_section_scores_non_integer():
    expected_keys = ["sec1", "sec2"]
    with pytest.raises(Stage1ValidationError, match="must be an integer"):
        validate_stage1_section_scores([{"section_key": "sec1", "score": 7.5}, {"section_key": "sec2", "score": 5}], expected_keys)


def test_validate_stage1_section_scores_non_numeric():
    expected_keys = ["sec1"]
    with pytest.raises(Stage1ValidationError, match="not numeric"):
        validate_stage1_section_scores([{"section_key": "sec1", "score": "eight"}], expected_keys)

    # Boolean is not allowed as numeric score
    with pytest.raises(Stage1ValidationError, match="not numeric"):
        validate_stage1_section_scores([{"section_key": "sec1", "score": True}], expected_keys)

