-- This hackathon has no track/category concept -- teams are grouped by
-- problem statement (Phase 16) instead, so the field is removed rather
-- than left unused.
alter table teams drop column track;
