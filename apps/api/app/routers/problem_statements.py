from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import ProblemStatement
from app.routers.submissions import get_db_pool
from app.storage_cleanup import cleanup_submission_storage

router = APIRouter(prefix="/problem-statements", tags=["problem-statements"])


@router.get("/", response_model=list[ProblemStatement])
async def list_problem_statements(pool: asyncpg.Pool = Depends(get_db_pool)) -> list[ProblemStatement]:
    """Backs the upload form's searchable dropdown (Step: pick a problem
    statement). A new one is created implicitly by POST /submissions when
    no existing id is picked -- there's no separate create endpoint."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("select * from problem_statements order by title")
    return [ProblemStatement(**dict(row)) for row in rows]


@router.delete("/{problem_statement_id}")
async def delete_problem_statement(
    problem_statement_id: UUID, pool: asyncpg.Pool = Depends(get_db_pool)
) -> dict[str, Any]:
    """Permanently deletes a problem statement and cleans up any submissions
    referencing it."""
    async with pool.acquire() as conn:
        ps = await conn.fetchrow(
            "select id, title from problem_statements where id = $1",
            problem_statement_id,
        )
        if ps is None:
            raise HTTPException(status_code=404, detail="Problem statement not found")

        # Fetch all submissions referencing this problem statement to clean up storage
        subs = await conn.fetch(
            "select id, team_id, pptx_storage_path, problem_statement_storage_path from submissions where problem_statement_id = $1",
            problem_statement_id,
        )
        for sub in subs:
            slide_rows = await conn.fetch(
                "select unnest(image_storage_paths) as path from slides where submission_id = $1",
                sub["id"],
            )
            image_paths = [r["path"] for r in slide_rows if r["path"]]
            cleanup_submission_storage(
                sub["pptx_storage_path"],
                sub["problem_statement_storage_path"],
                image_paths,
            )

            team_id = sub["team_id"]
            await conn.execute("delete from submissions where id = $1", sub["id"])
            remaining = await conn.fetchval(
                "select count(*) from submissions where team_id = $1", team_id
            )
            if remaining == 0:
                await conn.execute("delete from teams where id = $1", team_id)

        # Delete the problem statement
        await conn.execute("delete from problem_statements where id = $1", problem_statement_id)

    return {"deleted": True, "problem_statement_id": str(problem_statement_id), "title": ps["title"]}

