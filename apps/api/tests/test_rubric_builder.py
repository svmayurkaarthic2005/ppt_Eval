from uuid import uuid4

from app.models.schemas import SubmissionContext
from app.rubric.builder import _parse_submission_context, build_rubric

SECTIONS = {
    "sections": [
        {
            "key": "problem_understanding",
            "name": "Problem Understanding",
            "max_score": 10,
            "criteria": [
                {"key": "problem_clearly_defined", "name": "Problem clearly defined", "max_score": 2},
                {"key": "target_beneficiary_identified", "name": "Target beneficiary identified", "max_score": 2},
            ],
        },
        {
            "key": "execution_plan_timeline",
            "name": "Execution Plan & Timeline",
            "max_score": 10,
            "criteria": [
                {"key": "timeline_milestones", "name": "Timeline and milestones defined", "max_score": 2},
            ],
        },
    ]
}


def _context(
    problem_domain: str = "rural healthcare access",
    target_beneficiary: str = "patients in low-connectivity areas",
    required_deliverables: list[str] | None = None,
    track_constraints: list[str] | None = None,
    is_generic: bool = False,
    generic_reason: str | None = None,
) -> SubmissionContext:
    return SubmissionContext(
        problem_domain=problem_domain,
        target_beneficiary=target_beneficiary,
        required_deliverables=required_deliverables if required_deliverables is not None else ["must work offline"],
        track_constraints=track_constraints or [],
        is_generic=is_generic,
        generic_reason=generic_reason,
    )


def test_two_different_contexts_yield_identical_max_scores_only_context_differs():
    template_id = uuid4()
    context_a = _context(problem_domain="rural healthcare access", target_beneficiary="patients")
    context_b = _context(
        problem_domain="urban waste management",
        target_beneficiary="municipal sanitation workers",
        required_deliverables=["must include a cost breakup"],
    )

    rubric_a = build_rubric(template_id, SECTIONS, context_a)
    rubric_b = build_rubric(template_id, SECTIONS, context_b)

    scores_a = [(c.criterion_key, c.max_score) for c in rubric_a.criteria]
    scores_b = [(c.criterion_key, c.max_score) for c in rubric_b.criteria]
    assert scores_a == scores_b

    section_keys_a = {c.section_key for c in rubric_a.criteria}
    section_keys_b = {c.section_key for c in rubric_b.criteria}
    assert section_keys_a == section_keys_b

    assert rubric_a.evaluation_context != rubric_b.evaluation_context
    assert "rural healthcare access" in rubric_a.evaluation_context
    assert "urban waste management" in rubric_b.evaluation_context


def test_build_rubric_copies_every_criterion_from_the_template():
    rubric = build_rubric(uuid4(), SECTIONS, _context())
    keys = [c.criterion_key for c in rubric.criteria]
    assert keys == [
        "problem_clearly_defined",
        "target_beneficiary_identified",
        "timeline_milestones",
    ]
    assert all(c.max_score == 2 for c in rubric.criteria)


def test_build_rubric_total_matches_template_total_regardless_of_context():
    total_a = sum(c.max_score for c in build_rubric(uuid4(), SECTIONS, _context()).criteria)
    total_b = sum(
        c.max_score
        for c in build_rubric(uuid4(), SECTIONS, _context(problem_domain="something else")).criteria
    )
    assert total_a == total_b == 6  # 2+2+2 in this trimmed test template


def test_parse_submission_context_defaults_missing_fields():
    context = _parse_submission_context({"problem_domain": "x"})
    assert context.problem_domain == "x"
    assert context.target_beneficiary == ""
    assert context.required_deliverables == []
    assert context.track_constraints == []
    assert context.is_generic is False
    assert context.generic_reason is None


def test_parse_submission_context_flags_generic():
    context = _parse_submission_context(
        {
            "problem_domain": "",
            "is_generic": True,
            "generic_reason": "Copied verbatim from the hackathon brief.",
        }
    )
    assert context.is_generic is True
    assert context.generic_reason == "Copied verbatim from the hackathon brief."
