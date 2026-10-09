import type { DashboardRow, ReliabilityLabel } from "@hackeval/types";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { ApiError, getDashboard } from "../lib/api";

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
  }, []);

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

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

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
            className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700"
          >
            Compare {selected.size} teams
          </button>
        </div>
      )}
    </main>
  );
}
