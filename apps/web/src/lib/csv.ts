import type { RankingRow } from "@hackeval/types";

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function rankingRowsToCsv(
  rows: (RankingRow & { problem_statement?: string })[],
  sectionKeys: string[],
  includeProblemStatement: boolean,
): string {
  const header = [
    "Rank",
    ...(includeProblemStatement ? ["Problem Statement"] : []),
    "Team",
    "Submission ID",
    "Total Score",
    "Max Score",
    ...sectionKeys,
    "Reliability",
    "Flags",
  ];

  const lines = rows.map((row) => {
    const cells = [
      row.manual_rank ?? row.rank,
      ...(includeProblemStatement ? [row.problem_statement ?? ""] : []),
      row.team_name,
      row.submission_id,
      Number(row.total.toFixed(2)),
      Number(row.max_total.toFixed(2)),
      ...sectionKeys.map((key) =>
        row.section_totals[key] != null ? Number(row.section_totals[key].toFixed(2)) : "",
      ),
      row.reliability_label ?? "",
      row.flag_count,
    ];
    return cells.map(escapeCsvCell).join(",");
  });

  return [header.map(escapeCsvCell).join(","), ...lines].join("\r\n");
}

export function downloadCsv(csv: string, filename: string): void {
  // Leading BOM so Excel detects UTF-8 instead of mangling non-ASCII team names.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
