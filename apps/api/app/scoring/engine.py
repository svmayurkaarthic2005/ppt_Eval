"""Phase 9: the single place a submission's totals are ever computed in
application code. Mirrors the DB trigger in
supabase/migrations/20260101001000_scoring_completeness.sql -- same
completeness rule, same arithmetic -- so the two can never diverge: the
app layer exists for a clear Python exception, the trigger is the backstop
that holds even if this module is bypassed entirely (a raw SQL write, a
bug, a future code path that forgets to call it).

The only numeric values that ever reach section_totals/final_scores are
Python-computed sums of individually validated criterion_scores.llm_score
rows -- never a total parsed out of raw LLM text. This module only reads
and validates; the trigger is the sole writer of section_totals/
final_scores, so there is exactly one write path, not two racing ones.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import asyncpg

from app.comparison import invalidate_for_submission


class IncompleteSectionError(Exception):
    pass


@dataclass(frozen=True)
class SectionTotal:
    section_key: str
    total: float
    max_total: float
    criteria_scored: int
    criteria_expected: int


@dataclass(frozen=True)
class FinalScore:
    total: float
    max_total: float
    sections: list[SectionTotal]


def _validate_and_sum(
    section_key: str,
    expected_criterion_keys: list[str],
    scored: dict[str, float],
    max_total: float,
) -> SectionTotal:
    """Pure: no I/O. Asserts the scored criteria are exactly the section's
    defined criteria -- no more, no fewer -- before summing, so a missing
    criterion raises instead of silently producing a misleadingly-low
    total, and a stray/duplicate key raises instead of silently inflating one."""
    missing = [key for key in expected_criterion_keys if key not in scored]
    if missing:
        raise IncompleteSectionError(
            f"section {section_key!r} is missing scores for criteria {missing} "
            f"({len(scored)}/{len(expected_criterion_keys)} scored)"
        )

    extra = [key for key in scored if key not in expected_criterion_keys]
    if extra:
        raise IncompleteSectionError(
            f"section {section_key!r} has criterion_scores rows not in its rubric "
            f"template: {extra}"
        )

    total = round(float(sum(scored[key] for key in expected_criterion_keys)), 2)
    return SectionTotal(
        section_key=section_key,
        total=total,
        max_total=float(max_total),
        criteria_scored=len(scored),
        criteria_expected=len(expected_criterion_keys),
    )


def _sum_sections(sections: list[SectionTotal]) -> FinalScore:
    """Pure: no I/O. Only ever called once every section has already
    passed _validate_and_sum, so this is a plain sum of validated totals."""
    return FinalScore(
        total=round(float(sum(s.total for s in sections)), 2),
        max_total=round(float(sum(s.max_total for s in sections)), 2),
        sections=sections,
    )


async def _get_section_definition(
    conn: asyncpg.Connection, submission_id: UUID, section_key: str
) -> tuple[list[str], float]:
    row = await conn.fetchrow(
        """
        select section.value -> 'criteria' as criteria,
               (section.value ->> 'max_score')::numeric as max_score
        from submissions s
        join rubric_templates rt on rt.id = s.rubric_template_id
        cross join lateral jsonb_array_elements(rt.sections -> 'sections') as section
        where s.id = $1 and section.value ->> 'key' = $2
        """,
        submission_id,
        section_key,
    )
    if row is None:
        raise ValueError(f"no rubric section {section_key!r} resolved for submission {submission_id}")
    criteria_raw = row["criteria"]
    if isinstance(criteria_raw, str):
        import json
        criteria_raw = json.loads(criteria_raw)
    criteria_keys = [c["key"] for c in criteria_raw]
    return criteria_keys, float(row["max_score"])



async def _get_all_section_keys(conn: asyncpg.Connection, submission_id: UUID) -> list[str]:
    rows = await conn.fetch(
        """
        select section.value ->> 'key' as section_key
        from submissions s
        join rubric_templates rt on rt.id = s.rubric_template_id
        cross join lateral jsonb_array_elements(rt.sections -> 'sections') as section
        where s.id = $1
        """,
        submission_id,
    )
    if not rows:
        raise ValueError(f"no rubric template resolved for submission {submission_id}")
    return [r["section_key"] for r in rows]


async def compute_section_total(
    conn: asyncpg.Connection, submission_id: UUID, section_key: str
) -> SectionTotal:
    expected_keys, max_total = await _get_section_definition(conn, submission_id, section_key)
    rows = await conn.fetch(
        "select criterion_key, llm_score from criterion_scores where submission_id = $1 and section_key = $2",
        submission_id,
        section_key,
    )
    scored = {r["criterion_key"]: float(r["llm_score"]) for r in rows}
    return _validate_and_sum(section_key, expected_keys, scored, max_total)


async def compute_final_score(conn: asyncpg.Connection, submission_id: UUID) -> FinalScore:
    """Only succeeds once all four sections are complete -- raises
    IncompleteSectionError (naming the first incomplete section found)
    otherwise, rather than summing whichever sections happen to be done."""
    section_keys = await _get_all_section_keys(conn, submission_id)
    sections = [await compute_section_total(conn, submission_id, key) for key in section_keys]
    return _sum_sections(sections)


async def finalize_submission_if_complete(
    conn: asyncpg.Connection, submission_id: UUID
) -> FinalScore | None:
    """The pipeline's 'score' stage calls this after every criterion is
    scored; it's a no-op (returns None) until the submission is actually
    complete, at which point it sets status='scored' and returns the total."""
    try:
        final_score = await compute_final_score(conn, submission_id)
    except IncompleteSectionError:
        return None

    await conn.execute("update submissions set status = 'scored' where id = $1", submission_id)
    # Phase 15: a fresh final score invalidates any cached /compare response
    # that includes this submission -- never serve a stale total.
    invalidate_for_submission(submission_id)
    return final_score
