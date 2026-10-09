"""Phase 10: a submission's reliability label (HIGH/MEDIUM/REVIEW) is
derived only from (a) the nearest calibration run's empirical error for
submissions of a similar score range, (b) the count/severity of its own
consistency_flags, and (c) whether any criterion came back
needs_human_review from Phase 6. Never from the LLM's own self-reported
confidence -- the spec explicitly calls that uncalibrated, so there is no
code path here that reads anything the model said about its own certainty.

The label is the most cautious (highest-REVIEW) of the two independent
signals -- one weak signal is enough to warrant a closer look, rather than
averaging it away against a strong one.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

import asyncpg

from app.comparison import invalidate_for_submission

ReliabilityLabel = Literal["HIGH", "MEDIUM", "REVIEW"]

_LABEL_RANK: dict[str, int] = {"HIGH": 0, "MEDIUM": 1, "REVIEW": 2}

# "Similar score range": pairs from past calibration runs whose AI total
# lands within this many marks (out of 40) of the submission being labeled.
SCORE_WINDOW = 4
HIGH_MAE_THRESHOLD = 2.0  # marks out of 40
MEDIUM_MAE_THRESHOLD = 5.0


def _label_from_mae(mae: float | None, max_score: int) -> ReliabilityLabel:
    if mae is None:
        # No calibration evidence for this score range yet -- can't claim
        # HIGH confidence without an empirical basis for it.
        return "MEDIUM"
    normalized = mae / max_score * 40
    if normalized <= HIGH_MAE_THRESHOLD:
        return "HIGH"
    if normalized <= MEDIUM_MAE_THRESHOLD:
        return "MEDIUM"
    return "REVIEW"


def _label_from_flag_severities(severities: list[str]) -> ReliabilityLabel:
    if any(s == "high" for s in severities):
        return "REVIEW"
    if any(s == "medium" for s in severities):
        return "MEDIUM"
    return "HIGH"


def derive_reliability_label(
    max_score: int,
    nearest_calibration_mae: float | None,
    consistency_flag_severities: list[str],
    has_needs_human_review_criterion: bool,
) -> ReliabilityLabel:
    """Pure: no I/O. A criterion that never got a valid score always wins
    outright -- there's no amount of good calibration data or clean flags
    that makes an unscored criterion not need review."""
    if has_needs_human_review_criterion:
        return "REVIEW"

    candidates = [
        _label_from_mae(nearest_calibration_mae, max_score),
        _label_from_flag_severities(consistency_flag_severities),
    ]
    return max(candidates, key=lambda label: _LABEL_RANK[label])


async def _nearest_calibration_mae(
    conn: asyncpg.Connection, final_score: float, window: float = float(SCORE_WINDOW)
) -> float | None:
    rows = await conn.fetch(
        "select ai_total, human_total from calibration_pairs where ai_total between $1 and $2",
        float(final_score - window),
        float(final_score + window),
    )
    if not rows:
        return None
    errors = [abs(float(r["ai_total"]) - float(r["human_total"])) for r in rows]
    return sum(errors) / len(errors)


async def _unresolved_flag_severities(conn: asyncpg.Connection, submission_id: UUID) -> list[str]:
    rows = await conn.fetch(
        "select severity from consistency_flags where submission_id = $1 and resolved = false",
        submission_id,
    )
    return [r["severity"] for r in rows]


async def _has_needs_human_review_criterion(conn: asyncpg.Connection, submission_id: UUID) -> bool:
    row = await conn.fetchrow(
        """
        select 1 from consistency_flags
        where submission_id = $1 and flag_type = 'criterion_needs_human_review' and resolved = false
        limit 1
        """,
        submission_id,
    )
    return row is not None


async def compute_and_store_reliability_label(
    conn: asyncpg.Connection, submission_id: UUID, final_score: float, max_score: float = 40.0
) -> ReliabilityLabel:
    mae = await _nearest_calibration_mae(conn, float(final_score))

    severities = await _unresolved_flag_severities(conn, submission_id)
    needs_review = await _has_needs_human_review_criterion(conn, submission_id)

    label = derive_reliability_label(max_score, mae, severities, needs_review)

    await conn.execute(
        "update submissions set reliability_label = $2 where id = $1", submission_id, label
    )
    # Phase 15: reliability is part of the /compare payload too.
    invalidate_for_submission(submission_id)
    return label
