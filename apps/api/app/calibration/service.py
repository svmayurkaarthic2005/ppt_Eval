"""Phase 10's write path: turns an admin's batch of per-section human
scores into a calibration_runs row + calibration_pairs rows. The AI side
of each pair is always read back from section_totals (Phase 9's
trigger-computed truth) -- the admin only ever supplies the human score,
never the AI one, so a calibration run can't be skewed by a typo'd or
stale AI number entered by hand.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import asyncpg

from app.calibration.statistics import (
    ResolvedCalibrationPair,
    SectionScorePair,
    mean_absolute_error,
    section_agreement_pct,
    spearman_rank_correlation,
)

MIN_SAMPLE_SIZE = 1
MAX_SAMPLE_SIZE = 100


class CalibrationRunSizeError(ValueError):
    pass


class SectionMismatchError(ValueError):
    pass


@dataclass(frozen=True)
class HumanSectionScore:
    section_key: str
    human_score: float



@dataclass(frozen=True)
class CalibrationSubmissionInput:
    submission_id: UUID
    human_section_scores: list[HumanSectionScore]


@dataclass(frozen=True)
class CalibrationRunSummary:
    id: UUID
    sample_size: int
    mean_absolute_error: float
    criterion_agreement_pct: float
    ranking_agreement_pct: float


async def _resolve_pair(
    conn: asyncpg.Connection, submission_input: CalibrationSubmissionInput
) -> ResolvedCalibrationPair:
    submission_id = submission_input.submission_id
    ai_rows = await conn.fetch(
        "select section_key, computed_total from section_totals where submission_id = $1",
        submission_id,
    )
    ai_by_section = {r["section_key"]: float(r["computed_total"]) for r in ai_rows}
    if not ai_by_section:
        raise SectionMismatchError(
            f"submission {submission_id} has no computed section totals yet "
            "(it isn't fully scored, so it can't be used for calibration)"
        )

    human_by_section = {s.section_key: float(s.human_score) for s in submission_input.human_section_scores}
    if set(ai_by_section) != set(human_by_section):
        raise SectionMismatchError(
            f"submission {submission_id}: human-entered sections {sorted(human_by_section)} "
            f"don't match the AI's scored sections {sorted(ai_by_section)}"
        )

    section_scores = [
        SectionScorePair(section_key=key, ai_score=ai_by_section[key], human_score=human_by_section[key])
        for key in ai_by_section
    ]
    return ResolvedCalibrationPair(submission_id=submission_id, section_scores=section_scores)



async def record_calibration_run(
    conn: asyncpg.Connection,
    submissions: list[CalibrationSubmissionInput],
    notes: str | None = None,
) -> CalibrationRunSummary:
    if not MIN_SAMPLE_SIZE <= len(submissions) <= MAX_SAMPLE_SIZE:
        raise CalibrationRunSizeError(
            f"a calibration run needs {MIN_SAMPLE_SIZE}-{MAX_SAMPLE_SIZE} submissions, "
            f"got {len(submissions)}"
        )

    pairs = [await _resolve_pair(conn, s) for s in submissions]

    ai_totals = [float(p.ai_total) for p in pairs]
    human_totals = [float(p.human_total) for p in pairs]

    mae = mean_absolute_error(ai_totals, human_totals)
    agreement_pct = section_agreement_pct(pairs)
    rank_correlation = spearman_rank_correlation(ai_totals, human_totals)

    run_row = await conn.fetchrow(
        """
        insert into calibration_runs
            (sample_size, mean_absolute_error, criterion_agreement_pct, ranking_agreement_pct, notes)
        values ($1, $2, $3, $4, $5)
        returning id
        """,
        len(pairs),
        mae,
        agreement_pct,
        rank_correlation,
        notes,
    )
    run_id = run_row["id"]

    for pair in pairs:
        await conn.execute(
            """
            insert into calibration_pairs
                (calibration_run_id, submission_id, human_total, ai_total, section_scores)
            values ($1, $2, $3, $4, $5)
            """,
            run_id,
            pair.submission_id,
            pair.human_total,
            pair.ai_total,
            [
                {"section_key": s.section_key, "ai_score": s.ai_score, "human_score": s.human_score}
                for s in pair.section_scores
            ],
        )

    return CalibrationRunSummary(
        id=run_id,
        sample_size=len(pairs),
        mean_absolute_error=mae,
        criterion_agreement_pct=agreement_pct,
        ranking_agreement_pct=rank_correlation,
    )
