from unittest.mock import AsyncMock, MagicMock

import pytest

from app.rankings import (
    RankingRow,
    get_leaderboard_publish_status,
    set_leaderboard_publish_status,
)
from app.routers.rankings import (
    overall_ranking,
    ranking_by_problem_statement,
)


def _pool(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)
    pool.acquire.return_value = acquire_cm
    return pool


@pytest.mark.asyncio
async def test_get_leaderboard_publish_status_defaults_to_false():
    conn = AsyncMock()
    conn.fetchrow.return_value = None

    status = await get_leaderboard_publish_status(conn)
    assert status == {"is_published": False, "published_at": None}


@pytest.mark.asyncio
async def test_set_leaderboard_publish_status_updates_row():
    conn = AsyncMock()

    res = await set_leaderboard_publish_status(conn, True)
    assert res["is_published"] is True
    assert conn.execute.called


@pytest.mark.asyncio
async def test_overall_ranking_returns_empty_for_viewer_when_unpublished(monkeypatch):
    conn = AsyncMock()
    monkeypatch.setattr(
        "app.routers.rankings.get_leaderboard_publish_status",
        AsyncMock(return_value={"is_published": False, "published_at": None}),
    )

    rows = await overall_ranking(pool=_pool(conn), admin_id=None)
    assert rows == []


@pytest.mark.asyncio
async def test_overall_ranking_returns_data_for_admin_when_unpublished(monkeypatch):
    conn = AsyncMock()
    sample_row = RankingRow(
        submission_id="sub-1",
        team_name="Alpha",
        total_score=35.0,
        max_total_score=40.0,
        section_totals={},
        reliability="HIGH",
        slide_count=12,
    )
    monkeypatch.setattr(
        "app.routers.rankings.get_overall_ranking",
        AsyncMock(return_value=[sample_row]),
    )

    rows = await overall_ranking(pool=_pool(conn), admin_id="admin-id")
    assert len(rows) == 1
    assert rows[0].team_name == "Alpha"


@pytest.mark.asyncio
async def test_by_problem_statement_returns_empty_for_viewer_when_unpublished(monkeypatch):
    conn = AsyncMock()
    monkeypatch.setattr(
        "app.routers.rankings.get_leaderboard_publish_status",
        AsyncMock(return_value={"is_published": False, "published_at": None}),
    )

    groups = await ranking_by_problem_statement(pool=_pool(conn), admin_id=None)
    assert groups == []
