"""Phase 14: read-only aggregation for the /dashboard page. Every field
here is read straight from final_scores/section_totals/the Phase 10
reliability label (or, for a submission still mid-pipeline, its own
status/preliminary_score) -- nothing is recomputed. Sorting/filtering by
reliability label or flag type all happen client-side on this same
payload, since a hackathon-scale submission count doesn't need
server-side pagination.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

import asyncpg
from pydantic import BaseModel

from app.models.schemas import ReliabilityLabel, SubmissionStatus

DEFAULT_MAX_TOTAL = 40


class DashboardRow(BaseModel):
    submission_id: UUID
    team_name: str
    status: SubmissionStatus
    total: float | None
    max_total: float
    section_totals: dict[str, float]
    reliability_label: ReliabilityLabel | None
    flag_count: int
    flag_types: list[str]
    score_source: Literal["stage1", "stage2"] | None
    stage2_selected: bool = False


async def get_dashboard_rows(conn: asyncpg.Connection) -> list[DashboardRow]:
    rows = await conn.fetch(
        """
        select
            s.id as submission_id,
            t.name as team_name,
            s.status as status,
            s.reliability_label as reliability_label,
            s.preliminary_score as preliminary_score,
            f.computed_total as final_total,
            exists (
                select 1 from jobs j
                where j.submission_id = s.id
                  and j.job_type = 'stage2_deep_analysis'
                  and j.status in ('queued', 'running', 'done')
            ) as stage2_selected
        from submissions s
        join teams t on t.id = s.team_id
        left join final_scores f on f.submission_id = s.id
        order by coalesce(f.computed_total, s.preliminary_score) desc nulls last
        """
    )

    dashboard_rows: list[DashboardRow] = []
    for row in rows:
        submission_id: UUID = row["submission_id"]

        section_rows = await conn.fetch(
            "select section_key, computed_total from section_totals where submission_id = $1",
            submission_id,
        )
        section_totals = {r["section_key"]: r["computed_total"] for r in section_rows}

        flag_rows = await conn.fetch(
            "select flag_type from consistency_flags where submission_id = $1 and resolved = false",
            submission_id,
        )
        flag_types = sorted({r["flag_type"] for r in flag_rows})

        total: int | None
        score_source: Literal["stage1", "stage2"] | None
        if row["final_total"] is not None:
            total, score_source = row["final_total"], "stage2"
        elif row["preliminary_score"] is not None:
            total, score_source = row["preliminary_score"], "stage1"
        else:
            total, score_source = None, None

        dashboard_rows.append(
            DashboardRow(
                submission_id=submission_id,
                team_name=row["team_name"],
                status=row["status"],
                total=total,
                max_total=DEFAULT_MAX_TOTAL,
                section_totals=section_totals,
                reliability_label=row["reliability_label"],
                flag_count=len(flag_rows),
                flag_types=flag_types,
                score_source=score_source,
                stage2_selected=bool(row["stage2_selected"]),
            )
        )
    return dashboard_rows
