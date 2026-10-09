import type { ComparisonResponse } from "@hackeval/types";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#4f46e5", "#059669", "#d97706", "#e11d48", "#0284c7", "#7c3aed"];

interface ComparisonRadarChartProps {
  data: ComparisonResponse;
}

export default function ComparisonRadarChart({ data }: ComparisonRadarChartProps) {
  const [mode, setMode] = useState<"radar" | "bar">("radar");

  const radarData = data.sections.map((section) => {
    const row: Record<string, string | number> = { section };
    for (const s of data.submissions) row[s.team_name] = s.section_totals[section] ?? 0;
    return row;
  });

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-slate-700">Section comparison</h3>
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs">
          {(["radar", "bar"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 font-medium transition ${
                mode === m ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"
              }`}
            >
              {m === "radar" ? "Radar" : "Bar"}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={340}>
        {mode === "radar" ? (
          <RadarChart data={radarData}>
            <PolarGrid />
            <PolarAngleAxis dataKey="section" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis angle={30} domain={[0, 10]} />
            {data.submissions.map((s, i) => (
              <Radar
                key={s.submission_id}
                name={s.team_name}
                dataKey={s.team_name}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.15}
              />
            ))}
            <Legend />
            <Tooltip />
          </RadarChart>
        ) : (
          <BarChart data={radarData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="section" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 10]} />
            <Tooltip />
            <Legend />
            {data.submissions.map((s, i) => (
              <Bar key={s.submission_id} dataKey={s.team_name} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
