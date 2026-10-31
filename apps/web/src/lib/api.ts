import type {
  CalibrationCandidate,
  CalibrationRun,
  CalibrationRunSummary,
  ComparisonResponse,
  DashboardRow,
  ProblemStatement,
  ProblemStatementGroup,
  RankingRow,
  RubricVersionMismatchErrorBody,
  Submission,
  SubmissionAudit,
  SubmissionEvidence,
  SubmissionSlides,
} from "@hackeval/types";

import { getAccessToken } from "./supabaseClient";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8002";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail ?? response.statusText, response.status);
  }
  return response.json() as Promise<T>;
}

export async function previewProblemStatement(
  file: File,
): Promise<{ text: string; usable: boolean }> {
  const form = new FormData();
  form.append("problem_statement", file);
  const response = await fetch(`${API_URL}/submissions/preview-problem-statement`, {
    method: "POST",
    body: form,
  });
  return parseOrThrow(response);
}

export type ProblemStatementInput = { mode: "typed"; text: string } | { mode: "file"; file: File };

/**
 * Uses XMLHttpRequest (not fetch) specifically to get real upload-progress
 * events for the pptx -- a 50MB upload can take several seconds on a slow
 * connection, and `onProgress` drives Step 2's progress bar from actual
 * bytes sent, not a fake timer.
 */
export function createSubmission(
  fields: {
    teamName: string;
    // Only set when adding a brand new problem statement -- reusing an
    // existing one (problemStatementId set) never re-sends its text/file.
    problemStatement: ProblemStatementInput | null;
    problemStatementId: string | null;
    pptx: File;
  },
  onProgress?: (fraction: number) => void,
): Promise<Submission> {
  return getAccessToken().then(
    (token) =>
      new Promise<Submission>((resolve, reject) => {
        const form = new FormData();
        form.append("team_name", fields.teamName);
        if (fields.problemStatementId) {
          form.append("problem_statement_id", fields.problemStatementId);
        } else if (fields.problemStatement?.mode === "typed") {
          form.append("problem_statement_text", fields.problemStatement.text);
        } else if (fields.problemStatement?.mode === "file") {
          form.append("problem_statement_file", fields.problemStatement.file);
        }
        form.append("pptx", fields.pptx);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/submissions/`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
        };

        xhr.onload = () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            // non-JSON response; fall through with empty body
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(body as unknown as Submission);
          } else {
            reject(
              new ApiError((body.detail as string | undefined) ?? xhr.statusText, xhr.status),
            );
          }
        };
        xhr.onerror = () => reject(new ApiError("Network error while submitting", 0));
        xhr.send(form);
      }),
  );
}

export async function getSubmission(id: string): Promise<Submission> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function listCalibrationCandidates(): Promise<CalibrationCandidate[]> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/calibration/candidates`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function listCalibrationRuns(): Promise<CalibrationRun[]> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/calibration/runs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export interface CalibrationRunSubmissionInput {
  submission_id: string;
  human_section_scores: { section_key: string; human_score: number }[];
}

export async function createCalibrationRun(
  submissions: CalibrationRunSubmissionInput[],
  notes?: string,
): Promise<CalibrationRunSummary> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/calibration/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ submissions, notes: notes ?? null }),
  });
  return parseOrThrow(response);
}

export async function getSubmissionEvidence(id: string): Promise<SubmissionEvidence> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${id}/evidence`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function getSubmissionSlides(id: string): Promise<SubmissionSlides> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${id}/slides`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function getSubmissionAudit(id: string): Promise<SubmissionAudit> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${id}/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function getDashboard(): Promise<DashboardRow[]> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

/** Public aggregate counts for the leaderboard's stat cards -- unlike
 * getDashboard(), this carries no per-team detail, so it works for general
 * (non-admin) viewers too. */
export async function getSubmissionStats(): Promise<{
  total: number;
  scored: number;
  in_progress: boolean;
}> {
  const response = await fetch(`${API_URL}/submissions/stats`);
  return parseOrThrow(response);
}

export interface LeaderboardPublishStatus {
  is_published: boolean;
  published_at: string | null;
}

export async function getLeaderboardPublishStatus(): Promise<LeaderboardPublishStatus> {
  const response = await fetch(`${API_URL}/rankings/status`);
  return parseOrThrow(response);
}

export async function setLeaderboardPublishStatus(
  published: boolean,
): Promise<LeaderboardPublishStatus> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/rankings/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ published }),
  });
  return parseOrThrow(response);
}

export async function getOverallRanking(): Promise<RankingRow[]> {
  const headers: Record<string, string> = {};
  const token = await getAccessToken().catch(() => null);
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(`${API_URL}/rankings/overall`, { headers });
  return parseOrThrow(response);
}

export async function getRankingByProblemStatement(): Promise<ProblemStatementGroup[]> {
  const headers: Record<string, string> = {};
  const token = await getAccessToken().catch(() => null);
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(`${API_URL}/rankings/by-problem-statement`, { headers });
  return parseOrThrow(response);
}

export async function listProblemStatements(): Promise<ProblemStatement[]> {
  const response = await fetch(`${API_URL}/problem-statements/`);
  return parseOrThrow(response);
}

/** Admin pin: overrides a submission's computed rank. null clears the pin. */
/** Stage 1 (cheap triage) runs automatically for every submission, but
 * Stage 2 (full per-criterion scoring) only runs for submissions an admin
 * selects -- top-N by preliminary score, plus anything flagged or manually
 * requested. Without this, a submission sits at 'analyzing' forever. */
export async function triggerStage2Selection(): Promise<{ selected_submission_ids: string[] }> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/stage2-selection`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function setManualRank(
  submissionId: string,
  manualRank: number | null,
): Promise<Submission> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${submissionId}/rank`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ manual_rank: manualRank }),
  });
  return parseOrThrow(response);
}

export class RubricMismatchError extends Error {
  constructor(public body: RubricVersionMismatchErrorBody) {
    super("rubric_version_mismatch");
  }
}

export async function getComparison(ids: string[]): Promise<ComparisonResponse> {
  const token = await getAccessToken();
  const response = await fetch(
    `${API_URL}/submissions/compare?ids=${encodeURIComponent(ids.join(","))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 422) {
    const body = await response.json().catch(() => null);
    if (body?.error === "rubric_version_mismatch") {
      throw new RubricMismatchError(body as RubricVersionMismatchErrorBody);
    }
  }
  return parseOrThrow(response);
}

export async function deleteTeam(
  teamId: string,
): Promise<{ deleted: boolean; team_id: string; team_name: string }> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/teams/${teamId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function renameTeam(
  teamId: string,
  name: string,
): Promise<{ team_id: string; team_name: string }> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/teams/${teamId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseOrThrow(response);
}

export async function deleteSubmission(
  submissionId: string,
): Promise<{ deleted: boolean; submission_id: string; team_id: string }> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${submissionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function createProblemStatement(data: {
  title: string;
  reference_text?: string;
  is_custom?: boolean;
}): Promise<ProblemStatement> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/problem-statements/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  return parseOrThrow(response);
}

export async function deleteProblemStatement(
  problemStatementId: string,
): Promise<{ deleted: boolean; problem_statement_id: string; title: string }> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/problem-statements/${problemStatementId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function generateAcademicBenchmark(submissionId: string): Promise<Submission> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${submissionId}/benchmark`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function generateCostAnalysis(submissionId: string): Promise<Submission> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${submissionId}/cost-analysis`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function reEvaluateSubmission(submissionId: string): Promise<Submission> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/${submissionId}/re-evaluate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}

export async function reevaluateAllFailedSubmissions(): Promise<{ requeued_count: number; submission_ids: string[] }> {
  const token = await getAccessToken();
  const response = await fetch(`${API_URL}/submissions/reevaluate-failed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseOrThrow(response);
}



