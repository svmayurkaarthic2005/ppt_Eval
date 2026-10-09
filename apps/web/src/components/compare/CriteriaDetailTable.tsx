import type { ComparisonResponse } from "@hackeval/types";
import { useMemo } from "react";

interface CriteriaDetailTableProps {
  data: ComparisonResponse;
}

interface Row {
  section: string;
  criterionKey: string;
  maxScore: number;
  rationaleBySubmission: Record<string, string>;
  scoreBySubmission: Record<string, number | null>;
}

export default function CriteriaDetailTable({ data }: CriteriaDetailTableProps) {
  const rows = useMemo<Row[]>(() => {
    const bySection = new Map<string, Map<string, Row>>();
    for (const section of data.sections) bySection.set(section, new Map());

    for (const submission of data.submissions) {
      for (const c of submission.criteria) {
        const sectionRows = bySection.get(c.section) ?? bySection.set(c.section, new Map()).get(c.section)!;
        let row = sectionRows.get(c.criterion_key);
        if (!row) {
          row = {
            section: c.section,
            criterionKey: c.criterion_key,
            maxScore: c.max_score,
            rationaleBySubmission: {},
            scoreBySubmission: {},
          };
          sectionRows.set(c.criterion_key, row);
        }
        row.scoreBySubmission[submission.submission_id] = c.score;
        row.rationaleBySubmission[submission.submission_id] = c.rationale;
      }
    }

    return Array.from(bySection.values()).flatMap((sectionRows) => Array.from(sectionRows.values()));
  }, [data]);

  const showDelta = data.submissions.length === 2;
  const [teamA, teamB] = data.submissions;

  return (
    <div className="max-h-[560px] overflow-auto rounded-lg bg-white shadow-sm">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white shadow-sm">
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="px-3 py-2.5">Criterion</th>
            {data.submissions.map((s) => (
              <th key={s.submission_id} className="px-3 py-2.5">
                {s.team_name}
              </th>
            ))}
            {showDelta && <th className="px-3 py-2.5">Δ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const scores = Object.values(row.scoreBySubmission).filter(
              (v): v is number => v !== null && v !== undefined,
            );
            const maxInRow = scores.length > 0 ? Math.max(...scores) : null;

            return (
              <tr key={`${row.section}-${row.criterionKey}`} className="border-b border-slate-100">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-slate-800">{row.criterionKey}</p>
                  <p className="text-xs text-slate-400">{row.section}</p>
                </td>
                {data.submissions.map((s) => {
                  const score = row.scoreBySubmission[s.submission_id];
                  const isMax = score !== null && score !== undefined && score === maxInRow;
                  return (
                    <td
                      key={s.submission_id}
                      title={row.rationaleBySubmission[s.submission_id] ?? ""}
                      className={`px-3 py-2.5 ${isMax ? "rounded bg-emerald-50 font-semibold text-emerald-800" : "text-slate-700"}`}
                    >
                      {score ?? "-"}/{row.maxScore}
                    </td>
                  );
                })}
                {showDelta && (
                  <td className="px-3 py-2.5 text-slate-500">
                    {(() => {
                      const a = row.scoreBySubmission[teamA.submission_id];
                      const b = row.scoreBySubmission[teamB.submission_id];
                      if (a === null || a === undefined || b === null || b === undefined) return "-";
                      const delta = a - b;
                      return delta > 0 ? `+${delta}` : `${delta}`;
                    })()}
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
