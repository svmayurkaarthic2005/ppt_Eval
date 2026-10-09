-- Phase 2 revision: a team's problem statement can arrive as either an
-- uploaded file or pasted-in text. Exactly one of "a file was uploaded" or
-- "text was typed and non-empty" must be true for every submission --
-- enforced here as a CHECK constraint, not just frontend validation, so no
-- application bug (old or future) can ever persist a submission with
-- neither (or both).

create type problem_statement_source as enum ('typed', 'uploaded');

-- Backfill existing rows (all were uploaded under the old file-only flow)
-- before making the column NOT NULL.
alter table submissions add column problem_statement_source problem_statement_source;
update submissions set problem_statement_source = 'uploaded' where problem_statement_source is null;
alter table submissions alter column problem_statement_source set not null;

alter table submissions alter column problem_statement_storage_path drop not null;

alter table submissions add constraint problem_statement_source_consistency check (
  (problem_statement_source = 'uploaded' and problem_statement_storage_path is not null)
  or
  (problem_statement_source = 'typed'
    and problem_statement_storage_path is null
    and problem_statement_text is not null
    and length(btrim(problem_statement_text)) > 0)
);
