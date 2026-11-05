"""Optical Character Recognition (OCR) module using PyMuPDF.

Provides robust OCR fallback for scanned, exported, or image-only pitch decks
(e.g., Canva/Figma exports, full-bleed graphic slides) where python-pptx finds
zero native text frames.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import pymupdf

logger = logging.getLogger("hackeval.extraction.ocr")

_CACHED_TESSDATA_DIR: str | None = None


def get_tessdata_dir() -> str | None:
    """Finds or resolves the directory containing `eng.traineddata`."""
    global _CACHED_TESSDATA_DIR
    if _CACHED_TESSDATA_DIR and os.path.isdir(_CACHED_TESSDATA_DIR):
        return _CACHED_TESSDATA_DIR

    env_prefix = os.environ.get("TESSDATA_PREFIX")
    if env_prefix and os.path.isdir(env_prefix) and (Path(env_prefix) / "eng.traineddata").is_file():
        _CACHED_TESSDATA_DIR = env_prefix
        return env_prefix

    search_dirs = [
        Path(__file__).parent.parent / "tessdata",
        Path("tessdata").resolve(),
        Path("/usr/share/tesseract-ocr/5/tessdata"),
        Path("/usr/share/tesseract-ocr/4.00/tessdata"),
        Path("/usr/share/tessdata"),
        Path("/usr/local/share/tessdata"),
    ]

    for d in search_dirs:
        if d.is_dir() and (d / "eng.traineddata").is_file():
            _CACHED_TESSDATA_DIR = str(d)
            os.environ["TESSDATA_PREFIX"] = _CACHED_TESSDATA_DIR
            return _CACHED_TESSDATA_DIR

    # If running in development and tessdata exists in workspace root
    root_tess = Path.cwd() / "tessdata"
    if root_tess.is_dir() and (root_tess / "eng.traineddata").is_file():
        _CACHED_TESSDATA_DIR = str(root_tess)
        os.environ["TESSDATA_PREFIX"] = _CACHED_TESSDATA_DIR
        return _CACHED_TESSDATA_DIR

    return None


def extract_text_from_image_bytes(image_bytes: bytes) -> str:
    """Runs OCR on an image byte buffer (PNG/JPEG/etc.) using PyMuPDF.
    Never raises -- returns empty string on any failure so pipeline proceeds.
    """
    if not image_bytes:
        return ""

    tess_dir = get_tessdata_dir()
    try:
        img_doc = pymupdf.open(stream=image_bytes, filetype="png")
        if img_doc.page_count == 0:
            return ""
        rect = img_doc[0].rect
        doc = pymupdf.open()
        page = doc.new_page(width=rect.width, height=rect.height)
        page.insert_image(rect, stream=image_bytes)

        kwargs: dict[str, str] = {"language": "eng"}
        if tess_dir:
            kwargs["tessdata"] = tess_dir

        tp = page.get_textpage_ocr(**kwargs)
        text = tp.extractText()
        doc.close()
        img_doc.close()
        return text.strip()
    except Exception as exc:  # noqa: BLE001
        logger.debug("OCR extraction failed: %s", exc)
        return ""


def extract_text_from_pdf_page(page: pymupdf.Page) -> str:
    """Extracts text from a PyMuPDF PDF page, falling back to OCR if vector text is empty."""
    try:
        text = page.get_text()
        if len(text.strip()) >= 20:
            return text.strip()
    except Exception:  # noqa: BLE001
        text = ""

    tess_dir = get_tessdata_dir()
    try:
        kwargs: dict[str, str] = {"language": "eng"}
        if tess_dir:
            kwargs["tessdata"] = tess_dir
        tp = page.get_textpage_ocr(**kwargs)
        ocr_text = tp.extractText().strip()
        return ocr_text if len(ocr_text) > len(text.strip()) else text.strip()
    except Exception as exc:  # noqa: BLE001
        logger.debug("PDF page OCR extraction failed: %s", exc)
        return text.strip()
