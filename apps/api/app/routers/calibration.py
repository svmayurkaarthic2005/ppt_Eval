from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import get_current_admin_id
from app.calibration.reliability import compute_and_store_reliability_label
from app.calibration.service import (
    CalibrationRunSizeError,
    CalibrationSubmissionInput,
    HumanSectionScore,
    SectionMismatchError,
    record_calibration_run,
)
from app.models.schemas import CalibrationRun as CalibrationRunSchema

router = APIRouter(prefix="/calibration", tags=["calibration"])


def get_db_pool(request: Request) -> asyncpg.Pool:
    pool = request.app.state.db_pool
    if pool is None:
        raise HTTPException(status_code=503, detail="Job queue database is not configured")
    return pool


class HumanSectionScoreIn(BaseModel):
    section_key: str
    human_score: float


class CalibrationSubmissionIn(BaseModel):
    submission_id: UUID
    human_section_scores: list[HumanSectionScoreIn]


class CalibrationRunIn(BaseModel):
    submissions: list[CalibrationSubmissionIn]
    notes: str | None = None


class CalibrationRunOut(BaseModel):
    id: UUID
    sample_size: int
    mean_absolute_error: float
    criterion_agreement_pct: float
    ranking_agreement_pct: float


class CalibrationCandidate(BaseModel):
    submission_id: UUID
    team_name: str
    final_total: float
    section_totals: dict[str, float]


@router.get("/status")
async def calibration_status() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/candidates", response_model=list[CalibrationCandidate])
async def list_candidates(pool: asyncpg.Pool = Depends(get_db_pool)) -> list[CalibrationCandidate]:
    """Already-scored submissions an admin can pick 20-30 of for a run."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select s.id as submission_id, t.name as team_name, f.computed_total as final_total
            from submissions s
            join teams t on t.id = s.team_id
            join final_scores f on f.submission_id = s.id
            where s.status = 'scored'
            order by s.uploaded_at desc
            """
        )
        candidates = []
        for row in rows:
            section_rows = await conn.fetch(
                "select section_key, computed_total from section_totals where submission_id = $1",
                row["submission_id"],
            )
            candidates.append(
                CalibrationCandidate(
                    submission_id=row["submission_id"],
                    team_name=row["team_name"],
                    final_total=float(row["final_total"]),
                    section_totals={r["section_key"]: float(r["computed_total"]) for r in section_rows},
                )
            )
        return candidates


@router.get("/runs", response_model=list[CalibrationRunSchema])
async def list_runs(pool: asyncpg.Pool = Depends(get_db_pool)) -> list[CalibrationRunSchema]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("select * from calibration_runs order by created_at desc")
    return [CalibrationRunSchema(**dict(r)) for r in rows]


@router.post("/runs", response_model=CalibrationRunOut, status_code=201)
async def create_calibration_run(
    body: CalibrationRunIn,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> CalibrationRunOut:
    submissions = [
        CalibrationSubmissionInput(
            submission_id=s.submission_id,
            human_section_scores=[
                HumanSectionScore(section_key=h.section_key, human_score=h.human_score)
                for h in s.human_section_scores
            ],
        )
        for s in body.submissions
    ]

    async with pool.acquire() as conn, conn.transaction():
        try:
            summary = await record_calibration_run(conn, submissions, notes=body.notes)
        except (CalibrationRunSizeError, SectionMismatchError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        # This run just added fresh calibration evidence, and
        # _nearest_calibration_mae (app/calibration/reliability.py) looks up
        # the nearest evidence by SCORE WINDOW across *all* calibration_pairs,
        # not just this run's own submissions -- so any already-scored
        # submission whose score happens to fall in a now-better-evidenced
        # range needs recomputing too, not only the ones in `submissions`
        # (which used to be the only ones refreshed here, silently leaving
        # every other similarly-scored submission's label stale).
        all_scored = await conn.fetch(
            "select f.submission_id, f.computed_total from final_scores f "
            "join submissions s on s.id = f.submission_id where s.status = 'scored'"
        )
        for row in all_scored:
            await compute_and_store_reliability_label(
                conn, row["submission_id"], row["computed_total"]
            )

    return CalibrationRunOut(
        id=summary.id,
        sample_size=summary.sample_size,
        mean_absolute_error=summary.mean_absolute_error,
        criterion_agreement_pct=summary.criterion_agreement_pct,
        ranking_agreement_pct=summary.ranking_agreement_pct,
    )
