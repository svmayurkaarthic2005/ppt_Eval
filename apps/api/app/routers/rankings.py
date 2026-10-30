import asyncpg
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import get_current_admin_id, get_optional_admin_id
from app.rankings import (
    ProblemStatementGroup,
    RankingRow,
    get_leaderboard_publish_status,
    get_overall_ranking,
    get_ranking_by_problem_statement,
    set_leaderboard_publish_status,
)
from app.routers.submissions import get_db_pool

router = APIRouter(prefix="/rankings", tags=["rankings"])


class PublishStatusResponse(BaseModel):
    is_published: bool
    published_at: str | None = None


class PublishToggleRequest(BaseModel):
    published: bool


@router.get("/status", response_model=PublishStatusResponse)
async def get_publish_status(
    pool: asyncpg.Pool = Depends(get_db_pool),
) -> PublishStatusResponse:
    async with pool.acquire() as conn:
        status = await get_leaderboard_publish_status(conn)
        return PublishStatusResponse(**status)


@router.post("/publish", response_model=PublishStatusResponse)
async def publish_leaderboard(
    payload: PublishToggleRequest,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> PublishStatusResponse:
    async with pool.acquire() as conn:
        status = await set_leaderboard_publish_status(conn, payload.published)
        return PublishStatusResponse(**status)


@router.get("/overall", response_model=list[RankingRow])
async def overall_ranking(
    pool: asyncpg.Pool = Depends(get_db_pool),
    admin_id: str | None = Depends(get_optional_admin_id),
) -> list[RankingRow]:
    async with pool.acquire() as conn:
        if not admin_id:
            status = await get_leaderboard_publish_status(conn)
            if not status["is_published"]:
                return []
        return await get_overall_ranking(conn)


@router.get("/by-problem-statement", response_model=list[ProblemStatementGroup])
async def ranking_by_problem_statement(
    pool: asyncpg.Pool = Depends(get_db_pool),
    admin_id: str | None = Depends(get_optional_admin_id),
) -> list[ProblemStatementGroup]:
    async with pool.acquire() as conn:
        if not admin_id:
            status = await get_leaderboard_publish_status(conn)
            if not status["is_published"]:
                return []
        return await get_ranking_by_problem_statement(conn)
