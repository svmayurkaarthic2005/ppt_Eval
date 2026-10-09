-- Phase 10: calibration_pairs needs per-section human vs AI scores (not
-- just the overall totals already on the table) to compute a per-section
-- agreement percentage; and submissions get a stored reliability label so
-- Phase 14's dashboard can show it without recomputing on every page load.

alter table calibration_pairs add column section_scores jsonb not null default '[]';

create type reliability_label as enum ('HIGH', 'MEDIUM', 'REVIEW');

alter table submissions add column reliability_label reliability_label;
