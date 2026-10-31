import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import RankingTable from "../components/RankingTable";
import { useConfirm } from "../components/ConfirmDialog";
import { downloadCsv, rankingRowsToCsv } from "../lib/csv";
import { truncateAtWord } from "../lib/text";
import { useAdminAuth } from "../lib/useAdminAuth";
import {
  ApiError,
  createProblemStatement,
  deleteProblemStatement,
  deleteSubmission,
  getDashboard,
  getLeaderboardPublishStatus,
  getOverallRanking,
  getRankingByProblemStatement,
  getSubmissionStats,
  listProblemStatements,
  reEvaluateSubmission,
  reevaluateAllFailedSubmissions,
  setLeaderboardPublishStatus,
  setManualRank,
  triggerStage2Selection,
  type LeaderboardPublishStatus,
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
  subtext,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  subtext?: string;
}) {
  return (
    <div className="stitch-card rounded-xl border border-slate-200/80 p-4 sm:p-5 flex items-center gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums text-slate-900">
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
  showAction = true,
}: {
  title?: string;
  message: string;
  actionText?: string;
  actionTo?: string;
  onActionClick?: () => void;
  showAction?: boolean;
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
      {showAction &&
        (onActionClick ? (
          <button
            type="button"
            onClick={onActionClick}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            {actionText}
          </button>
        ) : (
          <Link
            to={actionTo}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            {actionText}
          </Link>
        ))}
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
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
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50"
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white">
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
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-700 transition disabled:opacity-50"
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
  onReEvaluateRow,
  onDeleteGroup,
  isAdmin,
  activeEvaluatingIds,
}: {
  group: ProblemStatementGroup;
  selected: Set<string>;
  onToggleSelected: (submissionId: string) => void;
  onSetManualRank: (submissionId: string, manualRank: number | null) => void;
  onDeleteRow: (row: RankingRow) => void;
  onReEvaluateRow?: (row: RankingRow) => Promise<void> | void;
  onDeleteGroup: (group: ProblemStatementGroup) => void;
  isAdmin: boolean;
  activeEvaluatingIds?: Set<string>;
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

        {isAdmin && (
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
        )}
      </div>
      {expanded && (
        <div className="border-t border-slate-100 p-3 sm:p-4 bg-slate-50/40">
          <RankingTable
            rows={group.submissions}
            sectionKeys={sectionKeys}
            selected={selected}
            onToggleSelected={onToggleSelected}
            onSetManualRank={isAdmin ? onSetManualRank : undefined}
            onDeleteRow={isAdmin ? onDeleteRow : undefined}
            onReEvaluateRow={isAdmin ? onReEvaluateRow : undefined}
            linkToTeam={isAdmin}
            isAdmin={isAdmin}
            activeEvaluatingIds={activeEvaluatingIds}
          />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { isAdmin } = useAdminAuth();
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
  const [bulkReEvaluating, setBulkReEvaluating] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [publishStatus, setPublishStatus] = useState<LeaderboardPublishStatus>({
    is_published: false,
    published_at: null,
  });
  const [togglingPublish, setTogglingPublish] = useState(false);
  const [reEvaluatingFailed, setReEvaluatingFailed] = useState(false);
  const [evaluatingIds, setEvaluatingIds] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<
    Array<{ id: string; type: "success" | "info" | "error"; title: string; detail?: string }>
  >([]);
  const navigate = useNavigate();

  const showToast = useCallback(
    (type: "success" | "info" | "error", title: string, detail?: string) => {
      const id = Math.random().toString(36).slice(2, 9);
      setToasts((prev) => [...prev, { id, type, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    [],
  );

  function loadPublishStatus(): void {
    getLeaderboardPublishStatus()
      .then(setPublishStatus)
      .catch(() => {});
  }

  async function handleTogglePublish(): Promise<void> {
    const nextState = !publishStatus.is_published;
    setTogglingPublish(true);
    try {
      const updated = await setLeaderboardPublishStatus(nextState);
      setPublishStatus(updated);
      loadRankings();
      showToast(
        "success",
        nextState ? "Leaderboard Published!" : "Leaderboard Unpublished",
        nextState
          ? "Scores and rankings are now visible to public viewers."
          : "Rankings are now hidden from public viewers.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update publication status.");
      showToast(
        "error",
        "Publish Update Failed",
        err instanceof ApiError ? err.message : "Failed to update publication status.",
      );
    } finally {
      setTogglingPublish(false);
    }
  }

  async function handleReEvaluateAllFailed(): Promise<void> {
    const ok = await confirm(
      "Re-evaluate all 0-score and failed submissions? Stale flags will be wiped and full scoring will re-run fresh across all active Groq API keys.",
    );
    if (!ok) return;
    setReEvaluatingFailed(true);
    try {
      const res = await reevaluateAllFailedSubmissions();
      if (res.submission_ids && res.submission_ids.length > 0) {
        setEvaluatingIds((prev) => new Set([...prev, ...res.submission_ids]));
      }
      showToast(
        "info",
        "Batch Re-evaluation Started",
        `Queued ${res.requeued_count} submissions! Scores will automatically refresh live as they complete.`,
      );
      loadRankings();
      loadStats();
    } catch (err) {
      showToast(
        "error",
        "Re-evaluation Failed",
        err instanceof Error ? err.message : "Failed to re-evaluate submissions.",
      );
    } finally {
      setReEvaluatingFailed(false);
    }
  }

  /** Public aggregate counts -- works for every viewer, admin or not. */
  function loadStats(): Promise<boolean> {
    return getSubmissionStats().then((stats) => {
      setTotalSubmitted(stats.total);
      setTotalScored(stats.scored);
      return stats.in_progress;
    });
  }

  /** Per-submission detail needed only for the admin "ready for full
   * scoring" banner -- getDashboard() is admin-gated, so this must never
   * run for a general viewer. */
  function loadAdminDashboardStats(): void {
    if (!isAdmin) return;
    getDashboard()
      .then((rows) => {
        setTotalAwaitingStage2(
          rows.filter(
            (r) => r.status === "analyzing" && r.score_source === "stage1" && !r.stage2_selected,
          ).length,
        );
      })
      .catch(() => {});
  }

  function loadRankings() {
    getOverallRanking()
      .then((data) => {
        setOverall(data);
        setError(null);
      })
      .catch((err) => {
        // Only set fatal error if we don't have rankings yet.
        // If data is already displayed, a polling glitch must never destroy the user's dashboard!
        setOverall((curr) => {
          if (curr === null) {
            setError(err instanceof ApiError ? err.message : "Could not load rankings.");
          }
          return curr;
        });
      });

    getRankingByProblemStatement()
      .then((data) => {
        setGroups(data);
      })
      .catch((err) => {
        setGroups((curr) => {
          if (curr === null) {
            setError(err instanceof ApiError ? err.message : "Could not load rankings.");
          }
          return curr;
        });
      });
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
    loadPublishStatus();
    loadRankings();
    loadStats();
    loadAdminDashboardStats();
    loadProblemStatementsData();

    const interval = setInterval(() => {
      loadPublishStatus();
      loadAdminDashboardStats();
      loadStats().then((inProgress) => {
        if (inProgress) {
          loadRankings();
          loadProblemStatementsData();
        }
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  // Active tracking for currently evaluating submission IDs
  useEffect(() => {
    if (evaluatingIds.size === 0) return;

    const interval = setInterval(async () => {
      try {
        const fresh = await getOverallRanking();
        if (fresh) {
          setOverall(fresh);
          setEvaluatingIds((prev) => {
            const next = new Set(prev);
            for (const id of prev) {
              const row = fresh.find((r) => r.submission_id === id);
              if (row && row.total > 0) {
                next.delete(id);
                showToast(
                  "success",
                  "Scoring Complete!",
                  `"${row.team_name}" finished scoring with total: ${Number(row.total.toFixed(2))}/${row.max_total}`,
                );
              }
            }
            return next;
          });
        }
        getRankingByProblemStatement().then(setGroups).catch(() => {});
        loadStats();
      } catch (e) {
        console.error("Evaluation poll failed:", e);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [evaluatingIds, showToast]);

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
      loadStats();
      loadAdminDashboardStats();
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
      `Delete this submission by "${row.team_name}"?\n\nOnly this submission (ID: ${String(row.submission_id).slice(0, 8)}…) will be deleted. If it is the team's last submission, the team entry will also be removed.`,
    );
    if (!ok) return;
    try {
      // Always delete by submission_id, not team_id.
      // Deleting by team_id would wipe ALL submissions for teams sharing the
      // same name (they share a team_id via _get_or_create_team's name-match).
      // The backend's DELETE /submissions/{id} already auto-removes the team
      // row when no submissions remain, so this covers both cases safely.
      await deleteSubmission(row.submission_id);
      loadRankings();
      loadStats();
      loadAdminDashboardStats();
      loadProblemStatementsData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete submission");
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
      loadStats();
      loadAdminDashboardStats();
      loadProblemStatementsData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete problem statement");
    }
  }

  async function handleDeleteGroup(group: ProblemStatementGroup) {
    await handleDeleteProblemStatementById(group.problem_statement_id, group.title);
  }

  async function handleReEvaluateRow(row: RankingRow) {
    setEvaluatingIds((prev) => new Set([...prev, row.submission_id]));
    showToast(
      "info",
      "Re-evaluation Started",
      `Analyzing presentation deck for "${row.team_name}". Full scoring pipeline has restarted.`,
    );
    try {
      await reEvaluateSubmission(row.submission_id);
      loadRankings();
      loadStats();
    } catch (err) {
      setEvaluatingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.submission_id);
        return next;
      });
      showToast(
        "error",
        "Re-evaluation Failed",
        err instanceof Error ? err.message : "Failed to re-evaluate submission",
      );
    }
  }

  async function handleBulkReEvaluate() {
    if (selected.size === 0) return;
    const ok = await confirm(
      `Re-evaluate all ${selected.size} selected submissions? This will re-queue full scoring from slide rendering through to deep analysis for each.`,
    );
    if (!ok) return;
    setBulkReEvaluating(true);
    try {
      const ids = Array.from(selected);
      setEvaluatingIds((prev) => new Set([...prev, ...ids]));
      showToast(
        "info",
        "Bulk Re-evaluation Queued",
        `Queued ${ids.length} submissions for scoring. Updates will stream in live.`,
      );
      let successCount = 0;
      for (const id of ids) {
        try {
          await reEvaluateSubmission(id);
          successCount++;
        } catch (e) {
          console.error(`Failed to re-evaluate ${id}:`, e);
        }
      }
      setSelected(new Set());
      loadRankings();
      loadStats();
    } finally {
      setBulkReEvaluating(false);
    }
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
      const csv = rankingRowsToCsv(overall ?? [], overallSectionKeys, false, isAdmin);
      downloadCsv(csv, "hackeval-leaderboard-overall.csv");
    } else {
      const rows = (groups ?? []).flatMap((g) =>
        g.submissions.map((row) => ({ ...row, problem_statement: g.title })),
      );
      const sectionKeys = sectionKeysOf(rows);
      const csv = rankingRowsToCsv(rows, sectionKeys, true, isAdmin);
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

  if (error && overall === null) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center p-6">
        <div className="stitch-card max-w-md rounded-2xl p-8 text-center shadow-lg border border-slate-200">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-slate-900 mb-1">Connection Issue</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            {error}. The server may be warming up from standby. Click below to reconnect.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              loadRankings();
              loadPublishStatus();
              loadStats();
              loadAdminDashboardStats();
              loadProblemStatementsData();
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-100 hover:bg-indigo-700 transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200/70">
              Environmental & Chemical Engineering Hackathon
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-pulse"></span>
              Live Standings
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
          {isAdmin && (
            <>
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
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white transition-colors hover:bg-indigo-700"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Deck
              </Link>
            </>
          )}
        </div>
      </div>

      {pinError && (
        <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm font-medium text-red-700">
          {pinError}
        </div>
      )}

      {isAdmin && totalAwaitingStage2 > 0 && (
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
            className="rounded-xl bg-amber-600 px-4 py-2 text-xs sm:text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
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
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
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
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Active Problem Statements"
          value={totalProblemStatements}
          subtext="Domain tracks evaluated"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          }
        />
      </div>

      {/* Admin Leaderboard Publication Bar */}
      {isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                publishStatus.is_published
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-amber-50 text-amber-600"
              }`}
            >
              {publishStatus.is_published ? (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">Leaderboard Visibility:</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    publishStatus.is_published
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      publishStatus.is_published ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                    }`}
                  />
                  {publishStatus.is_published ? "Published (Live for Everyone)" : "Draft (Hidden from Public Viewers)"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {publishStatus.is_published
                  ? "Participants and public viewers can currently see all rankings and scores."
                  : "Only logged-in admins can see these scores right now. Public viewers see an 'Under Evaluation' holding screen."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={reEvaluatingFailed}
              onClick={handleReEvaluateAllFailed}
              title="Re-run evaluation for any decks that scored 0 or encountered rate limits"
              className={`group relative inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all duration-300 shadow-sm ${
                reEvaluatingFailed
                  ? "bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600 text-white shadow-amber-200 cursor-wait ring-2 ring-amber-300"
                  : "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-400 active:scale-95"
              } disabled:opacity-75`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                className={`h-4 w-4 transition-transform duration-500 ${
                  reEvaluatingFailed
                    ? "animate-spin text-white"
                    : "group-hover:rotate-180 text-amber-700"
                }`}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>{reEvaluatingFailed ? "Queuing Scoring..." : "Re-evaluate 0-Score Decks"}</span>
            </button>
            <button
              type="button"
              disabled={togglingPublish}
              onClick={handleTogglePublish}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm ${
                publishStatus.is_published
                  ? "bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              } disabled:opacity-50`}
            >
              {togglingPublish ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-current" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Updating...
                </>
              ) : publishStatus.is_published ? (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                  Unpublish Leaderboard
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Publish Leaderboard
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {loading && <TableSkeleton />}

      {!loading && !isAdmin && !publishStatus.is_published && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-indigo-100 bg-gradient-to-b from-white to-indigo-50/30 py-20 px-6 text-center shadow-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="max-w-md">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/80 px-3 py-1 text-xs font-bold text-amber-800 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              Evaluation In Progress
            </span>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">
              Leaderboard Under Jury Evaluation
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Submissions are currently being evaluated and verified. The official hackathon rankings and scores will be published here once the jury finalizes the results.
            </p>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <svg className="h-4 w-4 text-indigo-500 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Auto-refreshing status periodically
          </div>
        </div>
      )}

      {/* Clean View Segmented Switcher (No duplicate buttons) */}
      {(isAdmin || publishStatus.is_published) && (
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
      )}

      {/* View 1: Overall Standings */}
      {!loading && (isAdmin || publishStatus.is_published) && view === "overall" && overall!.length === 0 && (
        <EmptyState message="No submissions have completed scoring yet." showAction={isAdmin} />
      )}

      {!loading && (isAdmin || publishStatus.is_published) && view === "overall" && overall!.length > 0 && (
        <RankingTable
          rows={overall!}
          sectionKeys={overallSectionKeys}
          selected={selected}
          onToggleSelected={toggleSelected}
          onSetManualRank={isAdmin ? handleSetManualRank : undefined}
          onDeleteRow={isAdmin ? handleDeleteRow : undefined}
          onReEvaluateRow={isAdmin ? handleReEvaluateRow : undefined}
          linkToTeam={isAdmin}
          isAdmin={isAdmin}
          activeEvaluatingIds={evaluatingIds}
        />
      )}

      {/* View 2: Grouped by Problem Statement */}
      {!loading && (isAdmin || publishStatus.is_published) && view === "by-problem-statement" && groups!.length === 0 && emptyProblemStatements.length === 0 && (
        <EmptyState
          title="No Problem Statements or Submissions"
          message="Create a problem statement or upload a presentation to generate domain rankings."
          actionText="Add Problem Statement"
          onActionClick={() => setIsAddModalOpen(true)}
          showAction={isAdmin}
        />
      )}

      {!loading && (isAdmin || publishStatus.is_published) && view === "by-problem-statement" && (groups!.length > 0 || emptyProblemStatements.length > 0) && (
        <div className="flex flex-col gap-4">
          {groups!.map((group) => (
            <ProblemStatementGroupCard
              key={group.problem_statement_id}
              group={group}
              selected={selected}
              onToggleSelected={toggleSelected}
              onSetManualRank={handleSetManualRank}
              onDeleteRow={handleDeleteRow}
              onReEvaluateRow={handleReEvaluateRow}
              onDeleteGroup={handleDeleteGroup}
              isAdmin={isAdmin}
              activeEvaluatingIds={evaluatingIds}
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
                      ? truncateAtWord(ps.reference_text, 100)
                      : "No teams evaluated yet for this domain."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                {isAdmin && (
                  <Link
                    to="/upload"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Upload Deck
                  </Link>
                )}
                {isAdmin && (
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
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-6 inset-x-0 flex justify-center z-40 pointer-events-none gap-3">
          {isAdmin && (
            <button
              type="button"
              onClick={handleBulkReEvaluate}
              disabled={bulkReEvaluating}
              className="pointer-events-auto rounded-full bg-amber-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg transition-colors hover:bg-amber-700 flex items-center gap-2 disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`h-4 w-4 ${bulkReEvaluating ? "animate-spin" : ""}`}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {bulkReEvaluating ? "Queuing..." : `Re-evaluate ${selected.size} Selected`}
            </button>
          )}
          {selected.size >= MIN_COMPARE && (
            <button
              type="button"
              onClick={handleCompare}
              className="pointer-events-auto rounded-full bg-indigo-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg transition-colors hover:bg-indigo-700 flex items-center gap-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Compare {selected.size} Selected Teams
            </button>
          )}
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
          loadStats();
          loadAdminDashboardStats();
        }}
      />
      {/* Non-blocking Animated Toast Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl p-4 shadow-xl border backdrop-blur-md transition-all duration-300 animate-slide-up ${
              toast.type === "success"
                ? "bg-slate-900/95 text-emerald-50 border-emerald-500/50 shadow-emerald-950/30"
                : toast.type === "error"
                ? "bg-slate-900/95 text-rose-50 border-rose-500/50 shadow-rose-950/30"
                : "bg-slate-900/95 text-white border-indigo-500/50 shadow-indigo-950/30"
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/10 mt-0.5">
              {toast.type === "success" ? (
                <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : toast.type === "error" ? (
                <svg className="h-4 w-4 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-4 w-4 text-indigo-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
            </span>
            <div className="flex-1 min-w-0 pr-1">
              <p className="text-xs font-bold leading-tight">{toast.title}</p>
              {toast.detail && <p className="text-[11px] opacity-80 mt-1 leading-relaxed">{toast.detail}</p>}
            </div>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-white/60 hover:text-white text-xs font-bold px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
