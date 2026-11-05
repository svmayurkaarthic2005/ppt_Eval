import pymupdf

from app.extraction.ocr import (
    extract_text_from_image_bytes,
    extract_text_from_pdf_page,
    get_tessdata_dir,
)


def test_get_tessdata_dir():
    # Should resolve to a directory containing eng.traineddata or None
    d = get_tessdata_dir()
    if d is not None:
        assert isinstance(d, str)


def test_extract_text_from_empty_image_returns_empty_string():
    assert extract_text_from_image_bytes(b"") == ""
    assert extract_text_from_image_bytes(b"invalid-bytes") == ""


def test_extract_text_from_pdf_page_with_vector_text():
    doc = pymupdf.open()
    page = doc.new_page(width=500, height=300)
    page.insert_text((50, 50), "This is vector text on a slide with enough characters to test.")
    extracted = extract_text_from_pdf_page(page)
    doc.close()
    assert "vector text on a slide" in extracted
