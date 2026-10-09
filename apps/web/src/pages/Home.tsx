import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import RankingTable from "../components/RankingTable";
import { useConfirm } from "../components/ConfirmDialog";
import {
  ApiError,
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
import type { ProblemStatementGroup, RankingRow } from "@hackeval/types";

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
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md ${gradient} transition-transform group-hover:scale-105`}>
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums text-slate-900">
              {value === null ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-200" /> : value}
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-white/70 py-16 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 17V9m6 8v-5m-9 5h12a2 2 0 002-2V8a2 2 0 00-2-2H6a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-slate-800">No Teams Evaluated Yet</h3>
      <p className="text-sm text-slate-500 max-w-sm">{message}</p>
      <Link
        to="/upload"
        className="mt-2 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition hover:bg-indigo-700"
      >
        Upload Deck to Begin
      </Link>
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
          title={`Delete problem statement "${group.title}"`}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 opacity-60 hover:bg-red-50 hover:text-red-600 hover:opacity-100 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
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
  const [totalSubmitted, setTotalSubmitted] = useState<number | null>(null);
  const [totalScored, setTotalScored] = useState<number | null>(null);
  const [totalProblemStatements, setTotalProblemStatements] = useState<number | null>(null);
  const [totalAwaitingStage2, setTotalAwaitingStage2] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [stage2Message, setStage2Message] = useState<string | null>(null);
  const [triggeringStage2, setTriggeringStage2] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  // Rankings only change while some submission is actually being processed;
  // polling them on a fixed timer regardless of that wastes 2 extra API
  // calls every tick for as long as the tab is left open (and indefinitely,
  // since this page has no terminal state to stop at the way a single
  // submission's own status does). loadDashboardStats's return value says
  // whether anything is in flight right now, so the poll can skip the
  // ranking refetch whenever nothing is.
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

  useEffect(() => {
    loadRankings();
    loadDashboardStats();
    listProblemStatements().then((rows) => setTotalProblemStatements(rows.length));

    const interval = setInterval(() => {
      loadDashboardStats().then((inProgress) => {
        if (inProgress) loadRankings();
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete team");
    }
  }

  async function handleDeleteGroup(group: ProblemStatementGroup) {
    const ok = await confirm(
      `Delete problem statement "${group.title}"?\n\nAll submissions evaluating against this problem statement will also be deleted.`,
    );
    if (!ok) return;
    try {
      await deleteProblemStatement(group.problem_statement_id);
      loadRankings();
      loadDashboardStats();
      listProblemStatements().then((rows) => setTotalProblemStatements(rows.length));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete problem statement");
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

  const overallSectionKeys = useMemo(() => sectionKeysOf(overall ?? []), [overall]);
  const loading = overall === null || groups === null;

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
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100/80 px-3 py-1 text-xs font-bold text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-pulse"></span>
              Live Tournament Standings
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200/50">
              Academic Benchmark Integrated
            </span>
          </div>
          <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Hackathon Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Live evaluation scores, grounded in peer-reviewed literature across IEEE and arXiv.
          </p>
        </div>

        <Link
          to="/upload"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition-all hover:scale-[1.02] hover:shadow-indigo-600/35"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Upload Submission Deck
        </Link>
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
          subtext="Domains evaluated"
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

      {/* View Segmented Switcher */}
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
      </div>

      {loading && <TableSkeleton />}

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

      {!loading && view === "by-problem-statement" && groups!.length === 0 && (
        <EmptyState message="No submissions have completed scoring yet." />
      )}

      {!loading && view === "by-problem-statement" && groups!.length > 0 && (
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
    </main>
  );
}
