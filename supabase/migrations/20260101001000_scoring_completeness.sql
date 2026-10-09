-- Phase 9: the DB trigger from Phase 1 (20260101000100_scoring_triggers.sql)
-- summed whatever criterion_scores rows existed for a section, even a
-- partial set -- silently writing a misleadingly-low total. This replaces
-- both trigger functions so the backstop matches app/scoring/engine.py's
-- rule exactly: a section_totals/final_scores row only ever exists once
-- its section/submission is actually complete; while incomplete, the row
-- is removed rather than left showing a partial number.

create or replace function recalc_section_total(p_submission_id uuid, p_section_key text)
returns void as $$
declare
  max_criteria int;
  scored_count int;
begin
  select jsonb_array_length(section.value -> 'criteria') into max_criteria
  from submissions s
  join rubric_templates rt on rt.id = s.rubric_template_id
  cross join lateral jsonb_array_elements(rt.sections -> 'sections') as section
  where s.id = p_submission_id
    and section.value ->> 'key' = p_section_key;

  select count(*) into scored_count
  from criterion_scores
  where submission_id = p_submission_id and section_key = p_section_key;

  if max_criteria is null or scored_count < max_criteria then
    -- Not complete yet (or no rubric template resolved): no total to show.
    delete from section_totals
    where submission_id = p_submission_id and section_key = p_section_key;
    return;
  end if;

  insert into section_totals (submission_id, section_key, computed_total)
  values (p_submission_id, p_section_key, 0)
  on conflict (submission_id, section_key)
  do update set computed_total = 0; -- overwritten by trg_enforce_section_total below
end;
$$ language plpgsql;

create or replace function recalc_final_score(p_submission_id uuid)
returns void as $$
declare
  expected_sections int;
  complete_sections int;
begin
  select jsonb_array_length(rt.sections -> 'sections') into expected_sections
  from submissions s
  join rubric_templates rt on rt.id = s.rubric_template_id
  where s.id = p_submission_id;

  select count(*) into complete_sections
  from section_totals
  where submission_id = p_submission_id;

  if expected_sections is null or complete_sections < expected_sections then
    delete from final_scores where submission_id = p_submission_id;
    return;
  end if;

  insert into final_scores (submission_id, computed_total)
  values (p_submission_id, 0)
  on conflict (submission_id)
  do update set computed_total = 0; -- overwritten by trg_enforce_final_total below
end;
$$ language plpgsql;
