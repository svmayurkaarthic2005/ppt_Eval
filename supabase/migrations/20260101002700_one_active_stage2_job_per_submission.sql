-- Three admin actions (re-run benchmark, re-run cost analysis, re-evaluate)
-- each independently check "is there already a queued/running
-- stage2_deep_analysis job for this submission?" and insert one if not.
-- That check-then-insert isn't atomic: two of those requests arriving close
-- together (e.g. an admin clicking two re-run buttons back to back) can
-- both see no active job and both insert one, giving the submission two
-- concurrent stage2_deep_analysis jobs. The orchestrator then races with
-- itself writing criterion_scores for the same submission, which trips the
-- per-section row-count trigger and fails both jobs.
--
-- A partial unique index makes "at most one active stage2_deep_analysis job
-- per submission" an invariant the database enforces, instead of something
-- every call site has to get right on its own.

create unique index jobs_one_active_stage2_per_submission
  on jobs (submission_id)
  where job_type = 'stage2_deep_analysis' and status in ('queued', 'running');
