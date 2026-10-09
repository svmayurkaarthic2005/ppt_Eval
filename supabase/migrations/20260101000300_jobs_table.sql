-- Postgres-backed job queue. A row here survives an API server restart, so a
-- submission can never be silently dropped mid-pipeline the way an
-- in-memory queue would drop it: the worker just resumes from whatever rows
-- are still 'queued' (or re-queues anything stuck in 'running' too long).

create type job_type as enum ('extract_problem_statement', 'run_pipeline');
create type job_status as enum ('queued', 'running', 'done', 'failed');

create table jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  job_type job_type not null,
  status job_status not null default 'queued',
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Polling query: claim the oldest due, queued job.
create index jobs_poll_idx on jobs (run_after) where status = 'queued';
create index jobs_submission_id_idx on jobs (submission_id);
