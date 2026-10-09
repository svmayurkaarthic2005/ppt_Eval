// Mirrors apps/api/app/models/schemas.py and supabase/migrations/. Keep all three in sync by hand.

export type SubmissionStatus =
  | "uploaded"
  | "extracting"
  | "rendering"
  | "analyzing"
  | "scored"
  | "failed";

export type SlideRole =
  | "problem"
  | "existing_solution"
  | "proposed_solution"
  | "workflow"
  | "cost"
  | "execution"
  | "timeline"
  | "other";

/** Never derived from the LLM's own self-reported confidence -- see
 * apps/api/app/calibration/reliability.py. */
export type ReliabilityLabel = "HIGH" | "MEDIUM" | "REVIEW";

export interface Team {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
}

export interface RubricTemplate {
  id: string;
  name: string;
  version: number;
  sections: Record<string, unknown>;
  created_at: string;
}

/** Phase 5 grounding, extracted from the team's own problem statement.
 * Never influences a criterion's max_score -- see apps/api/app/rubric/builder.py. */
export interface SubmissionContext {
  problem_domain: string;
  target_beneficiary: string;
  required_deliverables: string[];
  track_constraints: string[];
  is_generic: boolean;
  generic_reason: string | null;
}

export type ProblemStatementSource = "typed" | "uploaded";

export interface ProblemStatement {
  id: string;
  title: string;
  reference_text: string;
  is_custom: boolean;
  created_by_team_id: string | null;
  created_at: string;
}

export interface ScholarlyPaper {
  title: string;
  source: string;
  venue: string;
  authors: string;
  year: string;
  url: string;
  summary: string;
}

export interface AcademicBenchmark {
  papers: ScholarlyPaper[];
  existing_solutions_summary: string;
  gaps_in_existing_solutions: string;
  why_ranked_explanation: string;
  better_than_existing_aspects: string[];
  limitations_and_tradeoffs: string[];
}

export interface Submission {
  id: string;
  team_id: string;
  rubric_template_id: string | null;
  problem_statement_id: string;
  pptx_storage_path: string;
  problem_statement_source: ProblemStatementSource;
  problem_statement_storage_path: string | null;
  problem_statement_text: string | null;
  submission_context: SubmissionContext | null;
  slide_count: number | null;
  status: SubmissionStatus;
  reliability_label: ReliabilityLabel | null;
  manual_rank: number | null;
  uploaded_at: string;
  team_name?: string | null;
  problem_statement_title?: string | null;
  preliminary_score?: number | null;
  academic_benchmark?: AcademicBenchmark | null;
}

export interface Slide {
  id: string;
  submission_id: string;
  slide_number: number;
  title: string;
  raw_text: string;
  shapes: unknown[];
  tables: unknown[];
  image_storage_paths: string[];
  classified_role: SlideRole | null;
  needs_visual_rendering: boolean;
}

export interface EvidenceItem {
  id: string;
  submission_id: string;
  slide_id: string;
  criterion_key: string;
  evidence_type: string;
  observation: string;
  raw_llm_output: Record<string, unknown>;
  created_at: string;
}

export interface CriterionScore {
  id: string;
  submission_id: string;
  section_key: string;
  criterion_key: string;
  llm_score: number;
  max_score: number;
  rationale: string;
  created_at: string;
  updated_at: string;
}

/** Read-only: computed_total is recalculated server-side by a trigger. */
export interface SectionTotal {
  id: string;
  submission_id: string;
  section_key: string;
  computed_total: number;
  updated_at: string;
}

/** Read-only: computed_total is recalculated server-side by a trigger. */
export interface FinalScore {
  id: string;
  submission_id: string;
  computed_total: number;
  updated_at: string;
}

export interface ConsistencyFlag {
  id: string;
  submission_id: string;
  flag_type: string;
  severity: "low" | "medium" | "high";
  description: string;
  resolved: boolean;
  created_at: string;
}

export interface CalibrationRun {
  id: string;
  created_at: string;
  sample_size: number;
  mean_absolute_error: number;
  criterion_agreement_pct: number;
  ranking_agreement_pct: number;
  notes: string | null;
}

export interface SectionScorePair {
  section_key: string;
  ai_score: number;
  human_score: number;
}

export interface CalibrationPair {
  id: string;
  calibration_run_id: string;
  submission_id: string;
  human_total: number;
  ai_total: number;
  section_scores: SectionScorePair[];
}

/** An already-scored submission an admin can pick for a calibration run.
 * API-layer composition (joins teams/submissions/section_totals), not a table. */
export interface CalibrationCandidate {
  submission_id: string;
  team_name: string;
  final_total: number;
  section_totals: Record<string, number>;
}

export interface CalibrationRunSummary {
  id: string;
  sample_size: number;
  mean_absolute_error: number;
  criterion_agreement_pct: number;
  ranking_agreement_pct: number;
}

/** API-layer composition, not a table: a submission's scores in one response. */
export interface EvaluationResult {
  submission: Submission;
  criterion_scores: CriterionScore[];
  section_totals: SectionTotal[];
  final_score: FinalScore | null;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  supabase: "reachable" | "unreachable";
  groq: "reachable" | "unreachable";
}

/** Phase 11: reconstructed from stored rows alone, never a fresh LLM call. */
export interface EvidenceItemView {
  slide_number: number | null;
  evidence_type: string;
  observation: string;
  text_snippet: string | null;
  image_urls: string[];
}

export interface CriterionEvidenceView {
  section_key: string;
  criterion_key: string;
  llm_score: number;
  max_score: number;
  rationale: string;
  evidence: EvidenceItemView[];
  evidence_unavailable: boolean;
  needs_human_review: boolean;
  raw_llm_output_fallback: Record<string, unknown> | null;
}

export interface SubmissionEvidence {
  submission_id: string;
  criteria: CriterionEvidenceView[];
}

/** Lets a viewer see the actual deck: a signed download link for the
 * original .pptx plus a signed image per slide that got rendered. */
export interface SlideView {
  slide_number: number;
  title: string;
  classified_role: SlideRole | null;
  image_urls: string[];
}

export interface SubmissionSlides {
  submission_id: string;
  pptx_download_url: string | null;
  slides: SlideView[];
}

export interface StatusTransition {
  status: SubmissionStatus;
  changed_at: string;
}

export interface SubmissionAudit {
  submission_id: string;
  status_history: StatusTransition[];
  consistency_flags: {
    flag_type: string;
    severity: string;
    description: string;
    resolved: boolean;
    created_at: string;
  }[];
  /** Stage 2's per-criterion progress; null until a rubric_template is
   * resolved (i.e. before Stage 2 scoring has anything to count). */
  criteria_scored: number | null;
  criteria_total: number | null;
}

/** Phase 14: /dashboard's full data set in one call -- read straight from
 * final_scores/section_totals/the reliability label, never recomputed. */
export interface DashboardRow {
  submission_id: string;
  team_name: string;
  status: SubmissionStatus;
  total: number | null;
  max_total: number;
  section_totals: Record<string, number>;
  reliability_label: ReliabilityLabel | null;
  flag_count: number;
  flag_types: string[];
  score_source: "stage1" | "stage2" | null;
  stage2_selected?: boolean;
}

/** Phase 15: GET /submissions/compare response -- exact contract the
 * /compare frontend is built against. */
export interface CriterionComparisonRow {
  criterion_key: string;
  section: string;
  score: number;
  max_score: number;
  rationale: string;
}

export interface SubmissionComparison {
  submission_id: string;
  team_name: string;
  reliability: ReliabilityLabel | null;
  flag_count: number;
  section_totals: Record<string, number>;
  final_total: number;
  criteria: CriterionComparisonRow[];
}

export interface ComparisonResponse {
  rubric_template_id: string;
  sections: string[];
  submissions: SubmissionComparison[];
}

export interface RubricVersionMismatchDetail {
  submission_id: string;
  rubric_template_id: string;
}

export interface RubricVersionMismatchErrorBody {
  error: "rubric_version_mismatch";
  details: RubricVersionMismatchDetail[];
}

/** Phase 16: GET /rankings/overall and the per-group rows inside
 * GET /rankings/by-problem-statement -- same shape as DashboardRow plus
 * `rank`, restricted to fully `scored` submissions. `rank` is always
 * computed by its own ORDER BY/ROW_NUMBER() query server-side, never
 * derived from the other ranking's list. */
export interface RankingRow {
  rank: number;
  submission_id: string;
  team_id: string;
  team_name: string;
  total: number;
  max_total: number;
  section_totals: Record<string, number>;
  reliability_label: ReliabilityLabel | null;
  flag_count: number;
  flag_types: string[];
  manual_rank: number | null;
}

export interface ProblemStatementGroup {
  problem_statement_id: string;
  title: string;
  submission_count: number;
  submissions: RankingRow[];
}
