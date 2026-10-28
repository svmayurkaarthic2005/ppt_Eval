from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.comparison import _cache
from app.routers.submissions import reevaluate_submission


@pytest.fixture(autouse=True)
def clear_comparison_cache():
    _cache.clear()
    yield
    _cache.clear()


class MockPool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass


@pytest.mark.asyncio
async def test_reevaluate_submission_marks_stale_and_queues_job():
    sub_id = uuid4()
    mock_row = {
        "id": sub_id,
        "team_id": uuid4(),
        "problem_statement_id": uuid4(),
        "problem_statement_source": "typed",
        "uploaded_at": "2026-01-01T00:00:00Z",
        "pptx_storage_path": "path/test.pptx",
        "status": "scored",
        "created_at": "2026-01-01T00:00:00Z",
        "final_score": 35,
        "final_max_score": 40,
        "reliability_label": "HIGH",
        "is_stale": True,
        "evaluation_version": 2,
        "team_name": "Team Test",
        "problem_statement_title": "Test Title",
    }

    mock_conn = AsyncMock()
    mock_conn.fetchrow.side_effect = [mock_row, mock_row]

    mock_pool = MockPool(mock_conn)

    res = await reevaluate_submission(submission_id=sub_id, pool=mock_pool)

    assert res.id == sub_id
    assert res.is_stale is True
    # Verify update to is_stale=true was executed
    mock_conn.execute.assert_any_call("update submissions set is_stale = true where id = $1", sub_id)
    # Verify the job enqueue was attempted -- idempotency against an
    # already-active job is now a DB-level constraint (ON CONFLICT DO
    # NOTHING), not an application-level check, so this always fires.
    enqueue_calls = [
        c for c in mock_conn.execute.call_args_list if "insert into jobs" in c.args[0]
    ]
    assert len(enqueue_calls) == 1
    assert enqueue_calls[0].args[1] == sub_id
    assert "on conflict" in enqueue_calls[0].args[0]
    assert "do nothing" in enqueue_calls[0].args[0]


@pytest.mark.asyncio
async def test_reevaluate_submission_does_not_check_job_state_itself():
    """A second concurrent re-run request no longer needs (or gets) an
    application-level "is a job already active?" check -- that race was the
    actual bug (two concurrent requests could both pass the check before
    either inserted). The single INSERT ... ON CONFLICT DO NOTHING here
    relies entirely on the partial unique index to stay idempotent."""
    sub_id = uuid4()
    mock_row = {
        "id": sub_id,
        "team_id": uuid4(),
        "problem_statement_id": uuid4(),
        "problem_statement_source": "typed",
        "uploaded_at": "2026-01-01T00:00:00Z",
        "pptx_storage_path": "path/test.pptx",
        "status": "scored",
        "created_at": "2026-01-01T00:00:00Z",
        "final_score": 35,
        "final_max_score": 40,
        "reliability_label": "HIGH",
        "is_stale": True,
        "evaluation_version": 1,
        "team_name": "Team Test",
        "problem_statement_title": "Test Title",
    }

    mock_conn = AsyncMock()
    mock_conn.fetchrow.side_effect = [mock_row, mock_row]

    mock_pool = MockPool(mock_conn)

    res = await reevaluate_submission(submission_id=sub_id, pool=mock_pool)
    assert res.id == sub_id

    # No SELECT ... from jobs check-then-insert -- fetchval is unused.
    mock_conn.fetchval.assert_not_called()


@pytest.mark.asyncio
async def test_reevaluate_submission_not_found_raises_404():
    sub_id = uuid4()
    mock_conn = AsyncMock()
    mock_conn.fetchrow.return_value = None

    mock_pool = MockPool(mock_conn)

    with pytest.raises(HTTPException) as exc_info:
        await reevaluate_submission(submission_id=sub_id, pool=mock_pool)
    assert exc_info.value.status_code == 404
