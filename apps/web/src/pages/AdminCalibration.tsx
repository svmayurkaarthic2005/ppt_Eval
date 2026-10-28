import type { CalibrationCandidate, CalibrationRun, CalibrationRunSummary } from "@hackeval/types";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import {
  ApiError,
  createCalibrationRun,
  listCalibrationCandidates,
  listCalibrationRuns,
} from "../lib/api";
import { useAdminAuth } from "../lib/useAdminAuth";

const SECTION_DISPLAY_NAMES: Record<string, string> = {
  problem_understanding: "Problem Understanding",
  existing_solutions: "Existing Solutions",
  proposed_solution_affordability: "Proposed Solution",
  execution_plan_timeline: "Execution & Timeline",
  problem_understanding_and_depth: "Problem Understanding",
  existing_solutions_and_novelty: "Existing Solutions",
  proposed_solution_and_feasibility: "Proposed Solution",
  execution_and_timeline: "Execution & Timeline",
};

function formatSectionTitle(key: string): string {
  if (SECTION_DISPLAY_NAMES[key]) return SECTION_DISPLAY_NAMES[key];
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function AdminCalibration() {
  const { isAdmin, loading: authLoading } = useAdminAuth();
  const [candidates, setCandidates] = useState<CalibrationCandidate[]>([]);
  const [runs, setRuns] = useState<CalibrationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [humanScores, setHumanScores] = useState<Record<string, Record<string, string>>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationRunSummary | null>(null);

  useEffect(() => {
    Promise.all([listCalibrationCandidates(), listCalibrationRuns()])
      .then(([c, r]) => {
        setCandidates(c);
        setRuns(r);
        // Automatically select all candidates by default if there are any
        if (c.length > 0) {
          setSelected(new Set(c.map((item) => item.submission_id)));
        }
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load calibration data."))
      .finally(() => setLoading(false));
  }, []);

  const sectionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of candidates) {
      for (const key of Object.keys(c.section_totals)) keys.add(key);
    }
    return Array.from(keys).sort();
  }, [candidates]);

  function toggleSelected(submissionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(submissionId)) {
        next.delete(submissionId);
      } else {
        next.add(submissionId);
      }
      return next;
    });
  }

  function handleSelectAll() {
    if (selected.size === candidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(candidates.map((c) => c.submission_id)));
    }
  }

  function handlePrefillAiScores() {
    const prefilled: Record<string, Record<string, string>> = {};
    for (const c of candidates) {
      if (selected.has(c.submission_id)) {
        prefilled[c.submission_id] = {};
        for (const key of sectionKeys) {
          const aiVal = c.section_totals[key];
          prefilled[c.submission_id][key] = aiVal !== undefined ? String(aiVal) : "8.0";
        }
      }
    }
    setHumanScores((prev) => ({ ...prev, ...prefilled }));
  }

  function handleClearScores() {
    setHumanScores({});
  }

  function setHumanScore(submissionId: string, sectionKey: string, value: string) {
    setHumanScores((prev) => ({
      ...prev,
      [submissionId]: { ...prev[submissionId], [sectionKey]: value },
    }));
  }

  const selectedCandidates = candidates.filter((c) => selected.has(c.submission_id));

  const canSubmit =
    selectedCandidates.length >= 1 &&
    selectedCandidates.every((c) =>
      sectionKeys.every((key) => {
        const raw = humanScores[c.submission_id]?.[key];
        return raw !== undefined && raw.trim() !== "" && !Number.isNaN(Number(raw));
      }),
    );

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const summary = await createCalibrationRun(
        selectedCandidates.map((c) => ({
          submission_id: c.submission_id,
          human_section_scores: sectionKeys.map((key) => ({
            section_key: key,
            human_score: Number(humanScores[c.submission_id]?.[key]),
          })),
        })),
        notes || undefined,
      );
      setResult(summary);
      const updatedRuns = await listCalibrationRuns();
      setRuns(updatedRuns);
      setNotes("");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not create calibration run.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <p className="text-sm font-medium text-slate-600">Loading scored candidates...</p>
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-57px)] w-full max-w-[1440px] flex-col gap-8 px-4 sm:px-6 lg:px-8 py-8 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Judge Calibration Studio
            </h1>
            <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
              Human-in-the-Loop
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Compare human evaluation against AI scoring across completed presentations to calibrate model reliability.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
          >
            &larr; Back to Standings
          </Link>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {/* Candidates Evaluation Panel */}
      {candidates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-900">No scored submissions yet</h3>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Upload and score presentation decks first. Once a submission completes evaluation, it will appear here for judge calibration.
          </p>
          <Link
            to="/upload"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            Upload a submission
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Action & Stats Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSelectAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={selected.size === candidates.length && candidates.length > 0}
                  className="rounded border-slate-300 text-indigo-600 pointer-events-none"
                />
                {selected.size === candidates.length ? "Deselect All" : "Select All"}
              </button>

              <button
                type="button"
                onClick={handlePrefillAiScores}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                title="Prefill all section inputs with AI scores as a starting baseline"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Prefill AI Baseline
              </button>

              <button
                type="button"
                onClick={handleClearScores}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Clear Inputs
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 font-semibold">
                {selectedCandidates.length} of {candidates.length} Selected
              </span>
            </div>
          </div>

          {/* Candidates Matrix Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="w-12 px-4 py-3.5 text-center">Select</th>
                    <th className="px-4 py-3.5">Team & Presentation</th>
                    <th className="px-4 py-3.5 text-center">AI Total</th>
                    <th className="px-4 py-3.5 text-center">Human Total</th>
                    {sectionKeys.map((key) => (
                      <th key={key} className="px-4 py-3.5 min-w-[140px]">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-700">{formatSectionTitle(key)}</span>
                          <span className="text-[10px] font-normal text-slate-400">max 10 pts</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {candidates.map((c) => {
                    const isSelected = selected.has(c.submission_id);
                    
                    // Compute live human total
                    let humanTotal: number | null = 0;
                    for (const key of sectionKeys) {
                      const val = humanScores[c.submission_id]?.[key];
                      if (val === undefined || val === "" || Number.isNaN(Number(val))) {
                        humanTotal = null;
                        break;
                      }
                      humanTotal += Number(val);
                    }

                    return (
                      <tr
                        key={c.submission_id}
                        className={`transition hover:bg-slate-50/80 ${
                          isSelected ? "bg-indigo-50/20" : "opacity-60"
                        }`}
                      >
                        <td className="px-4 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(c.submission_id)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900">{c.team_name}</span>
                            <span className="font-mono text-[11px] text-slate-400">
                              {c.submission_id.slice(0, 8)}...
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                            {c.final_total.toFixed(1)} / 40
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          {humanTotal !== null ? (
                            <span className="inline-flex items-center rounded-md bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-800">
                              {humanTotal.toFixed(1)} / 40
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 font-mono">--</span>
                          )}
                        </td>
                        {sectionKeys.map((key) => {
                          const aiVal = c.section_totals[key];
                          const humanValStr = humanScores[c.submission_id]?.[key] ?? "";
                          const humanVal = humanValStr !== "" ? Number(humanValStr) : null;
                          const delta = humanVal !== null && aiVal !== undefined ? humanVal - aiVal : null;

                          return (
                            <td key={key} className="px-4 py-4">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min="0"
                                    max="10"
                                    step="0.1"
                                    placeholder={aiVal !== undefined ? String(aiVal) : "0.0"}
                                    disabled={!isSelected}
                                    className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                                    value={humanValStr}
                                    onChange={(e) => setHumanScore(c.submission_id, key, e.target.value)}
                                  />
                                  {delta !== null && (
                                    <span
                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                        Math.abs(delta) < 0.3
                                          ? "bg-slate-100 text-slate-600"
                                          : delta > 0
                                          ? "bg-emerald-100 text-emerald-800"
                                          : "bg-amber-100 text-amber-800"
                                      }`}
                                    >
                                      {delta > 0 ? `+${delta.toFixed(1)}` : delta < 0 ? delta.toFixed(1) : "="}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-slate-400">
                                  AI: <span className="font-semibold text-slate-600">{aiVal !== undefined ? aiVal.toFixed(1) : "-"}</span>
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Submission and Parameters Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Calibration Run Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Judge Panel Round 1 baseline calibration"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                {submitError && (
                  <p className="text-xs font-medium text-red-600">{submitError}</p>
                )}
                <button
                  type="button"
                  disabled={!canSubmit || submitting}
                  onClick={handleSubmit}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Computing Calibration...
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Execute Calibration Run ({selectedCandidates.length})
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Latest Run Results Banner */}
      {result && (
        <div className="overflow-hidden rounded-xl border border-indigo-200 bg-indigo-50/40 p-6">
          <div className="flex items-center gap-2 text-indigo-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold">
              ✓
            </span>
            <h3 className="text-lg font-bold text-slate-900">Calibration Run Completed Successfully</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Statistical correlation and mean absolute error have been recalculated and stored.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-xs font-medium text-slate-500">Sample Size</span>
              <p className="mt-1 text-2xl font-bold text-slate-900">{result.sample_size}</p>
              <span className="text-[11px] text-slate-400">Submissions analyzed</span>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-xs font-medium text-slate-500">Mean Absolute Error (MAE)</span>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {result.mean_absolute_error.toFixed(2)}
              </p>
              <span className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded ${
                result.mean_absolute_error <= 1.5
                  ? "bg-emerald-100 text-emerald-800"
                  : result.mean_absolute_error <= 3.0
                  ? "bg-blue-100 text-blue-800"
                  : "bg-amber-100 text-amber-800"
              }`}>
                {result.mean_absolute_error <= 1.5
                  ? "Exceptional Alignment"
                  : result.mean_absolute_error <= 3.0
                  ? "Good Precision"
                  : "Moderate Deviation"}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-xs font-medium text-slate-500">Section Agreement</span>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {result.criterion_agreement_pct.toFixed(1)}%
              </p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, result.criterion_agreement_pct)}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <span className="text-xs font-medium text-slate-500">Rank Correlation (Spearman ρ)</span>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {result.ranking_agreement_pct.toFixed(3)}
              </p>
              <span className="inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                {result.ranking_agreement_pct >= 0.8
                  ? "Strong Order Agreement"
                  : result.ranking_agreement_pct >= 0.5
                  ? "Positive Trend"
                  : "Variance in Standings"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Historical Calibration Runs */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Calibration Run History</h2>
            <p className="text-xs text-slate-500">Track of model adjustments and alignment runs over time.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {runs.length} {runs.length === 1 ? "run" : "runs"} recorded
          </span>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            No calibration runs recorded yet. Perform your first run above to establish benchmark metrics.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-4">Timestamp</th>
                  <th className="py-3 pr-4 text-center">Sample Size</th>
                  <th className="py-3 pr-4 text-center">MAE</th>
                  <th className="py-3 pr-4 text-center">Agreement %</th>
                  <th className="py-3 pr-4 text-center">Rank Corr. (ρ)</th>
                  <th className="py-3 pr-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="py-3 pr-4 text-xs font-medium text-slate-700">
                      {new Date(r.created_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-3 pr-4 text-center">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {r.sample_size}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-center font-mono font-medium text-slate-800">
                      {r.mean_absolute_error.toFixed(2)}
                    </td>
                    <td className="py-3 pr-4 text-center">
                      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        {r.criterion_agreement_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-center font-mono font-semibold text-purple-700">
                      {r.ranking_agreement_pct.toFixed(3)}
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-500 italic max-w-xs truncate">
                      {r.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
