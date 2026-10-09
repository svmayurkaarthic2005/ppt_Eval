"""Phase 15: GET /submissions/compare -- puts 2-6 scored submissions side
by side. Enforces same-rubric comparison (never compares incompatible
point structures) and caches the assembled response briefly per unique id
combination, since judges reopen the same comparison repeatedly while
deliberating -- but a re-scoring event for any included submission
invalidates its cache entries immediately, so "a few seconds" is a
performance optimization, not a staleness tolerance.
"""

from __future__ import annotations

import time
from typing import Any, Literal
from uuid import UUID

import asyncpg
from pydantic import BaseModel

MIN_SUBMISSIONS = 2
MAX_SUBMISSIONS = 6
CACHE_TTL_SECONDS = 10

_cache: dict[frozenset[str], tuple[float, dict[str, Any]]] = {}


def _cache_key(ids: list[UUID]) -> frozenset[str]:
    return frozenset(str(i) for i in ids)


def _get_cached(ids: list[UUID]) -> dict[str, Any] | None:
    entry = _cache.get(_cache_key(ids))
    if entry is None:
        return None
    cached_at, data = entry
    if time.monotonic() - cached_at > CACHE_TTL_SECONDS:
        del _cache[_cache_key(ids)]
        return None
    return data


def _set_cached(ids: list[UUID], data: dict[str, Any]) -> None:
    _cache[_cache_key(ids)] = (time.monotonic(), data)


def invalidate_for_submission(submission_id: UUID) -> None:
    """Called by Phase 9 (scoring) and Phase 10 (reliability) whenever
    either changes for a submission -- drops every cached comparison that
    includes it, regardless of which other submissions it was compared
    against."""
    target = str(submission_id)
    stale_keys = [key for key in _cache if target in key]
    for key in stale_keys:
        del _cache[key]


class RubricVersionMismatchError(Exception):
    def __init__(self, details: list[dict[str, Any]]):
        self.details = details
        super().__init__("submissions were scored under different rubric versions")


class SubmissionNotFoundError(Exception):
    def __init__(self, missing_ids: list[UUID]):
        self.missing_ids = missing_ids
        super().__init__(f"submission(s) not found: {missing_ids}")


class CriterionComparisonRow(BaseModel):
    criterion_key: str
    section: str
    score: float
    max_score: float
    rationale: str


class SubmissionComparison(BaseModel):
    submission_id: UUID
    team_name: str
    reliability: Literal["HIGH", "MEDIUM", "REVIEW"] | None
    flag_count: int
    section_totals: dict[str, float]
    final_total: float
    criteria: list[CriterionComparisonRow]


class ComparisonResponse(BaseModel):
    rubric_template_id: UUID
    sections: list[str]
    submissions: list[SubmissionComparison]


def parse_and_dedupe_ids(raw: str) -> list[UUID]:
    """Pure: no I/O. Parses a comma-separated id list, de-duplicating while
    preserving first-seen order (so "same id twice" collapses to one
    submission, not an error about malformed input)."""
    seen: dict[UUID, None] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        seen[UUID(part)] = None
    return list(seen.keys())


def validate_count(ids: list[UUID]) -> None:
    """Pure: no I/O. Raises ValueError with a human-readable message; the
    router maps this to a 400 before any query runs."""
    if not MIN_SUBMISSIONS <= len(ids) <= MAX_SUBMISSIONS:
        raise ValueError(
            f"Provide between {MIN_SUBMISSIONS} and {MAX_SUBMISSIONS} distinct submission ids, "
            f"got {len(ids)}"
        )


async def build_comparison(conn: asyncpg.Connection, ids: list[UUID]) -> ComparisonResponse:
    cached = _get_cached(ids)
    if cached is not None:
        return ComparisonResponse(**cached)

    base_rows = await conn.fetch(
        """
        select s.id, s.rubric_template_id, s.reliability_label, t.name as team_name
        from submissions s
        join teams t on t.id = s.team_id
        where s.id = any($1::uuid[])
        """,
        ids,
    )
    found_ids = {row["id"] for row in base_rows}
    missing = [i for i in ids if i not in found_ids]
    if missing:
        raise SubmissionNotFoundError(missing)

    template_ids = {row["rubric_template_id"] for row in base_rows}
    if len(template_ids) > 1:
        raise RubricVersionMismatchError(
            [
                {"submission_id": row["id"], "rubric_template_id": row["rubric_template_id"]}
                for row in base_rows
            ]
        )
    rubric_template_id = next(iter(template_ids))

    template = await conn.fetchrow(
        "select sections from rubric_templates where id = $1", rubric_template_id
    )
    section_order: list[str] = []
    section_name_by_key: dict[str, str] = {}
    for section in template["sections"]["sections"]:
        section_order.append(section["name"])
        section_name_by_key[section["key"]] = section["name"]

    final_rows = await conn.fetch(
        "select submission_id, computed_total from final_scores where submission_id = any($1::uuid[])",
        ids,
    )
    final_by_submission = {row["submission_id"]: float(row["computed_total"]) for row in final_rows}

    section_total_rows = await conn.fetch(
        "select submission_id, section_key, computed_total from section_totals where submission_id = any($1::uuid[])",
        ids,
    )
    section_totals_by_submission: dict[UUID, dict[str, float]] = {i: {} for i in ids}
    for row in section_total_rows:
        name = section_name_by_key.get(row["section_key"], row["section_key"])
        section_totals_by_submission[row["submission_id"]][name] = float(row["computed_total"])

    flag_rows = await conn.fetch(
        """
        select submission_id, count(*) as n from consistency_flags
        where submission_id = any($1::uuid[]) and resolved = false
        group by submission_id
        """,
        ids,
    )
    flag_count_by_submission = {row["submission_id"]: row["n"] for row in flag_rows}

    criterion_rows = await conn.fetch(
        """
        select submission_id, section_key, criterion_key, llm_score, max_score, rationale
        from criterion_scores
        where submission_id = any($1::uuid[])
        order by submission_id, section_key, criterion_key
        """,
        ids,
    )
    criteria_by_submission: dict[UUID, list[CriterionComparisonRow]] = {i: [] for i in ids}
    for row in criterion_rows:
        criteria_by_submission[row["submission_id"]].append(
            CriterionComparisonRow(
                criterion_key=row["criterion_key"],
                section=section_name_by_key.get(row["section_key"], row["section_key"]),
                score=float(row["llm_score"]),
                max_score=float(row["max_score"]),
                rationale=row["rationale"],
            )
        )

    team_name_by_submission = {row["id"]: row["team_name"] for row in base_rows}
    reliability_by_submission = {row["id"]: row["reliability_label"] for row in base_rows}

    submissions = [
        SubmissionComparison(
            submission_id=submission_id,
            team_name=team_name_by_submission[submission_id],
            reliability=reliability_by_submission[submission_id],
            flag_count=flag_count_by_submission.get(submission_id, 0),
            section_totals=section_totals_by_submission.get(submission_id, {}),
            final_total=float(final_by_submission.get(submission_id, 0)),
            criteria=criteria_by_submission.get(submission_id, []),
        )
        for submission_id in ids
    ]

    response = ComparisonResponse(
        rubric_template_id=rubric_template_id,
        sections=section_order,
        submissions=submissions,
    )
    _set_cached(ids, response.model_dump(mode="json"))
    return response
