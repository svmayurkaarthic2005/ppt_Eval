import type { DashboardRow, ReliabilityLabel } from "@hackeval/types";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import {
  ApiError,
  getDashboard,
  getLeaderboardPublishStatus,
  setLeaderboardPublishStatus,
  type LeaderboardPublishStatus,
} from "../lib/api";
import { useAdminAuth } from "../lib/useAdminAuth";

const MAX_COMPARE = 6;

type SortKey = "rank" | "team_name" | "total";

const RELIABILITY_COLORS: Record<ReliabilityLabel, string> = {
  HIGH: "bg-green-100 text-green-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  REVIEW: "bg-red-100 text-red-800",
};

function toCsv(rows: DashboardRow[], sectionKeys: string[]): string {
  const header = [
    "rank",
    "team_name",
    "status",
    "total",
    "max_total",
    ...sectionKeys,
    "reliability_label",
    "flag_count",
    "flag_types",
  ];
  const lines = rows.map((row, i) =>
    [
      i + 1,
      row.team_name,
      row.status,
      row.total ?? "",
      row.max_total,
      ...sectionKeys.map((key) => row.section_totals[key] ?? ""),
      row.reliability_label ?? "",
      row.flag_count,
      row.flag_types.join("; "),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export default function Dashboard() {
  const { isAdmin, loading: authLoading } = useAdminAuth();
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reliabilityFilter, setReliabilityFilter] = useState("");
  const [flagTypeFilter, setFlagTypeFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState<string | null>(
    (location.state as { toast?: string } | null)?.toast ?? null,
  );

  const [publishStatus, setPublishStatus] = useState<LeaderboardPublishStatus | null>(null);
  const [togglingPublish, setTogglingPublish] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    getDashboard()
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load dashboard."))
      .finally(() => setLoading(false));

    getLeaderboardPublishStatus()
      .then(setPublishStatus)
      .catch(() => {});
  }, []);

  async function handleTogglePublish() {
    if (!publishStatus) return;
    const nextState = !publishStatus.is_published;
    setTogglingPublish(true);
    try {
      const updated = await setLeaderboardPublishStatus(nextState);
      setPublishStatus(updated);
      setToast(
        nextState
          ? "Leaderboard is now published and live for all viewers!"
          : "Leaderboard has been unpublished (hidden from public viewers).",
      );
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "Failed to update publication status.");
    } finally {
      setTogglingPublish(false);
    }
  }

  function toggleSelected(submissionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(submissionId)) {
        next.delete(submissionId);
      } else if (next.size < MAX_COMPARE) {
        next.add(submissionId);
      }
      return next;
    });
  }

  function handleCompare() {
    navigate(`/compare?ids=${Array.from(selected).join(",")}`);
  }

  const sectionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) for (const key of Object.keys(r.section_totals)) keys.add(key);
    return Array.from(keys).sort();
  }, [rows]);

  const flagTypes = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.flag_types))).sort(),
    [rows],
  );

  const filtered = rows
    .filter((r) => !reliabilityFilter || r.reliability_label === reliabilityFilter)
    .filter((r) => !flagTypeFilter || r.flag_types.includes(flagTypeFilter));

  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    if (sortKey === "team_name") diff = a.team_name.localeCompare(b.team_name);
    else if (sortKey === "total") diff = (a.total ?? -1) - (b.total ?? -1);
    return sortAsc ? diff : -diff;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === "team_name");
    }
  }

  function handleExportCsv() {
    const csv = toCsv(sorted, sectionKeys);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hackeval-dashboard.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading || loading) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  if (!isAdmin) return <Navigate to="/login" replace />;

  if (error) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-57px)] max-w-6xl flex-col gap-6 bg-slate-50 px-4 py-12">
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <button
          type="button"
          onClick={handleExportCsv}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Export CSV
        </button>
      </div>

      {/* Leaderboard Publication Control Card */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-900">Leaderboard Publication</h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  publishStatus?.is_published
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    publishStatus?.is_published ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                  }`}
                />
                {publishStatus?.is_published ? "Published (Live to Public)" : "Draft (Admins Only)"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {publishStatus?.is_published
                ? "The leaderboard results are currently public and visible to all participants and viewers."
                : "Results are hidden from regular viewers while evaluation is in progress. Only logged-in admins can view scores."}
            </p>
          </div>
          <button
            type="button"
            disabled={togglingPublish || !publishStatus}
            onClick={handleTogglePublish}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition shadow-sm ${
              publishStatus?.is_published
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
            ) : publishStatus?.is_published ? (
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

      <div className="flex flex-wrap gap-3">
        <select
          value={reliabilityFilter}
          onChange={(e) => setReliabilityFilter(e.target.value)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All reliability labels</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="REVIEW">REVIEW</option>
        </select>

        <select
          value={flagTypeFilter}
          onChange={(e) => setFlagTypeFilter(e.target.value)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All flag types</option>
          {flagTypes.map((ft) => (
            <option key={ft} value={ft}>
              {ft}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full min-w-max text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Rank</th>
              <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("team_name")}>
                Team
              </th>
              <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("total")}>
                Total /40
              </th>
              {sectionKeys.map((key) => (
                <th key={key} className="px-3 py-2">
                  {key}
                </th>
              ))}
              <th className="px-3 py-2">Reliability</th>
              <th className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.submission_id} className="border-b border-slate-100">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.submission_id)}
                    onChange={() => toggleSelected(row.submission_id)}
                    disabled={!selected.has(row.submission_id) && selected.size >= MAX_COMPARE}
                  />
                </td>
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link to={`/team/${row.submission_id}`} className="text-slate-800 underline">
                    {row.team_name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {row.total !== null ? (
                    `${row.total}/${row.max_total}`
                  ) : (
                    <span className="italic text-slate-400">{row.status}...</span>
                  )}
                </td>
                {sectionKeys.map((key) => (
                  <td key={key} className="px-3 py-2">
                    {row.section_totals[key] ?? "-"}
                  </td>
                ))}
                <td className="px-3 py-2">
                  {row.reliability_label && (
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${RELIABILITY_COLORS[row.reliability_label]}`}
                    >
                      {row.reliability_label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{row.flag_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size >= 2 && (
        <div className="sticky bottom-4 flex justify-center">
          <button
            type="button"
            onClick={handleCompare}
            className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-indigo-700"
          >
            Compare {selected.size} teams
          </button>
        </div>
      )}
    </main>
  );
}
