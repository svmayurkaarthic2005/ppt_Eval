-- The slide's title placeholder is kept distinct from raw_text (the
-- concatenation of its other text runs) so Phase 3's structural extraction
-- doesn't have to fold title into body text to fit the Phase 1 schema.
alter table slides add column title text not null default '';
alter table slides alter column title drop default;
