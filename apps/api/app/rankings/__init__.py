"""Phase 16: GET /rankings/overall and GET /rankings/by-problem-statement.
Read-only, same row shape as Phase 14's dashboard, restricted to fully
`scored` submissions. Overall rank and within-group rank are each their own
`ROW_NUMBER() OVER (...)` query -- never derived by filtering the other --
so a group of 3 and the full field of 40 are both correctly numbered from 1,
independently of each other.

An admin can pin a submission's rank via PATCH /submissions/{id}/rank
(submissions.manual_rank). Pinned submissions sort first, ordered by their
own pin number ascending; everyone else sorts by computed_total as before.
Both ranking queries order by `manual_rank nulls last` ahead of the score,
so a pin is honored identically in the overall list and within whichever
problem-statement group that submission belongs to.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
from pydantic import BaseModel

from app.dashboard import DEFAULT_MAX_TOTAL
from app.models.schemas import ReliabilityLabel


class RankingRow(BaseModel):
    rank: int
    submission_id: UUID
    team_id: UUID
    team_name: str
    total: float
    max_total: float
    section_totals: dict[str, float]
    reliability_label: ReliabilityLabel | None
    flag_count: int
    flag_types: list[str]
    manual_rank: int | None


class ProblemStatementGroup(BaseModel):
    problem_statement_id: UUID
    title: str
    submission_count: int
    submissions: list[RankingRow]


def _attach_section_totals_and_flags(
    base_rows: list[asyncpg.Record],
    section_total_rows: list[asyncpg.Record],
    flag_rows: list[asyncpg.Record],
) -> list[RankingRow]:
    section_totals_by_submission: dict[UUID, dict[str, float]] = {}
    for row in section_total_rows:
        section_totals_by_submission.setdefault(row["submission_id"], {})[
            row["section_key"]
        ] = float(row["computed_total"])

    flag_count_by_submission: dict[UUID, int] = {}
    flag_types_by_submission: dict[UUID, set[str]] = {}
    for row in flag_rows:
        sid = row["submission_id"]
        flag_count_by_submission[sid] = flag_count_by_submission.get(sid, 0) + 1
        flag_types_by_submission.setdefault(sid, set()).add(row["flag_type"])

    return [
        RankingRow(
            rank=row["rank"],
            submission_id=row["submission_id"],
            team_id=row["team_id"],
            team_name=row["team_name"],
            total=float(row["total"]),
            max_total=float(DEFAULT_MAX_TOTAL),
            section_totals=section_totals_by_submission.get(row["submission_id"], {}),
            reliability_label=row["reliability_label"],
            flag_count=flag_count_by_submission.get(row["submission_id"], 0),
            flag_types=sorted(flag_types_by_submission.get(row["submission_id"], set())),
            manual_rank=row["manual_rank"],
        )
        for row in base_rows
    ]


async def _fetch_section_totals_and_flags(
    conn: asyncpg.Connection, submission_ids: list[UUID]
) -> tuple[list[asyncpg.Record], list[asyncpg.Record]]:
    section_total_rows = await conn.fetch(
        "select submission_id, section_key, computed_total from section_totals "
        "where submission_id = any($1::uuid[])",
        submission_ids,
    )
    flag_rows = await conn.fetch(
        "select submission_id, flag_type from consistency_flags "
        "where submission_id = any($1::uuid[]) and resolved = false",
        submission_ids,
    )
    return section_total_rows, flag_rows


async def get_overall_ranking(conn: asyncpg.Connection) -> list[RankingRow]:
    base_rows = await conn.fetch(
        """
        select
            s.id as submission_id,
            s.team_id as team_id,
            t.name as team_name,
            f.computed_total as total,
            s.reliability_label as reliability_label,
            s.manual_rank as manual_rank,
            row_number() over (
                order by s.manual_rank asc nulls last, f.computed_total desc
            ) as rank
        from submissions s
        join teams t on t.id = s.team_id
        join final_scores f on f.submission_id = s.id
        where s.status = 'scored'
        order by rank
        """
    )
    submission_ids = [row["submission_id"] for row in base_rows]
    section_total_rows, flag_rows = await _fetch_section_totals_and_flags(conn, submission_ids)
    return _attach_section_totals_and_flags(base_rows, section_total_rows, flag_rows)


async def get_ranking_by_problem_statement(
    conn: asyncpg.Connection,
) -> list[ProblemStatementGroup]:
    base_rows = await conn.fetch(
        """
        select
            s.id as submission_id,
            s.team_id as team_id,
            s.problem_statement_id as problem_statement_id,
            ps.title as problem_statement_title,
            t.name as team_name,
            f.computed_total as total,
            s.reliability_label as reliability_label,
            s.manual_rank as manual_rank,
            row_number() over (
                partition by s.problem_statement_id
                order by s.manual_rank asc nulls last, f.computed_total desc
            ) as rank
        from submissions s
        join teams t on t.id = s.team_id
        join final_scores f on f.submission_id = s.id
        join problem_statements ps on ps.id = s.problem_statement_id
        where s.status = 'scored'
        order by s.problem_statement_id, rank
        """
    )
    submission_ids = [row["submission_id"] for row in base_rows]
    section_total_rows, flag_rows = await _fetch_section_totals_and_flags(conn, submission_ids)
    ranking_rows = _attach_section_totals_and_flags(base_rows, section_total_rows, flag_rows)
    ranking_row_by_submission = {row.submission_id: row for row in ranking_rows}

    groups: dict[UUID, ProblemStatementGroup] = {}
    for row in base_rows:
        ps_id = row["problem_statement_id"]
        group = groups.get(ps_id)
        if group is None:
            group = ProblemStatementGroup(
                problem_statement_id=ps_id,
                title=row["problem_statement_title"],
                submission_count=0,
                submissions=[],
            )
            groups[ps_id] = group
        group.submissions.append(ranking_row_by_submission[row["submission_id"]])
        group.submission_count += 1

    return list(groups.values())
