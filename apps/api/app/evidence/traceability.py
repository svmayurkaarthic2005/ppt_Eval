"""Phase 11: reconstructs a submission's scores from stored rows alone --
never re-calls the LLM to "explain" a score after the fact. If a scored
criterion somehow has no evidence_items citations (shouldn't happen given
Phase 6's unconditional raw-response logging, but defended against here),
the caller gets the raw pre-parse log instead of a fabricated explanation.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import asyncpg
from pydantic import BaseModel

from app.supabase_client import get_service_client

logger = logging.getLogger("hackeval.evidence.traceability")

SIGNED_URL_EXPIRY_SECONDS = 3600


class EvidenceItemOut(BaseModel):
    slide_number: int | None
    evidence_type: str
    observation: str
    text_snippet: str | None
    image_urls: list[str]


class CriterionEvidenceOut(BaseModel):
    section_key: str
    criterion_key: str
    llm_score: float
    max_score: float
    rationale: str
    evidence: list[EvidenceItemOut]
    evidence_unavailable: bool
    needs_human_review: bool
    raw_llm_output_fallback: dict[str, Any] | None


class SubmissionEvidenceOut(BaseModel):
    submission_id: UUID
    criteria: list[CriterionEvidenceOut]


class StatusTransition(BaseModel):
    status: str
    changed_at: str


class SubmissionAuditOut(BaseModel):
    submission_id: UUID
    status_history: list[StatusTransition]
    consistency_flags: list[dict[str, Any]]
    criteria_scored: int | None
    criteria_total: int | None


class SlideOut(BaseModel):
    slide_number: int
    title: str
    classified_role: str | None
    image_urls: list[str]


class SubmissionSlidesOut(BaseModel):
    submission_id: UUID
    pptx_download_url: str | None
    slides: list[SlideOut]


def build_criterion_evidence(
    section_key: str,
    criterion_key: str,
    llm_score: float,
    max_score: float,
    rationale: str,
    citations: list[dict[str, Any]],
    raw_llm_output_fallback: dict[str, Any] | None,
    needs_human_review: bool = False,
) -> CriterionEvidenceOut:
    """Pure: no I/O. `citations` entries are plain dicts (already resolved,
    including any signed image URLs) so this is testable without a DB or
    Supabase Storage.

    `needs_human_review` is a separate signal from `evidence_unavailable`:
    a criterion can be legitimately scored with no cited slide (a holistic
    criterion that isn't about one specific slide -- not every response has
    evidence_refs, and that's fine), which must not look like the scoring
    itself failed. Only an actual criterion_needs_human_review flag means
    that."""
    evidence = [
        EvidenceItemOut(
            slide_number=c.get("slide_number"),
            evidence_type=c["evidence_type"],
            observation=c["observation"],
            text_snippet=(c["raw_text"][:300] if c.get("raw_text") else None),
            image_urls=c.get("image_urls") or [],
        )
        for c in citations
    ]
    return CriterionEvidenceOut(
        section_key=section_key,
        criterion_key=criterion_key,
        llm_score=llm_score,
        max_score=max_score,
        rationale=rationale,
        evidence=evidence,
        evidence_unavailable=not evidence,
        needs_human_review=needs_human_review,
        raw_llm_output_fallback=raw_llm_output_fallback if not evidence else None,
    )


def _sign_image_urls(storage, paths: list[str]) -> list[str]:
    urls: list[str] = []
    for path in paths:
        try:
            signed = storage.create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
            url = signed.get("signedURL") or signed.get("signedUrl")
        except Exception as exc:  # noqa: BLE001 -- a storage hiccup shouldn't break the whole evidence view
            logger.warning("could not sign URL for %s: %s", path, exc)
            url = None
        if url:
            urls.append(url)
    return urls


async def get_submission_evidence(conn: asyncpg.Connection, submission_id: UUID) -> SubmissionEvidenceOut:
    criterion_rows = await conn.fetch(
        """
        select section_key, criterion_key, llm_score, max_score, rationale
        from criterion_scores
        where submission_id = $1
        order by section_key, criterion_key
        """,
        submission_id,
    )

    flagged_rows = await conn.fetch(
        """
        select description from consistency_flags
        where submission_id = $1 and flag_type = 'criterion_needs_human_review' and resolved = false
        """,
        submission_id,
    )
    flagged_descriptions = [row["description"] for row in flagged_rows]

    def _is_flagged(criterion_key: str) -> bool:
        prefix = f"Criterion {criterion_key} "
        return any(d.startswith(prefix) for d in flagged_descriptions)

    # ── Bulk fetch all citation rows in ONE query (was N=20 sequential fetches) ──
    all_citation_rows = await conn.fetch(
        """
        select e.criterion_key, e.observation, e.evidence_type,
               sl.slide_number, sl.raw_text, sl.image_storage_paths
        from evidence_items e
        join slides sl on sl.id = e.slide_id
        where e.submission_id = $1 and e.slide_id is not null
        order by e.criterion_key, sl.slide_number
        """,
        submission_id,
    )
    # Group citation rows by criterion_key
    citations_by_criterion: dict[str, list[dict]] = {}
    for c in all_citation_rows:
        citations_by_criterion.setdefault(c["criterion_key"], []).append(c)

    # ── Bulk fetch fallback log rows for criteria with no citations ──
    all_fallback_rows = await conn.fetch(
        """
        select distinct on (criterion_key) criterion_key, raw_llm_output
        from evidence_items
        where submission_id = $1 and slide_id is null
        order by criterion_key, created_at desc
        """,
        submission_id,
    )
    fallback_by_criterion: dict[str, dict] = {
        r["criterion_key"]: r["raw_llm_output"] for r in all_fallback_rows
    }

    # ── Collect all unique image paths and sign them in one pass ──
    all_paths: list[str] = []
    seen: set[str] = set()
    for c in all_citation_rows:
        for p in (c["image_storage_paths"] or []):
            if p not in seen:
                seen.add(p)
                all_paths.append(p)

    storage = get_service_client().storage.from_("rendered-slides")
    signed_url_cache: dict[str, str] = {}
    for path in all_paths:
        urls = _sign_image_urls(storage, [path])
        if urls:
            signed_url_cache[path] = urls[0]

    criteria_out: list[CriterionEvidenceOut] = []
    for row in criterion_rows:
        raw_citations = citations_by_criterion.get(row["criterion_key"], [])
        citations = [
            {
                "slide_number": c["slide_number"],
                "evidence_type": c["evidence_type"],
                "observation": c["observation"],
                "raw_text": c["raw_text"],
                "image_urls": [
                    signed_url_cache[p]
                    for p in (c["image_storage_paths"] or [])
                    if p in signed_url_cache
                ],
            }
            for c in raw_citations
        ]
        fallback = fallback_by_criterion.get(row["criterion_key"]) if not citations else None
        criteria_out.append(
            build_criterion_evidence(
                row["section_key"],
                row["criterion_key"],
                float(row["llm_score"]),
                float(row["max_score"]),
                row["rationale"],
                citations,
                fallback,
                needs_human_review=_is_flagged(row["criterion_key"]),
            )
        )

    return SubmissionEvidenceOut(submission_id=submission_id, criteria=criteria_out)



async def get_submission_slides(conn: asyncpg.Connection, submission_id: UUID) -> SubmissionSlidesOut:
    """Lets a viewer see the actual deck -- a signed download link for the
    original .pptx plus, for whichever slides got rendered (Phase 4), a
    signed image per slide so they can flip through it without downloading
    anything. A slide that was never rendered still appears, just without
    an image."""
    submission_row = await conn.fetchrow(
        "select pptx_storage_path from submissions where id = $1", submission_id
    )
    pptx_download_url: str | None = None
    if submission_row and submission_row["pptx_storage_path"]:
        pptx_bucket = get_service_client().storage.from_("pptx-uploads")
        try:
            signed = pptx_bucket.create_signed_url(
                submission_row["pptx_storage_path"], SIGNED_URL_EXPIRY_SECONDS
            )
            pptx_download_url = signed.get("signedURL") or signed.get("signedUrl")
        except Exception as exc:  # noqa: BLE001 -- a storage hiccup shouldn't break the whole view
            logger.warning(
                "could not sign pptx download URL for submission %s: %s", submission_id, exc
            )

    slide_rows = await conn.fetch(
        """
        select slide_number, title, classified_role, image_storage_paths
        from slides where submission_id = $1 order by slide_number
        """,
        submission_id,
    )
    image_bucket = get_service_client().storage.from_("rendered-slides")
    slides = [
        SlideOut(
            slide_number=row["slide_number"],
            title=row["title"],
            classified_role=row["classified_role"],
            image_urls=_sign_image_urls(image_bucket, row["image_storage_paths"] or []),
        )
        for row in slide_rows
    ]
    return SubmissionSlidesOut(
        submission_id=submission_id, pptx_download_url=pptx_download_url, slides=slides
    )


async def get_submission_audit(conn: asyncpg.Connection, submission_id: UUID) -> SubmissionAuditOut:
    history_rows = await conn.fetch(
        """
        select status, changed_at from submission_status_history
        where submission_id = $1
        order by changed_at
        """,
        submission_id,
    )
    flag_rows = await conn.fetch(
        """
        select flag_type, severity, description, resolved, created_at from consistency_flags
        where submission_id = $1
        order by created_at
        """,
        submission_id,
    )

    # Stage 2's per-criterion progress, for an honest "N of M scored so far"
    # instead of a guessed ETA -- None (not a count of 0) when there's no
    # rubric_template resolved yet, so the frontend can tell "not started"
    # apart from "started, 0 scored".
    criteria_total = await conn.fetchval(
        """
        select sum(jsonb_array_length(section.value -> 'criteria'))
        from submissions s
        join rubric_templates rt on rt.id = s.rubric_template_id
        cross join lateral jsonb_array_elements(rt.sections -> 'sections') as section
        where s.id = $1
        """,
        submission_id,
    )
    criteria_scored = (
        await conn.fetchval(
            "select count(*) from criterion_scores where submission_id = $1", submission_id
        )
        if criteria_total is not None
        else None
    )

    return SubmissionAuditOut(
        submission_id=submission_id,
        status_history=[
            StatusTransition(status=r["status"], changed_at=r["changed_at"].isoformat())
            for r in history_rows
        ],
        consistency_flags=[
            {
                "flag_type": r["flag_type"],
                "severity": r["severity"],
                "description": r["description"],
                "resolved": r["resolved"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in flag_rows
        ],
        criteria_scored=criteria_scored,
        criteria_total=criteria_total,
    )
