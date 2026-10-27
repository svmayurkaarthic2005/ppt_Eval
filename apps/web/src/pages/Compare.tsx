import type { ComparisonResponse, RubricVersionMismatchErrorBody } from "@hackeval/types";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import ComparisonHeader from "../components/compare/ComparisonHeader";
import ComparisonRadarChart from "../components/compare/ComparisonRadarChart";
import ComparisonSummaryTable from "../components/compare/ComparisonSummaryTable";
import CriteriaDetailTable from "../components/compare/CriteriaDetailTable";
import { ApiError, RubricMismatchError, getComparison } from "../lib/api";
import { useAdminAuth } from "../lib/useAdminAuth";

const MIN_TEAMS = 2;

function SkeletonTable() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-8 w-1/3 rounded bg-slate-200" />
      <div className="h-40 rounded-lg bg-slate-100" />
      <div className="h-64 rounded-lg bg-slate-100" />
    </div>
  );
}

export default function Compare() {
  const { isAdmin, loading: authLoading } = useAdminAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // The URL's `ids` param is the single source of truth -- de-duplicated
  // before fetching so a URL with repeats never fetches/renders twice.
  const ids = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    return Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
  }, [searchParams]);

  const [data, setData] = useState<ComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<RubricVersionMismatchErrorBody | null>(null);

  useEffect(() => {
    if (ids.length < MIN_TEAMS) {
      navigate("/dashboard", {
        state: { toast: "Select at least 2 teams to compare." },
      });
      return;
    }

    setLoading(true);
    setError(null);
    setMismatch(null);
    getComparison(ids)
      .then(setData)
      .catch((err) => {
        if (err instanceof RubricMismatchError) {
          setMismatch(err.body);
        } else {
          setError(err instanceof ApiError ? err.message : "Could not load comparison.");
        }
      })
      .finally(() => setLoading(false));
  }, [ids, navigate]);

  function handleRemove(submissionId: string) {
    const remaining = ids.filter((id) => id !== submissionId);
    if (remaining.length < MIN_TEAMS) {
      navigate("/dashboard", {
        state: { toast: "At least 2 teams are needed to compare." },
      });
      return;
    }
    setSearchParams({ ids: remaining.join(",") });
  }

  if (authLoading || loading) {
    return (
      <main className="mx-auto min-h-[calc(100vh-57px)] max-w-6xl bg-slate-50 px-4 py-12">
        <SkeletonTable />
      </main>
    );
  }

  if (!isAdmin) return <Navigate to="/login" replace />;

  if (mismatch) {
    const names = mismatch.details.map((d) => d.submission_id.slice(0, 8)).join(" and ");
    return (
      <main className="mx-auto flex min-h-[calc(100vh-57px)] max-w-2xl flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <h1 className="text-lg font-semibold text-slate-800">Can't compare these submissions</h1>
        <p className="text-sm text-slate-600">
          Submissions {names} were scored under different rubric versions and can't be compared
          directly.
        </p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-slate-50">
        <p className="text-red-600">{error ?? "Could not load comparison."}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-57px)] max-w-6xl flex-col gap-6 bg-slate-50 px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">Compare submissions</h1>
      <ComparisonHeader submissions={data.submissions} onRemove={handleRemove} />
      <ComparisonSummaryTable data={data} />
      <ComparisonRadarChart data={data} />
      <CriteriaDetailTable data={data} />
    </main>
  );
}
