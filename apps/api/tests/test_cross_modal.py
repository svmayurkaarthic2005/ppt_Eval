import pytest
from pydantic import ValidationError

from app.validation.cross_modal import (
    _SEVERITY_TO_FLAG_SEVERITY,
    CROSS_MODAL_JSON_SCHEMA,
    SlideText,
    _build_messages,
    _estimate_tokens,
    _parse_result,
)


def test_schema_requires_contradictions_array_and_forbids_extra_fields():
    assert CROSS_MODAL_JSON_SCHEMA["required"] == ["contradictions"]
    assert CROSS_MODAL_JSON_SCHEMA["additionalProperties"] is False
    item_schema = CROSS_MODAL_JSON_SCHEMA["properties"]["contradictions"]["items"]
    assert set(item_schema["required"]) == {
        "claim",
        "contradicting_evidence",
        "slide_numbers",
        "severity",
    }


def test_parse_result_accepts_empty_contradictions_as_success():
    raw = {"choices": [{"message": {"content": '{"contradictions": []}'}}]}
    result = _parse_result(raw)
    assert result.contradictions == []


def test_parse_result_accepts_populated_contradictions():
    raw = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"contradictions": [{"claim": "fully offline", '
                        '"contradicting_evidence": "architecture shows a cloud API dependency", '
                        '"slide_numbers": [4, 7], "severity": "severe"}]}'
                    )
                }
            }
        ]
    }
    result = _parse_result(raw)
    assert len(result.contradictions) == 1
    assert result.contradictions[0].severity == "severe"
    assert result.contradictions[0].slide_numbers == [4, 7]


def test_parse_result_rejects_malformed_json():
    raw = {"choices": [{"message": {"content": "not json"}}]}
    with pytest.raises(ValidationError):
        _parse_result(raw)


def test_parse_result_rejects_missing_contradictions_key():
    raw = {"choices": [{"message": {"content": "{}"}}]}
    with pytest.raises(ValidationError):
        _parse_result(raw)


def test_parse_result_raises_on_malformed_response_shape():
    with pytest.raises((KeyError, IndexError)):
        _parse_result({"choices": []})


def test_severity_mapping_covers_all_three_levels():
    assert _SEVERITY_TO_FLAG_SEVERITY == {"minor": "low", "moderate": "medium", "severe": "high"}


def test_build_messages_includes_all_three_modalities():
    messages = _build_messages(
        written_claims=[SlideText(slide_number=3, raw_text="Works fully offline.")],
        workflow_structure={"steps": ["capture", "upload", "sync"]},
        architecture_description="Relies on a cloud API for sync.",
    )
    user_content = messages[1]["content"]
    assert "Works fully offline." in user_content
    assert "capture" in user_content
    assert "Relies on a cloud API for sync." in user_content
    assert messages[0]["role"] == "system"


def test_build_messages_handles_missing_workflow_and_architecture():
    messages = _build_messages(
        written_claims=[SlideText(slide_number=1, raw_text="Some claim.")],
        workflow_structure=None,
        architecture_description=None,
    )
    user_content = messages[1]["content"]
    assert "(none extracted)" in user_content


def test_estimate_tokens_grows_with_input_size():
    short = _estimate_tokens([{"content": "x" * 10}])
    long = _estimate_tokens([{"content": "x" * 1000}])
    assert long > short
