-- Phase 3 flags a slide as needing visual rendering at parse time (a
-- picture shape with no native chart data); Phase 4 reads this column to
-- know which slides to rasterize, rather than re-parsing consistency_flags
-- free text.
alter table slides add column needs_visual_rendering boolean not null default false;

-- Render cache, keyed by a hash of the slide's own XML part. A duplicate or
-- re-run submission with byte-identical slide content reuses the PNG
-- instead of re-running LibreOffice -- this is what keeps Phase 12's
-- 100+ PPT throughput from re-rendering the same slide over and over.
create table rendered_slide_cache (
  content_hash text primary key,
  storage_path text not null,
  created_at timestamptz not null default now()
);
