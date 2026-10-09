import type { SubmissionAudit } from "@hackeval/types";

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** When Stage 2 (full scoring) started -- the earliest time this submission
 * entered 'analyzing', which is also when per-criterion scoring begins. */
export function analyzingStartedAt(audit: SubmissionAudit | null): string | null {
  return audit?.status_history.find((t) => t.status === "analyzing")?.changed_at ?? null;
}

/** Self-calibrating ETA: provides a realistic time estimate based on criteria remaining.
 * Automatically handles the 0-scored initial state, parses UTC/ISO dates safely,
 * and clamps per-criterion time to realistic bounds (1.5s - 6s) so idle pauses or
 * date skew never produce inflated hours. */
export function estimateRemaining(audit: SubmissionAudit | null): string | null {
  if (!audit) return null;
  const { criteria_scored, criteria_total } = audit;
  if (criteria_total === null || criteria_total <= 0) return null;
  const scored = criteria_scored ?? 0;
  if (scored >= criteria_total) return null;

  const remaining = criteria_total - scored;
  const startedAt = analyzingStartedAt(audit);

  // Default baseline ~2.5s per criterion on Groq LLM
  let perCriterionMs = 2500;

  if (startedAt && scored > 0) {
    const startTime = new Date(startedAt).getTime();
    if (!isNaN(startTime)) {
      const elapsedMs = Math.max(0, Date.now() - startTime);
      const measured = elapsedMs / scored;
      // Clamp to realistic range (1s - 7s) to prevent idle wait or date-skew inflation
      if (measured >= 1000 && measured <= 7000) {
        perCriterionMs = measured;
      } else if (measured > 7000) {
        perCriterionMs = 3000;
      }
    }
  }

  return formatDuration(perCriterionMs * remaining);
}

