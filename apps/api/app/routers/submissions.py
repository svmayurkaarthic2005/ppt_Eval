from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth import get_current_admin_id
from app.comparison import (
    ComparisonResponse,
    RubricVersionMismatchError,
    SubmissionNotFoundError,
    build_comparison,
    invalidate_for_submission,
    parse_and_dedupe_ids,
    validate_count,
)
from app.dashboard import DashboardRow, get_dashboard_rows
from app.evidence.traceability import (
    SubmissionAuditOut,
    SubmissionEvidenceOut,
    SubmissionSlidesOut,
    get_submission_audit,
    get_submission_evidence,
    get_submission_slides,
)
from app.extraction import (
    MAX_DECK_BYTES,
    MAX_PROBLEM_STATEMENT_BYTES,
    extract_text,
    is_usable,
)
from app.models.schemas import Submission, SubmissionContext
from app.pipeline import extract_problem_statement
from app.pipeline.orchestrator import (
    RankedSubmission,
    enqueue_stage2_deep_analysis,
    get_ranked_submissions,
    run_stage2_selection,
)
from app.storage_cleanup import cleanup_submission_storage
from app.supabase_client import get_service_client

router = APIRouter(prefix="/submissions", tags=["submissions"])

ALLOWED_PROBLEM_STATEMENT_EXTENSIONS = {"pdf", "docx", "txt"}
_EXTENSION_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
}
_PPTX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)

# Deck upload: both .pptx and .pdf are accepted.
ALLOWED_DECK_EXTENSIONS = {"pptx", "pdf"}
_DECK_CONTENT_TYPES = {
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf": "application/pdf",
}


def _extension_of(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def _derive_problem_statement_title(text: str) -> str:
    """Caps the title at ~80 chars for display, same budget as the
    problem_statements migration's backfill, but cuts at a word boundary
    and marks the cut with an ellipsis instead of lopping off mid-word."""
    stripped = text.strip()
    if not stripped:
        return "Untitled problem statement"
    if len(stripped) <= 80:
        return stripped
    truncated = stripped[:80].rsplit(" ", 1)[0].rstrip(",;:-—") or stripped[:80]
    return f"{truncated}…"


def get_db_pool(request: Request) -> asyncpg.Pool:
    pool = request.app.state.db_pool
    if pool is None:
        raise HTTPException(status_code=503, detail="Job queue database is not configured")
    return pool


async def _get_or_create_team(conn: asyncpg.Connection, owner_user_id: str, name: str) -> UUID:
    """Teams used to each have their own login, so matching on owner_user_id
    was enough to find "this team's" row. Now a single admin account uploads
    on behalf of every team, so owner_user_id is identical on every call --
    matching on it alone collapsed every submission onto whichever team was
    created first. Match on the (trimmed, case-insensitive) name instead:
    the same name reuses that team, a new name creates a new one -- the
    "duplicate team name" case is exactly the reuse case."""
    existing = await conn.fetchrow(
        "select id from teams where lower(trim(name)) = lower(trim($1))", name
    )
    if existing is not None:
        return existing["id"]

    created = await conn.fetchrow(
        "insert into teams (name, owner_user_id) values ($1, $2) returning id",
        name.strip(),
        owner_user_id,
    )
    return created["id"]


@router.get("/", response_model=list[Submission])
async def list_submissions() -> list[Submission]:
    """Not yet implemented: will list submissions from Supabase."""
    return []


@router.post("/preview-problem-statement")
async def preview_problem_statement(
    problem_statement: UploadFile = File(...),
) -> dict[str, object]:
    """Stateless preview for Step 1 of the upload form: extracts and returns
    text without creating a submission (the pptx isn't chosen yet)."""
    extension = _extension_of(problem_statement.filename)
    if extension not in ALLOWED_PROBLEM_STATEMENT_EXTENSIONS:
        raise HTTPException(
            status_code=422, detail="Problem statement must be .pdf, .docx, or .txt"
        )

    content = await problem_statement.read()
    if len(content) > MAX_PROBLEM_STATEMENT_BYTES:
        raise HTTPException(status_code=413, detail="Problem statement exceeds 10MB")

    text = extract_text(content, _EXTENSION_CONTENT_TYPES[extension])
    return {"text": text, "usable": is_usable(text)}


@router.post("/", response_model=Submission, status_code=201)
async def create_submission(
    team_name: str = Form(...),
    problem_statement_file: UploadFile | None = File(None),
    problem_statement_text: str | None = Form(None),
    problem_statement_id: str | None = Form(None),
    pptx: UploadFile = File(...),
    owner_user_id: str = Depends(get_current_admin_id),
    pool: asyncpg.Pool = Depends(get_db_pool),
) -> Submission:
    existing_ps_id: UUID | None = None
    if problem_statement_id:
        try:
            existing_ps_id = UUID(problem_statement_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Malformed problem_statement_id") from exc

    has_file = problem_statement_file is not None and bool(problem_statement_file.filename)
    typed_text = (problem_statement_text or "").strip()
    has_text = bool(typed_text)

    if existing_ps_id is not None:
        # Reusing an existing problem statement -- its full text was
        # captured once, when it was first added, and is never re-collected
        # from a team that's just reusing it.
        has_file = False
        has_text = False
        typed_text = ""
    elif has_file and has_text:
        raise HTTPException(
            status_code=422,
            detail="Provide either a problem statement file or typed text, not both",
        )
    elif not has_file and not has_text:
        raise HTTPException(
            status_code=422, detail="A problem statement (file or typed text) is required"
        )

    ps_extension = ""
    ps_content = b""
    if has_file:
        assert problem_statement_file is not None
        ps_extension = _extension_of(problem_statement_file.filename)
        if ps_extension not in ALLOWED_PROBLEM_STATEMENT_EXTENSIONS:
            raise HTTPException(
                status_code=422, detail="Problem statement must be .pdf, .docx, or .txt"
            )
        ps_content = await problem_statement_file.read()
        if len(ps_content) > MAX_PROBLEM_STATEMENT_BYTES:
            raise HTTPException(status_code=413, detail="Problem statement exceeds 10MB")

    deck_extension = _extension_of(pptx.filename)
    if deck_extension not in ALLOWED_DECK_EXTENSIONS:
        raise HTTPException(status_code=422, detail="Slide deck must be .pptx or .pdf")

    pptx_content = await pptx.read()
    if len(pptx_content) > MAX_DECK_BYTES:
        raise HTTPException(status_code=413, detail="Slide deck exceeds 50MB")

    async with pool.acquire() as conn, conn.transaction():
        team_id = await _get_or_create_team(conn, owner_user_id, team_name)

        # The grouping key for ranking is a deliberate, explicit choice made
        # at upload time -- never fuzzy-matched. If the team picked an
        # existing problem statement from the dropdown, use it as-is;
        # otherwise ("this isn't listed") create a new custom one now, with
        # its title derived from whichever problem statement content the
        # team already provided.
        if existing_ps_id is not None:
            found = await conn.fetchrow(
                "select id, reference_text from problem_statements where id = $1", existing_ps_id
            )
            if found is None:
                raise HTTPException(status_code=422, detail="problem_statement_id not found")
            ps_id = existing_ps_id
            # The team picked this from the dropdown rather than typing/
            # uploading anything this time -- reuse the text captured when
            # it was first added, so grounding (Phase 5) works exactly as
            # it would have if they'd retyped it.
            typed_text = found["reference_text"]
            has_text = True
        else:
            ps_reference_text = (
                typed_text
                if has_text
                else extract_text(ps_content, _EXTENSION_CONTENT_TYPES[ps_extension])
            )
            ps_id = (
                await conn.fetchrow(
                    """
                    insert into problem_statements (title, reference_text, is_custom, created_by_team_id)
                    values ($1, $2, true, $3)
                    returning id
                    """,
                    _derive_problem_statement_title(ps_reference_text),
                    ps_reference_text,
                    team_id,
                )
            )["id"]

        # pptx_storage_path is NOT NULL and embeds the submission id, so
        # insert a placeholder, then fill in the real path once the id is
        # known. problem_statement_storage_path stays NULL for typed text.
        submission_id: UUID
        if has_file:
            submission_id = (
                await conn.fetchrow(
                    """
                    insert into submissions
                        (team_id, problem_statement_id, pptx_storage_path, problem_statement_source,
                         problem_statement_storage_path, deck_file_type, status)
                    values ($1, $2, 'pending', 'uploaded', 'pending', $3, 'uploaded')
                    returning id
                    """,
                    team_id,
                    ps_id,
                    deck_extension,
                )
            )["id"]
        else:
            submission_id = (
                await conn.fetchrow(
                    """
                    insert into submissions
                        (team_id, problem_statement_id, pptx_storage_path, problem_statement_source,
                         problem_statement_text, deck_file_type, status)
                    values ($1, $2, 'pending', 'typed', $3, $4, 'uploaded')
                    returning id
                    """,
                    team_id,
                    ps_id,
                    typed_text,
                    deck_extension,
                )
            )["id"]

        pptx_path = f"{submission_id}/original.{deck_extension}"
        deck_content_type = _DECK_CONTENT_TYPES.get(deck_extension, _PPTX_CONTENT_TYPE)
        storage = get_service_client().storage
        storage.from_("pptx-uploads").upload(
            pptx_path, pptx_content, {"content-type": deck_content_type}
        )

        if has_file:
            ps_path = f"{submission_id}/original.{ps_extension}"
            storage.from_("problem-statements").upload(
                ps_path, ps_content, {"content-type": _EXTENSION_CONTENT_TYPES[ps_extension]}
            )
            await conn.execute(
                """
                update submissions
                set pptx_storage_path = $2, problem_statement_storage_path = $3
                where id = $1
                """,
                submission_id,
                pptx_path,
                ps_path,
            )
        else:
            await conn.execute(
                "update submissions set pptx_storage_path = $2 where id = $1",
                submission_id,
                pptx_path,
            )

        # Extraction is fast and deterministic (no LLM call), so it runs
        # synchronously here rather than waiting a poll interval for the
        # worker to pick it up -- it's the exact same code path as
        # POST /submissions/{id}/extract-problem-statement, so a later
        # re-run stays consistent. For typed text this just validates word
        # count (no download/parsing needed); for an uploaded file it
        # downloads and parses as before.
        await extract_problem_statement(conn, submission_id)
        row = await conn.fetchrow("select * from submissions where id = $1", submission_id)

    return Submission(**dict(row))


@router.post("/stage2-selection")
async def trigger_stage2_selection(
    top_n: int = 10,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> dict[str, list[UUID]]:
    """Admin-triggered: looks across every submission that's finished
    Stage 1, selects the top-N plus anything flagged/manually requested,
    and enqueues their Stage 2 jobs. Registered before /{submission_id} so
    "stage2-selection" is never mistaken for a submission id."""
    async with pool.acquire() as conn:
        selected = await run_stage2_selection(conn, top_n=top_n)
    return {"selected_submission_ids": selected}


@router.get("/stats")
async def get_submission_stats(pool: asyncpg.Pool = Depends(get_db_pool)) -> dict[str, int | bool]:
    """Aggregate counts for the public leaderboard's stat cards -- no
    per-team detail, so (unlike /dashboard) this stays public. Registered
    before /{submission_id} so "stats" is never mistaken for a submission id."""
    async with pool.acquire() as conn:
        total = await conn.fetchval("select count(*) from submissions")
        scored = await conn.fetchval("select count(*) from submissions where status = 'scored'")
        in_progress = await conn.fetchval(
            "select exists(select 1 from submissions where status not in ('scored', 'failed'))"
        )
    return {"total": total, "scored": scored, "in_progress": in_progress}


@router.get("/ranking", response_model=list[RankedSubmission])
async def get_ranking(
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> list[RankedSubmission]:
    """Stage 3: one ranked list combining Stage-1-only and fully Stage-2-scored
    submissions, each tagged with which stage produced its score. Registered
    before /{submission_id} so "ranking" is never mistaken for a submission id."""
    async with pool.acquire() as conn:
        return await get_ranked_submissions(conn)


@router.get("/dashboard", response_model=list[DashboardRow])
async def get_dashboard(
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> list[DashboardRow]:
    """Phase 14: the /dashboard page's full data set in one call -- sorting
    and filtering happen client-side. Registered before /{submission_id} so
    "dashboard" is never mistaken for a submission id."""
    async with pool.acquire() as conn:
        return await get_dashboard_rows(conn)


@router.get("/compare", response_model=None)
async def compare_submissions(
    ids: str = Query(..., description="Comma-separated submission ids, 2-6 distinct"),
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> ComparisonResponse | JSONResponse:
    """Phase 15. Registered before /{submission_id} so "compare" is never
    mistaken for a submission id."""
    try:
        parsed_ids = parse_and_dedupe_ids(ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Malformed submission id: {exc}") from exc

    # Count is validated before any query runs, per spec.
    try:
        validate_count(parsed_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    async with pool.acquire() as conn:
        try:
            return await build_comparison(conn, parsed_ids)
        except SubmissionNotFoundError as exc:
            raise HTTPException(
                status_code=404,
                detail=f"Submission(s) not found: {', '.join(str(i) for i in exc.missing_ids)}",
            ) from exc
        except RubricVersionMismatchError as exc:
            return JSONResponse(
                status_code=422,
                content={
                    "error": "rubric_version_mismatch",
                    "details": [
                        {
                            "submission_id": str(d["submission_id"]),
                            "rubric_template_id": str(d["rubric_template_id"]),
                        }
                        for d in exc.details
                    ],
                },
            )


@router.get("/{submission_id}", response_model=Submission)
async def get_submission(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> Submission:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            select s.*, t.name as team_name, ps.title as problem_statement_title
            from submissions s
            left join teams t on t.id = s.team_id
            left join problem_statements ps on ps.id = s.problem_statement_id
            where s.id = $1
            """,
            submission_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return Submission(**dict(row))


@router.post("/{submission_id}/extract-problem-statement", response_model=Submission)
async def rerun_extract_problem_statement(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> Submission:
    async with pool.acquire() as conn, conn.transaction():
        await extract_problem_statement(conn, submission_id)
        row = await conn.fetchrow("select * from submissions where id = $1", submission_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return Submission(**dict(row))


@router.get("/{submission_id}/evidence", response_model=SubmissionEvidenceOut)
async def get_evidence(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> SubmissionEvidenceOut:
    async with pool.acquire() as conn:
        submission = await conn.fetchrow("select id from submissions where id = $1", submission_id)
        if submission is None:
            raise HTTPException(status_code=404, detail="Submission not found")
        return await get_submission_evidence(conn, submission_id)


@router.get("/{submission_id}/slides", response_model=SubmissionSlidesOut)
async def get_slides(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> SubmissionSlidesOut:
    """Lets a viewer see the original deck: a signed download link for the
    .pptx plus a signed image per rendered slide."""
    async with pool.acquire() as conn:
        submission = await conn.fetchrow("select id from submissions where id = $1", submission_id)
        if submission is None:
            raise HTTPException(status_code=404, detail="Submission not found")
        return await get_submission_slides(conn, submission_id)


@router.get("/{submission_id}/audit", response_model=SubmissionAuditOut)
async def get_audit(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> SubmissionAuditOut:
    async with pool.acquire() as conn:
        submission = await conn.fetchrow("select id from submissions where id = $1", submission_id)
        if submission is None:
            raise HTTPException(status_code=404, detail="Submission not found")
        return await get_submission_audit(conn, submission_id)


@router.post("/{submission_id}/request-review", response_model=Submission)
async def request_manual_review(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> Submission:
    """An admin manually marks a submission for Stage 2 (full) analysis,
    regardless of its Stage 1 preliminary score."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            update submissions set manual_review_requested = true
            where id = $1
            returning *
            """,
            submission_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return Submission(**dict(row))


class SetManualRankBody(BaseModel):
    manual_rank: int | None


@router.patch("/{submission_id}/rank", response_model=Submission)
async def set_manual_rank(
    submission_id: UUID,
    body: SetManualRankBody,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> Submission:
    """Admin pin: overrides this submission's computed rank. Pinned
    submissions sort first (by their own pin number, ascending) ahead of
    everyone else, in both /rankings/overall and its problem-statement
    group -- see app/rankings. Pass manual_rank: null to unpin."""
    if body.manual_rank is not None and body.manual_rank < 1:
        raise HTTPException(status_code=422, detail="manual_rank must be 1 or greater")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "update submissions set manual_rank = $2 where id = $1 returning *",
            submission_id,
            body.manual_rank,
        )
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    return Submission(**dict(row))


@router.post("/{submission_id}/benchmark", response_model=Submission)
async def generate_benchmark_for_submission(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> Submission:
    """Explicitly triggers or refreshes the academic & literature benchmark
    (IEEE, Google Scholar / CrossRef, arXiv) for a submission."""
    async with pool.acquire() as conn:
        sub = await conn.fetchrow(
            """
            select s.*, t.name as team_name, ps.title as ps_title, ps.reference_text as ps_reference_text
            from submissions s
            left join teams t on t.id = s.team_id
            left join problem_statements ps on ps.id = s.problem_statement_id
            where s.id = $1
            """,
            submission_id,
        )
        if sub is None:
            raise HTTPException(status_code=404, detail="Submission not found")

        slides = await conn.fetch(
            "select slide_number, raw_text from slides where submission_id = $1 order by slide_number",
            submission_id,
        )
        from app.research.scholarly import fetch_academic_literature, generate_academic_benchmark
        deck_text = "\n".join(f"[Slide {s['slide_number']}] {s['raw_text'] or ''}" for s in slides)
        context = SubmissionContext(**(sub["submission_context"] or {
            "problem_domain": sub["ps_title"] or "Environmental and Chemical Engineering",
            "target_beneficiary": "Environmental and Chemical Engineering Practitioners",
            "required_deliverables": [],
            "track_constraints": [],
            "is_generic": False,
        }))
        papers = await fetch_academic_literature(
            domain=context.problem_domain,
            problem_text=sub["ps_reference_text"] or sub["ps_title"] or "",
            deck_sample=deck_text[:1000],
        )
        bench = await generate_academic_benchmark(
            context=context,
            problem_statement_text=sub["ps_reference_text"] or sub["ps_title"] or "",
            deck_text=deck_text,
            papers=papers,
        )
        benchmark_dict = bench.model_dump()
        is_already_scored = sub["status"] == "scored"
        if is_already_scored:
            await conn.execute(
                "update submissions set academic_benchmark = $2, is_stale = true where id = $1",
                submission_id,
                benchmark_dict,
            )
            invalidate_for_submission(submission_id)
            await enqueue_stage2_deep_analysis(conn, submission_id)
        else:
            await conn.execute(
                "update submissions set academic_benchmark = $2 where id = $1",
                submission_id,
                benchmark_dict,
            )

        row = await conn.fetchrow(
            """
            select s.*, t.name as team_name, ps.title as problem_statement_title
            from submissions s
            left join teams t on t.id = s.team_id
            left join problem_statements ps on ps.id = s.problem_statement_id
            where s.id = $1
            """,
            submission_id,
        )
        return Submission(**dict(row))


@router.post("/{submission_id}/cost-analysis", response_model=Submission)
async def generate_cost_analysis_for_submission(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> Submission:
    """Explicitly triggers or refreshes the required components & cost affordability analysis
    (Bill of Materials, missing components calculation, market benchmark rates) for a submission."""
    async with pool.acquire() as conn:
        sub = await conn.fetchrow(
            """
            select s.*, t.name as team_name, ps.title as ps_title, ps.reference_text as ps_reference_text
            from submissions s
            left join teams t on t.id = s.team_id
            left join problem_statements ps on ps.id = s.problem_statement_id
            where s.id = $1
            """,
            submission_id,
        )
        if sub is None:
            raise HTTPException(status_code=404, detail="Submission not found")

        slides = await conn.fetch(
            "select slide_number, raw_text, tables from slides where submission_id = $1 order by slide_number",
            submission_id,
        )
        from app.research.cost_analyzer import generate_cost_analysis
        deck_text = "\n".join(f"[Slide {s['slide_number']}] {s['raw_text'] or ''}" for s in slides)
        slide_tables = [t for s in slides for t in (s["tables"] or []) if t]
        context = SubmissionContext(**(sub["submission_context"] or {
            "problem_domain": sub["ps_title"] or "Environmental and Chemical Engineering",
            "target_beneficiary": "Environmental and Chemical Engineering Practitioners",
            "required_deliverables": [],
            "track_constraints": [],
            "is_generic": False,
        }))
        cost_res = await generate_cost_analysis(
            context=context,
            problem_statement_text=sub["ps_reference_text"] or sub["ps_title"] or "",
            deck_text=deck_text,
            slide_tables=slide_tables,
        )
        cost_dict = cost_res.model_dump()
        is_already_scored = sub["status"] == "scored"
        if is_already_scored:
            await conn.execute(
                "update submissions set cost_analysis = $2, is_stale = true where id = $1",
                submission_id,
                cost_dict,
            )
            invalidate_for_submission(submission_id)
            await enqueue_stage2_deep_analysis(conn, submission_id)
        else:
            await conn.execute(
                "update submissions set cost_analysis = $2 where id = $1",
                submission_id,
                cost_dict,
            )

        await conn.execute(
            "delete from consistency_flags where submission_id = $1 and flag_type = 'cost_omission'",
            submission_id,
        )
        if cost_res.missing_components_count >= 2:
            await conn.execute(
                """
                insert into consistency_flags (submission_id, flag_type, severity, description)
                values ($1, 'cost_omission', 'medium', $2)
                """,
                submission_id,
                f"Cost breakdown omitted {cost_res.missing_components_count} required components for the stated technical architecture.",
            )
        row = await conn.fetchrow(
            """
            select s.*, t.name as team_name, ps.title as problem_statement_title
            from submissions s
            left join teams t on t.id = s.team_id
            left join problem_statements ps on ps.id = s.problem_statement_id
            where s.id = $1
            """,
            submission_id,
        )
        return Submission(**dict(row))


@router.post("/{submission_id}/re-evaluate", response_model=Submission)
async def reevaluate_submission(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> Submission:
    """Explicitly triggers full re-evaluation for a submission.

    Pipeline: render_slides → build_rubric → stage1_preliminary →
    stage2_deep_analysis.  Re-rendering ensures fresh slide images are
    downloaded from storage before the LLM sees them -- skipping this step
    was the cause of 'vision disabled / no images' zero-scores when a
    previous submission had tripped the daily quota flag and `image_storage_paths`
    was stale or empty for the submission being re-evaluated.
    """
    async with pool.acquire() as conn:
        sub = await conn.fetchrow(
            """
            select s.*, t.name as team_name, ps.title as problem_statement_title
            from submissions s
            left join teams t on t.id = s.team_id
            left join problem_statements ps on ps.id = s.problem_statement_id
            where s.id = $1
            """,
            submission_id,
        )
        if sub is None:
            raise HTTPException(status_code=404, detail="Submission not found")

        # Reset status so the full pipeline runs: rendering → rubric-build →
        # stage1 → stage2. Clearing criterion_scores and consistency_flags lets
        # stage2 re-score all criteria fresh instead of inheriting stale flags or 0 scores.
        await conn.execute(
            "update submissions set is_stale = true, status = 'rendering', "
            "preliminary_score = null, preliminary_flagged = false, "
            "reliability_label = null, submission_context = null where id = $1",
            submission_id,
        )
        await conn.execute(
            "delete from consistency_flags where submission_id = $1", submission_id
        )
        await conn.execute(
            "delete from criterion_scores where submission_id = $1", submission_id
        )
        await conn.execute(
            "delete from final_scores where submission_id = $1", submission_id
        )
        # Cancel any pending/running jobs for this submission so we don't
        # race the new pipeline jobs against old ones.
        await conn.execute(
            "update jobs set status = 'failed', last_error = 'superseded by re-evaluate' "
            "where submission_id = $1 and status in ('queued', 'running')",
            submission_id,
        )
        # Re-queue from the top of the pipeline so rendering re-downloads
        # images -- this is the fix for stale/empty image_storage_paths.
        await conn.execute(
            "insert into jobs (submission_id, job_type) values ($1, 'render_slides')",
            submission_id,
        )
        invalidate_for_submission(submission_id)

        row = await conn.fetchrow(
            """
            select s.*, t.name as team_name, ps.title as problem_statement_title
            from submissions s
            left join teams t on t.id = s.team_id
            left join problem_statements ps on ps.id = s.problem_statement_id
            where s.id = $1
            """,
            submission_id,
        )
        return Submission(**dict(row))


@router.post("/reevaluate-failed")
async def reevaluate_all_failed(
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> dict[str, Any]:
    """Admin-only batch action: finds all submissions that either failed or
    ended up with a total score of 0 due to transient LLM rate limits/errors,
    resets them, and re-queues them to 'render_slides'."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select distinct s.id, t.name as team_name
            from submissions s
            left join teams t on t.id = s.team_id
            left join final_scores fs on fs.submission_id = s.id
            where s.status = 'failed'
               or (s.status = 'scored' and (fs.computed_total is null or fs.computed_total = 0))
            """
        )
        sub_ids = [r["id"] for r in rows]
        for sub_id in sub_ids:
            await conn.execute(
                "update submissions set is_stale = true, status = 'rendering', "
                "preliminary_score = null, preliminary_flagged = false, "
                "reliability_label = null, submission_context = null where id = $1",
                sub_id,
            )
            await conn.execute("delete from consistency_flags where submission_id = $1", sub_id)
            await conn.execute("delete from criterion_scores where submission_id = $1", sub_id)
            await conn.execute("delete from final_scores where submission_id = $1", sub_id)
            await conn.execute(
                "update jobs set status = 'failed', last_error = 'superseded by bulk re-evaluate' "
                "where submission_id = $1 and status in ('queued', 'running')",
                sub_id,
            )
            await conn.execute(
                "insert into jobs (submission_id, job_type) values ($1, 'render_slides')",
                sub_id,
            )
            invalidate_for_submission(sub_id)

    return {"requeued_count": len(sub_ids), "submission_ids": [str(s) for s in sub_ids]}


@router.delete("/{submission_id}")
async def delete_submission(
    submission_id: UUID,
    pool: asyncpg.Pool = Depends(get_db_pool),
    _admin_id: str = Depends(get_current_admin_id),
) -> dict[str, Any]:
    """Permanently deletes a submission, its slides, scores, and storage files.
    If this was the team's only submission, also cleans up the team."""
    async with pool.acquire() as conn:
        sub = await conn.fetchrow(
            "select id, team_id, pptx_storage_path, problem_statement_storage_path from submissions where id = $1",
            submission_id,
        )
        if sub is None:
            raise HTTPException(status_code=404, detail="Submission not found")

        slide_rows = await conn.fetch(
            "select unnest(image_storage_paths) as path from slides where submission_id = $1",
            submission_id,
        )
        image_paths = [r["path"] for r in slide_rows if r["path"]]

        cleanup_submission_storage(
            sub["pptx_storage_path"],
            sub["problem_statement_storage_path"],
            image_paths,
        )

        team_id = sub["team_id"]
        await conn.execute("delete from submissions where id = $1", submission_id)

        remaining = await conn.fetchval(
            "select count(*) from submissions where team_id = $1", team_id
        )
        if remaining == 0:
            await conn.execute(
                "update problem_statements set created_by_team_id = null where created_by_team_id = $1",
                team_id,
            )
            await conn.execute("delete from teams where id = $1", team_id)

    return {"deleted": True, "submission_id": str(submission_id), "team_id": str(team_id)}
