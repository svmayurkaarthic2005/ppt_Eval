import pymupdf as fitz
from docx import Document

from app.extraction.problem_statement import MIN_USABLE_WORDS, extract_text, is_usable, word_count


def _make_pdf_bytes(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def _make_docx_bytes(paragraphs: list[str]) -> bytes:
    import io

    document = Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def test_txt_extraction_roundtrips():
    content = b"Hello hackathon judges, this is a plain text problem statement."
    assert extract_text(content, "text/plain") == content.decode()


def test_pdf_extraction_reads_inserted_text():
    text = extract_text(_make_pdf_bytes("Build a tool that helps judges."), "application/pdf")
    assert "Build a tool that helps judges." in text


def test_docx_extraction_joins_paragraphs():
    text = extract_text(
        _make_docx_bytes(["First paragraph.", "Second paragraph."]),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    assert "First paragraph." in text
    assert "Second paragraph." in text


def test_word_count():
    assert word_count("one two three") == 3
    assert word_count("") == 0


def test_is_usable_threshold():
    short = " ".join(["word"] * (MIN_USABLE_WORDS - 1))
    long_enough = " ".join(["word"] * MIN_USABLE_WORDS)
    assert not is_usable(short)
    assert is_usable(long_enough)
