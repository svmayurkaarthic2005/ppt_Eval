import type { ReliabilityLabel, RankingRow } from "@hackeval/types";
import { useState } from "react";
import { Link } from "react-router-dom";

const MAX_COMPARE = 6;

const RELIABILITY_COLORS: Record<ReliabilityLabel, string> = {
  HIGH: "bg-emerald-50 text-emerald-700 border border-emerald-200/80",
  MEDIUM: "bg-amber-50 text-amber-700 border border-amber-200/80",
  REVIEW: "bg-rose-50 text-rose-700 border border-rose-200/80",
};

const TOP_RANK_STYLES: Record<number, string> = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-slate-300 text-slate-900",
  3: "bg-amber-700 text-white",
};

function RankBadge({ rank }: { rank: number }) {
  const topStyle = TOP_RANK_STYLES[rank];
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-xl text-xs font-black ${
        topStyle ?? "bg-slate-100 font-bold text-slate-600 border border-slate-200/60"
      }`}
    >
      #{rank}
    </span>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      className="h-3.5 w-3.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.586 8.414l-4.95 1.414-3.293 3.293 7.07 7.071 3.293-3.293 1.414-4.95-3.534-3.535zM9 15l-5 5"
      />
    </svg>
  );
}

function RankCell({
  row,
  onSetManualRank,
}: {
  row: RankingRow;
  onSetManualRank?: (submissionId: string, manualRank: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(row.manual_rank ?? ""));
  const pinned = row.manual_rank !== null;

  if (!onSetManualRank) {
    return <RankBadge rank={row.rank} />;
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={1}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-12 rounded-lg border border-indigo-400 px-1.5 py-0.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
          placeholder="#"
        />
        <button
          type="button"
          title="Save pin"
          onClick={() => {
            const n = Number(draft);
            if (draft !== "" && Number.isFinite(n) && n >= 1) {
              onSetManualRank(row.submission_id, n);
            }
            setEditing(false);
          }}
          className="rounded-lg bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-indigo-700 shadow-sm"
        >
          ✓
        </button>
        {pinned && (
          <button
            type="button"
            title="Unpin"
            onClick={() => {
              onSetManualRank(row.submission_id, null);
              setDraft("");
              setEditing(false);
            }}
            className="rounded-lg bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600 hover:bg-slate-300"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <RankBadge rank={row.rank} />
      <button
        type="button"
        title={pinned ? `Pinned to #${row.manual_rank}` : "Pin this rank"}
        onClick={() => {
          setDraft(String(row.manual_rank ?? ""));
          setEditing(true);
        }}
        className={`flex h-6 w-6 items-center justify-center rounded-lg transition ${
          pinned ? "text-indigo-600 bg-indigo-50" : "text-slate-300 hover:text-slate-500 hover:bg-slate-100"
        }`}
      >
        <PinIcon filled={pinned} />
      </button>
    </div>
  );
}

export default function RankingTable({
  rows,
  sectionKeys,
  selected,
  onToggleSelected,
  onSetManualRank,
  onDeleteRow,
  onReEvaluateRow,
  linkToTeam = true,
  isAdmin,
}: {
  rows: RankingRow[];
  sectionKeys: string[];
  selected: Set<string>;
  onToggleSelected: (submissionId: string) => void;
  onSetManualRank?: (submissionId: string, manualRank: number | null) => void;
  onDeleteRow?: (row: RankingRow) => void;
  onReEvaluateRow?: (row: RankingRow) => Promise<void> | void;
  /** Team drill-down (and compare selection, which only makes sense once
   * you can open a team page) is admin-only -- general viewers get a
   * read-only rank table with no navigable rows. */
  linkToTeam?: boolean;
  /** When false (viewer mode), Reliability, Flags, and Actions columns are hidden */
  isAdmin?: boolean;
  /** Set of submission IDs currently undergoing active re-evaluation */
  activeEvaluatingIds?: Set<string>;
}) {
  const isUserAdmin = Boolean(isAdmin);
  const [reEvaluatingId, setReEvaluatingId] = useState<string | null>(null);

  async function handleReEvaluate(row: RankingRow) {
    if (!onReEvaluateRow) return;
    setReEvaluatingId(row.submission_id);
    try {
      await onReEvaluateRow(row);
    } finally {
      setReEvaluatingId(null);
    }
  }

  return (
    <div className="stitch-card overflow-x-auto rounded-2xl shadow-sm [mask-image:linear-gradient(to_right,black_96%,transparent_100%)]">
      <table className="w-full min-w-max text-left text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-200/80 bg-slate-50/90 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
            {isUserAdmin && <th className="px-4 py-3.5 w-10"></th>}
            <th className="px-4 py-3.5">Rank</th>
            <th className="px-4 py-3.5">Team & Project</th>
            {/* Hidden below sm: the score is shown inline under the team
                name there instead, so it's visible without having to
                scroll the table horizontally on a phone. */}
            <th className="hidden sm:table-cell px-4 py-3.5">Total Score</th>
            {/* Per-section breakdown is already shown on each team's own
                detail page -- hidden below lg here so the table doesn't
                force a long horizontal scroll on mobile/tablet just to
                reach Reliability/Flags/Actions. */}
            {sectionKeys.map((key) => (
              <th key={key} className="hidden lg:table-cell px-4 py-3.5 whitespace-nowrap">
                {key === "execution_plan_timeline"
                  ? "Timeline"
                  : key === "existing_solutions"
                  ? "Prior Art"
                  : key === "problem_understanding"
                  ? "Problem Depth"
                  : key === "proposed_solution_affordability"
                  ? "Solution Fit"
                  : key.replace(/_/g, " ")}
              </th>
            ))}
            {isUserAdmin && <th className="px-4 py-3.5">Reliability</th>}
            {isUserAdmin && <th className="px-4 py-3.5 text-center">Flags</th>}
            {isUserAdmin && (onDeleteRow || onReEvaluateRow) && (
              <th className="px-4 py-3.5 text-right">Actions</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const isSelected = selected.has(row.submission_id);
            const isEvaluating =
              Boolean(activeEvaluatingIds?.has(row.submission_id)) ||
              reEvaluatingId === row.submission_id;
            const scorePct = row.max_total > 0 ? (row.total / row.max_total) * 100 : 0;
            return (
              <tr
                key={row.submission_id}
                className={`transition-all duration-300 relative ${
                  isEvaluating
                    ? "bg-indigo-50/90 ring-1 ring-inset ring-indigo-300"
                    : isSelected
                    ? "bg-indigo-50/70"
                    : "hover:bg-slate-50/80"
                }`}
              >
                {isUserAdmin && (
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelected(row.submission_id)}
                      disabled={!isSelected && selected.size >= MAX_COMPARE}
                      className="h-4 w-4 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 transition cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-4 py-3.5">
                  <RankCell row={row} onSetManualRank={onSetManualRank} />
                </td>
                <td className="px-4 py-3.5">
                  {isUserAdmin ? (
                    <Link to={`/team/${row.submission_id}`} className="group block">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 group-hover:text-indigo-600 transition text-sm">
                          {row.team_name}
                        </span>
                        {isEvaluating && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700 animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-ping" />
                            Evaluating
                          </span>
                        )}
                      </div>
                      <span className="block text-[11px] text-slate-600">
                        ID: {row.submission_id.slice(0, 8)}...
                      </span>
                    </Link>
                  ) : (
                    <div className="block">
                      <span className="font-bold text-slate-900 text-sm">{row.team_name}</span>
                      <span className="mt-1 flex items-center gap-1.5 sm:hidden">
                        <span className="font-extrabold tabular-nums text-slate-900 text-sm">
                          {Number(row.total.toFixed(2))}
                        </span>
                        <span className="text-xs text-slate-600 font-medium">/ {Number(row.max_total.toFixed(2))}</span>
                      </span>
                    </div>
                  )}
                </td>
                <td className="hidden sm:table-cell whitespace-nowrap px-4 py-3.5">
                  {isEvaluating ? (
                    <div className="inline-flex items-center gap-2 rounded-xl bg-indigo-100/90 px-3 py-1.5 text-xs font-bold text-indigo-800 shadow-sm animate-pulse border border-indigo-200">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
                      </span>
                      <span>Re-scoring deck</span>
                      <span className="inline-flex gap-0.5 ml-0.5">
                        <span className="dot-1 h-1 w-1 rounded-full bg-indigo-600 inline-block" />
                        <span className="dot-2 h-1 w-1 rounded-full bg-indigo-600 inline-block" />
                        <span className="dot-3 h-1 w-1 rounded-full bg-indigo-600 inline-block" />
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <span className="font-extrabold tabular-nums text-slate-900 text-sm">
                        {Number(row.total.toFixed(2))}
                      </span>
                      <span className="text-xs text-slate-600 font-medium">/ {Number(row.max_total.toFixed(2))}</span>
                      <div className="hidden lg:block w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-600"
                          style={{ width: `${Math.min(100, Math.max(0, scorePct))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </td>
                {sectionKeys.map((key) => (
                  <td key={key} className="hidden lg:table-cell px-4 py-3.5 text-slate-600 font-semibold tabular-nums text-xs sm:text-sm">
                    {isEvaluating ? (
                      <span className="inline-block w-8 h-3 rounded bg-indigo-200/60 animate-pulse" />
                    ) : (
                      row.section_totals[key] != null ? Number(row.section_totals[key].toFixed(2)) : "-"
                    )}
                  </td>
                ))}
                {isUserAdmin && (
                  <td className="px-4 py-3.5">
                    {isEvaluating ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 shadow-sm animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-ping-soft" />
                        Analyzing
                      </span>
                    ) : (
                      row.reliability_label && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${RELIABILITY_COLORS[row.reliability_label]}`}
                        >
                          {row.reliability_label}
                        </span>
                      )
                    )}
                  </td>
                )}
                {isUserAdmin && (
                  <td className="px-4 py-3.5 text-center">
                    {isEvaluating ? (
                      <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-xs font-bold bg-indigo-100/80 text-indigo-700 border border-indigo-200 animate-pulse">
                        <svg className="h-3 w-3 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                      </span>
                    ) : (
                      <span className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-xs font-bold ${
                        row.flag_count > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                      }`}>
                        {row.flag_count}
                      </span>
                    )}
                  </td>
                )}
                {isUserAdmin && (onDeleteRow || onReEvaluateRow) && (
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {onReEvaluateRow && (
                        <button
                          type="button"
                          onClick={() => handleReEvaluate(row)}
                          disabled={isEvaluating}
                          title={`Re-evaluate ${row.team_name}`}
                          className={`group relative inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-sm transition-all duration-300 overflow-hidden ${
                            isEvaluating
                              ? "bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white shadow-md shadow-indigo-200 cursor-wait ring-2 ring-indigo-300"
                              : "border border-indigo-200/90 bg-indigo-50/70 text-indigo-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 hover:shadow-md hover:shadow-indigo-100 active:scale-95"
                          }`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            className={`h-3.5 w-3.5 transition-transform duration-500 ${
                              isEvaluating
                                ? "animate-spin text-white"
                                : "group-hover:rotate-180 text-indigo-600 group-hover:text-white"
                            }`}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>{isEvaluating ? "Evaluating..." : "Re-evaluate"}</span>
                        </button>
                      )}
                      {onDeleteRow && (
                        <button
                          type="button"
                          onClick={() => onDeleteRow(row)}
                          title={`Delete ${row.team_name}`}
                          className="inline-flex items-center gap-1 rounded-xl border border-red-200/80 bg-red-50/70 px-2.5 py-1 text-xs font-semibold text-red-700 shadow-sm transition-all hover:bg-red-600 hover:text-white hover:border-red-600"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
