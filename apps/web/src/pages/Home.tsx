import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import RankingTable from "../components/RankingTable";
import { useConfirm } from "../components/ConfirmDialog";
import { downloadCsv, rankingRowsToCsv } from "../lib/csv";
import {
  ApiError,
  createProblemStatement,
  deleteProblemStatement,
  deleteSubmission,
  deleteTeam,
  getDashboard,
  getOverallRanking,
  getRankingByProblemStatement,
  listProblemStatements,
  setManualRank,
  triggerStage2Selection,
} from "../lib/api";
import type { ProblemStatement, ProblemStatementGroup, RankingRow } from "@hackeval/types";

const AUTO_EXPAND_MAX_SIZE = 10;
const MIN_COMPARE = 2;

function sectionKeysOf(rows: RankingRow[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const key of Object.keys(r.section_totals)) keys.add(key);
  return Array.from(keys).sort();
}

function StatCard({
  label,
  value,
  icon,
  gradient,
  subtext,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  gradient: string;
  subtext?: string;
}) {
  return (
    <div className="stitch-card rounded-2xl p-4 sm:p-5 flex items-center justify-between relative overflow-hidden group">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md ${gradient} transition-transform group-hover:scale-105`}
        >
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums text-slate-900">
              {value === null ? (
                <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-200" />
              ) : (
                value
              )}
            </span>
            {subtext && <span className="text-xs font-medium text-slate-600">{subtext}</span>}
          </div>
        </div>
      </div>
      <div className="hidden sm:block absolute right-2 -bottom-2 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
        {icon}
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="stitch-card overflow-hidden rounded-2xl">
      <div className="animate-pulse divide-y divide-slate-100">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="h-7 w-7 rounded-full bg-slate-200" />
            <div className="h-5 w-44 rounded-lg bg-slate-200" />
            <div className="ml-auto h-5 w-20 rounded-lg bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  title = "No Teams Evaluated Yet",
  message,
  actionText = "Upload Deck to Begin",
  actionTo = "/upload",
  onActionClick,
}: {
  title?: string;
  message: string;
  actionText?: string;
  actionTo?: string;
  onActionClick?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-white/70 py-16 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 shadow-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-7 w-7"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 17V9m6 8v-5m-9 5h12a2 2 0 002-2V8a2 2 0 00-2-2H6a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm">{message}</p>
      {onActionClick ? (
        <button
          type="button"
          onClick={onActionClick}
          className="mt-2 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-700"
        >
          {actionText}
        </button>
      ) : (
        <Link
          to={actionTo}
          className="mt-2 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-700"
        >
          {actionText}
        </Link>
      )}
    </div>
  );
}

function AddProblemStatementModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Please provide a title for the problem statement.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createProblemStatement({
        title: cleanTitle,
        reference_text: referenceText.trim(),
      });
      setTitle("");
      setReferenceText("");
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create problem statement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-indigo-50/50 to-purple-50/50">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/25">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Add Problem Statement</h2>
              <p className="text-xs text-slate-500">Create a new competition domain track</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="ps-title" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Domain / Title <span className="text-red-500">*</span>
            </label>
            <input
              id="ps-title"
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. AI-Powered Early Crop Disease Detection"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
            />
          </div>

          <div>
            <label htmlFor="ps-ref" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Reference Details & Context <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              id="ps-ref"
              rows={4}
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              placeholder="Provide background context, challenge requirements, constraints, or evaluation goals for this problem statement..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 resize-none"
            />
          </div>

          <div className="mt-2 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/25 hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Problem Statement"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RemoveProblemStatementModal({
  isOpen,
  onClose,
  problemStatements,
  groups,
  onRemoved,
}: {
  isOpen: boolean;
  onClose: () => void;
  problemStatements: ProblemStatement[] | null;
  groups: ProblemStatementGroup[] | null;
  onRemoved: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (problemStatements && problemStatements.length > 0) {
      if (!selectedId || !problemStatements.some((p) => p.id === selectedId)) {
        setSelectedId(problemStatements[0].id);
      }
    }
  }, [problemStatements, selectedId]);

  if (!isOpen) return null;

  const currentPs = problemStatements?.find((p) => p.id === selectedId);
  const subCount = groups?.find((g) => g.problem_statement_id === selectedId)?.submission_count ?? 0;

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !currentPs) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProblemStatement(selectedId);
      onRemoved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove problem statement.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-red-50/50 to-orange-50/50">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 text-white shadow-md shadow-red-600/25">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Remove Problem Statement</h2>
              <p className="text-xs text-slate-500">Delete an existing domain track and all associated evaluations</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleDelete} className="p-6 flex flex-col gap-4">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          {!problemStatements || problemStatements.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              No problem statements available to remove.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="ps-select" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Select Problem Statement to Remove
                </label>
                <select
                  id="ps-select"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 bg-white focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20"
                >
                  {problemStatements.map((ps) => {
                    const c = groups?.find((g) => g.problem_statement_id === ps.id)?.submission_count ?? 0;
                    return (
                      <option key={ps.id} value={ps.id}>
                        {ps.title} ({c} {c === 1 ? "team" : "teams"})
                      </option>
                    );
                  })}
                </select>
              </div>

              {currentPs && (
                <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-700">Domain Overview:</span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {subCount} {subCount === 1 ? "team" : "teams"} attached
                    </span>
                  </div>
                  <p className="font-semibold text-slate-900 text-sm">{currentPs.title}</p>
                  {currentPs.reference_text && (
                    <p className="text-slate-500 line-clamp-2">{currentPs.reference_text}</p>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 flex gap-3 items-start">
                <svg className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs text-amber-800 leading-relaxed">
                  <strong>Warning:</strong> Removing this problem statement will also permanently delete all decks, evaluations, and rankings attached to it.
                </p>
              </div>
            </>
          )}

          <div className="mt-2 flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleting || !selectedId}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-red-600/25 hover:bg-red-700 transition disabled:opacity-50"
            >
              {deleting ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Removing...
                </>
              ) : (
                "Permanently Remove"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProblemStatementGroupCard({
  group,
  selected,
  onToggleSelected,
  onSetManualRank,
  onDeleteRow,
  onDeleteGroup,
}: {
  group: ProblemStatementGroup;
  selected: Set<string>;
  onToggleSelected: (submissionId: string) => void;
  onSetManualRank: (submissionId: string, manualRank: number | null) => void;
  onDeleteRow: (row: RankingRow) => void;
  onDeleteGroup: (group: ProblemStatementGroup) => void;
}) {
  const [expanded, setExpanded] = useState(group.submission_count <= AUTO_EXPAND_MAX_SIZE);
  const sectionKeys = useMemo(() => sectionKeysOf(group.submissions), [group.submissions]);

  return (
    <div className="stitch-card overflow-hidden rounded-2xl transition-all">
      <div className="flex w-full items-center justify-between px-5 py-4 transition hover:bg-slate-50/80">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center justify-between pr-4 text-left group"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </span>
            <span
              title={group.title}
              className="truncate font-bold text-slate-800 text-sm sm:text-base group-hover:text-indigo-600 transition"
            >
              {group.title}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200/60">
              {group.submission_count} {group.submission_count === 1 ? "team" : "teams"}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-slate-200 transition">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteGroup(group);
          }}
          title={`Remove problem statement "${group.title}"`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-red-200/80 bg-red-50/70 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 hover:border-red-300 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Remove
        </button>
      </div>
      {expanded && (
        <div className="border-t border-slate-100 p-3 sm:p-4 bg-slate-50/40">
          <RankingTable
            rows={group.submissions}
            sectionKeys={sectionKeys}
            selected={selected}
            onToggleSelected={onToggleSelected}
            onSetManualRank={onSetManualRank}
            onDeleteRow={onDeleteRow}
          />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const confirm = useConfirm();
  const [view, setView] = useState<"overall" | "by-problem-statement">("overall");
  const [overall, setOverall] = useState<RankingRow[] | null>(null);
  const [groups, setGroups] = useState<ProblemStatementGroup[] | null>(null);
  const [allProblemStatements, setAllProblemStatements] = useState<ProblemStatement[] | null>(null);
  const [totalSubmitted, setTotalSubmitted] = useState<number | null>(null);
  const [totalScored, setTotalScored] = useState<number | null>(null);
  const [totalProblemStatements, setTotalProblemStatements] = useState<number | null>(null);
  const [totalAwaitingStage2, setTotalAwaitingStage2] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [stage2Message, setStage2Message] = useState<string | null>(null);
  const [triggeringStage2, setTriggeringStage2] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const navigate = useNavigate();

  function loadDashboardStats(): Promise<boolean> {
    return getDashboard().then((rows) => {
      setTotalSubmitted(rows.length);
      setTotalScored(rows.filter((r) => r.status === "scored").length);
      setTotalAwaitingStage2(
        rows.filter(
          (r) => r.status === "analyzing" && r.score_source === "stage1" && !r.stage2_selected,
        ).length,
      );
      return rows.some((r) => r.status !== "scored" && r.status !== "failed");
    });
  }

  function loadRankings() {
    getOverallRanking()
      .then(setOverall)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load rankings."));
    getRankingByProblemStatement()
      .then(setGroups)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load rankings."));
  }

  function loadProblemStatementsData() {
    listProblemStatements()
      .then((rows) => {
        setAllProblemStatements(rows);
        setTotalProblemStatements(rows.length);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadRankings();
    loadDashboardStats();
    loadProblemStatementsData();

    const interval = setInterval(() => {
      loadDashboardStats().then((inProgress) => {
        if (inProgress) {
          loadRankings();
          loadProblemStatementsData();
        }
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  async function handleTriggerStage2() {
    setTriggeringStage2(true);
    setStage2Message(null);
    try {
      const { selected_submission_ids } = await triggerStage2Selection();
      setStage2Message(
        selected_submission_ids.length === 0
          ? "Nothing new to select -- every eligible submission is already running Stage 2."
          : `Selected ${selected_submission_ids.length} submission(s) for full Stage 2 scoring. They'll finish processing in the background.`,
      );
      loadDashboardStats();
      loadRankings();
    } catch (err) {
      setStage2Message(
        err instanceof ApiError ? err.message : "Could not trigger Stage 2 selection.",
      );
    } finally {
      setTriggeringStage2(false);
    }
  }

  async function handleSetManualRank(submissionId: string, manualRank: number | null) {
    setPinError(null);
    try {
      await setManualRank(submissionId, manualRank);
      loadRankings();
    } catch (err) {
      setPinError(err instanceof ApiError ? err.message : "Could not update pinned rank.");
    }
  }

  async function handleDeleteRow(row: RankingRow) {
    const ok = await confirm(
      `Delete team "${row.team_name}"?\n\nAll submissions, slides, and evaluation scores for this team will be permanently deleted.`,
    );
    if (!ok) return;
    try {
      if (row.team_id) {
        await deleteTeam(row.team_id);
      } else {
        await deleteSubmission(row.submission_id);
      }
      loadRankings();
      loadDashboardStats();
      loadProblemStatementsData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete team");
    }
  }

  async function handleDeleteProblemStatementById(id: string, title: string) {
    const ok = await confirm(
      `Delete problem statement "${title}"?\n\nAll associated submissions and evaluations referencing this domain will be permanently deleted.`,
    );
    if (!ok) return;
    try {
      await deleteProblemStatement(id);
      loadRankings();
      loadDashboardStats();
      loadProblemStatementsData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete problem statement");
    }
  }

  async function handleDeleteGroup(group: ProblemStatementGroup) {
    await handleDeleteProblemStatementById(group.problem_statement_id, group.title);
  }

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

  function handleCompare() {
    navigate(`/compare?ids=${Array.from(selected).join(",")}`);
  }

  function handleDownloadCsv() {
    if (view === "overall") {
      const csv = rankingRowsToCsv(overall ?? [], overallSectionKeys, false);
      downloadCsv(csv, "hackeval-leaderboard-overall.csv");
    } else {
      const rows = (groups ?? []).flatMap((g) =>
        g.submissions.map((row) => ({ ...row, problem_statement: g.title })),
      );
      const sectionKeys = sectionKeysOf(rows);
      const csv = rankingRowsToCsv(rows, sectionKeys, true);
      downloadCsv(csv, "hackeval-leaderboard-by-problem-statement.csv");
    }
  }

  const overallSectionKeys = useMemo(() => sectionKeysOf(overall ?? []), [overall]);
  const loading = overall === null || groups === null;

  // Identify empty problem statements (ones without submissions in groups)
  const emptyProblemStatements = useMemo(() => {
    if (!allProblemStatements || !groups) return [];
    const activeIds = new Set(groups.map((g) => g.problem_statement_id));
    return allProblemStatements.filter((ps) => !activeIds.has(ps.id));
  }, [allProblemStatements, groups]);

  if (error) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center p-6">
        <div className="stitch-card max-w-md rounded-2xl p-6 text-center">
          <p className="font-semibold text-red-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Retry Connection
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 sm:px-6 lg:px-8 py-8 pb-28">
      {/* Top Banner / Hero Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/60 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100/90 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-300/60">
              🌱 Environmental & Chemical Engineering Hackathon
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100/80 px-3 py-1 text-xs font-bold text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-pulse"></span>
              Live Tournament Standings
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200/50">
              BOM & Academic Benchmark Integrated
            </span>
          </div>
          <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Hackathon Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Live evaluation scores for sustainable materials, polymer recycling, chemical compounding, and emission reduction grounded in peer-reviewed literature.
          </p>
        </div>

        {/* Single, Primary Action Button Group */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-indigo-700 shadow-sm transition-all hover:bg-indigo-50/70 hover:border-indigo-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Problem Statement
          </button>

          <button
            type="button"
            onClick={() => setIsRemoveModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50/70 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-red-700 shadow-sm transition-all hover:bg-red-100 hover:border-red-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Remove Problem Statement
          </button>

          <Link
            to="/upload"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition-all hover:scale-[1.02] hover:shadow-indigo-600/35"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Deck
          </Link>
        </div>
      </div>

      {pinError && (
        <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm font-medium text-red-700">
          {pinError}
        </div>
      )}

      {totalAwaitingStage2 > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/80 bg-amber-50/90 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-bold text-amber-900">
                {totalAwaitingStage2} submission{totalAwaitingStage2 === 1 ? "" : "s"} ready for full scoring
              </p>
              <p className="text-xs text-amber-700">
                Preliminary triage completed. Trigger deep 20-criteria scoring and literature benchmarking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleTriggerStage2}
            disabled={triggeringStage2}
            className="rounded-xl bg-amber-600 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-md shadow-amber-600/25 transition hover:bg-amber-700 disabled:opacity-60"
          >
            {triggeringStage2 ? "Evaluating..." : "Run Full Scoring"}
          </button>
        </div>
      )}

      {stage2Message && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/90 p-4 text-sm font-medium text-indigo-700">
          {stage2Message}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Teams Submitted"
          value={totalSubmitted}
          subtext="Total decks registered"
          gradient="bg-gradient-to-br from-indigo-500 to-indigo-700"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 20h5v-1a4 4 0 00-3-3.87M9 20H4v-1a4 4 0 013-3.87m5-4.13a4 4 0 100-8 4 4 0 000 8zm0 0a4 4 0 014 4v1H5v-1a4 4 0 014-4z"
              />
            </svg>
          }
        />
        <StatCard
          label="Decks Fully Scored"
          value={totalScored}
          subtext="Calibrated by AI jury"
          gradient="bg-gradient-to-br from-emerald-500 to-teal-700"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Active Problem Statements"
          value={totalProblemStatements}
          subtext="Domain tracks evaluated"
          gradient="bg-gradient-to-br from-purple-500 to-pink-600"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          }
        />
      </div>

      {/* Clean View Segmented Switcher (No duplicate buttons) */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-xl bg-slate-200/70 p-1 border border-slate-300/40">
          {(
            [
              { key: "overall" as const, label: "Overall Standings" },
              { key: "by-problem-statement" as const, label: "Grouped By Problem Statement" },
            ]
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              className={`rounded-lg px-4 py-2 text-xs sm:text-sm font-bold transition-all duration-150 ${
                view === tab.key
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!loading && (
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
            </svg>
            Download CSV
          </button>
        )}
      </div>

      {loading && <TableSkeleton />}

      {/* View 1: Overall Standings */}
      {!loading && view === "overall" && overall!.length === 0 && (
        <EmptyState message="No submissions have completed scoring yet." />
      )}

      {!loading && view === "overall" && overall!.length > 0 && (
        <RankingTable
          rows={overall!}
          sectionKeys={overallSectionKeys}
          selected={selected}
          onToggleSelected={toggleSelected}
          onSetManualRank={handleSetManualRank}
          onDeleteRow={handleDeleteRow}
        />
      )}

      {/* View 2: Grouped by Problem Statement */}
      {!loading && view === "by-problem-statement" && groups!.length === 0 && emptyProblemStatements.length === 0 && (
        <EmptyState
          title="No Problem Statements or Submissions"
          message="Create a problem statement or upload a presentation to generate domain rankings."
          actionText="Add Problem Statement"
          onActionClick={() => setIsAddModalOpen(true)}
        />
      )}

      {!loading && view === "by-problem-statement" && (groups!.length > 0 || emptyProblemStatements.length > 0) && (
        <div className="flex flex-col gap-4">
          {groups!.map((group) => (
            <ProblemStatementGroupCard
              key={group.problem_statement_id}
              group={group}
              selected={selected}
              onToggleSelected={toggleSelected}
              onSetManualRank={handleSetManualRank}
              onDeleteRow={handleDeleteRow}
              onDeleteGroup={handleDeleteGroup}
            />
          ))}

          {/* Display empty problem statements that have no submissions yet */}
          {emptyProblemStatements.map((ps) => (
            <div
              key={ps.id}
              className="stitch-card overflow-hidden rounded-2xl border-dashed border-2 border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/60"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </span>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm sm:text-base">{ps.title}</h3>
                  <p className="text-xs text-slate-500">
                    {ps.reference_text
                      ? ps.reference_text.slice(0, 100) + (ps.reference_text.length > 100 ? "..." : "")
                      : "No teams evaluated yet for this domain."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Link
                  to="/upload"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Upload Deck
                </Link>
                <button
                  type="button"
                  onClick={() => handleDeleteProblemStatementById(ps.id, ps.title)}
                  title={`Remove problem statement "${ps.title}"`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/70 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 hover:border-red-300 transition"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected.size >= MIN_COMPARE && (
        <div className="fixed bottom-6 inset-x-0 flex justify-center z-40 pointer-events-none">
          <button
            type="button"
            onClick={handleCompare}
            className="pointer-events-auto rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-600/30 transition-all hover:scale-105 hover:shadow-indigo-600/40 flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Compare {selected.size} Selected Teams
          </button>
        </div>
      )}

      {/* Add Problem Statement Modal */}
      <AddProblemStatementModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCreated={() => {
          loadProblemStatementsData();
          loadRankings();
        }}
      />

      {/* Remove Problem Statement Modal */}
      <RemoveProblemStatementModal
        isOpen={isRemoveModalOpen}
        onClose={() => setIsRemoveModalOpen(false)}
        problemStatements={allProblemStatements}
        groups={groups}
        onRemoved={() => {
          loadProblemStatementsData();
          loadRankings();
          loadDashboardStats();
        }}
      />
    </main>
  );
}
