"""Problem-statement text extraction: PyMuPDF for PDF, python-docx for DOCX,
plain decode for TXT.

The #1 logic bug to avoid: never let a downstream phase run on empty input
and still produce a score. MIN_USABLE_WORDS gates that -- callers must check
`is_usable()` before persisting a status other than 'failed'.
"""

from __future__ import annotations

import io

import docx
import pymupdf as fitz

MIN_USABLE_WORDS = 1  # just "not empty" -- no word-count floor beyond that

ALLOWED_PROBLEM_STATEMENT_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
}
MAX_PROBLEM_STATEMENT_BYTES = 10 * 1024 * 1024

ALLOWED_PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
MAX_PPTX_BYTES = 50 * 1024 * 1024


class UnsupportedFileType(ValueError):
    pass


def extract_text(content: bytes, content_type: str) -> str:
    extension = ALLOWED_PROBLEM_STATEMENT_TYPES.get(content_type)
    if extension is None:
        raise UnsupportedFileType(content_type)

    if extension == "txt":
        return content.decode("utf-8", errors="replace")

    if extension == "pdf":
        with fitz.open(stream=content, filetype="pdf") as pdf:
            return "\n".join(page.get_text() for page in pdf)

    document = docx.Document(io.BytesIO(content))
    return "\n".join(paragraph.text for paragraph in document.paragraphs)


def word_count(text: str) -> int:
    return len(text.split())


def is_usable(text: str) -> bool:
    return word_count(text) >= MIN_USABLE_WORDS
