from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.teams import delete_team


def _pool(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)
    pool.acquire.return_value = acquire_cm
    return pool


@pytest.mark.asyncio
async def test_delete_team_raises_404_when_team_missing():
    conn = AsyncMock()
    conn.fetchrow.return_value = None

    with pytest.raises(HTTPException) as exc_info:
        await delete_team(team_id=uuid4(), pool=_pool(conn))

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_team_cleans_up_storage_for_every_submission_then_deletes():
    team_id = uuid4()
    sub_id = uuid4()
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": team_id, "name": "AgroStress AI"}
    conn.fetch.side_effect = [
        [{"id": sub_id, "pptx_storage_path": "decks/a.pptx", "problem_statement_storage_path": "ps/b.pdf"}],
        [{"path": "slides/1.png"}, {"path": "slides/2.png"}],
    ]

    with patch("app.routers.teams.cleanup_submission_storage") as mock_cleanup:
        result = await delete_team(team_id=team_id, pool=_pool(conn))

    mock_cleanup.assert_called_once_with("decks/a.pptx", "ps/b.pdf", ["slides/1.png", "slides/2.png"])
    delete_calls = [c for c in conn.execute.call_args_list if "delete from teams" in c.args[0]]
    assert len(delete_calls) == 1
    assert delete_calls[0].args[1] == team_id
    assert result == {"deleted": True, "team_id": str(team_id), "team_name": "AgroStress AI"}


@pytest.mark.asyncio
async def test_delete_team_with_no_submissions_skips_cleanup_but_still_deletes():
    team_id = uuid4()
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": team_id, "name": "Empty Team"}
    conn.fetch.return_value = []

    with patch("app.routers.teams.cleanup_submission_storage") as mock_cleanup:
        result = await delete_team(team_id=team_id, pool=_pool(conn))

    mock_cleanup.assert_not_called()
    assert result["deleted"] is True
