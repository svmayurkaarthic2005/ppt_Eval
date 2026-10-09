-- Phase 16 follow-up: a team picking an existing problem statement from the
-- dropdown must never be asked to retype or re-upload it. The full text has
-- to live on problem_statements itself (title is just an 80-char label),
-- not be re-collected from each submission that reuses it.
alter table problem_statements add column reference_text text not null default '';

-- Backfill: every problem_statements row created so far (by the Phase 16
-- migration's own backfill, or by a submission created before this change)
-- can recover its reference_text from the submission that referenced it --
-- submissions.problem_statement_text already held the full text.
update problem_statements ps
set reference_text = s.problem_statement_text
from submissions s
where s.problem_statement_id = ps.id
  and ps.reference_text = ''
  and s.problem_statement_text is not null;
