"""Slide-role classification: a cheap keyword pass over the title first,
falling back to a small text-only Groq model only when the keyword pass
can't confidently pick a single role.

Never raises -- a classification hiccup (missing API key, network error,
unparseable model output) degrades to SlideRole.other rather than failing
the structural-extraction job over a non-essential label.
"""

from __future__ import annotations

import logging

import httpx

from app.config import get_settings
from app.models.schemas import SlideRole

logger = logging.getLogger("hackeval.extraction.slide_roles")

GROQ_MODEL = "openai/gpt-oss-20b"

KEYWORDS: dict[SlideRole, tuple[str, ...]] = {
    SlideRole.problem: ("problem", "challenge", "pain point", "the ask"),
    SlideRole.existing_solution: (
        "existing solution",
        "current solution",
        "status quo",
        "competitor",
        "alternative",
        "prior art",
    ),
    SlideRole.proposed_solution: (
        "proposed solution",
        "our solution",
        "solution overview",
        "our approach",
        "what we built",
    ),
    SlideRole.workflow: (
        "workflow",
        "architecture",
        "how it works",
        "system design",
        "pipeline",
        "tech stack",
    ),
    SlideRole.cost: ("cost", "pricing", "budget", "roi"),
    SlideRole.execution: ("execution", "implementation", "go-to-market", "gtm", "team"),
    SlideRole.timeline: ("timeline", "roadmap", "milestones", "schedule"),
}


def classify_by_keywords(title: str) -> SlideRole | None:
    """Returns a role only when exactly one role's keywords match the title."""
    haystack = title.lower()
    matches = [role for role, keywords in KEYWORDS.items() if any(kw in haystack for kw in keywords)]
    return matches[0] if len(matches) == 1 else None


async def classify_with_llm(title: str, raw_text: str) -> SlideRole:
    settings = get_settings()
    if not settings.groq_api_key:
        return SlideRole.other

    valid_roles = ", ".join(role.value for role in SlideRole)
    prompt = (
        f"Slide title: {title!r}\n"
        f"Slide body (truncated): {raw_text[:500]!r}\n\n"
        f"Classify this hackathon-pitch-deck slide into exactly one category: {valid_roles}. "
        "Respond with only the category word, nothing else."
    )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": 50,
                    "reasoning_effort": "low",
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"].strip().lower()
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        logger.warning("slide role LLM classification failed: %s", exc)
        return SlideRole.other

    try:
        return SlideRole(content)
    except ValueError:
        logger.warning("slide role LLM returned an unrecognized category: %r", content)
        return SlideRole.other


async def classify_slide_role(title: str, raw_text: str) -> SlideRole:
    by_keyword = classify_by_keywords(title)
    if by_keyword is not None:
        return by_keyword
    return await classify_with_llm(title, raw_text)
