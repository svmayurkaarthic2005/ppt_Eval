"""Pydantic models mirroring the Supabase schema (supabase/migrations/).

Mirrors packages/types/src/index.ts -- keep both in sync by hand.
One model per table, named after it; field names and nullability match the
migration columns exactly so a row read straight from Supabase validates.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SubmissionStatus(str, Enum):
    uploaded = "uploaded"
    extracting = "extracting"
    rendering = "rendering"
    analyzing = "analyzing"
    scored = "scored"
    failed = "failed"


class SlideRole(str, Enum):
    problem = "problem"
    existing_solution = "existing_solution"
    proposed_solution = "proposed_solution"
    workflow = "workflow"
    cost = "cost"
    execution = "execution"
    timeline = "timeline"
    other = "other"


class Team(BaseModel):
    id: UUID
    name: str
    owner_user_id: UUID
    created_at: datetime


class ProblemStatement(BaseModel):
    id: UUID
    title: str
    reference_text: str
    is_custom: bool
    created_by_team_id: UUID | None = None
    created_at: datetime


class RubricTemplate(BaseModel):
    id: UUID
    name: str
    version: int
    sections: dict[str, Any]
    created_at: datetime


class SubmissionContext(BaseModel):
    """Phase 5 grounding, extracted from the team's own problem statement.
    Never influences a criterion's max_score -- see app/rubric/builder.py."""

    problem_domain: str
    target_beneficiary: str
    required_deliverables: list[str]
    track_constraints: list[str]
    is_generic: bool
    generic_reason: str | None = None
    solution_type: str = "unknown"
    """Broad implementation category extracted from the problem statement:
    "hardware" (physical device/prototype/circuit/sensor/mechanical system),
    "software" (app/AI/ML/algorithm/dashboard with no physical build),
    "hybrid" (both hardware and software components), or
    "unknown" (cannot be determined from the problem statement alone).
    Used by render_evaluation_context to apply the right technical-rigor
    framing so a pure hardware project is never penalised for lacking code
    or APIs, and a pure software project is never penalised for lacking
    physical apparatus or a bill of materials."""


class ReliabilityLabel(str, Enum):
    high = "HIGH"
    medium = "MEDIUM"
    review = "REVIEW"


class ProblemStatementSource(str, Enum):
    typed = "typed"
    uploaded = "uploaded"


class Submission(BaseModel):
    id: UUID
    team_id: UUID
    rubric_template_id: UUID | None = None
    problem_statement_id: UUID
    pptx_storage_path: str
    problem_statement_source: ProblemStatementSource
    problem_statement_storage_path: str | None = None
    problem_statement_text: str | None = None
    submission_context: SubmissionContext | None = None
    slide_count: int | None = None
    status: SubmissionStatus
    reliability_label: ReliabilityLabel | None = None
    manual_rank: int | None = None
    uploaded_at: datetime
    team_name: str | None = None
    problem_statement_title: str | None = None
    preliminary_score: float | None = None
    academic_benchmark: dict[str, Any] | None = None
    cost_analysis: dict[str, Any] | None = None
    deck_file_type: str = "pptx"
    is_stale: bool = False
    evaluation_version: int = 1

    @field_validator("academic_benchmark", "submission_context", "cost_analysis", mode="before")
    @classmethod
    def _parse_json_if_string(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                import json
                return json.loads(v)
            except (json.JSONDecodeError, TypeError, ValueError):
                return v
        return v


class Slide(BaseModel):
    id: UUID
    submission_id: UUID
    slide_number: int
    title: str
    raw_text: str
    shapes: list[Any]
    tables: list[Any]
    image_storage_paths: list[str]
    classified_role: SlideRole | None = None
    needs_visual_rendering: bool = False


class EvidenceItem(BaseModel):
    id: UUID
    submission_id: UUID
    slide_id: UUID
    criterion_key: str
    evidence_type: str
    observation: str
    raw_llm_output: dict[str, Any]
    created_at: datetime


class CriterionScore(BaseModel):
    id: UUID
    submission_id: UUID
    section_key: str
    criterion_key: str
    llm_score: float = Field(ge=0)
    max_score: float
    rationale: str
    created_at: datetime
    updated_at: datetime


class SectionTotal(BaseModel):
    """Read-only: computed_total is recalculated server-side by a trigger."""

    id: UUID
    submission_id: UUID
    section_key: str
    computed_total: float
    updated_at: datetime


class FinalScore(BaseModel):
    """Read-only: computed_total is recalculated server-side by a trigger."""

    id: UUID
    submission_id: UUID
    computed_total: float
    updated_at: datetime


class ConsistencyFlag(BaseModel):
    id: UUID
    submission_id: UUID
    flag_type: str
    severity: Literal["low", "medium", "high"]
    description: str
    resolved: bool
    created_at: datetime


class CalibrationRun(BaseModel):
    id: UUID
    created_at: datetime
    sample_size: int
    mean_absolute_error: float
    criterion_agreement_pct: float
    ranking_agreement_pct: float
    notes: str | None = None


class CalibrationPair(BaseModel):
    id: UUID
    calibration_run_id: UUID
    submission_id: UUID
    human_total: float
    ai_total: float
    section_scores: list[dict[str, Any]] = Field(default_factory=list)


class EvaluationResult(BaseModel):
    """API-layer composition, not a table: a submission's scores in one response."""

    submission: Submission
    criterion_scores: list[CriterionScore]
    section_totals: list[SectionTotal]
    final_score: FinalScore | None = None


class HealthStatus(BaseModel):
    status: Literal["ok", "degraded"]
    supabase: Literal["reachable", "unreachable"]
    groq: Literal["reachable", "unreachable"]
