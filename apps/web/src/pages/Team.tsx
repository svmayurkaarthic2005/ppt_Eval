import type {
  AcademicBenchmark,
  CriterionEvidenceView,
  SlideView,
  Submission,
  SubmissionAudit,
  SubmissionEvidence,
  SubmissionSlides,
} from "@hackeval/types";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  deleteTeam,
  generateAcademicBenchmark,
  getSubmission,
  getSubmissionAudit,
  getSubmissionEvidence,
  getSubmissionSlides,
} from "../lib/api";
import { estimateRemaining } from "../lib/timing";

const TERMINAL_STATUSES = new Set(["scored", "failed"]);

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
    return <p className="mt-3 text-sm italic text-slate-400">No specific slide evidence cited.</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {criterion.evidence.map((item, i) => (
        <li key={i} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
          <p className="text-xs font-medium text-slate-500">
            Slide {item.slide_number ?? "?"} &middot; {item.evidence_type}
          </p>
          <p className="text-slate-700">{item.observation}</p>
          {item.image_urls.length > 0 && (
            <a href={item.image_urls[0]} target="_blank" rel="noreferrer">
              <img
                src={item.image_urls[0]}
                alt={`Slide ${item.slide_number}`}
                className="mt-2 h-20 w-auto rounded border border-slate-200"
              />
            </a>
          )}
          {item.text_snippet && (
            <p className="mt-1 text-xs italic text-slate-500">"{item.text_snippet}"</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function CriterionRow({ criterion }: { criterion: CriterionEvidenceView }) {
  const [expanded, setExpanded] = useState(false);
  const oneLineRationale = criterion.rationale.split("\n")[0].slice(0, 140);

  return (
    <div className="border-b border-slate-100 py-2.5 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <p className="text-sm font-medium text-slate-800">{criterion.criterion_key}</p>
          <p className="text-sm text-slate-500">{oneLineRationale}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-slate-700">
          {Number(criterion.llm_score.toFixed(2))}/{Number(criterion.max_score.toFixed(2))}
        </span>
      </button>
      {expanded && <EvidencePanel criterion={criterion} />}
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3.5 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 border border-indigo-200/80"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"
              />
            </svg>
            Download .pptx
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

  return (
    <div className="stitch-card rounded-2xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-800">
            {sectionKey.replace(/_/g, " ")}
          </h3>
          <p className="text-xs text-slate-600">{criteria.length} rubric criteria evaluated</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-24 h-2 rounded-full bg-slate-100 overflow-hidden hidden sm:block">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-600"
              style={{ width: `${Math.min(100, Math.max(0, scorePct))}%` }}
            />
          </div>
          <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-black text-slate-800 border border-slate-200/60 tabular-nums">
            {Number(total.toFixed(2))} / {Number(maxTotal.toFixed(2))}
          </span>
        </div>
      </div>
      <div className="mt-3 divide-y divide-slate-100">
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
}: {
  benchmark?: AcademicBenchmark | null;
  submissionId: string;
  onRefresh: (s: Submission) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const updated = await generateAcademicBenchmark(submissionId);
      onRefresh(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run benchmark");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="stitch-card overflow-hidden rounded-2xl border-indigo-200/90 bg-gradient-to-br from-white via-indigo-50/20 to-sky-50/25 p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-indigo-100 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-0.5 text-xs font-bold text-indigo-800">
              IEEE &middot; arXiv &middot; CrossRef
            </span>
            <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
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

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/25 transition-all hover:scale-[1.02] hover:shadow-indigo-600/35 disabled:opacity-50"
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

export default function Team() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [evidence, setEvidence] = useState<SubmissionEvidence | null>(null);
  const [audit, setAudit] = useState<SubmissionAudit | null>(null);
  const [slides, setSlides] = useState<SubmissionSlides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showResolvedFlags, setShowResolvedFlags] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getSubmission(id),
      getSubmissionEvidence(id),
      getSubmissionAudit(id),
      getSubmissionSlides(id),
    ])
      .then(([s, e, a, sl]) => {
        setSubmission(s);
        setEvidence(e);
        setAudit(a);
        setSlides(sl);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load submission."));
  }, [id]);

  // Real-time-ish status: poll while the submission is still mid-pipeline.
  useEffect(() => {
    if (!id || !submission || TERMINAL_STATUSES.has(submission.status)) return;
    pollRef.current = setInterval(async () => {
      const latest = await getSubmission(id).catch(() => null);
      if (latest) setSubmission(latest);

      // Slide images land during the 'rendering' stage, well before the
      // submission is fully scored -- refresh every tick, not just at the
      // end, so the deck viewer doesn't sit on "no image rendered" longer
      // than it has to.
      const sl = await getSubmissionSlides(id).catch(() => null);
      if (sl) setSlides(sl);

      if (latest && (latest.status === "scored" || TERMINAL_STATUSES.has(latest.status))) {
        const [e, a] = await Promise.all([getSubmissionEvidence(id), getSubmissionAudit(id)]).catch(
          () => [null, null],
        );
        if (e) setEvidence(e);
        if (a) setAudit(a);
      }
    }, 4000);
    return () => clearInterval(pollRef.current);
  }, [id, submission]);

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

  if (error) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  if (!submission || !evidence) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  const sections = evidence.criteria.reduce<Record<string, CriterionEvidenceView[]>>((acc, c) => {
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
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            {submission.team_name || `Submission ${submission.id}`}
          </h1>
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
          {evidence.criteria.length > 0 && (
            <div className="stitch-card flex items-center gap-3.5 rounded-2xl bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/40 px-4 py-2.5 shadow-sm border border-indigo-200/80">
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
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-xs font-black text-white shadow-md shadow-indigo-600/25">
                {Math.round(
                  (evidence.criteria.reduce((s, c) => s + c.llm_score, 0) /
                    (evidence.criteria.reduce((s, c) => s + c.max_score, 0) || 1)) *
                    100,
                )}%
              </div>
            </div>
          )}

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
        </div>
      </div>

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
          onRefresh={(updated) => setSubmission(updated)}
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
