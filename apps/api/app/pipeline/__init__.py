"""Job handlers registered with the worker in app.jobs.

extract_problem_statement is also called synchronously (same function) from
POST /submissions/{id}/extract-problem-statement for an on-demand re-run.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.extraction import MIN_USABLE_WORDS, extract_text, is_usable, word_count
from app.extraction.injection_scan import scan_and_flag
from app.extraction.structural import extract_submission_structure
from app.supabase_client import get_service_client

_EXTENSION_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
}


async def extract_problem_statement(conn: asyncpg.Connection, submission_id: UUID) -> None:
    row = await conn.fetchrow(
        "select problem_statement_source, problem_statement_storage_path, problem_statement_text "
        "from submissions where id = $1",
        submission_id,
    )
    if row is None:
        raise ValueError(f"submission {submission_id} not found")

    if row["problem_statement_source"] == "typed":
        # Already plain text -- nothing to download or parse. Still runs
        # through the same usability gate below, so typing three words
        # can't bypass the quality bar a blank/corrupt upload would hit.
        text = row["problem_statement_text"] or ""
    else:
        storage_path: str = row["problem_statement_storage_path"]
        extension = storage_path.rsplit(".", 1)[-1].lower()
        content_type = _EXTENSION_CONTENT_TYPES[extension]
        content = get_service_client().storage.from_("problem-statements").download(storage_path)
        text = extract_text(content, content_type)

    if not is_usable(text):
        await conn.execute(
            "update submissions set status = 'failed' where id = $1", submission_id
        )
        await conn.execute(
            """
            insert into consistency_flags (submission_id, flag_type, severity, description)
            values ($1, 'problem_statement_unreadable', 'high', $2)
            """,
            submission_id,
            f"Only {word_count(text)} usable words extracted (minimum {MIN_USABLE_WORDS}).",
        )
        return

    await conn.execute(
        """
        update submissions
        set problem_statement_text = $2, status = 'extracting'
        where id = $1
        """,
        submission_id,
        text,
    )
    # Phase 13: advisory only -- never changes status or any score.
    await scan_and_flag(conn, submission_id, "problem statement", text)
    await conn.execute(
        "insert into jobs (submission_id, job_type) values ($1, 'run_pipeline')",
        submission_id,
    )


async def run_pipeline(conn: asyncpg.Connection, submission_id: UUID) -> None:
    # Phase 3: walk the PPTX structurally (python-pptx) and classify each
    # slide's role. On success this leaves status='rendering' (Phase 4's
    # cue to pick up); on a corrupt/password-protected deck it leaves
    # status='failed' with a consistency_flags row -- either way it returns
    # normally rather than raising, so the job completes.
    # ponytail: Phase 4+ (rubric-build -> LLM-analyze -> validate -> score ->
    # calibrate -> rank) isn't built yet.
    await extract_submission_structure(conn, submission_id)
