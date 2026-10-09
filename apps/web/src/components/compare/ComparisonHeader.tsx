import type { SubmissionComparison } from "@hackeval/types";

interface ComparisonHeaderProps {
  submissions: SubmissionComparison[];
  onRemove: (submissionId: string) => void;
}

export default function ComparisonHeader({ submissions, onRemove }: ComparisonHeaderProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {submissions.map((s) => (
        <span
          key={s.submission_id}
          className="flex items-center gap-2 rounded-full bg-indigo-50 py-1.5 pl-3.5 pr-2 text-sm font-medium text-indigo-700"
        >
          {s.team_name}
          <button
            type="button"
            onClick={() => onRemove(s.submission_id)}
            aria-label={`Remove ${s.team_name} from comparison`}
            className="flex h-5 w-5 items-center justify-center rounded-full text-indigo-400 transition hover:bg-indigo-200 hover:text-indigo-800"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
