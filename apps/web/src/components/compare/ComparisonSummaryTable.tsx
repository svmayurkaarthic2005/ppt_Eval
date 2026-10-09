import type { ComparisonResponse } from "@hackeval/types";

const RELIABILITY_COLORS: Record<string, string> = {
  HIGH: "bg-green-100 text-green-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  REVIEW: "bg-red-100 text-red-800",
};

interface ComparisonSummaryTableProps {
  data: ComparisonResponse;
}

export default function ComparisonSummaryTable({ data }: ComparisonSummaryTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white shadow-sm">
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="px-3 py-2.5">Team</th>
            {data.sections.map((section) => (
              <th key={section} className="px-3 py-2.5">
                {section}
              </th>
            ))}
            <th className="px-3 py-2.5">Total /40</th>
            <th className="px-3 py-2.5">Reliability</th>
            <th className="px-3 py-2.5">Flags</th>
          </tr>
        </thead>
        <tbody>
          {data.submissions.map((s) => (
            <tr key={s.submission_id} className="border-b border-slate-100">
              <td className="px-3 py-2.5 font-medium text-slate-800">{s.team_name}</td>
              {data.sections.map((section) => (
                <td key={section} className="px-3 py-2.5">
                  {s.section_totals[section] ?? "-"}
                </td>
              ))}
              <td className="px-3 py-2.5 font-semibold text-slate-900">{s.final_total}</td>
              <td className="px-3 py-2.5">
                {s.reliability && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${RELIABILITY_COLORS[s.reliability]}`}
                  >
                    {s.reliability}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">{s.flag_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
