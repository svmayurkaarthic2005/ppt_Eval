-- Phase 6 logs every raw LLM response into evidence_items.raw_llm_output
-- before any post-processing/validation -- including when the response
-- fails schema validation and so cites no slide at all. slide_id must be
-- nullable to allow that call-level log row; per-slide citation rows
-- (inserted after successful parsing) still set it.
alter table evidence_items alter column slide_id drop not null;
