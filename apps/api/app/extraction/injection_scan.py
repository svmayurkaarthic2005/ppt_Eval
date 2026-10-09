"""Phase 13: runs right after extraction (Phase 2/3) over slide and
problem-statement text, flagging suspected prompt-injection attempts for
human awareness. This never touches criterion_scores, section_totals, or
final_scores -- it only ever inserts a consistency_flags row, so it can't
change a score up or down by itself, automatically or otherwise.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.llm.prompt_safety import detect_injection_patterns


async def scan_and_flag(
    conn: asyncpg.Connection, submission_id: UUID, source: str, text: str
) -> list[str]:
    matches = detect_injection_patterns(text)
    if matches:
        await conn.execute(
            """
            insert into consistency_flags (submission_id, flag_type, severity, description)
            values ($1, 'suspected_injection_attempt', 'low', $2)
            """,
            submission_id,
            f"{source}: matched suspected-injection pattern(s) {matches}. Advisory only -- "
            "not used to adjust any score automatically.",
        )
    return matches
