import asyncio
from contextlib import asynccontextmanager
from uuid import UUID

import asyncpg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Windows subprocess support (LibreOffice rendering) needs
# WindowsProactorEventLoopPolicy set *before* uvicorn creates its event
# loop -- too late to do here at import time. See run_dev.py.
from app.health import get_health
from app.jobs import create_pool, run_worker
from app.models.schemas import HealthStatus
from app.pipeline import extract_problem_statement, run_pipeline
from app.pipeline.orchestrator import run_stage1_preliminary, run_stage2_deep_analysis
from app.rendering.slide_renderer import render_submission_slides
from app.routers import (
    calibration,
    evaluation,
    problem_statements,
    rankings,
    rubric,
    submissions,
    teams,
)
from app.rubric.builder import build_rubric_for_submission


async def _run_build_rubric(conn: asyncpg.Connection, submission_id: UUID) -> None:
    """Adapts build_rubric_for_submission's return value to the job
    handler's None-returning signature -- the worker doesn't need the
    RubricForSubmission, only that the job completed."""
    await build_rubric_for_submission(conn, submission_id)


JOB_HANDLERS = {
    "extract_problem_statement": extract_problem_statement,
    "run_pipeline": run_pipeline,
    "render_slides": render_submission_slides,
    "build_rubric": _run_build_rubric,
    "stage1_preliminary": run_stage1_preliminary,
    "stage2_deep_analysis": run_stage2_deep_analysis,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool()
    app.state.db_pool = pool
    stop = asyncio.Event()
    worker_task = asyncio.create_task(run_worker(pool, JOB_HANDLERS, stop)) if pool else None

    yield

    stop.set()
    if worker_task:
        await worker_task
    if pool:
        await pool.close()


app = FastAPI(title="HackEval API", version="0.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Allow local dev plus deployed Render (*.onrender.com) and Vercel
    # (*.vercel.app, including per-deploy preview subdomains) frontends.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|.*\.onrender\.com|.*\.vercel\.app)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import logging
    logging.getLogger("uvicorn.error").exception("Unhandled error on %s: %s", request.url, exc)
    origin = request.headers.get("origin", "*")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={
            "Access-Control-Allow-Origin": origin if origin else "*",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )


app.include_router(submissions.router)
app.include_router(teams.router)
app.include_router(evaluation.router)
app.include_router(rubric.router)
app.include_router(calibration.router)
app.include_router(rankings.router)
app.include_router(problem_statements.router)


@app.get("/health", response_model=HealthStatus)
async def health() -> HealthStatus:
    return await get_health()
