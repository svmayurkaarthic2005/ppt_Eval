import logging
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from app.routers.submissions import get_db_pool
from app.storage_cleanup import cleanup_submission_storage

logger = logging.getLogger("hackeval.teams")

router = APIRouter(prefix="/teams", tags=["teams"])


@router.delete("/{team_id}")
async def delete_team(
    team_id: UUID, pool: asyncpg.Pool = Depends(get_db_pool)
) -> dict[str, Any]:
    """Permanently deletes a team, all its submissions, slides, scores,
    and associated storage files."""
    async with pool.acquire() as conn:
        team = await conn.fetchrow("select id, name from teams where id = $1", team_id)
        if team is None:
            raise HTTPException(status_code=404, detail="Team not found")

        # 1. Fetch all submissions for this team to clean up storage
        subs = await conn.fetch(
            "select id, pptx_storage_path, problem_statement_storage_path from submissions where team_id = $1",
            team_id,
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

        # 2. Unlink any problem statements created by this team
        await conn.execute(
            "update problem_statements set created_by_team_id = null where created_by_team_id = $1",
            team_id,
        )

        # 3. Delete the team (cascades submissions, slides, scores, jobs, etc.)
        await conn.execute("delete from teams where id = $1", team_id)

    return {"deleted": True, "team_id": str(team_id), "team_name": team["name"]}
