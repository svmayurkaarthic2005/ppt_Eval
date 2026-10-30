"""Regression tests locking in the Environmental & Chemical Engineering theme
across the evaluation pipeline's prompts and grounding text.

A submission's actual theme-fit judgment happens inside an LLM call, which
these tests never invoke -- instead they assert on the deterministic prompt
and context text every stage actually sends, the same way
test_llm_client.py's _build_messages tests already do. That's the honest,
testable boundary: we can guarantee the model is TOLD the right thing on
every code path; we can't unit-test whether it listens.
"""

from app.llm.client import SYSTEM_PROMPT as STAGE2_SYSTEM_PROMPT
from app.models.schemas import SubmissionContext
from app.pipeline.orchestrator import STAGE1_SYSTEM_PROMPT
from app.rubric.builder import render_evaluation_context

THEME_PHRASE = "Environmental and Chemical Engineering"


def _context(
    problem_domain: str = "industrial wastewater treatment",
    target_beneficiary: str = "process plant operators",
) -> SubmissionContext:
    return SubmissionContext(
        problem_domain=problem_domain,
        target_beneficiary=target_beneficiary,
        required_deliverables=[],
        track_constraints=[],
        is_generic=False,
        generic_reason=None,
    )


def test_stage1_system_prompt_states_the_theme():
    assert THEME_PHRASE in STAGE1_SYSTEM_PROMPT


def test_stage2_system_prompt_states_the_theme():
    assert THEME_PHRASE in STAGE2_SYSTEM_PROMPT


def test_stage2_system_prompt_protects_software_only_submissions():
    # The SYSTEM_PROMPT must instruct the model not to demand software artefacts
    # from hardware submissions, and not to demand physical apparatus/BOM from
    # software submissions. The solution-type framing is in evaluation_context.
    assert "do NOT ask a hardware submission for" in STAGE2_SYSTEM_PROMPT
    assert "do NOT ask a software submission for" in STAGE2_SYSTEM_PROMPT
    assert "evaluation_context block in the user message" in STAGE2_SYSTEM_PROMPT


def test_stage2_system_prompt_does_not_reward_sophistication_alone():
    # Now expressed via hardware/software neutrality: strong in its own domain
    # AND addressing the theme is required -- sophistication alone is not enough.
    assert "demonstrably addresses the hackathon" in STAGE2_SYSTEM_PROMPT
    assert "score well regardless of whether it uses physical or digital means" in STAGE2_SYSTEM_PROMPT


def test_evaluation_context_states_the_theme_for_a_concrete_submission():
    context = render_evaluation_context(_context())
    assert THEME_PHRASE in context
    assert "industrial wastewater treatment" in context


def test_evaluation_context_states_the_theme_even_with_no_team_grounding():
    # The fallback path (no problem_domain/target_beneficiary extracted yet)
    # must still carry the theme -- this is exactly the path the off-theme
    # "Artificial Intelligence" / "Engineering Solution" defaults used to
    # hit before falling through to this function.
    empty_context = _context(problem_domain="", target_beneficiary="")
    rendered = render_evaluation_context(empty_context)
    assert THEME_PHRASE in rendered


def test_evaluation_context_protects_software_only_submissions():
    # With hardware support, the context now includes solution-type-specific framing.
    # Default solution_type is "unknown" so _THEME_GROUNDING still covers both directions.
    context = render_evaluation_context(_context())
    # The theme grounding and solution-type framing together must protect both
    # hardware submissions (no code required) and software submissions (no BOM required).
    assert "physical process" in context  # hardware path covered
    assert "software/AI system" in context  # software path covered
    assert "none of them should be rewarded or penalized merely for being that type" in context


def test_evaluation_context_treats_implementation_technologies_as_equally_valid():
    context = render_evaluation_context(_context())
    assert "physical process" in context
    assert "software/AI system" in context
    assert "hybrid" in context


def test_submission_context_fallback_defaults_are_on_theme():
    # Regression guard: the benchmark/cost-analysis re-run endpoints used to
    # fall back to "Artificial Intelligence" / "Engineering Solution" as a
    # problem_domain when submission_context wasn't populated yet -- a
    # domain-neutral default that contradicts the event's fixed theme.
    import pathlib

    source = pathlib.Path(__file__).parent.parent.joinpath("app", "routers", "submissions.py").read_text(
        encoding="utf-8"
    )
    assert "Artificial Intelligence" not in source
    assert '"Engineering Solution"' not in source
    assert source.count('"Environmental and Chemical Engineering"') >= 2
