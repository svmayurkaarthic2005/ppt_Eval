"""Structural PPTX extraction via python-pptx: walks every slide into the
`slides` table (shapes/tables/charts/hyperlinks as jsonb), per the Phase 1
schema. Native PPT data (chart.plots, table cells) is preferred over the
rendered-slide image analysis that comes later in Phase 4 -- it's more
reliable than re-reading numbers off a picture.

Slide count is read from the deck itself (`enumerate(presentation.slides)`)
-- nothing here assumes a fixed number of slides.
"""

from __future__ import annotations

import io
import logging
import zipfile
from dataclasses import dataclass
from uuid import UUID

import asyncpg
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.exc import PackageNotFoundError

from app.extraction.injection_scan import scan_and_flag
from app.extraction.slide_roles import classify_slide_role
from app.supabase_client import get_service_client

logger = logging.getLogger("hackeval.extraction.structural")

_CURRENCY_CHARS = "$€£¥₹"
# Opening a corrupt file, or one encrypted with a password (OOXML password
# protection wraps the package in a non-zip CFB container), fails at one of
# these stages rather than raising a single dedicated exception type.
_PPTX_OPEN_ERRORS = (PackageNotFoundError, zipfile.BadZipFile, KeyError, ValueError, OSError)


class PptxCorruptError(Exception):
    """Raised for a corrupt or password-protected .pptx python-pptx can't open."""


@dataclass
class ParsedSlide:
    slide_number: int
    title: str
    raw_text: str
    shapes: list[dict]
    tables: list[list[list[dict]]]
    needs_visual_rendering: bool


def parse_numeric_cell(text: str) -> int | float | None:
    """Strips currency symbols/thousands separators; never coerces a
    malformed cell to 0 -- returns None instead, with the original string
    kept alongside it by the caller."""
    cleaned = text.strip()
    for char in _CURRENCY_CHARS:
        cleaned = cleaned.replace(char, "")
    cleaned = cleaned.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value


def _iter_shapes(shapes):
    """Recurses into group shapes so grouped text/tables/charts aren't missed."""
    for shape in shapes:
        yield shape
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _iter_shapes(shape.shapes)


def _extract_chart_data(chart) -> dict:
    return {
        "chart_type": str(chart.chart_type),
        "plots": [
            {
                "categories": list(plot.categories),
                "series": [
                    {"name": series.name, "values": list(series.values)} for series in plot.series
                ],
            }
            for plot in chart.plots
        ],
    }


def _extract_table(shape) -> list[list[dict]]:
    rows = []
    for row in shape.table.rows:
        cells = [
            {"text": cell.text, "value": parse_numeric_cell(cell.text)} for cell in row.cells
        ]
        rows.append(cells)
    return rows


def _extract_shape(shape) -> tuple[dict, str]:
    """Returns (shape dict for the `shapes` jsonb column, its text run contribution)."""
    hyperlinks = []
    paragraphs = []

    if shape.has_text_frame:
        for paragraph in shape.text_frame.paragraphs:
            run_texts = []
            for run in paragraph.runs:
                run_texts.append(run.text)
                address = run.hyperlink.address
                if address:
                    hyperlinks.append({"text": run.text, "address": address})
            paragraphs.append("".join(run_texts))

    has_chart = bool(getattr(shape, "has_chart", False))
    shape_dict = {
        "shape_id": shape.shape_id,
        "name": shape.name,
        "type": str(shape.shape_type),
        "left": shape.left,
        "top": shape.top,
        "width": shape.width,
        "height": shape.height,
        "has_chart": has_chart,
        "chart_data": _extract_chart_data(shape.chart) if has_chart else None,
        "hyperlinks": hyperlinks,
        "is_picture": shape.shape_type == MSO_SHAPE_TYPE.PICTURE,
    }
    return shape_dict, "\n".join(paragraphs)


def _extract_slide_title(slide, slide_number: int) -> tuple[str, int | None]:
    """Finds the slide title, falling back from native title placeholder to
    the topmost non-footer text box, and finally to 'Title Slide' or 'Slide {n}'."""
    # 1. Native title placeholder
    title_shape = slide.shapes.title
    if title_shape is not None and title_shape.has_text_frame:
        raw = title_shape.text_frame.text.strip()
        if raw:
            first_line = raw.splitlines()[0].strip()
            if first_line:
                return first_line[:120], title_shape.shape_id

    # 2. Heuristic: inspect non-footer text boxes sorted by vertical coordinate (top)
    candidates: list[tuple[int, int, str]] = []
    for s in _iter_shapes(slide.shapes):
        if not getattr(s, "has_text_frame", False):
            continue
        text = s.text_frame.text.strip()
        if not text:
            continue
        name_lower = getattr(s, "name", "").lower()
        if any(term in name_lower for term in ("footer", "slide num", "page num")):
            continue
        top = getattr(s, "top", None)
        top_val = top if top is not None else 99999999
        # Ignore items in the bottom 15% of standard presentation height (6,000,000 EMU)
        if top_val > 6000000:
            continue
        candidates.append((top_val, s.shape_id, text))

    if candidates:
        candidates.sort(key=lambda x: x[0])
        first_line = candidates[0][2].splitlines()[0].strip()
        first_line = first_line.lstrip("•-*# ").strip()
        if slide_number == 1 and first_line.lower().startswith(("presented by", "by:", "author", "name of")):
            return "Title Slide", candidates[0][1]
        if first_line:
            return first_line[:120], candidates[0][1]

    # 3. Fallbacks
    if slide_number == 1:
        return "Title Slide", None
    return f"Slide {slide_number}", None


def parse_pptx(content: bytes) -> list[ParsedSlide]:
    try:
        presentation = Presentation(io.BytesIO(content))
    except _PPTX_OPEN_ERRORS as exc:
        raise PptxCorruptError(str(exc)) from exc

    parsed_slides: list[ParsedSlide] = []
    for slide_number, slide in enumerate(presentation.slides, start=1):
        title, title_shape_id = _extract_slide_title(slide, slide_number)

        body_text_parts: list[str] = []
        shape_dicts: list[dict] = []
        tables: list[list[list[dict]]] = []
        needs_visual_rendering = False

        for shape in _iter_shapes(slide.shapes):
            if shape.shape_id == title_shape_id:
                shape_dict, _ = _extract_shape(shape)
                shape_dicts.append(shape_dict)
                if shape_dict["is_picture"] and not shape_dict["has_chart"]:
                    needs_visual_rendering = True
                continue  # kept separate in `title`, not duplicated into raw_text

            if getattr(shape, "has_table", False):
                tables.append(_extract_table(shape))
                continue

            shape_dict, text = _extract_shape(shape)
            shape_dicts.append(shape_dict)
            if text:
                body_text_parts.append(text)
            if shape_dict["is_picture"] and not shape_dict["has_chart"]:
                needs_visual_rendering = True

        parsed_slides.append(
            ParsedSlide(
                slide_number=slide_number,
                title=title,
                raw_text="\n".join(body_text_parts),
                shapes=shape_dicts,
                tables=tables,
                needs_visual_rendering=needs_visual_rendering,
            )
        )

    return parsed_slides


async def extract_submission_structure(conn: asyncpg.Connection, submission_id: UUID) -> None:
    row = await conn.fetchrow(
        "select pptx_storage_path from submissions where id = $1", submission_id
    )
    if row is None:
        raise ValueError(f"submission {submission_id} not found")

    content = get_service_client().storage.from_("pptx-uploads").download(
        row["pptx_storage_path"]
    )

    try:
        slides = parse_pptx(content)
    except PptxCorruptError as exc:
        logger.warning("submission %s: corrupt/protected pptx: %s", submission_id, exc)
        await conn.execute("update submissions set status = 'failed' where id = $1", submission_id)
        await conn.execute(
            """
            insert into consistency_flags (submission_id, flag_type, severity, description)
            values ($1, 'pptx_corrupt', 'high', $2)
            """,
            submission_id,
            f"Could not open the .pptx file: {exc}",
        )
        return  # handled, not raised -- the pipeline job completes normally

    needs_rendering: list[int] = []
    for slide in slides:
        # Phase 13: advisory only -- never changes classification or any score.
        await scan_and_flag(
            conn, submission_id, f"slide {slide.slide_number}", f"{slide.title}\n{slide.raw_text}"
        )
        role = await classify_slide_role(slide.title, slide.raw_text)
        await conn.execute(
            """
            insert into slides
                (submission_id, slide_number, title, raw_text, shapes, tables,
                 classified_role, needs_visual_rendering)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (submission_id, slide_number) do update set
                title = excluded.title,
                raw_text = excluded.raw_text,
                shapes = excluded.shapes,
                tables = excluded.tables,
                classified_role = excluded.classified_role,
                needs_visual_rendering = excluded.needs_visual_rendering
            """,
            submission_id,
            slide.slide_number,
            slide.title,
            slide.raw_text,
            slide.shapes,
            slide.tables,
            role.value,
            slide.needs_visual_rendering,
        )
        if slide.needs_visual_rendering:
            needs_rendering.append(slide.slide_number)

    await conn.execute(
        "update submissions set slide_count = $2, status = 'rendering' where id = $1",
        submission_id,
        len(slides),
    )

    if needs_rendering:
        await conn.execute(
            """
            insert into consistency_flags (submission_id, flag_type, severity, description)
            values ($1, 'needs_visual_rendering', 'low', $2)
            """,
            submission_id,
            f"Slides {needs_rendering} contain images with no native chart data; "
            "Phase 4 rendering is required to analyze them.",
        )

    await conn.execute(
        "insert into jobs (submission_id, job_type) values ($1, 'render_slides')",
        submission_id,
    )
