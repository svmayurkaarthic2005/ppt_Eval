-- Phase 11: GET /submissions/{id}/audit needs every status transition
-- with a timestamp. A trigger captures this automatically regardless of
-- which code path changes the status (including the very first 'uploaded'
-- insert), rather than relying on every call site to remember to log it.
create table submission_status_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  status submission_status not null,
  changed_at timestamptz not null default now()
);

create index submission_status_history_submission_id_idx on submission_status_history (submission_id);

create or replace function log_submission_status_change() returns trigger as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into submission_status_history (submission_id, status, changed_at)
    values (new.id, new.status, now());
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_log_submission_status_change
after insert or update on submissions
for each row execute function log_submission_status_change();
