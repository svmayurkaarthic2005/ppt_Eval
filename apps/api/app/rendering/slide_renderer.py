"""Renders slides flagged by Phase 3 (slides.needs_visual_rendering) to PNG:
LibreOffice headless converts the deck to PDF, then pymupdf rasterizes the
needed pages at 150-200 DPI -- detailed enough for small chart labels
without exceeding Groq's 20MB per-image limit (Phase 6).

Caching: content_hash is sha256 of the slide's own XML part
(slide.part.blob). An identical hash from an earlier render (duplicate
submission, re-run) skips LibreOffice entirely when every needed slide is
already cached, or is copied into this submission's own storage folder
(via Storage's copy(), not re-rendered) when only some are. A copy -- not a
shared path -- keeps each submission's files under its own
`{submission_id}/` folder, which the Phase 2 storage RLS policies depend on.

A rendering failure/timeout never blocks the evaluation: it's recorded as a
consistency_flags row and the submission proceeds to 'analyzing' on
whatever text-only structural data Phase 3 already captured.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from uuid import UUID

import asyncpg
import pymupdf
from pptx import Presentation
from pptx.exc import PackageNotFoundError

from app.config import get_settings
from app.rendering.subprocess_runner import (
    SubprocessFailedError,
    SubprocessTimeoutError,
    SubprocessUnavailableError,
    run_with_timeout,
)
from app.supabase_client import get_service_client

logger = logging.getLogger("hackeval.rendering")

LIBREOFFICE_TIMEOUT_SECONDS = 60
RENDER_DPI = 150
SOFFICE_ARGV: list[str] = ["soffice"]
_PPTX_OPEN_ERRORS = (PackageNotFoundError, zipfile.BadZipFile, KeyError, ValueError, OSError)


def _resolve_soffice_path() -> str | None:
    settings = get_settings()
    if settings.libreoffice_path and Path(settings.libreoffice_path).is_file():
        return settings.libreoffice_path

    if shutil.which(SOFFICE_ARGV[0]) is not None or Path(SOFFICE_ARGV[0]).is_file():
        return SOFFICE_ARGV[0]

    if SOFFICE_ARGV != ["soffice"]:
        return SOFFICE_ARGV[0]

    if sys.platform.startswith("win"):
        candidates = [
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ]
        for c in candidates:
            if Path(c).is_file():
                return c
    return None


def _is_powerpoint_available() -> bool:
    if not sys.platform.startswith("win"):
        return False
    try:
        import comtypes
        import comtypes.client  # noqa: F401
        return True
    except ImportError:
        return False


def _convert_pptx_to_pdf_powerpoint(pptx_bytes: bytes) -> bytes:
    import comtypes
    import comtypes.client

    comtypes.CoInitialize()
    ppt = None
    pres = None
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        pptx_path = tmp_path / "deck.pptx"
        pdf_path = tmp_path / "deck.pdf"
        pptx_path.write_bytes(pptx_bytes)
        try:
            ppt = comtypes.client.CreateObject("PowerPoint.Application")
            pres = ppt.Presentations.Open(str(pptx_path), True, False, False)
            pres.SaveAs(str(pdf_path), 32)  # 32 = ppSaveAsPDF
        finally:
            if pres is not None:
                try:
                    pres.Close()
                except Exception:  # noqa: BLE001, S110
                    pass
            if ppt is not None:
                try:
                    ppt.Quit()
                except Exception:  # noqa: BLE001, S110
                    pass
            comtypes.CoUninitialize()

        if not pdf_path.exists():
            raise SubprocessFailedError(0, b"PowerPoint COM did not produce a PDF output file")
        return pdf_path.read_bytes()


async def _convert_pptx_to_pdf_soffice(
    soffice_path: str, pptx_bytes: bytes, timeout: float
) -> bytes:
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        pptx_path = tmp_path / "deck.pptx"
        pptx_path.write_bytes(pptx_bytes)

        argv = [
            soffice_path,
            *SOFFICE_ARGV[1:],
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(tmp_path),
            str(pptx_path),
        ]
        await run_with_timeout(argv, timeout)

        pdf_path = tmp_path / "deck.pdf"
        if not pdf_path.exists():
            raise SubprocessFailedError(0, b"soffice did not produce a PDF output file")
        return pdf_path.read_bytes()


def hash_slide_xml(slide) -> str:
    return hashlib.sha256(slide.part.blob).hexdigest()


def rasterize_page_to_png(pdf_bytes: bytes, page_index: int, dpi: int = RENDER_DPI) -> bytes:
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
        page = pdf[page_index]
        return page.get_pixmap(dpi=dpi).tobytes("png")


async def convert_pptx_to_pdf_bytes(
    pptx_bytes: bytes, timeout: float = LIBREOFFICE_TIMEOUT_SECONDS
) -> bytes:
    soffice_path = _resolve_soffice_path()
    if soffice_path is not None:
        try:
            return await _convert_pptx_to_pdf_soffice(soffice_path, pptx_bytes, timeout)
        except Exception as exc:
            logger.warning("LibreOffice conversion failed (%s); trying fallback if available", exc)
            if not _is_powerpoint_available():
                raise

    if _is_powerpoint_available():
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_convert_pptx_to_pdf_powerpoint, pptx_bytes),
                timeout=timeout,
            )
        except TimeoutError as exc:
            raise SubprocessTimeoutError(f"PowerPoint COM conversion exceeded {timeout}s") from exc
        except Exception as exc:
            logger.warning("PowerPoint COM conversion failed: %s", exc)
            raise SubprocessUnavailableError(
                f"PowerPoint COM conversion failed: {exc}"
            ) from exc

    raise SubprocessUnavailableError(
        "No slide renderer available: LibreOffice ('soffice') is not found and PowerPoint COM is unavailable."
    )


async def _flag_rendering_unavailable(
    conn: asyncpg.Connection, submission_id: UUID, detail: str
) -> None:
    await conn.execute(
        """
        insert into consistency_flags (submission_id, flag_type, severity, description)
        values ($1, 'rendering_failed', 'high', $2)
        """,
        submission_id,
        f"{detail} Visual analysis is unavailable for this submission; "
        "proceeding with text-only structural scoring.",
    )


async def _advance_to_rubric_build(conn: asyncpg.Connection, submission_id: UUID) -> None:
    # Rendering (visual, optional) hands off to Phase 5 (rubric-build,
    # required) -- status stays 'rendering' until that job sets 'analyzing'.
    await conn.execute(
        "insert into jobs (submission_id, job_type) values ($1, 'build_rubric')",
        submission_id,
    )


async def render_submission_slides(conn: asyncpg.Connection, submission_id: UUID) -> None:
    submission = await conn.fetchrow(
        "select pptx_storage_path from submissions where id = $1", submission_id
    )
    if submission is None:
        raise ValueError(f"submission {submission_id} not found")

    # Render all slides in the deck so visual cards are available for every slide
    needed_rows = await conn.fetch(
        """
        select slide_number from slides
        where submission_id = $1
        order by slide_number
        """,
        submission_id,
    )
    if not needed_rows:
        await _advance_to_rubric_build(conn, submission_id)
        return

    pptx_bytes = get_service_client().storage.from_("pptx-uploads").download(
        submission["pptx_storage_path"]
    )

    try:
        presentation = Presentation(io.BytesIO(pptx_bytes))
    except _PPTX_OPEN_ERRORS as exc:
        # Phase 3 should already have caught an unopenable deck; defensive fallback.
        await _flag_rendering_unavailable(conn, submission_id, f"Could not reopen .pptx: {exc}.")
        await _advance_to_rubric_build(conn, submission_id)
        return

    needed_numbers = [row["slide_number"] for row in needed_rows]
    hashes_by_number = {
        n: hash_slide_xml(presentation.slides[n - 1])
        for n in needed_numbers
        if n - 1 < len(presentation.slides)
    }

    cached_rows = await conn.fetch(
        "select content_hash, storage_path from rendered_slide_cache where content_hash = any($1::text[])",
        list(set(hashes_by_number.values())),
    )
    cached_paths = {row["content_hash"]: row["storage_path"] for row in cached_rows}
    
    storage = get_service_client().storage.from_("rendered-slides")
    rendered_paths: dict[int, str] = {}
    cache_misses: dict[int, str] = {}

    # Attempt to copy cached renders first
    for slide_number, content_hash in hashes_by_number.items():
        cached_path = cached_paths.get(content_hash)
        if not cached_path:
            cache_misses[slide_number] = content_hash
            continue

        path = f"{submission_id}/slide-{slide_number}.png"
        try:
            storage.copy(cached_path, path)
            rendered_paths[slide_number] = path
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "submission %s: could not copy cached render from %s to %s (treating as cache miss): %s",
                submission_id,
                cached_path,
                path,
                exc,
            )
            # Stale cache pointer: purge from DB and re-render from PDF
            await conn.execute("delete from rendered_slide_cache where content_hash = $1", content_hash)
            cache_misses[slide_number] = content_hash

    # Render any missing or un-cached slides
    if cache_misses:
        try:
            pdf_bytes = await convert_pptx_to_pdf_bytes(pptx_bytes)
        except (
            SubprocessTimeoutError,
            SubprocessFailedError,
            SubprocessUnavailableError,
            NotImplementedError,
            FileNotFoundError,
        ) as exc:
            logger.warning("submission %s: rendering failed: %s", submission_id, exc)
            await _flag_rendering_unavailable(conn, submission_id, f"LibreOffice conversion failed: {exc}.")
            pdf_bytes = None

        if pdf_bytes is not None:
            with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
                page_count = pdf.page_count
            for slide_number, content_hash in cache_misses.items():
                page_index = slide_number - 1
                if page_index >= page_count:
                    continue  # defensive: conversion produced fewer pages than slides
                png_bytes = rasterize_page_to_png(pdf_bytes, page_index)
                path = f"{submission_id}/slide-{slide_number}.png"
                storage.upload(path, png_bytes, {"content-type": "image/png", "upsert": "true"})
                await conn.execute(
                    """
                    insert into rendered_slide_cache (content_hash, storage_path)
                    values ($1, $2)
                    on conflict (content_hash) do update set storage_path = excluded.storage_path
                    """,
                    content_hash,
                    path,
                )
                rendered_paths[slide_number] = path

    for slide_number, path in rendered_paths.items():
        await conn.execute(
            """
            update slides
            set image_storage_paths = case
                when $1 = any(image_storage_paths) then image_storage_paths
                else array_append(image_storage_paths, $1)
            end
            where submission_id = $2 and slide_number = $3
            """,
            path,
            submission_id,
            slide_number,
        )

    if rendered_paths:
        await conn.execute(
            """
            delete from consistency_flags
            where submission_id = $1 and flag_type = 'needs_visual_rendering'
            """,
            submission_id,
        )
        await conn.execute(
            """
            update consistency_flags
            set resolved = true
            where submission_id = $1 and flag_type = 'rendering_failed'
            """,
            submission_id,
        )

    await _advance_to_rubric_build(conn, submission_id)

