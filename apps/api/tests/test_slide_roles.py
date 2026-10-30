import httpx

from app.extraction.slide_roles import classify_by_keywords, classify_with_llm
from app.llm.key_pool import GroqKeyPool
from app.models.schemas import SlideRole


def test_classify_by_keywords_picks_single_unambiguous_match():
    assert classify_by_keywords("Our Proposed Solution") == SlideRole.proposed_solution


def test_classify_by_keywords_returns_none_when_ambiguous_or_no_match():
    assert classify_by_keywords("Team & Timeline") is None  # execution + timeline both match
    assert classify_by_keywords("Thank You") is None


async def test_classify_with_llm_requests_enough_tokens_for_reasoning_models(monkeypatch):
    """Groq's gpt-oss models spend max_tokens on hidden reasoning before the
    answer; a too-small budget (e.g. 10) returns empty content with
    finish_reason 'length', silently degrading every call to SlideRole.other.
    This guards against that regression."""
    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        text = ""
        request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "proposed_solution"}}]}

    async def fake_post(self, url, headers=None, json=None):
        captured.update(json)
        return FakeResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(
        "app.extraction.slide_roles.get_key_pool",
        lambda: GroqKeyPool(["fake-key"]),
    )

    result = await classify_with_llm("Our Approach", "We use anomaly detection")

    assert result == SlideRole.proposed_solution
    assert captured["max_tokens"] >= 50
    assert captured["reasoning_effort"] == "low"
