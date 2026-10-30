import type {
  AcademicBenchmark,
  CostAnalysis,
  CriterionEvidenceView,
  SlideView,
  Submission,
  SubmissionAudit,
  SubmissionEvidence,
  SubmissionSlides,
} from "@hackeval/types";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  deleteTeam,
  generateAcademicBenchmark,
  generateCostAnalysis,
  getSubmission,
  getSubmissionAudit,
  getSubmissionEvidence,
  getSubmissionSlides,
  reEvaluateSubmission,
  renameTeam,
} from "../lib/api";
import { truncateAtWord } from "../lib/text";
import { estimateRemaining } from "../lib/timing";
import { useAdminAuth } from "../lib/useAdminAuth";

const TERMINAL_STATUSES = new Set(["scored", "failed"]);

/** A submission is fully done (no active background job) only when it has
 * reached a terminal status AND the stale flag is clear.  A scored+stale
 * submission has a running stage2 re-score job we still need to track. */
function isFullySettled(s: { status: string; is_stale?: boolean } | null | undefined): boolean {
  if (!s) return false;
  return TERMINAL_STATUSES.has(s.status) && !s.is_stale;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-700",
  extracting: "bg-sky-100 text-sky-700",
  rendering: "bg-sky-100 text-sky-700",
  analyzing: "bg-amber-100 text-amber-800",
  scored: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-700",
};

const RELIABILITY_COLORS: Record<string, string> = {
  HIGH: "bg-green-100 text-green-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  REVIEW: "bg-red-100 text-red-800",
};

function EvidencePanel({ criterion }: { criterion: CriterionEvidenceView }) {
  if (criterion.evidence_unavailable && criterion.needs_human_review) {
    // Scoring itself failed after retrying -- a real problem, not just a
    // criterion the model didn't tie to one specific slide.
    return (
      <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <p className="font-medium">Auto-scoring failed for this criterion -- needs human review.</p>
        {criterion.raw_llm_output_fallback && (
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-xs text-amber-700">
            {JSON.stringify(criterion.raw_llm_output_fallback, null, 2)}
          </pre>
        )}
      </div>
    );
  }
  if (criterion.evidence_unavailable) {
    // Scored fine; the model just didn't cite a specific slide (common for
    // holistic criteria) -- the rationale above already explains the score.
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs italic text-slate-400">
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        No specific slide evidence cited — holistic criterion.
      </p>
    );
  }

  const evidenceTypeBadge: Record<string, string> = {
    visual:   "bg-violet-100 text-violet-800 border-violet-200",
    text:     "bg-sky-100    text-sky-800    border-sky-200",
    llm:      "bg-indigo-100 text-indigo-800 border-indigo-200",
    combined: "bg-teal-100   text-teal-800   border-teal-200",
  };
  return (
    <div className="mt-3 space-y-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Evidence cited</p>
      <ul className="flex flex-col gap-3">
        {criterion.evidence.map((item, i) => {
          const typeKey = (item.evidence_type ?? "").toLowerCase();
          const badgeCls = evidenceTypeBadge[typeKey] ?? "bg-slate-100 text-slate-700 border-slate-200";
          return (
            <li key={i} className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
              {/* Header */}
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-1.5">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-black text-white">
                  Slide {item.slide_number ?? "?"}
                </span>
                <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeCls}`}>
                  {item.evidence_type ?? "evidence"}
                </span>
              </div>

              <div className="flex gap-3 p-3">
                {/* Slide thumbnail — larger, opens full res */}
                {item.image_urls.length > 0 && (
                  <a href={item.image_urls[0]} target="_blank" rel="noreferrer"
                    className="group relative flex-shrink-0">
                    <img
                      src={item.image_urls[0]}
                      alt={`Slide ${item.slide_number}`}
                      className="h-24 w-auto rounded-lg border border-slate-200 object-cover transition-all duration-200 group-hover:scale-[1.03] group-hover:shadow-md"
                    />
                    <span className="absolute inset-0 flex items-end justify-center rounded-lg pb-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[9px] font-bold text-slate-800 shadow">
                        Full res ↗
                      </span>
                    </span>
                  </a>
                )}

                {/* Text content */}
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="border-l-2 border-indigo-300 pl-2.5 text-xs leading-relaxed text-slate-700">
                    {item.observation}
                  </p>
                  {item.text_snippet && (
                    <blockquote className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] italic leading-relaxed text-slate-500">
                      <span className="mr-0.5 font-serif text-slate-300 text-base leading-none">"</span>
                      {item.text_snippet}
                      <span className="ml-0.5 font-serif text-slate-300 text-base leading-none">"</span>
                    </blockquote>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CriterionRow({ criterion }: { criterion: CriterionEvidenceView }) {
  const [expanded, setExpanded] = useState(false);

  // Split the full rationale into the first sentence (preview) and the rest
  const fullText = criterion.rationale.trim();
  const firstSentenceEnd = fullText.search(/(?<=[.!?])\s/);
  const previewText =
    firstSentenceEnd > 0 ? fullText.slice(0, firstSentenceEnd + 1) : truncateAtWord(fullText, 150);
  const hasMore = fullText.length > previewText.length;

  // Score colour
  const pct = criterion.max_score > 0 ? criterion.llm_score / criterion.max_score : 0;
  const scoreColor =
    pct >= 0.8
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : pct >= 0.5
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : "text-rose-700 bg-rose-50 border-rose-200";
  const barColor =
    pct >= 0.8 ? "bg-emerald-500" : pct >= 0.5 ? "bg-amber-400" : "bg-rose-500";

  // Paragraphs for expanded view
  const paragraphs = fullText.split(/\n+/).filter(Boolean);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 py-3 text-left group"
      >
        <div className="flex-1 min-w-0">
          {/* Criterion key as a styled label */}
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">
            {criterion.criterion_key.replace(/_/g, " ")}
          </p>
          {/* Preview rationale — first sentence */}
          <p className={`text-sm leading-relaxed text-slate-600 transition-colors group-hover:text-slate-800 ${expanded ? "hidden" : ""}` }>
            {previewText}
            {hasMore && !expanded && (
              <span className="ml-1 text-indigo-400 font-medium text-xs">more…</span>
            )}
          </p>
        </div>

        {/* Score pill + mini bar */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-lg border px-2.5 py-0.5 text-xs font-black tabular-nums ${scoreColor}`}>
            {Number(criterion.llm_score.toFixed(1))}/{Number(criterion.max_score.toFixed(1))}
          </span>
          <div className="h-1 w-12 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${Math.min(100, pct * 100)}%` }}
            />
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 mt-1 ${
            expanded ? "rotate-180" : ""
          }`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="pb-4 animate-slide-up">
          {/* Full rationale — paragraph per block */}
          <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4 space-y-2.5">
            {paragraphs.map((para, i) => {
              // First paragraph gets an accent left border
              const isFirst = i === 0;
              return (
                <p
                  key={i}
                  className={`text-sm leading-relaxed text-slate-700 ${
                    isFirst
                      ? "pl-3 border-l-2 border-indigo-400 font-medium text-slate-800"
                      : "pl-3 border-l-2 border-transparent"
                  }`}
                >
                  {para}
                </p>
              );
            })}
          </div>
          <EvidencePanel criterion={criterion} />
        </div>
      )}
    </div>
  );
}

function SlideCard({ slide }: { slide: SlideView }) {
  return (
    <div className="stitch-card group relative overflow-hidden rounded-2xl transition-all hover:scale-[1.01]">
      <div className="relative aspect-video w-full overflow-hidden bg-slate-900/5">
        {slide.image_urls.length > 0 ? (
          <a href={slide.image_urls[0]} target="_blank" rel="noreferrer" className="block h-full w-full">
            <img
              src={slide.image_urls[0]}
              alt={`Slide ${slide.slide_number}: ${slide.title}`}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-indigo-950/0 group-hover:bg-indigo-950/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="rounded-xl bg-white/90 backdrop-blur-sm px-3 py-1.5 text-xs font-bold text-slate-900 shadow-md flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                </svg>
                View High-Res
              </span>
            </div>
          </a>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs font-medium text-slate-600">
            No image rendered for this slide
          </div>
        )}
        <span className="absolute top-2.5 left-2.5 rounded-lg bg-slate-900/75 backdrop-blur-md px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
          Slide {slide.slide_number}
        </span>
      </div>
      <div className="p-3 bg-white">
        <p className="truncate text-xs sm:text-sm font-bold text-slate-800">
          {slide.title || `Slide ${slide.slide_number}`}
        </p>
      </div>
    </div>
  );
}

function SubmissionSlidesViewer({ slides }: { slides: SubmissionSlides }) {
  return (
    <section className="stitch-card rounded-2xl p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">Extracted Presentation Deck</h2>
            <p className="text-xs text-slate-600">{slides.slides.length} slides extracted and rendered for visual jury analysis</p>
          </div>
        </div>
        {slides.pptx_download_url && (
          <a
            href={slides.pptx_download_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3.5 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 border border-indigo-200/80"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"
              />
            </svg>
            Download {slides.pptx_download_url.toLowerCase().includes(".pdf") ? ".pdf" : ".pptx"}
          </a>
        )}
      </div>
      {slides.slides.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">No slides extracted yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
          {slides.slides.map((slide) => (
            <SlideCard key={slide.slide_number} slide={slide} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionBreakdown({ sectionKey, criteria }: { sectionKey: string; criteria: CriterionEvidenceView[] }) {
  const total = criteria.reduce((sum, c) => sum + c.llm_score, 0);
  const maxTotal = criteria.reduce((sum, c) => sum + c.max_score, 0);
  const scorePct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

  const sectionColor =
    scorePct >= 75
      ? { bar: "bg-emerald-500", accent: "from-emerald-50", badge: "bg-emerald-100 text-emerald-800 border-emerald-200" }
      : scorePct >= 50
      ? { bar: "bg-amber-400",  accent: "from-amber-50",   badge: "bg-amber-100  text-amber-800  border-amber-200"  }
      : { bar: "bg-rose-500",   accent: "from-rose-50",     badge: "bg-rose-100   text-rose-800   border-rose-200"   };

  return (
    <div className="stitch-card overflow-hidden rounded-2xl shadow-sm">
      {/* Gradient accent header */}
      <div className={`bg-gradient-to-r ${sectionColor.accent} to-white px-5 pt-4 pb-3 border-b border-slate-100`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
              {sectionKey.replace(/_/g, " ")}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">{criteria.length} rubric criteria evaluated</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Section score progress */}
            <div className="flex items-center gap-2">
              <div className="w-28 h-1.5 rounded-full bg-slate-200 overflow-hidden hidden sm:block">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${sectionColor.bar}`}
                  style={{ width: `${Math.min(100, Math.max(0, scorePct))}%` }}
                />
              </div>
              <span className="text-xs text-slate-500 tabular-nums hidden sm:inline">
                {Math.round(scorePct)}%
              </span>
            </div>
            <span className={`rounded-xl border px-3 py-1 text-xs font-black tabular-nums ${sectionColor.badge}`}>
              {Number(total.toFixed(2))} / {Number(maxTotal.toFixed(2))}
            </span>
          </div>
        </div>
      </div>

      {/* Criteria list */}
      <div className="px-5 divide-y divide-slate-50">
        {criteria.map((c) => (
          <CriterionRow key={c.criterion_key} criterion={c} />
        ))}
      </div>
    </div>
  );
}

function AcademicBenchmarkSection({
  benchmark,
  submissionId,
  onRefresh,
  isAdmin,
}: {
  benchmark?: AcademicBenchmark | null;
  submissionId: string;
  onRefresh: (s: Submission) => void;
  isAdmin: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const updated = await generateAcademicBenchmark(submissionId);
      if (mountedRef.current) {
        onRefresh(updated);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to run benchmark");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  return (
    <section className="stitch-card overflow-hidden rounded-xl border border-slate-200/80 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-200/70">
              IEEE &middot; arXiv &middot; CrossRef
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              Peer-Reviewed SOTA Analysis
            </span>
          </div>
          <h2 className="mt-2 text-xl font-extrabold text-slate-900 tracking-tight">
            Academic Research & Literature Comparison
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Grounds technical novelty against published academic literature using IEEE and arXiv.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Querying IEEE & arXiv...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {benchmark ? "Re-run Literature Benchmark" : "Analyze Literature"}
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700 border border-red-200">{error}</p>
      )}

      {!benchmark ? (
        <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-200 bg-white/70 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-800">Literature Benchmark Ready</h3>
          <p className="mt-1 max-w-md text-xs text-slate-500">
            Click above to search IEEE and arXiv to compare this team's submission against state-of-the-art baselines.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {/* Status & Search Query Grounding Badge */}
          {benchmark.status && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 bg-white shadow-xs border-indigo-100">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  benchmark.status === "completed"
                    ? "bg-emerald-100 text-emerald-800"
                    : benchmark.status === "no_literature_found"
                    ? "bg-amber-100 text-amber-800"
                    : benchmark.status === "synthesis_failed"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-slate-100 text-slate-700"
                }`}>
                  {benchmark.status === "completed" && "Peer-Reviewed Literature Grounded"}
                  {benchmark.status === "no_literature_found" && "No Direct Literature Indexed (Novelty Unverified)"}
                  {benchmark.status === "synthesis_failed" && "Synthesis Failed (Manual Review Required)"}
                  {benchmark.status === "unavailable" && "Literature Search Unavailable"}
                </span>
                {benchmark.query_used && (
                  <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                    Query: "{benchmark.query_used}"
                  </span>
                )}
              </div>
              {benchmark.status === "no_literature_found" && (
                <span className="text-[11px] text-amber-800 font-medium">
                  Zero papers returned; lack of indexed literature does not guarantee superiority.
                </span>
              )}
            </div>
          )}

          {/* Why Ranked & Score Justification */}
          <div className="stitch-card rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-white text-xs font-black shadow-sm">
                1
              </span>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                Why It Ranked & Score Rationale
              </h3>
            </div>
            <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-700 bg-indigo-50/50 rounded-xl p-4 border border-indigo-100/70 font-normal">
              {benchmark.why_ranked_explanation}
            </p>
          </div>

          {/* Comparison vs Existing Systems Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Existing Solutions & Literature Baselines */}
            <div className="stitch-card rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black border border-slate-200/60">
                  SOTA
                </span>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Existing Solutions in Literature
                </h4>
              </div>
              <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
                {benchmark.existing_solutions_summary}
              </p>
              <div className="mt-3.5 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                  Gaps in Existing Solutions
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {benchmark.gaps_in_existing_solutions}
                </p>
              </div>
            </div>

            {/* Why Better Than Existing Systems */}
            <div className="stitch-card rounded-2xl border-emerald-200/80 bg-emerald-50/20 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 text-[10px] font-black border border-emerald-200/60">
                  ADV
                </span>
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                  Why It Is Better Than Existing Systems
                </h4>
              </div>
              <ul className="space-y-2 text-xs sm:text-sm text-emerald-950">
                {benchmark.better_than_existing_aspects.map((aspect, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <svg className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                    <span>{aspect}</span>
                  </li>
                ))}
              </ul>

              {benchmark.limitations_and_tradeoffs.length > 0 && (
                <div className="mt-3.5 border-t border-emerald-200/60 pt-3">
                  <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    Acknowledged Constraints & Trade-offs
                  </p>
                  <ul className="mt-1 list-disc list-inside space-y-1 text-xs text-slate-600">
                    {benchmark.limitations_and_tradeoffs.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Academic Papers Cited (IEEE & arXiv) */}
          {benchmark.papers && benchmark.papers.length > 0 && (
            <div className="stitch-card rounded-2xl p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-3.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                  <svg className="h-4 w-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Referenced Academic Literature ({benchmark.papers.length} Papers Evaluated)
                </h4>
                <span className="text-[11px] text-slate-600 font-medium">
                  Live indexed via IEEE CrossRef & arXiv
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {benchmark.papers.map((paper, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-xs flex flex-col justify-between hover:border-indigo-300 hover:bg-white transition-all shadow-sm">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                          paper.source.includes("Semantic")
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-200/80"
                            : paper.source.includes("IEEE")
                            ? "bg-sky-100 text-sky-800 border border-sky-200/80"
                            : "bg-purple-100 text-purple-800 border border-purple-200/80"
                        }`}>
                          {paper.source}
                        </span>
                        <span className="text-[11px] font-mono font-bold text-slate-600">{paper.year}</span>
                      </div>
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block font-bold text-slate-900 hover:text-indigo-600 hover:underline leading-snug"
                      >
                        {paper.title}
                      </a>
                      <p className="mt-1 text-[11px] text-slate-600">
                        {paper.authors} &middot; <span className="italic">{paper.venue}</span>
                      </p>
                      <p className="mt-2 text-slate-600 line-clamp-3 leading-relaxed">
                        {paper.summary}
                      </p>
                    </div>
                    {paper.url && (
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800"
                      >
                        Read Paper
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CostAffordabilitySection({
  costAnalysis,
  submissionId,
  onRefresh,
  isAdmin,
}: {
  costAnalysis?: CostAnalysis | null;
  submissionId: string;
  onRefresh: (s: Submission) => void;
  isAdmin: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const updated = await generateCostAnalysis(submissionId);
      if (mountedRef.current) {
        onRefresh(updated);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to run cost analysis");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }

  const isBomNotApplicable =
    costAnalysis?.analysis_status === "not_applicable" ||
    costAnalysis?.affordability_verdict === "not_applicable";

  const statusConfig = {
    applicable_evaluated: {
      label: "Physical BOM Evaluated",
      color: "bg-emerald-100 text-emerald-800 border-emerald-300",
      dot: "bg-emerald-500",
      desc: "Physical bill of materials evaluated with market benchmarks.",
    },
    not_applicable: {
      label: "Physical BOM Not Applicable",
      color: "bg-slate-100 text-slate-700 border-slate-300",
      dot: "bg-slate-500",
      desc: "Software/AI solution. No physical BOM required or evaluated.",
    },
    incomplete_review_required: {
      label: "Manual Review Required / Incomplete",
      color: "bg-amber-100 text-amber-800 border-amber-300",
      dot: "bg-amber-500",
      desc: "Automated analysis was incomplete or ungrounded. Manual financial review required.",
    },
    failed: {
      label: "Analysis Failed",
      color: "bg-rose-100 text-rose-800 border-rose-300",
      dot: "bg-rose-500",
      desc: "Cost analysis could not be completed.",
    },
  }[costAnalysis?.analysis_status ?? (isBomNotApplicable ? "not_applicable" : "applicable_evaluated")] ?? {
    label: "Cost Evaluated",
    color: "bg-slate-100 text-slate-800 border-slate-300",
    dot: "bg-slate-500",
    desc: "",
  };

  const verdictConfig = {
    not_applicable: {
      label: "Not Applicable",
      color: "bg-slate-100 text-slate-700 border-slate-300",
      dot: "bg-slate-500",
    },
    highly_affordable: {
      label: "Highly Affordable & Feasible",
      color: "bg-emerald-100 text-emerald-800 border-emerald-300",
      dot: "bg-emerald-500",
    },
    moderate_realistic: {
      label: "Realistic & Well-Budgeted",
      color: "bg-blue-100 text-blue-800 border-blue-300",
      dot: "bg-blue-500",
    },
    underestimated_missing_components: {
      label: "Underestimated / Missing Components",
      color: "bg-amber-100 text-amber-800 border-amber-300",
      dot: "bg-amber-500",
    },
    expensive_high_barrier: {
      label: "High Cost Barrier for Beneficiaries",
      color: "bg-rose-100 text-rose-800 border-rose-300",
      dot: "bg-rose-500",
    },
    unassessed: {
      label: "Unassessed / Manual Review",
      color: "bg-amber-100 text-amber-800 border-amber-300",
      dot: "bg-amber-500",
    },
  }[costAnalysis?.affordability_verdict ?? "unassessed"] ?? {
    label: "Affordability Evaluated",
    color: "bg-slate-100 text-slate-800 border-slate-300",
    dot: "bg-slate-500",
  };

  const curr = "₹";

  const categoryMap: Record<string, { label: string; badge: string }> = {
    chemicals_reagents: { label: "Chemicals & Reagents", badge: "bg-purple-100 text-purple-800" },
    equipment_hardware: { label: "Hardware & Equipment", badge: "bg-blue-100 text-blue-800" },
    sensors_instrumentation: { label: "Sensors & Instrumentation", badge: "bg-cyan-100 text-cyan-800" },
    utilities_energy: { label: "Utilities & Energy", badge: "bg-amber-100 text-amber-800" },
    waste_disposal_compliance: { label: "Waste Treatment & Safety", badge: "bg-emerald-100 text-emerald-800" },
    software_cloud: { label: "Software & Cloud Services", badge: "bg-indigo-100 text-indigo-800" },
    other: { label: "Other", badge: "bg-slate-100 text-slate-800" },
  };

  function VendorSourceBadge({
    sourceName,
    sourceUrl,
    provenance,
  }: {
    sourceName?: string;
    sourceUrl?: string;
    provenance?: string;
  }) {
    const name = (sourceName || "").trim();
    const isLiveVerified = provenance === "live_verified";
    const isUnavailable = provenance === "unavailable";

    return (
      <div className="flex flex-col gap-1 items-start">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
            isLiveVerified
              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
              : isUnavailable
              ? "bg-slate-100 text-slate-600 border border-slate-200"
              : "bg-sky-50 text-sky-800 border border-sky-200"
          }`}
        >
          {isLiveVerified ? "Verified Quote" : isUnavailable ? "Price Unavailable" : "Indicative Estimate"}
        </span>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Search catalog to verify live pricing (navigational search query, not static quote)"
            className="group inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            <span>{name || "Catalog Search"}</span>
            <svg
              className="h-3 w-3 opacity-70 transition-transform group-hover:translate-x-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ) : (
          <span className="text-[11px] text-slate-500">{name || "Market Benchmark"}</span>
        )}
      </div>
    );
  }

  return (
    <section className="stitch-card overflow-hidden rounded-xl border border-slate-200/80 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-bold ${statusConfig.color}`}>
              <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
              {statusConfig.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              Deterministic Financial Model
            </span>
          </div>
          <h2 className="mt-2 text-xl font-extrabold text-slate-900 tracking-tight">
            Components Bill of Materials (BOM) & Financial Model
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Reconciles itemized hardware CAPEX, consumables OPEX, and software services deterministically. Distinguishes physical hardware requirements from software-only scope without fabricating arbitrary prices.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Calculating Components & Pricing...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {costAnalysis ? "Re-calculate Cost & BOM" : "Calculate Components & Costs"}
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700 border border-red-200">{error}</p>
      )}

      {!costAnalysis ? (
        <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-200 bg-white/70 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-800">Component & Cost Analysis Ready</h3>
          <p className="mt-1 max-w-md text-xs text-slate-500">
            Click above to extract required technical components from the pitch deck and benchmark realistic market costs.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {/* KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="stitch-card rounded-xl p-3 bg-white shadow-sm border border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Declared Budget</span>
              <p className="mt-1 text-base font-black text-slate-900">
                {costAnalysis.deck_declared_budget !== null && costAnalysis.deck_declared_budget !== undefined
                  ? `${curr} ${costAnalysis.deck_declared_budget.toLocaleString()}`
                  : (costAnalysis.total_declared_cost !== null && costAnalysis.total_declared_cost !== undefined
                  ? `${curr} ${costAnalysis.total_declared_cost.toLocaleString()}`
                  : "None Stated")}
              </p>
              <span className="text-[10px] text-slate-500 truncate block">
                {costAnalysis.itemized_declared_cost ? `Itemized: ${curr} ${costAnalysis.itemized_declared_cost.toLocaleString()}` : "In deck text"}
              </span>
            </div>

            <div className="stitch-card rounded-xl p-3 bg-white shadow-sm border border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hardware CAPEX</span>
              <p className="mt-1 text-base font-black text-slate-900">
                {isBomNotApplicable
                  ? "N/A"
                  : costAnalysis.physical_hardware_capex !== null && costAnalysis.physical_hardware_capex !== undefined
                  ? `${curr} ${costAnalysis.physical_hardware_capex.toLocaleString()}`
                  : "-"}
              </p>
              <span className="text-[10px] text-slate-500">Physical equipment</span>
            </div>

            <div className="stitch-card rounded-xl p-3 bg-white shadow-sm border border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Consumables OPEX</span>
              <p className="mt-1 text-base font-black text-slate-900">
                {isBomNotApplicable
                  ? "N/A"
                  : costAnalysis.chemical_consumables_opex !== null && costAnalysis.chemical_consumables_opex !== undefined
                  ? `${curr} ${costAnalysis.chemical_consumables_opex.toLocaleString()}`
                  : "-"}
              </p>
              <span className="text-[10px] text-slate-500">Reagents & utilities</span>
            </div>

            <div className="stitch-card rounded-xl p-3 bg-white shadow-sm border border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Realistic Total Est.</span>
              <p className="mt-1 text-base font-black text-emerald-700">
                {isBomNotApplicable
                  ? "N/A"
                  : costAnalysis.analysis_status === "incomplete_review_required" || costAnalysis.analysis_status === "failed"
                  ? "Pending Review"
                  : costAnalysis.total_estimated_cost !== null && costAnalysis.total_estimated_cost !== undefined
                  ? `${curr} ${costAnalysis.total_estimated_cost.toLocaleString()}`
                  : "Unassessed"}
              </p>
              <span className="text-[10px] text-slate-500 font-medium">
                {isBomNotApplicable ? "Software-only scope" : "Reconciled line items"}
              </span>
            </div>

            <div className="stitch-card rounded-xl p-3 bg-white shadow-sm border border-slate-100 col-span-2 sm:col-span-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Affordability Score</span>
              <p className="mt-1 text-base font-black text-slate-900">
                {isBomNotApplicable
                  ? "N/A"
                  : costAnalysis.affordability_score_recommendation !== null && costAnalysis.affordability_score_recommendation !== undefined
                  ? `${costAnalysis.affordability_score_recommendation.toFixed(2)} / 2.0`
                  : "Unassessed"}
              </p>
              <span className="text-[10px] text-slate-500">
                {costAnalysis.missing_components_count > 0 ? `${costAnalysis.missing_components_count} omitted items` : "Affordability verdict"}
              </span>
            </div>
          </div>

          {/* Verdict Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black ${verdictConfig.color}`}>
                <span className={`h-2 w-2 rounded-full ${verdictConfig.dot}`} />
                {verdictConfig.label}
              </span>
              <span className="text-xs text-slate-500">
                {isBomNotApplicable
                  ? "No physical BOM required for this software/AI solution. Software operating costs scale with usage."
                  : `${costAnalysis.components.length} components evaluated across solution architecture.`}
              </span>
            </div>
            {!isBomNotApplicable && costAnalysis.cost_difference !== null && costAnalysis.cost_difference !== undefined && (
              <span className="text-xs font-semibold text-slate-600">
                Variance: <span className={costAnalysis.cost_difference > 0 ? "text-amber-700 font-bold" : "text-emerald-700 font-bold"}>
                  {costAnalysis.cost_difference > 0 ? `+${curr} ${costAnalysis.cost_difference.toLocaleString()} shortfall` : "Within declared budget"}
                </span>
              </span>
            )}
          </div>

          {/* Narrative Analysis */}
          <div className="stitch-card rounded-2xl p-4 sm:p-5 bg-white shadow-sm border border-slate-100">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-2">
              Financial & Engineering Feasibility Assessment
            </h4>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-emerald-50/40 p-3.5 rounded-xl border border-emerald-100/60 font-normal">
              {costAnalysis.affordability_analysis}
            </p>
          </div>

          {/* Itemized Components Table */}
          {costAnalysis.components && costAnalysis.components.length > 0 && (
            <div className="stitch-card rounded-2xl overflow-hidden bg-white shadow-sm border border-slate-100">
              <div className="border-b border-slate-100 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    Bill of Materials (BOM) & Line Item Financial Model
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Itemized components deterministically calculated (Quantity × Unit Cost = Line Total). Catalog search links provide navigational lookup to verify current vendor rates.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Deterministic Reconciliation Active
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <tr>
                      <th className="py-2.5 px-4 min-w-[180px]">Component Name</th>
                      <th className="py-2.5 px-3">Category & Scope</th>
                      <th className="py-2.5 px-2 text-center">Qty</th>
                      <th className="py-2.5 px-3">Deck Status</th>
                      <th className="py-2.5 px-3 text-right">Declared</th>
                      <th className="py-2.5 px-3 text-right">Line Total</th>
                      <th className="py-2.5 px-3 min-w-[150px]">Provenance & Catalog Lookup</th>
                      <th className="py-2.5 px-4 min-w-[200px]">Technical Justification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {costAnalysis.components.map((c, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-800">
                          {c.name}
                        </td>
                        <td className="py-3 px-3">
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${categoryMap[c.category]?.badge ?? "bg-slate-100 text-slate-700"}`}>
                            {categoryMap[c.category]?.label ?? c.category.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center font-mono text-slate-700">
                          {c.quantity ?? 1} {c.unit || "unit"}
                        </td>
                        <td className="py-3 px-3">
                          {c.is_declared_by_team ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                              ✓ In Budget
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                              ⚠ Omitted
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-slate-600 tabular-nums">
                          {c.declared_cost !== null && c.declared_cost !== undefined
                            ? `${curr} ${c.declared_cost.toLocaleString()}`
                            : "-"}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-slate-900 tabular-nums">
                          {c.line_total !== null && c.line_total !== undefined
                            ? `${curr} ${c.line_total.toLocaleString()}`
                            : (c.estimated_market_cost !== null && c.estimated_market_cost !== undefined
                            ? `${curr} ${c.estimated_market_cost.toLocaleString()}`
                            : "-")}
                        </td>
                        <td className="py-3 px-3">
                          <VendorSourceBadge
                            sourceName={c.source_name}
                            sourceUrl={c.source_url}
                            provenance={c.price_provenance}
                          />
                        </td>
                        <td className="py-3 px-4 text-slate-600">{c.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function Team() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAdminAuth();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [evidence, setEvidence] = useState<SubmissionEvidence | null>(null);
  const [audit, setAudit] = useState<SubmissionAudit | null>(null);
  const [slides, setSlides] = useState<SubmissionSlides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showResolvedFlags, setShowResolvedFlags] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reEvaluating, setReEvaluating] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  function startEditingName() {
    setNameDraft(submission?.team_name ?? "");
    setNameError(null);
    setEditingName(true);
  }

  async function handleSaveName() {
    if (!submission) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Team name cannot be empty.");
      return;
    }
    if (trimmed === submission.team_name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await renameTeam(submission.team_id, trimmed);
      setSubmission({ ...submission, team_name: trimmed });
      setEditingName(false);
    } catch (err) {
      setNameError(
        err instanceof ApiError ? err.message : "Could not rename team.",
      );
    } finally {
      setSavingName(false);
    }
  }

  async function handleReEvaluate() {
    if (!id) return;
    setReEvaluating(true);
    try {
      const updated = await reEvaluateSubmission(id);
      setSubmission(updated);
      const [e, a] = await Promise.all([
        getSubmissionEvidence(id),
        getSubmissionAudit(id),
      ]).catch(() => [null, null]);
      if (e) setEvidence(e);
      if (a) setAudit(a);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not re-evaluate submission");
    } finally {
      setReEvaluating(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    let active = true;
    setError(null);

    // Load submission first — unblocks the page render immediately.
    // Evidence, audit, and slides are fetched in parallel afterwards;
    // they fill in progressively rather than gating the initial paint.
    getSubmission(id)
      .then((s) => {
        if (!active) return;
        setSubmission(s);
        // Now fetch the heavier payloads in parallel without blocking the page.
        Promise.all([
          getSubmissionEvidence(id),
          getSubmissionAudit(id),
          getSubmissionSlides(id),
        ])
          .then(([e, a, sl]) => {
            if (!active) return;
            setEvidence(e);
            setAudit(a);
            setSlides(sl);
          })
          .catch(() => {/* non-fatal: evidence/slides are best-effort */});
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : "Could not load submission.");
      });

    return () => {
      active = false;
    };
  }, [id]);


  // Real-time status: poll while the submission is still mid-pipeline,
  // OR while it is scored-but-stale (a re-score job is running in the
  // background and we need to detect when is_stale flips back to false).
  useEffect(() => {
    if (!id || !submission || isFullySettled(submission)) return;
    let active = true;
    const pollId = id;

    pollRef.current = setInterval(async () => {
      const latest = await getSubmission(pollId).catch(() => null);
      if (!active || !latest) return;
      setSubmission(latest);

      const sl = await getSubmissionSlides(pollId).catch(() => null);
      if (active && sl) setSlides(sl);

      if (isFullySettled(latest)) {
        if (pollRef.current) clearInterval(pollRef.current);
        const [e, a] = await Promise.all([
          getSubmissionEvidence(pollId),
          getSubmissionAudit(pollId),
        ]).catch(() => [null, null]);
        if (active && e) setEvidence(e);
        if (active && a) setAudit(a);
      }
    }, 4000);

    return () => {
      active = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, submission?.status, submission?.is_stale]);

  async function handleSubmissionUpdated(updated: Submission) {
    setSubmission(updated);
    if (id) {
      const updatedAudit = await getSubmissionAudit(id).catch(() => null);
      if (updatedAudit) setAudit(updatedAudit);
    }
  }

  async function handleDeleteTeam() {
    if (!submission) return;
    setDeleting(true);
    try {
      await deleteTeam(submission.team_id);
      navigate("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not delete team");
      setDeleting(false);
    }
  }

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/login" replace />;

  if (error) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  if (!submission) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  // evidence is null while still loading (fetched after submission) — use
  // empty fallback so the page renders immediately and sections fill in.
  const sections = (evidence?.criteria ?? []).reduce<Record<string, CriterionEvidenceView[]>>((acc, c) => {
    (acc[c.section_key] ??= []).push(c);
    return acc;
  }, {});


  const context = submission.submission_context;

  const activeFlags =
    audit?.consistency_flags.filter(
      (f) => !f.resolved && f.flag_type !== "needs_visual_rendering",
    ) ?? [];
  const resolvedFlags =
    audit?.consistency_flags.filter(
      (f) => f.resolved || f.flag_type === "needs_visual_rendering",
    ) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-4 w-4"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Rankings
          </Link>
          {editingName ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="rounded-lg border border-indigo-300 px-2.5 py-1 text-2xl font-bold text-slate-900 outline-none ring-indigo-500/30 focus:ring-4 sm:text-3xl"
                />
                <button
                  type="button"
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingName ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  disabled={savingName}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
              {nameError && <p className="text-xs text-red-600">{nameError}</p>}
            </div>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 sm:text-3xl">
              {submission.team_name || `Submission ${submission.id}`}
              {isAdmin && (
                <button
                  type="button"
                  onClick={startEditingName}
                  title="Edit team name"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
            </h1>
          )}
          {submission.problem_statement_title && (
            <p className="mt-1 text-sm text-slate-600">
              <span className="font-semibold text-slate-500">Problem Statement:</span>{" "}
              {submission.problem_statement_title}
            </p>
          )}
          <p className="mt-1 font-mono text-xs text-slate-400">ID: {submission.id}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                STATUS_COLORS[submission.status] ?? "bg-slate-100 text-slate-700"
              }`}
            >
              {submission.status}
              {!TERMINAL_STATUSES.has(submission.status) && " · updating..."}
            </span>
            {submission.reliability_label && (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  RELIABILITY_COLORS[submission.reliability_label]
                }`}
              >
                {submission.reliability_label}
              </span>
            )}
          </div>
          {submission.status === "analyzing" && audit && audit.criteria_total !== null && (
            <p className="mt-1.5 text-xs text-slate-500">
              {audit.criteria_scored}/{audit.criteria_total} criteria scored
              {estimateRemaining(audit) && <> · ~{estimateRemaining(audit)} remaining</>}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col sm:flex-row items-start sm:items-center gap-3">
          {evidence && evidence.criteria.length > 0 && (
            <div className="stitch-card flex items-center gap-3.5 rounded-xl px-4 py-2.5 border border-slate-200/80">
              <div className="text-right">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700">Total Score</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-black tabular-nums text-slate-900">
                    {Number(evidence.criteria.reduce((s, c) => s + c.llm_score, 0).toFixed(2))}
                  </span>
                  <span className="text-xs font-bold text-slate-600">
                    / {Number(evidence.criteria.reduce((s, c) => s + c.max_score, 0).toFixed(2))}
                  </span>
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-xs font-black text-white">
                {Math.round(
                  (evidence.criteria.reduce((s, c) => s + c.llm_score, 0) /
                    (evidence.criteria.reduce((s, c) => s + c.max_score, 0) || 1)) *
                    100,
                )}%
              </div>
            </div>
          )}

          {isAdmin && (
          <button
            type="button"
            onClick={handleReEvaluate}
            disabled={reEvaluating}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/70 px-3.5 py-2 text-xs font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-600 hover:text-white hover:border-indigo-600 disabled:opacity-50"
            title="Re-run scoring pipeline on this submission"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className={`h-4 w-4 ${reEvaluating ? "animate-spin" : ""}`}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {reEvaluating ? "Queuing..." : "Re-Evaluate"}
          </button>
          )}

          {isAdmin && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200/80 bg-red-50/70 px-3.5 py-2 text-xs font-bold text-red-700 shadow-sm transition hover:bg-red-600 hover:text-white hover:border-red-600"
            title="Remove this team entirely"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-4 w-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete Team
          </button>
          )}
        </div>
      </div>

      {isAdmin && submission.is_stale && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/90 p-4 shadow-sm text-amber-900">
          <div className="flex items-start sm:items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-200/80 text-amber-800">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-bold text-amber-950">Evaluation Scores are Stale</p>
              <p className="text-xs text-amber-800">
                Cost analysis or academic benchmark evidence has been refreshed since this submission was scored. Re-evaluation is required to update dependent rubric criterion scores and final ranking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleReEvaluate}
            disabled={reEvaluating}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {reEvaluating ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Queuing Re-evaluation...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-Evaluate Submission
              </>
            )}
          </button>
        </div>
      )}

      {slides && <SubmissionSlidesViewer slides={slides} />}

      {context && (
        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-medium text-slate-700">
            What this submission was evaluated against (Phase 5)
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase text-slate-400">Problem domain</dt>
              <dd className="text-slate-700">{context.problem_domain || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-slate-400">Target beneficiary</dt>
              <dd className="text-slate-700">{context.target_beneficiary || "-"}</dd>
            </div>
            {context.required_deliverables.length > 0 && (
              <div>
                <dt className="text-xs font-medium uppercase text-slate-400">
                  Required deliverables
                </dt>
                <dd className="text-slate-700">{context.required_deliverables.join("; ")}</dd>
              </div>
            )}
            {context.track_constraints.length > 0 && (
              <div>
                <dt className="text-xs font-medium uppercase text-slate-400">Track constraints</dt>
                <dd className="text-slate-700">{context.track_constraints.join("; ")}</dd>
              </div>
            )}
            {context.is_generic && (
              <p className="text-amber-700">
                Flagged as a generic/boilerplate problem statement ({context.generic_reason}).
              </p>
            )}
          </dl>
        </section>
      )}

      {submission && (
        <AcademicBenchmarkSection
          benchmark={submission.academic_benchmark}
          submissionId={submission.id}
          onRefresh={handleSubmissionUpdated}
          isAdmin={isAdmin}
        />
      )}

      {submission && (
        <CostAffordabilitySection
          costAnalysis={submission.cost_analysis}
          submissionId={submission.id}
          onRefresh={handleSubmissionUpdated}
          isAdmin={isAdmin}
        />
      )}

      {Object.keys(sections).length === 0 ? (
        <p className="text-slate-500">No criterion scores recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(sections).map(([sectionKey, criteria]) => (
            <SectionBreakdown key={sectionKey} sectionKey={sectionKey} criteria={criteria} />
          ))}
        </div>
      )}

      {/* Consistency Flags Section: Active vs Resolved */}
      {activeFlags.length === 0 ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-950">
                  All consistency checks passed
                </p>
                <p className="text-xs text-emerald-700">
                  0 active flags &middot; Structural and cross-modal audit verified
                </p>
              </div>
            </div>
            {resolvedFlags.length > 0 && (
              <button
                type="button"
                onClick={() => setShowResolvedFlags((v) => !v)}
                className="text-xs font-medium text-emerald-800 underline hover:text-emerald-950"
              >
                {showResolvedFlags ? "Hide" : "Show"} resolved checks ({resolvedFlags.length})
              </button>
            )}
          </div>
          {showResolvedFlags && resolvedFlags.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-emerald-200/60 pt-3 text-xs">
              {resolvedFlags.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-emerald-900">
                  <span className="shrink-0 rounded bg-emerald-200/80 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900">
                    RESOLVED
                  </span>
                  <span>
                    <strong>{f.flag_type}</strong>: {f.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-amber-900">
              Active Consistency Flags ({activeFlags.length})
            </h2>
            {resolvedFlags.length > 0 && (
              <button
                type="button"
                onClick={() => setShowResolvedFlags((v) => !v)}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                {showResolvedFlags ? "Hide" : "Show"} resolved ({resolvedFlags.length})
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {activeFlags.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                    SEVERITY_COLORS[f.severity] ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {f.severity}
                </span>
                <span className="text-slate-700">
                  <strong>{f.flag_type}</strong>: {f.description}
                </span>
              </li>
            ))}
          </ul>
          {showResolvedFlags && resolvedFlags.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-500">Resolved Notes:</p>
              <ul className="flex flex-col gap-1.5 text-xs text-slate-600">
                {resolvedFlags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      RESOLVED
                    </span>
                    <span>
                      <strong>{f.flag_type}</strong>: {f.description}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="text-sm font-medium text-slate-700 underline"
        >
          {showHistory ? "Hide" : "Show"} pipeline history
        </button>

        {showHistory && audit && (
          <ol className="mt-3 flex flex-col gap-1 text-sm">
            {audit.status_history.map((t, i) => (
              <li key={i} className="text-slate-600">
                {new Date(t.changed_at).toLocaleString()} &rarr; <strong>{t.status}</strong>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Confirmation Modal to Delete Team */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">
              Delete {submission.team_name || "Team"}?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove this team from the hackathon, including all uploaded slides, evaluation scores, criterion evidence, and storage records. This action cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteTeam}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Yes, Delete Team"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
