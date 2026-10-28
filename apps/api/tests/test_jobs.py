import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.jobs import _resolve_supabase_pooler_url, run_worker


def test_resolve_supabase_pooler_url_rewrites_direct_connection():
    direct = "postgresql://postgres:secret@db.abcxyz123.supabase.co:5432/postgres"
    pooler = _resolve_supabase_pooler_url(direct)
    assert pooler == (
        "postgresql://postgres.abcxyz123:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
    )


def test_resolve_supabase_pooler_url_returns_none_for_non_supabase_url():
    assert _resolve_supabase_pooler_url("postgresql://user:pw@localhost:5432/mydb") is None


def test_resolve_supabase_pooler_url_returns_none_for_malformed_url():
    assert _resolve_supabase_pooler_url("not-a-url") is None


def _make_pool(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)
    pool.acquire.return_value = acquire_cm
    return pool


@pytest.mark.asyncio
async def test_run_worker_runs_handler_and_marks_job_done(monkeypatch):
    monkeypatch.setattr("app.jobs.POLL_INTERVAL_SECONDS", 0)
    submission_id = uuid4()
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"id": 1, "submission_id": submission_id, "job_type": "score"},
        None,
    ]
    pool = _make_pool(conn)

    stop = asyncio.Event()
    handler = AsyncMock()

    # Patch sleep so the "no job" branch doesn't actually wait, and stop the loop then.
    async def fake_sleep(_seconds):
        stop.set()

    monkeypatch.setattr("app.jobs.asyncio.sleep", fake_sleep)

    await run_worker(pool, {"score": handler}, stop)

    handler.assert_awaited_once_with(conn, submission_id)
    done_calls = [c for c in conn.execute.call_args_list if "status = 'done'" in c.args[0]]
    assert len(done_calls) == 1
    assert done_calls[0].args[1] == 1


@pytest.mark.asyncio
async def test_run_worker_marks_job_failed_when_handler_raises(monkeypatch):
    submission_id = uuid4()
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"id": 7, "submission_id": submission_id, "job_type": "score"},
        None,
    ]
    pool = _make_pool(conn)

    stop = asyncio.Event()
    handler = AsyncMock(side_effect=RuntimeError("boom"))

    async def fake_sleep(_seconds):
        stop.set()

    monkeypatch.setattr("app.jobs.asyncio.sleep", fake_sleep)

    await run_worker(pool, {"score": handler}, stop)

    failed_calls = [c for c in conn.execute.call_args_list if "status = 'failed'" in c.args[0]]
    assert len(failed_calls) == 1
    assert failed_calls[0].args[1] == 7
    assert "boom" in failed_calls[0].args[2]


@pytest.mark.asyncio
async def test_run_worker_flags_the_submission_when_a_job_fails(monkeypatch):
    """Without this, a failed job (which is never retried) can leave a
    submission silently stuck mid-pipeline forever -- the flag is what lets
    a human (or the Upload page's stall warning) ever find out why."""
    submission_id = uuid4()
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"id": 7, "submission_id": submission_id, "job_type": "stage2_deep_analysis"},
        None,
    ]
    pool = _make_pool(conn)

    stop = asyncio.Event()
    handler = AsyncMock(side_effect=RuntimeError("boom"))

    async def fake_sleep(_seconds):
        stop.set()

    monkeypatch.setattr("app.jobs.asyncio.sleep", fake_sleep)

    await run_worker(pool, {"stage2_deep_analysis": handler}, stop)

    flag_calls = [c for c in conn.execute.call_args_list if "insert into consistency_flags" in c.args[0]]
    assert len(flag_calls) == 1
    assert "'high'" in flag_calls[0].args[0]
    assert flag_calls[0].args[1] == submission_id
    assert "stage2_deep_analysis" in flag_calls[0].args[2]
    assert "boom" in flag_calls[0].args[2]


@pytest.mark.asyncio
async def test_run_worker_marks_job_failed_when_no_handler_registered(monkeypatch):
    submission_id = uuid4()
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"id": 3, "submission_id": submission_id, "job_type": "unknown_type"},
        None,
    ]
    pool = _make_pool(conn)

    stop = asyncio.Event()

    async def fake_sleep(_seconds):
        stop.set()

    monkeypatch.setattr("app.jobs.asyncio.sleep", fake_sleep)

    await run_worker(pool, {}, stop)

    failed_calls = [c for c in conn.execute.call_args_list if "status = 'failed'" in c.args[0]]
    assert len(failed_calls) == 1
    assert "no handler registered" in failed_calls[0].args[2]


@pytest.mark.asyncio
async def test_run_worker_sleeps_when_queue_is_empty(monkeypatch):
    conn = AsyncMock()
    conn.fetchrow.return_value = None
    pool = _make_pool(conn)

    stop = asyncio.Event()
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)
        stop.set()

    monkeypatch.setattr("app.jobs.asyncio.sleep", fake_sleep)

    await run_worker(pool, {}, stop)

    assert slept
