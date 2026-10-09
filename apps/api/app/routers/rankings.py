import asyncpg
from fastapi import APIRouter, Depends

from app.rankings import (
    ProblemStatementGroup,
    RankingRow,
    get_overall_ranking,
    get_ranking_by_problem_statement,
)
from app.routers.submissions import get_db_pool

router = APIRouter(prefix="/rankings", tags=["rankings"])


@router.get("/overall", response_model=list[RankingRow])
async def overall_ranking(pool: asyncpg.Pool = Depends(get_db_pool)) -> list[RankingRow]:
    async with pool.acquire() as conn:
        return await get_overall_ranking(conn)


@router.get("/by-problem-statement", response_model=list[ProblemStatementGroup])
async def ranking_by_problem_statement(
    pool: asyncpg.Pool = Depends(get_db_pool),
) -> list[ProblemStatementGroup]:
    async with pool.acquire() as conn:
        return await get_ranking_by_problem_statement(conn)
