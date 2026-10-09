-- The submission_context grounding object (Phase 5) is stored alongside the
-- submission it describes; LLM-analyze (Phase 6) reads it back out to
-- ground every evaluation prompt in the team's own stated problem.
alter table submissions add column submission_context jsonb;

alter type job_type add value 'build_rubric';

-- Fixed 40-mark Hack4Purpose template: 4 sections x 5 criteria x 2 marks.
-- This structure never changes per-submission -- only evaluation_context
-- (Phase 5's grounding text, built from the team's own problem statement)
-- varies. Criteria text below is a placeholder pending the exact wording
-- from the real Hack4Purpose rubric; swap the `sections` jsonb value below,
-- not the code that reads it, once the authoritative text is available.
insert into rubric_templates (name, version, sections)
values (
  'hack4purpose-default',
  1,
  '{
    "sections": [
      {
        "key": "problem_understanding",
        "name": "Problem Understanding",
        "max_score": 10,
        "criteria": [
          {"key": "problem_clearly_defined", "name": "Problem clearly defined", "max_score": 2},
          {"key": "target_beneficiary_identified", "name": "Target beneficiary identified", "max_score": 2},
          {"key": "root_cause_explained", "name": "Root cause / context explained", "max_score": 2},
          {"key": "scope_and_scale_articulated", "name": "Scope and scale of the problem articulated", "max_score": 2},
          {"key": "evidence_for_problem", "name": "Evidence or data supporting the problem", "max_score": 2}
        ]
      },
      {
        "key": "existing_solutions",
        "name": "Existing Solutions",
        "max_score": 10,
        "criteria": [
          {"key": "existing_solutions_identified", "name": "Existing solutions identified", "max_score": 2},
          {"key": "gaps_analyzed", "name": "Gaps in existing solutions analyzed", "max_score": 2},
          {"key": "comparison_specific", "name": "Comparison is specific, not generic", "max_score": 2},
          {"key": "alternatives_awareness", "name": "Awareness of alternatives or competitors", "max_score": 2},
          {"key": "justification_for_new_approach", "name": "Justification for a new approach", "max_score": 2}
        ]
      },
      {
        "key": "proposed_solution_affordability",
        "name": "Proposed Solution & Affordability",
        "max_score": 10,
        "criteria": [
          {"key": "solution_addresses_problem", "name": "Solution directly addresses the stated problem", "max_score": 2},
          {"key": "technical_feasibility", "name": "Technical feasibility", "max_score": 2},
          {"key": "cost_affordability", "name": "Cost and affordability considered", "max_score": 2},
          {"key": "scalability", "name": "Scalability", "max_score": 2},
          {"key": "innovation_differentiation", "name": "Innovation and differentiation", "max_score": 2}
        ]
      },
      {
        "key": "execution_plan_timeline",
        "name": "Execution Plan & Timeline",
        "max_score": 10,
        "criteria": [
          {"key": "implementation_plan_clarity", "name": "Implementation plan clarity", "max_score": 2},
          {"key": "timeline_milestones", "name": "Timeline and milestones defined", "max_score": 2},
          {"key": "resource_team_plan", "name": "Resource and team plan", "max_score": 2},
          {"key": "risk_mitigation", "name": "Risk mitigation", "max_score": 2},
          {"key": "deployment_rollout_plan", "name": "Deployment and rollout plan", "max_score": 2}
        ]
      }
    ]
  }'::jsonb
)
on conflict (name, version) do nothing;
