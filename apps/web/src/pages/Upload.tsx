import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import Dropzone from "../components/Dropzone";
import { useConfirm } from "../components/ConfirmDialog";
import {
  ApiError,
  createSubmission,
  deleteProblemStatement,
  getSubmission,
  getSubmissionAudit,
  listProblemStatements,
  previewProblemStatement,
} from "../lib/api";
import type { ProblemStatementInput } from "../lib/api";
import { estimateRemaining } from "../lib/timing";
import { useAdminAuth } from "../lib/useAdminAuth";
import type { ProblemStatement, Submission, SubmissionAudit, SubmissionStatus } from "@hackeval/types";

const PS_EXTENSIONS = ["pdf", "docx", "txt"];
const MAX_PS_BYTES = 10 * 1024 * 1024;
const MAX_PPTX_BYTES = 50 * 1024 * 1024;

const STATUS_STEPS: SubmissionStatus[] = [
  "uploaded",
  "extracting",
  "rendering",
  "analyzing",
  "scored",
];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Evaluation stage metadata ────────────────────────────────────────────────
const STAGE_META: Record<string, { label: string; icon: string; hint: string }> = {
  uploaded:   { label: "Uploaded",          icon: "📤", hint: "Deck received" },
  extracting: { label: "Extracting text",   icon: "📝", hint: "Reading slides" },
  rendering:  { label: "Rendering slides",  icon: "🖼️",  hint: "Generating images" },
  analyzing:  { label: "AI Evaluation",     icon: "🧠", hint: "Scoring criteria" },
  scored:     { label: "Complete",          icon: "✅", hint: "All done" },
};

const ANALYSIS_MESSAGES = [
  "Reading your problem statement…",
  "Extracting key claims from slides…",
  "Benchmarking against published research…",
  "Evaluating technical feasibility…",
  "Scoring innovation & impact…",
  "Assessing financial feasibility…",
  "Checking implementation plan…",
  "Verifying cross-modal consistency…",
  "Finalising evaluation scores…",
];

function EvaluationTracker({
  submission,
  audit,
}: {
  submission: import("@hackeval/types").Submission;
  audit: import("@hackeval/types").SubmissionAudit | null;
}) {
  const statusIndex = STATUS_STEPS.indexOf(submission.status as import("@hackeval/types").SubmissionStatus);
  const isAnalyzing = submission.status === "analyzing";
  const isScored    = submission.status === "scored";
  const isFailed    = submission.status === "failed";

  // Rotating analysis messages
  const [msgIdx, setMsgIdx] = useState(0);
  const msgRef = useRef(0);
  useEffect(() => {
    if (!isAnalyzing) return;
    const id = setInterval(() => {
      msgRef.current = (msgRef.current + 1) % ANALYSIS_MESSAGES.length;
      setMsgIdx(msgRef.current);
    }, 2800);
    return () => clearInterval(id);
  }, [isAnalyzing]);

  const criteria_scored = audit?.criteria_scored ?? null;
  const criteria_total  = audit?.criteria_total  ?? null;
  const pct = criteria_scored !== null && criteria_total ? Math.round((criteria_scored / criteria_total) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-5 py-2 w-full animate-slide-up">

      {/* ── Central visual ───────────────────────────────── */}
      <div className="relative flex items-center justify-center" style={{ width: 104, height: 104 }}>
        {/* Outer slow ring */}
        {isAnalyzing && (
          <>
            <div
              className="absolute inset-0 rounded-full border-2 border-transparent animate-spin-slow"
              style={{ borderTopColor: "#6366f1", borderRightColor: "#a78bfa" }}
            />
            {/* Inner reverse ring */}
            <div
              className="absolute rounded-full border-2 border-transparent animate-spin-reverse"
              style={{ inset: 8, borderBottomColor: "#06b6d4", borderLeftColor: "#8b5cf6" }}
            />
          </>
        )}

        {/* Icon circle */}
        <div
          className={`relative z-10 flex h-16 w-16 items-center justify-center rounded-full text-2xl transition-all duration-500 ${
            isScored
              ? "bg-emerald-100 shadow-lg shadow-emerald-200"
              : isFailed
              ? "bg-red-100 shadow-lg shadow-red-200"
              : "bg-indigo-50 shadow-lg shadow-indigo-100"
          } ${
            isAnalyzing ? "animate-ping-soft" : ""
          }`}
        >
          {isScored ? "🎉" : isFailed ? "❌" : isAnalyzing ? "🧠" : "⚙️"}
        </div>
      </div>

      {/* ── Headline ─────────────────────────────────────── */}
      {isScored ? (
        <div className="text-center animate-slide-up">
          <p className="text-lg font-bold text-emerald-700">Evaluation Complete!</p>
          <p className="mt-0.5 text-xs text-slate-500">Your deck has been fully scored.</p>
        </div>
      ) : isFailed ? (
        <div className="text-center">
          <p className="text-base font-bold text-red-600">Submission Failed</p>
          <p className="mt-1 text-sm text-red-500">Check your problem statement and try again.</p>
        </div>
      ) : (
        <div className="text-center">
          <p className="shimmer-text text-base font-bold" key={msgIdx}>
            {ANALYSIS_MESSAGES[msgIdx]}
          </p>
          {isAnalyzing && (
            <div className="mt-1.5 flex justify-center gap-1">
              <span className="dot-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
              <span className="dot-2 inline-block h-1.5 w-1.5 rounded-full bg-violet-400" />
              <span className="dot-3 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
            </div>
          )}
        </div>
      )}

      {/* ── Criteria progress bar (only during analyzing) ── */}
      {isAnalyzing && criteria_total !== null && (
        <div className="w-full animate-slide-up">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold">
            <span className="text-slate-500">Criteria evaluated</span>
            <span className="text-indigo-600">{criteria_scored ?? 0} / {criteria_total}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full flow-bar transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          {audit && estimateRemaining(audit) && (
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              ~{estimateRemaining(audit)} remaining
            </p>
          )}
        </div>
      )}

      {/* ── Pipeline steps ───────────────────────────────── */}
      {!isFailed && (
        <div className="w-full rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Pipeline</p>
          <ol className="flex flex-col gap-0">
            {STATUS_STEPS.map((s, i) => {
              const reached  = statusIndex >= i;
              const isActive = statusIndex === i && !isScored;
              return (
                <li key={s} className="flex items-center gap-3 py-1.5">
                  {/* Step dot */}
                  <span
                    className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-500 ${
                      isActive
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                        : reached
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-200 text-slate-400"
                    }`}
                  >
                    {isActive ? (
                      // Pulsing glow ring on active step
                      <>
                        <span className="absolute inset-0 rounded-full bg-indigo-400 opacity-40 animate-ping" />
                        <span className="relative">{i + 1}</span>
                      </>
                    ) : reached ? (
                      "✓"
                    ) : (
                      i + 1
                    )}
                  </span>

                  {/* Connector line */}
                  <span
                    className={`text-sm transition-all duration-500 ${
                      isActive
                        ? "font-semibold text-indigo-700"
                        : reached
                        ? "font-medium text-emerald-700"
                        : "text-slate-400"
                    }`}
                  >
                    {STAGE_META[s]?.icon} {STAGE_META[s]?.label}
                  </span>

                  {isActive && (
                    <span className="ml-auto text-[10px] text-indigo-400 italic">
                      {STAGE_META[s]?.hint}…
                    </span>
                  )}
                  {reached && !isActive && (
                    <span className="ml-auto text-[10px] text-emerald-500">done</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* ── High-severity flag warning ────────────────────── */}
      {audit?.consistency_flags.some((f) => !f.resolved && f.severity === "high") && (
        <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800 animate-slide-up">
          <p className="font-semibold">⚠️ A pipeline step needs attention</p>
          <p className="mt-1 text-[11px] leading-relaxed">
            {audit.consistency_flags.find((f) => !f.resolved && f.severity === "high")?.description}
          </p>
        </div>
      )}

      {/* ── CTA buttons ──────────────────────────────────── */}
      <div className="flex flex-col gap-2 w-full mt-1">
        <Link
          to={`/team/${submission.id}`}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white text-center transition-all hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-200"
        >
          {isScored ? "🎯 View Full Evaluation →" : "View Live Progress →"}
        </Link>
        <Link
          to="/"
          className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition py-1 text-center"
        >
          ← Back to Leaderboard
        </Link>
      </div>
    </div>
  );
}

function ProgressSteps({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {[1, 2, 3].map((s) => (
        <div key={s} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full bg-indigo-600 transition-all duration-500 ${
              step > s ? "w-full" : step === s ? "w-full animate-pulse" : "w-0"
            }`}
          />
        </div>
      ))}
    </div>
  );
}

export default function Upload() {
  const { isAdmin, loading: authLoading } = useAdminAuth();
  const confirm = useConfirm();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [teamName, setTeamName] = useState("");

  const [psMode, setPsMode] = useState<"typed" | "file">("typed");
  const [typedText, setTypedText] = useState("");
  const [psFile, setPsFile] = useState<File | null>(null);
  const [psFileError, setPsFileError] = useState<string | null>(null);
  const [psPreview, setPsPreview] = useState<{ text: string; usable: boolean } | null>(null);
  const [psPreviewLoading, setPsPreviewLoading] = useState(false);

  const [problemStatements, setProblemStatements] = useState<ProblemStatement[]>([]);
  const [psSearch, setPsSearch] = useState("");
  const [selectedPsId, setSelectedPsId] = useState<string | null>(null);
  const [psChoiceMade, setPsChoiceMade] = useState(false);

  const [pptxFile, setPptxFile] = useState<File | null>(null);
  const [pptxFileError, setPptxFileError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [uploadFraction, setUploadFraction] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [audit, setAudit] = useState<SubmissionAudit | null>(null);

  function handlePsFileSelected(file: File) {
    setPsFile(file);
    setPsPreview(null);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!PS_EXTENSIONS.includes(extension)) {
      setPsFileError("Must be a .pdf, .docx, or .txt file.");
      return;
    }
    if (file.size > MAX_PS_BYTES) {
      setPsFileError("Must be under 10MB.");
      return;
    }
    setPsFileError(null);
    setPsPreviewLoading(true);
    previewProblemStatement(file)
      .then(setPsPreview)
      .catch((err) =>
        setPsFileError(err instanceof ApiError ? err.message : "Could not read this file."),
      )
      .finally(() => setPsPreviewLoading(false));
  }

  function handlePptxSelected(file: File) {
    setPptxFile(file);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (extension !== "pptx" && extension !== "pdf") {
      setPptxFileError("Must be a .pptx or .pdf file.");
      return;
    }
    if (file.size > MAX_PPTX_BYTES) {
      setPptxFileError("Must be under 50MB.");
      return;
    }
    setPptxFileError(null);
  }

  async function handleDeletePs(ps: ProblemStatement) {
    const ok = await confirm(
      `Delete problem statement "${ps.title}"?\n\nAny submissions evaluating against this problem statement will also be deleted.`,
    );
    if (!ok) return;
    try {
      await deleteProblemStatement(ps.id);
      setProblemStatements((prev) => prev.filter((p) => p.id !== ps.id));
      if (selectedPsId === ps.id) {
        setSelectedPsId(null);
        setPsChoiceMade(false);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete problem statement");
    }
  }

  const typedWords = wordCount(typedText);
  const addingNewPs = psChoiceMade && selectedPsId === null;
  const psSatisfied =
    psMode === "typed"
      ? typedText.trim().length > 0
      : psFile !== null && !psFileError && psPreview?.usable === true;

  const step1Reason = !teamName.trim() ? "Enter your team name." : null;

  const step2Reason = !psChoiceMade
    ? "Pick your problem statement from the list, or add it as a new one."
    : addingNewPs && !psSatisfied
      ? psMode === "typed"
        ? "Write your problem statement."
        : "Upload a readable problem statement file."
      : null;

  const pptxSatisfied = pptxFile !== null && !pptxFileError;
  const submitReason = !pptxSatisfied
    ? pptxFileError ?? "Upload your slide deck (.pptx or .pdf)."
    : null;

  useEffect(() => {
    listProblemStatements()
      .then(setProblemStatements)
      .catch(() => setProblemStatements([]));
  }, []);

  const filteredProblemStatements = useMemo(() => {
    const q = psSearch.trim().toLowerCase();
    if (!q) return problemStatements;
    return problemStatements.filter((ps) => ps.title.toLowerCase().includes(q));
  }, [problemStatements, psSearch]);

  async function handleSubmit() {
    if (!pptxFile) return;
    const problemStatement: ProblemStatementInput | null = addingNewPs
      ? psMode === "typed"
        ? { mode: "typed", text: typedText }
        : { mode: "file", file: psFile! }
      : null;

    setSubmitting(true);
    setSubmitError(null);
    setUploadFraction(0);
    try {
      const created = await createSubmission(
        { teamName, problemStatement, problemStatementId: selectedPsId, pptx: pptxFile },
        setUploadFraction,
      );
      setSubmission(created);
      setStep(4);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not create submission.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!submission || submission.status === "scored" || submission.status === "failed") return;
    let active = true;
    const subId = submission.id;
    const interval = setInterval(async () => {
      const latest = await getSubmission(subId).catch(() => null);
      if (!active || !latest) return;
      setSubmission(latest);
      const latestAudit = await getSubmissionAudit(subId).catch(() => null);
      if (active && latestAudit) setAudit(latestAudit);
    }, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [submission?.id, submission?.status]);

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/login" replace />;

  return (
    <main className="flex flex-col items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-[640px]">
        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200/70 mb-2">
            Environmental & Chemical Engineering Hackathon
          </span>
          <h1 className="text-2xl font-bold text-slate-900">
            Submit your pitch deck
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            AI-powered evaluation of sustainable processes, materials, recycling, and chemical solutions
          </p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-xl shadow-slate-200/60">
          <ProgressSteps step={step} />

          {step === 1 && (
            <div className="flex flex-col gap-6">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Team name
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/30 transition focus:border-indigo-500 focus:ring-4"
                  placeholder="Team Nebula"
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium text-slate-700">Problem statement</p>
                <p className="mt-1 text-xs text-slate-400">
                  This is the grouping key for ranking -- pick the official problem statement your
                  team is tackling, or add it if it isn't listed yet.
                </p>
              </div>

              <input
                value={psSearch}
                onChange={(e) => setPsSearch(e.target.value)}
                placeholder="Search problem statements..."
                className="rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/30 transition focus:border-indigo-500 focus:ring-4"
              />

              <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {filteredProblemStatements.length === 0 && (
                  <p className="px-2 py-3 text-center text-sm text-slate-400">
                    {problemStatements.length === 0 ? "No problem statements yet." : "No matches."}
                  </p>
                )}
                {filteredProblemStatements.map((ps) => {
                  const isSelected = psChoiceMade && selectedPsId === ps.id;
                  return (
                    <div
                      key={ps.id}
                      className={`group flex items-center justify-between rounded-lg transition ${
                        isSelected
                          ? "bg-indigo-600 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPsId(ps.id);
                          setPsChoiceMade(true);
                        }}
                        className="min-w-0 flex-1 break-words px-3 py-2 text-left text-sm"
                      >
                        {ps.title}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePs(ps);
                        }}
                        title="Delete problem statement"
                        className={`mr-1.5 flex h-7 w-7 items-center justify-center rounded-md transition ${
                          isSelected
                            ? "text-indigo-200 hover:bg-indigo-700 hover:text-white"
                            : "text-slate-400 opacity-60 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        }`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedPsId(null);
                  setPsChoiceMade(true);
                }}
                className={`rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition ${
                  addingNewPs
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                This isn't listed -- add it
              </button>

              {addingNewPs && (
                <div className="border-t border-slate-100 pt-4">
                  <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1">
                    {(["typed", "file"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPsMode(mode)}
                        className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                          psMode === mode
                            ? "bg-white text-indigo-700 shadow-sm"
                            : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {mode === "typed" ? "Type it" : "Upload a file"}
                      </button>
                    ))}
                  </div>

                  {psMode === "typed" ? (
                    <div>
                      <textarea
                        value={typedText}
                        onChange={(e) => setTypedText(e.target.value)}
                        placeholder="Describe the problem you're solving, who it affects, why existing solutions fall short, and what your solution does differently. A good problem statement names a specific affected group and a concrete pain point."
                        className="min-h-[200px] w-full rounded-lg border border-slate-300 px-3.5 py-3 text-sm leading-relaxed text-slate-900 outline-none ring-indigo-500/30 transition focus:border-indigo-500 focus:ring-4"
                      />
                      <p
                        className={`mt-1.5 text-xs transition-colors ${
                          typedWords > 0 ? "font-medium text-emerald-600" : "text-slate-400"
                        }`}
                      >
                        {typedWords} words
                      </p>
                    </div>
                  ) : (
                    <Dropzone
                      accept={PS_EXTENSIONS}
                      file={psFile}
                      onFileSelected={handlePsFileSelected}
                      onRemove={() => {
                        setPsFile(null);
                        setPsFileError(null);
                        setPsPreview(null);
                      }}
                      error={psFileError}
                      hint=".pdf, .docx, or .txt · up to 10MB"
                    />
                  )}

                  {psMode === "typed" && typedWords > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                        Preview
                      </p>
                      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-slate-600">
                        {typedText}
                      </p>
                    </div>
                  )}

                  {psMode === "file" && psPreviewLoading && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
                      Reading document...
                    </div>
                  )}

                  {psMode === "file" && psPreview && !psPreviewLoading && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                        Extracted preview
                      </p>
                      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-slate-600">
                        {psPreview.text.slice(0, 1000)}
                        {psPreview.text.length > 1000 && "..."}
                      </p>
                      {!psPreview.usable && (
                        <p className="mt-2 text-sm text-red-600">
                          This didn't yield enough readable text. Check it's the right file.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium text-slate-700">Slide deck</p>
              <Dropzone
                accept={["pptx", "pdf"]}
                file={pptxFile}
                onFileSelected={handlePptxSelected}
                onRemove={() => {
                  setPptxFile(null);
                  setPptxFileError(null);
                }}
                error={pptxFileError}
                hint=".pptx or .pdf · up to 50MB"
              />

              {pptxFile && !pptxFileError && (
                <p className="text-xs text-slate-400">{formatBytes(pptxFile.size)}</p>
              )}

              {submitting && (
                <div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-indigo-600 transition-all"
                      style={{ width: `${Math.round(uploadFraction * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Uploading... {Math.round(uploadFraction * 100)}%
                  </p>
                </div>
              )}

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}
            </div>
          )}

          {step === 4 && submission && (
            <EvaluationTracker submission={submission} audit={audit} />
          )}


          {step < 4 && (
            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((step - 1) as 1 | 2 | 3)}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Back
                </button>
              ) : (
                <span />
              )}

              <div className="flex flex-col items-end gap-1">
                {step === 1 && step1Reason && (
                  <p className="text-xs text-slate-400">{step1Reason}</p>
                )}
                {step === 2 && step2Reason && (
                  <p className="text-xs text-slate-400">{step2Reason}</p>
                )}
                {step === 3 && submitReason && (
                  <p className="text-xs text-slate-400">{submitReason}</p>
                )}
                <button
                  type="button"
                  title={
                    step === 1
                      ? step1Reason ?? undefined
                      : step === 2
                        ? step2Reason ?? undefined
                        : submitReason ?? undefined
                  }
                  disabled={
                    step === 1
                      ? !!step1Reason
                      : step === 2
                        ? !!step2Reason
                        : !!submitReason || submitting
                  }
                  onClick={() => (step < 3 ? setStep((step + 1) as 2 | 3) : handleSubmit())}
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {step < 3 ? "Continue" : submitting ? "Submitting..." : "Submit"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
