from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.calibration.service import (
    CalibrationRunSizeError,
    CalibrationSubmissionInput,
    HumanSectionScore,
    SectionMismatchError,
    record_calibration_run,
)


def _conn_with_ai_rows(ai_rows: list[dict]) -> AsyncMock:
    conn = AsyncMock()
    conn.fetch.return_value = ai_rows
    conn.fetchrow.return_value = {"id": uuid4()}
    return conn


@pytest.mark.asyncio
async def test_record_calibration_run_rejects_too_few_submissions():
    with pytest.raises(CalibrationRunSizeError):
        await record_calibration_run(AsyncMock(), submissions=[])


@pytest.mark.asyncio
async def test_record_calibration_run_rejects_too_many_submissions():
    submissions = [
        CalibrationSubmissionInput(submission_id=uuid4(), human_section_scores=[])
        for _ in range(101)
    ]
    with pytest.raises(CalibrationRunSizeError):
        await record_calibration_run(AsyncMock(), submissions=submissions)


@pytest.mark.asyncio
async def test_resolve_pair_rejects_submission_with_no_ai_scores_yet():
    conn = _conn_with_ai_rows([])
    submission = CalibrationSubmissionInput(
        submission_id=uuid4(),
        human_section_scores=[HumanSectionScore(section_key="problem_understanding", human_score=8.0)],
    )
    with pytest.raises(SectionMismatchError, match="isn't fully scored"):
        await record_calibration_run(conn, submissions=[submission])


@pytest.mark.asyncio
async def test_resolve_pair_rejects_mismatched_sections():
    conn = _conn_with_ai_rows([{"section_key": "problem_understanding", "computed_total": 8.0}])
    submission = CalibrationSubmissionInput(
        submission_id=uuid4(),
        human_section_scores=[HumanSectionScore(section_key="execution_plan_timeline", human_score=7.0)],
    )
    with pytest.raises(SectionMismatchError, match="don't match"):
        await record_calibration_run(conn, submissions=[submission])


@pytest.mark.asyncio
async def test_record_calibration_run_computes_summary_from_section_scores():
    conn = _conn_with_ai_rows(
        [
            {"section_key": "problem_understanding", "computed_total": 8.0},
            {"section_key": "execution_plan_timeline", "computed_total": 6.0},
        ]
    )
    submissions = [
        CalibrationSubmissionInput(
            submission_id=uuid4(),
            human_section_scores=[
                HumanSectionScore(section_key="problem_understanding", human_score=9.0),
                HumanSectionScore(section_key="execution_plan_timeline", human_score=6.0),
            ],
        ),
        CalibrationSubmissionInput(
            submission_id=uuid4(),
            human_section_scores=[
                HumanSectionScore(section_key="problem_understanding", human_score=8.0),
                HumanSectionScore(section_key="execution_plan_timeline", human_score=6.0),
            ],
        ),
    ]

    summary = await record_calibration_run(conn, submissions=submissions, notes="pilot run")

    assert summary.sample_size == 2
    # submission 1: ai_total=14, human_total=15 -> diff 1; submission 2: ai_total=14, human_total=14 -> diff 0
    assert summary.mean_absolute_error == pytest.approx(0.5)
    insert_run_call = conn.fetchrow.call_args
    assert insert_run_call.args[1] == 2  # sample_size persisted
    assert conn.execute.await_count == 2  # one calibration_pairs row per submission
