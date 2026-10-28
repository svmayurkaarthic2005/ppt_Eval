-- enforce_section_criterion_count (20260101000900_validation.sql) ran as a
-- BEFORE INSERT OR UPDATE trigger. For `INSERT ... ON CONFLICT (...) DO
-- UPDATE` -- exactly how criterion_scores is always upserted -- Postgres
-- fires the BEFORE INSERT trigger first, on the row as it would be newly
-- inserted, with a freshly generated `id` (criterion_scores.id defaults to
-- gen_random_uuid()) that doesn't match the existing row the conflict will
-- resolve onto. The trigger's self-exclusion (`id <> new.id`) therefore
-- never excludes that existing row, so for a section already at its full
-- criteria count, re-scoring ANY one of those criteria always counted one
-- too many and raised -- not an edge case, this fired on every
-- re-evaluation of every already-scored submission (surfaced by the
-- "Manual Review" / "Evaluation Scores are Stale" submissions that could
-- never successfully re-score).
--
-- An AFTER trigger fires once Postgres has resolved insert-vs-update, so
-- `new` (including new.id) reflects the row that was actually written --
-- the existing row's real id on the update path, a genuinely fresh id only
-- for a genuine new insert. Same validation logic, correct self-exclusion.

drop trigger trg_enforce_section_criterion_count on criterion_scores;

create trigger trg_enforce_section_criterion_count
after insert or update on criterion_scores
for each row execute function enforce_section_criterion_count();
