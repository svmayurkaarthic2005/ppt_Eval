from app.routers.submissions import _derive_problem_statement_title


def test_derive_title_truncates_long_text_with_ellipsis():
    text = "x" * 200
    title = _derive_problem_statement_title(text)
    # no space to break on, so it falls back to a hard cut at 80 chars
    assert title == "x" * 80 + "…"


def test_derive_title_truncates_at_a_word_boundary():
    text = "Farmers and agronomists need early, reliable crop-stress signals that classical CNNs cannot pick up"
    title = _derive_problem_statement_title(text)
    assert len(title) <= 81
    assert not title.endswith("…ick")  # never cuts mid-word
    assert title == text[:80].rsplit(" ", 1)[0] + "…"


def test_derive_title_strips_whitespace():
    assert _derive_problem_statement_title("  Build a thing  ") == "Build a thing"


def test_derive_title_falls_back_when_blank():
    assert _derive_problem_statement_title("   ") == "Untitled problem statement"
