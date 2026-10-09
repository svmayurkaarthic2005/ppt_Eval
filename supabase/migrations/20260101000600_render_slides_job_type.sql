-- Phase 4 chains off Phase 3's 'run_pipeline' job as its own job type, so a
-- rendering failure/timeout can't block the phase that already ran.
alter type job_type add value 'render_slides';
