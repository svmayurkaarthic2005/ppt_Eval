from app.evidence.traceability import build_criterion_evidence


def test_criterion_with_citations_exposes_slide_number_and_snippet():
    citations = [
        {
            "slide_number": 4,
            "evidence_type": "llm_citation",
            "observation": "Clearly states the target beneficiary.",
            "raw_text": "Our target users are rural farmers without reliable internet access.",
            "image_urls": ["https://example.supabase.co/signed/slide-4.png"],
        }
    ]
    result = build_criterion_evidence(
        section_key="problem_understanding",
        criterion_key="target_beneficiary_identified",
        llm_score=2,
        max_score=2,
        rationale="Target beneficiary is explicitly named.",
        citations=citations,
        raw_llm_output_fallback=None,
    )

    assert result.evidence_unavailable is False
    assert result.raw_llm_output_fallback is None
    assert len(result.evidence) == 1
    item = result.evidence[0]
    assert item.slide_number == 4
    assert item.image_urls == ["https://example.supabase.co/signed/slide-4.png"]
    assert item.text_snippet is not None
    assert item.text_snippet.startswith("Our target users")


def test_criterion_with_no_citations_falls_back_to_raw_log_not_fabrication():
    fallback_raw = {"choices": [{"message": {"content": "malformed, could not parse"}}]}
    result = build_criterion_evidence(
        section_key="cost",
        criterion_key="cost_affordability",
        llm_score=1,
        max_score=2,
        rationale="Some rationale text that exists despite missing citations.",
        citations=[],
        raw_llm_output_fallback=fallback_raw,
    )

    assert result.evidence_unavailable is True
    assert result.evidence == []
    assert result.raw_llm_output_fallback == fallback_raw
    assert result.needs_human_review is False  # no citations isn't itself a failure signal


def test_needs_human_review_flag_passes_through_independently_of_citations():
    # A criterion that genuinely failed scoring (flagged criterion_needs_human_review)
    # must be distinguishable from one that was scored fine but just didn't cite a slide.
    result = build_criterion_evidence(
        section_key="cost",
        criterion_key="scalability",
        llm_score=0,
        max_score=2,
        rationale="Auto-scoring failed after retrying once; needs human review.",
        citations=[],
        raw_llm_output_fallback=None,
        needs_human_review=True,
    )
    assert result.evidence_unavailable is True
    assert result.needs_human_review is True


def test_fallback_is_suppressed_when_citations_exist_even_if_passed_in():
    # Defensive: a caller shouldn't be able to accidentally show a stale raw
    # log fallback when real evidence is present.
    citations = [
        {
            "slide_number": 2,
            "evidence_type": "llm_citation",
            "observation": "x",
            "raw_text": None,
            "image_urls": [],
        }
    ]
    result = build_criterion_evidence(
        section_key="timeline",
        criterion_key="timeline_milestones",
        llm_score=2,
        max_score=2,
        rationale="ok",
        citations=citations,
        raw_llm_output_fallback={"should": "not appear"},
    )
    assert result.evidence_unavailable is False
    assert result.raw_llm_output_fallback is None


def test_text_only_evidence_has_no_image_urls():
    citations = [
        {
            "slide_number": 7,
            "evidence_type": "llm_citation",
            "observation": "Discusses timeline in text form only.",
            "raw_text": "Month 1: prototype. Month 2: pilot. Month 3: launch.",
            "image_urls": [],
        }
    ]
    result = build_criterion_evidence(
        section_key="execution_plan_timeline",
        criterion_key="timeline_milestones",
        llm_score=2,
        max_score=2,
        rationale="Clear month-by-month plan.",
        citations=citations,
        raw_llm_output_fallback=None,
    )
    assert result.evidence[0].image_urls == []
    assert result.evidence[0].text_snippet is not None


def test_missing_raw_text_yields_none_snippet_not_empty_string():
    citations = [
        {
            "slide_number": 1,
            "evidence_type": "llm_citation",
            "observation": "x",
            "raw_text": None,
            "image_urls": [],
        }
    ]
    result = build_criterion_evidence(
        section_key="problem_understanding",
        criterion_key="problem_clearly_defined",
        llm_score=2,
        max_score=2,
        rationale="ok",
        citations=citations,
        raw_llm_output_fallback=None,
    )
    assert result.evidence[0].text_snippet is None
