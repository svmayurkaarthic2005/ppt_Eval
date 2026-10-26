from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.llm.client import (
    IMAGE_BATCH_SIZE,
    CriterionScoreResult,
    EvidenceSlide,
    _batch_images,
    _build_messages,
    _criterion_json_schema,
    _estimate_tokens,
    _section_json_schema,
    _validate_score,
    evaluate_criterion,
    evaluate_section,
)
from app.models.schemas import SubmissionContext
from app.rubric.builder import RubricCriterionForSubmission


def test_criterion_json_schema_bounds_score_to_max():
    schema = _criterion_json_schema(max_score=6)
    assert schema["properties"]["score"]["minimum"] == 0
    assert schema["properties"]["score"]["maximum"] == 6
    assert schema["properties"]["max_score"]["const"] == 6
    assert schema["additionalProperties"] is False


def test_validate_score_accepts_well_formed_response():
    raw = '{"score": 1, "max_score": 2, "rationale": "clear problem statement", "evidence_refs": [3, 4]}'
    result = _validate_score(raw, max_score=2)
    assert result.score == 1
    assert result.evidence_refs == [3, 4]


def test_validate_score_overrides_model_echoed_max_score():
    # Even if the model echoes a wrong max_score, the rubric's value wins.
    raw = '{"score": 2, "max_score": 999, "rationale": "x", "evidence_refs": []}'
    result = _validate_score(raw, max_score=2)
    assert result.max_score == 2


def test_validate_score_rejects_out_of_range_score():
    raw = '{"score": 5, "max_score": 2, "rationale": "x", "evidence_refs": []}'
    with pytest.raises(ValueError):
        _validate_score(raw, max_score=2)


def test_validate_score_rejects_malformed_json():
    with pytest.raises(ValidationError):
        _validate_score("not json at all", max_score=2)


def test_validate_score_rejects_missing_required_field():
    raw = '{"score": 1, "rationale": "x", "evidence_refs": []}'  # missing max_score
    with pytest.raises(ValidationError):
        _validate_score(raw, max_score=2)


def test_estimate_tokens_grows_with_text_and_images():
    base = _estimate_tokens("x" * 400, image_count=0)
    with_images = _estimate_tokens("x" * 400, image_count=2)
    assert with_images > base


def test_image_batching_never_exceeds_batch_size():
    images = [(i, b"x") for i in range(7)]
    batches = _batch_images(images)
    assert all(len(b) <= IMAGE_BATCH_SIZE for b in batches)


def test_image_batching_never_drops_an_image():
    images = [(i, b"x") for i in range(7)]
    batches = _batch_images(images)
    slide_numbers = sorted(n for batch in batches for n, _ in batch)
    assert slide_numbers == list(range(7))


def test_image_batching_handles_no_images():
    assert _batch_images([]) == [[]]


def test_criterion_score_result_round_trips():
    result = CriterionScoreResult(score=2, max_score=2, rationale="ok", evidence_refs=[1])
    assert result.model_dump()["score"] == 2


def test_build_messages_warns_about_pictured_slides_missing_this_round():
    criterion = RubricCriterionForSubmission(
        section_key="proposed_solution_affordability",
        criterion_key="solution_addresses_problem",
        name="Solution addresses the stated problem",
        max_score=2,
    )
    messages = _build_messages(
        criterion,
        evaluation_context="context",
        text_context="[Slide 3] some text\n[Slide 7] some text",
        image_batch=[(3, b"fake-png-bytes")],
        slides_without_image_this_round=[7],
    )
    user_text = messages[1]["content"][0]["text"]
    assert "Slides 7" in user_text
    assert "NOT attached" in user_text


def test_build_messages_omits_the_warning_when_nothing_is_missing():
    criterion = RubricCriterionForSubmission(
        section_key="proposed_solution_affordability",
        criterion_key="solution_addresses_problem",
        name="Solution addresses the stated problem",
        max_score=2,
    )
    messages = _build_messages(
        criterion,
        evaluation_context="context",
        text_context="[Slide 3] some text",
        image_batch=[(3, b"fake-png-bytes")],
        slides_without_image_this_round=[],
    )
    user_text = messages[1]["content"][0]["text"]
    assert "NOT attached" not in user_text


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _FakeConn:
    async def execute(self, *args, **kwargs):
        return None

    async def fetchrow(self, *args, **kwargs):
        return None


def _canned_response(score: int, max_score: int) -> _FakeResponse:
    return _FakeResponse(
        {
            "choices": [
                {
                    "message": {
                        "content": (
                            f'{{"score": {score}, "max_score": {max_score}, '
                            '"rationale": "stub", "evidence_refs": []}'
                        )
                    }
                }
            ]
        }
    )


async def test_evaluate_criterion_averages_scores_across_image_batches(monkeypatch):
    """Regression test: more than IMAGE_BATCH_SIZE image-bearing slides for
    one criterion used to take max() across the independently-scored
    batches, biasing image-heavy submissions upward. It must now average
    them instead, so a submission's score doesn't depend on how many image
    batches it happened to need."""
    scores_in_order = iter([10, 2])  # first batch scores high, second low

    async def fake_post_with_backoff(client, payload, api_key):
        return _canned_response(score=next(scores_in_order), max_score=10)

    monkeypatch.setattr("app.llm.client.post_with_backoff", fake_post_with_backoff)

    class _FakeSettings:
        groq_api_key = "test-key-not-real"

    monkeypatch.setattr("app.llm.client.get_settings", lambda: _FakeSettings())

    criterion = RubricCriterionForSubmission(
        section_key="problem_understanding",
        criterion_key="problem_clearly_defined",
        name="Problem clearly defined",
        max_score=10,
    )
    context = SubmissionContext(
        problem_domain="rural healthcare",
        target_beneficiary="community health workers",
        required_deliverables=[],
        track_constraints=[],
        is_generic=False,
        generic_reason=None,
    )
    # IMAGE_BATCH_SIZE images in the first slide's batch, 1 more in a second
    # batch -- two independent scoring calls for the same criterion.
    slides = [
        EvidenceSlide(slide_number=i, raw_text=f"slide {i}", image_bytes=b"x")
        for i in range(IMAGE_BATCH_SIZE + 1)
    ]

    evaluation = await evaluate_criterion(_FakeConn(), uuid4(), criterion, slides, context)

    assert evaluation.status == "scored"
    assert evaluation.result is not None
    assert evaluation.result.score == round((10 + 2) / 2)


def test_section_json_schema_has_one_sub_object_per_criterion():
    criteria = [
        RubricCriterionForSubmission(
            section_key="problem_understanding",
            criterion_key="problem_clearly_defined",
            name="Problem clearly defined",
            max_score=2,
        ),
        RubricCriterionForSubmission(
            section_key="problem_understanding",
            criterion_key="target_beneficiary_identified",
            name="Target beneficiary identified",
            max_score=2,
        ),
    ]
    schema = _section_json_schema(criteria)
    assert set(schema["properties"]) == {"problem_clearly_defined", "target_beneficiary_identified"}
    assert schema["required"] == ["problem_clearly_defined", "target_beneficiary_identified"]
    assert schema["properties"]["problem_clearly_defined"]["properties"]["score"]["maximum"] == 2
    assert schema["additionalProperties"] is False


def _section_criteria() -> list[RubricCriterionForSubmission]:
    return [
        RubricCriterionForSubmission(
            section_key="problem_understanding",
            criterion_key="problem_clearly_defined",
            name="Problem clearly defined",
            max_score=2,
        ),
        RubricCriterionForSubmission(
            section_key="problem_understanding",
            criterion_key="target_beneficiary_identified",
            name="Target beneficiary identified",
            max_score=2,
        ),
    ]


def _section_context() -> SubmissionContext:
    return SubmissionContext(
        problem_domain="rural healthcare",
        target_beneficiary="community health workers",
        required_deliverables=[],
        track_constraints=[],
        is_generic=False,
        generic_reason=None,
    )


async def test_evaluate_section_scores_every_criterion_in_one_call(monkeypatch):
    """The whole point of batching: one Groq call scores both criteria in
    the section, not one call per criterion."""
    call_count = 0

    async def fake_post_with_backoff(client, payload, api_key):
        nonlocal call_count
        call_count += 1
        import json as _json

        return _FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": _json.dumps(
                                {
                                    "problem_clearly_defined": {
                                        "score": 1.5,
                                        "max_score": 2,
                                        "rationale": "clear",
                                        "evidence_refs": [1],
                                    },
                                    "target_beneficiary_identified": {
                                        "score": 2,
                                        "max_score": 2,
                                        "rationale": "explicit",
                                        "evidence_refs": [2],
                                    },
                                }
                            )
                        }
                    }
                ]
            }
        )

    monkeypatch.setattr("app.llm.client.post_with_backoff", fake_post_with_backoff)

    class _FakeSettings:
        groq_api_key = "test-key-not-real"

    monkeypatch.setattr("app.llm.client.get_settings", lambda: _FakeSettings())

    slides = [EvidenceSlide(slide_number=1, raw_text="slide 1", image_bytes=None)]
    evaluations = await evaluate_section(
        _FakeConn(), uuid4(), _section_criteria(), slides, _section_context()
    )

    assert call_count == 1  # one Groq call scored both criteria
    assert evaluations["problem_clearly_defined"].status == "scored"
    assert evaluations["problem_clearly_defined"].result.score == 1.5
    assert evaluations["target_beneficiary_identified"].status == "scored"
    assert evaluations["target_beneficiary_identified"].result.score == 2


async def test_evaluate_section_flags_the_whole_section_when_a_key_is_missing(monkeypatch):
    """The request's schema makes every criterion key required and strict,
    so a response missing one is a schema violation -- both attempts get
    retried and, failing that, the whole section is flagged for human
    review rather than silently scoring the criteria that did parse."""
    import json as _json

    async def fake_post_with_backoff(client, payload, api_key):
        return _FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": _json.dumps(
                                {
                                    "problem_clearly_defined": {
                                        "score": 1.5,
                                        "max_score": 2,
                                        "rationale": "clear",
                                        "evidence_refs": [1],
                                    }
                                    # target_beneficiary_identified is missing
                                }
                            )
                        }
                    }
                ]
            }
        )

    monkeypatch.setattr("app.llm.client.post_with_backoff", fake_post_with_backoff)

    class _FakeSettings:
        groq_api_key = "test-key-not-real"

    monkeypatch.setattr("app.llm.client.get_settings", lambda: _FakeSettings())

    slides = [EvidenceSlide(slide_number=1, raw_text="slide 1", image_bytes=None)]
    evaluations = await evaluate_section(
        _FakeConn(), uuid4(), _section_criteria(), slides, _section_context()
    )

    assert evaluations["problem_clearly_defined"].status == "needs_human_review"
    assert evaluations["target_beneficiary_identified"].status == "needs_human_review"


async def test_evaluate_section_with_no_criteria_returns_empty():
    evaluations = await evaluate_section(_FakeConn(), uuid4(), [], [], _section_context())
    assert evaluations == {}
