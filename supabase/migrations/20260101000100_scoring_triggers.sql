-- Deterministic scoring: section_totals and final_scores are always derived
-- from criterion_scores / section_totals respectively. A BEFORE trigger on
-- each table overwrites whatever value was supplied (including a direct
-- INSERT/UPDATE from application code) with the real sum, so an LLM-provided
-- total can never be persisted by accident.

create or replace function recalc_section_total(p_submission_id uuid, p_section_key text)
returns void as $$
begin
  insert into section_totals (submission_id, section_key, computed_total)
  values (p_submission_id, p_section_key, 0)
  on conflict (submission_id, section_key)
  do update set computed_total = 0; -- overwritten by trg_enforce_section_total below
end;
$$ language plpgsql;

create or replace function enforce_section_total() returns trigger as $$
begin
  new.computed_total := coalesce((
    select sum(llm_score) from criterion_scores
    where submission_id = new.submission_id and section_key = new.section_key
  ), 0);
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_section_total
before insert or update on section_totals
for each row execute function enforce_section_total();

create or replace function trg_criterion_scores_recalc() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform recalc_section_total(old.submission_id, old.section_key);
    return old;
  end if;

  perform recalc_section_total(new.submission_id, new.section_key);

  if tg_op = 'UPDATE'
     and (old.submission_id is distinct from new.submission_id
          or old.section_key is distinct from new.section_key) then
    perform recalc_section_total(old.submission_id, old.section_key);
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_criterion_scores_recalc
after insert or update or delete on criterion_scores
for each row execute function trg_criterion_scores_recalc();

create or replace function recalc_final_score(p_submission_id uuid)
returns void as $$
begin
  insert into final_scores (submission_id, computed_total)
  values (p_submission_id, 0)
  on conflict (submission_id)
  do update set computed_total = 0; -- overwritten by trg_enforce_final_total below
end;
$$ language plpgsql;

create or replace function enforce_final_total() returns trigger as $$
begin
  new.computed_total := coalesce((
    select sum(computed_total) from section_totals
    where submission_id = new.submission_id
  ), 0);
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_final_total
before insert or update on final_scores
for each row execute function enforce_final_total();

create or replace function trg_section_totals_recalc() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform recalc_final_score(old.submission_id);
    return old;
  end if;

  perform recalc_final_score(new.submission_id);

  if tg_op = 'UPDATE' and old.submission_id is distinct from new.submission_id then
    perform recalc_final_score(old.submission_id);
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_section_totals_recalc
after insert or update or delete on section_totals
for each row execute function trg_section_totals_recalc();
