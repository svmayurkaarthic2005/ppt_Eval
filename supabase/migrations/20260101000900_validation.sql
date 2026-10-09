-- Phase 7: a hard assertion, enforced on every write to criterion_scores,
-- that a section never ends up with more rows than its rubric template
-- defines -- the guard against double-counting if an LLM call is
-- accidentally retried and re-inserted.
--
-- 0 <= llm_score <= max_score is already enforced by the CHECK constraint
-- on criterion_scores from Phase 1 (20260101000000_initial_schema.sql);
-- that's a single-row rule a CHECK constraint can express directly. This
-- one is cross-row (a COUNT against the rubric template), which a CHECK
-- constraint can't express, so it needs a trigger.
create or replace function enforce_section_criterion_count() returns trigger as $$
declare
  max_criteria int;
  existing_count int;
begin
  select jsonb_array_length(section.value -> 'criteria') into max_criteria
  from submissions s
  join rubric_templates rt on rt.id = s.rubric_template_id
  cross join lateral jsonb_array_elements(rt.sections -> 'sections') as section
  where s.id = new.submission_id
    and section.value ->> 'key' = new.section_key;

  if max_criteria is null then
    -- No rubric template resolved for this submission/section yet; nothing
    -- to bound against, so let it through (the row-level CHECK constraint
    -- still applies regardless).
    return new;
  end if;

  select count(*) into existing_count
  from criterion_scores
  where submission_id = new.submission_id
    and section_key = new.section_key
    and id <> new.id;

  if existing_count + 1 > max_criteria then
    raise exception
      'criterion_scores for submission % section % would reach % rows, exceeding the % defined criteria (retried/duplicated insert?)',
      new.submission_id, new.section_key, existing_count + 1, max_criteria;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_section_criterion_count
before insert or update on criterion_scores
for each row execute function enforce_section_criterion_count();
