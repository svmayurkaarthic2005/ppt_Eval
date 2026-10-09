-- Decimal scoring and academic literature benchmark migration
alter table criterion_scores alter column llm_score type numeric(6,2);
alter table criterion_scores alter column max_score type numeric(6,2);
alter table section_totals alter column computed_total type numeric(6,2);
alter table final_scores alter column computed_total type numeric(6,2);
alter table submissions alter column preliminary_score type numeric(6,2);
alter table submissions add column if not exists academic_benchmark jsonb;

create or replace function enforce_section_total() returns trigger as $$
begin
  new.computed_total := coalesce((
    select round(sum(llm_score), 2) from criterion_scores
    where submission_id = new.submission_id and section_key = new.section_key
  ), 0);
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create or replace function enforce_final_total() returns trigger as $$
begin
  new.computed_total := coalesce((
    select round(sum(computed_total), 2) from section_totals
    where submission_id = new.submission_id
  ), 0);
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;
