"""Postgres-backed job queue: `SELECT ... FOR UPDATE SKIP LOCKED` polling
against the `jobs` table (supabase/migrations/20260101000300_jobs_table.sql).

A row here is durable -- if the worker process dies mid-job, the row is left
'running' and the stale-job sweep below requeues it on the next poll, so a
submission is never silently dropped the way an in-memory queue would drop
it on a server restart.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable, Mapping
from uuid import UUID

import asyncpg

from app.config import get_settings

logger = logging.getLogger("hackeval.jobs")

POLL_INTERVAL_SECONDS = 2
STALE_AFTER_SECONDS = 300

JobHandler = Callable[[asyncpg.Connection, UUID], Awaitable[None]]
JobHandlers = dict[str, JobHandler]


async def _register_jsonb_codec(conn: asyncpg.Connection) -> None:
    # Without this, every jsonb column comes back as a raw JSON string
    # instead of a dict/list, and every write needs an explicit
    # json.dumps(...)::jsonb -- registering it once here means the rest of
    # the codebase can just read/write native Python values.
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


POOL_CONNECT_RETRIES = 3
POOL_CONNECT_TIMEOUT_SECONDS = 30


def _resolve_supabase_pooler_url(url: str) -> str | None:
    import re
    m = re.match(r"^postgresql://([^:]+):([^@]+)@db\.([a-zA-Z0-9]+)\.supabase\.co(?::\d+)?/(.*)$", url)
    if m:
        user, password, ref, db = m.groups()
        pooler_user = f"postgres.{ref}" if user == "postgres" else user
        return f"postgresql://{pooler_user}:{password}@aws-0-ap-northeast-1.pooler.supabase.com:5432/{db}"
    return None


async def create_pool() -> asyncpg.Pool | None:
    database_url = get_settings().database_url
    if not database_url:
        logger.warning("DATABASE_URL not set; job queue worker disabled")
        return None

    urls_to_try = [database_url]
    pooler_fallback = _resolve_supabase_pooler_url(database_url)
    if pooler_fallback and pooler_fallback != database_url:
        urls_to_try.append(pooler_fallback)

    last_error: Exception | None = None
    for current_url in urls_to_try:
        for attempt in range(1, POOL_CONNECT_RETRIES + 1):
            try:
                return await asyncpg.create_pool(
                    current_url,
                    min_size=1,
                    max_size=5,
                    init=_register_jsonb_codec,
                    timeout=POOL_CONNECT_TIMEOUT_SECONDS,
                )
            except (TimeoutError, OSError) as exc:
                last_error = exc
                logger.warning(
                    "DB pool connect attempt %d/%d failed for %s: %s",
                    attempt,
                    POOL_CONNECT_RETRIES,
                    current_url.split("@")[-1],
                    exc,
                )
    raise RuntimeError("Could not connect to DATABASE_URL after retries") from last_error


async def enqueue_job(conn: asyncpg.Connection, submission_id: UUID, job_type: str) -> None:
    await conn.execute(
        "insert into jobs (submission_id, job_type) values ($1, $2)",
        submission_id,
        job_type,
    )


async def _requeue_stale_jobs(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        update jobs set status = 'queued'
        where status = 'running' and updated_at < now() - make_interval(secs => $1)
        """,
        STALE_AFTER_SECONDS,
    )


async def _claim_next_job(conn: asyncpg.Connection) -> asyncpg.Record | None:
    return await conn.fetchrow(
        """
        update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
        where id = (
            select id from jobs
            where status = 'queued' and run_after <= now()
            order by run_after
            for update skip locked
            limit 1
        )
        returning id, submission_id, job_type
        """
    )


async def run_worker(
    pool: asyncpg.Pool, handlers: Mapping[str, JobHandler], stop: asyncio.Event
) -> None:
    while not stop.is_set():
        async with pool.acquire() as conn:
            await _requeue_stale_jobs(conn)
            job = await _claim_next_job(conn)

        if job is None:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            continue

        handler = handlers.get(job["job_type"])
        async with pool.acquire() as conn:
            try:
                if handler is None:
                    raise ValueError(f"no handler registered for job_type={job['job_type']!r}")
                await handler(conn, job["submission_id"])
                await conn.execute("update jobs set status = 'done' where id = $1", job["id"])
            except Exception as exc:  # isolate one bad job from the worker loop
                logger.exception("job %s (%s) failed", job["id"], job["job_type"])
                await conn.execute(
                    "update jobs set status = 'failed', last_error = $2 where id = $1",
                    job["id"],
                    str(exc),
                )
                # A failed job is never retried (see _requeue_stale_jobs --
                # only 'running' jobs past STALE_AFTER_SECONDS get requeued,
                # not 'failed' ones), so without this a submission can be
                # left silently stuck mid-pipeline forever: 'analyzing' with
                # no scores and no visible error, polled by the frontend
                # indefinitely. A flag at least makes the failure visible to
                # whoever looks at the submission next.
                await conn.execute(
                    """
                    insert into consistency_flags (submission_id, flag_type, severity, description)
                    values ($1, 'pipeline_job_failed', 'high', $2)
                    """,
                    job["submission_id"],
                    f"The '{job['job_type']}' job failed: {exc}. Re-run the relevant action "
                    "(e.g. Re-evaluate) once the underlying issue is fixed.",
                )
