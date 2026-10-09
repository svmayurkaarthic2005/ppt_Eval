-- Phase 16: problem statements become an explicit, selectable entity --
-- the grouping key for "rank within my own problem statement" is a
-- deliberate FK choice made at upload time, never fuzzy text-similarity
-- clustering, so two teams can never be silently merged into or split out
-- of the wrong group.
create table problem_statements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_custom boolean not null default false,
  created_by_team_id uuid references teams (id),
  created_at timestamptz not null default now()
);

-- No official organizer list was supplied to seed here -- this table
-- starts empty of real entries; populate it with the real list (is_custom
-- = false) before relying on the "pick an existing one" dropdown.

alter table submissions add column problem_statement_id uuid references problem_statements (id);

-- Backfill: every submission that predates this migration gets its own
-- custom problem_statements row (title derived from its own text) before
-- the column becomes NOT NULL, so this migration never breaks on existing
-- data. Generates the new row's id up front in a CTE so the INSERT and the
-- UPDATE that follows are correlated per-submission, not per-team (a team
-- can have more than one submission).
with needs_backfill as (
  select
    s.id as submission_id,
    s.problem_statement_text,
    s.team_id,
    gen_random_uuid() as new_ps_id
  from submissions s
  where s.problem_statement_id is null
),
inserted as (
  insert into problem_statements (id, title, is_custom, created_by_team_id)
  select
    new_ps_id,
    coalesce(nullif(left(btrim(problem_statement_text), 80), ''), 'Untitled problem statement'),
    true,
    team_id
  from needs_backfill
  returning id
)
update submissions s
set problem_statement_id = nb.new_ps_id
from needs_backfill nb
where s.id = nb.submission_id;

alter table submissions alter column problem_statement_id set not null;

create index submissions_problem_statement_id_idx on submissions (problem_statement_id);
