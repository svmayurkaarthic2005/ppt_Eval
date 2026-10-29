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

from app.llm.key_pool import get_key_pool
from app.models.schemas import SlideRole

logger = logging.getLogger("hackeval.extraction.slide_roles")

GROQ_MODEL = "openai/gpt-oss-20b"

KEYWORDS: dict[SlideRole, tuple[str, ...]] = {
    SlideRole.problem: (
        "problem",
        "challenge",
        "pain point",
        "the ask",
        "pollution",
        "emission",
        "waste issue",
        "environmental challenge",
        "contamination",
    ),
    SlideRole.existing_solution: (
        "existing solution",
        "current solution",
        "status quo",
        "competitor",
        "alternative",
        "prior art",
        "conventional method",
        "standard practice",
    ),
    SlideRole.proposed_solution: (
        "proposed solution",
        "our solution",
        "solution overview",
        "our approach",
        "what we built",
        "green chemistry",
        "bioremediation",
        "novel process",
        "sustainable solution",
    ),
    SlideRole.workflow: (
        "workflow",
        "architecture",
        "how it works",
        "system design",
        "pipeline",
        "tech stack",
        "process flow",
        "reaction mechanism",
        "experimental setup",
        "methodology",
        "process optimization",
        "flowsheet",
        "compounding process",
    ),
    SlideRole.cost: (
        "cost",
        "pricing",
        "budget",
        "roi",
        "bill of materials",
        "bom",
        "reagents cost",
        "equipment cost",
        "capex",
        "opex",
        "economic viability",
    ),
    SlideRole.execution: (
        "execution",
        "execution plan",
        "implementation plan",
        "next steps",
        "immediate next steps",
        "go-to-market",
        "gtm",
        "team",
        "pilot plant",
        "scale-up",
        "field testing",
        "industrial deployment",
        "prototype plan",
        "action plan",
    ),
    SlideRole.timeline: (
        "timeline",
        "roadmap",
        "milestones",
        "schedule",
        "work plan",
        "testing phases",
        "week 1",
        "gantt",
        "four-week",
        "4-week",
        "sprint",
        "phase plan",
    ),
}


def classify_by_keywords(title: str) -> SlideRole | None:
    """Returns a role when keywords unambiguously identify it.

    Strategy: find the longest matching keyword across all roles (specificity
    wins over shorter incidental matches).  If every matching keyword belongs
    to the *same* role, return that role.  If two or more *different* roles
    each have a matching keyword, return None so the LLM tiebreaker runs.

    Examples
    --------
    "Execution Plan & Immediate Next Steps"
        → "immediate next steps" (len 20, execution) wins; only execution
          keywords match → SlideRole.execution  ✓

    "Team & Timeline"
        → "timeline" (len 8, timeline) is longest, but "team" (len 4,
          execution) also matches a *different* role → None → LLM  ✓

    "Our Proposed Solution"
        → only proposed_solution keywords match → SlideRole.proposed_solution  ✓
    """
    haystack = title.lower()
    matched_roles: set[SlideRole] = set()
    best_role: SlideRole | None = None
    best_len = 0
    for role, keywords in KEYWORDS.items():
        for kw in keywords:
            if kw in haystack:
                matched_roles.add(role)
                if len(kw) > best_len:
                    best_role = role
                    best_len = len(kw)
    # Unambiguous: every matching keyword belongs to the same role
    if len(matched_roles) == 1:
        return best_role
    return None


async def classify_with_llm(title: str, raw_text: str) -> SlideRole:
    pool = get_key_pool()
    if not len(pool):
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
                headers={"Authorization": f"Bearer {pool.current}"},
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
