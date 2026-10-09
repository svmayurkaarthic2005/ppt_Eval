-- Admin can pin a submission to a specific rank position, overriding the
-- computed ORDER BY. Pinned submissions sort first (by their pin number,
-- ascending), then everyone else sorts by computed_total as before -- this
-- never renumbers or displaces other pinned submissions implicitly, so two
-- different pins always keep their own explicit, distinct ordering.
alter table submissions add column manual_rank integer;
