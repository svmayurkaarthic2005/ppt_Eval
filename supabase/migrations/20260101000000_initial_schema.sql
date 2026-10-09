-- HackEval initial schema.
-- This schema is the source of truth for scores: criterion_scores is the only
-- table the LLM pipeline writes to; section_totals and final_scores are always
-- recomputed server-side (see 20260101000100_scoring_triggers.sql).

create extension if not exists pgcrypto;

create type submission_status as enum (
  'uploaded',
  'extracting',
  'rendering',
  'analyzing',
  'scored',
  'failed'
);

create type slide_role as enum (
  'problem',
  'existing_solution',
  'proposed_solution',
  'workflow',
  'cost',
  'execution',
  'timeline',
  'other'
);

-- One login per team for this event; RLS policies key off owner_user_id.
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  track text not null,
  owner_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- Versioned so a submission can always record which rubric version scored it.
create table rubric_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null,
  sections jsonb not null,
  created_at timestamptz not null default now(),
  unique (name, version)
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  rubric_template_id uuid references rubric_templates (id),
  pptx_storage_path text not null,
  problem_statement_storage_path text not null,
  problem_statement_text text,
  slide_count int,
  status submission_status not null default 'uploaded',
  uploaded_at timestamptz not null default now()
);

create index submissions_team_id_idx on submissions (team_id);

create table slides (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  slide_number int not null,
  raw_text text not null default '',
  shapes jsonb not null default '[]'::jsonb,
  tables jsonb not null default '[]'::jsonb,
  image_storage_paths text[] not null default '{}',
  classified_role slide_role,
  unique (submission_id, slide_number)
);

create index slides_submission_id_idx on slides (submission_id);

-- One row per piece of evidence a criterion score is based on; Phase 11's
-- traceability view reads from here.
create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  slide_id uuid not null references slides (id) on delete cascade,
  criterion_key text not null,
  evidence_type text not null,
  observation text not null,
  raw_llm_output jsonb not null,
  created_at timestamptz not null default now()
);

create index evidence_items_submission_id_idx on evidence_items (submission_id);
create index evidence_items_slide_id_idx on evidence_items (slide_id);

-- The LLM writes ONLY to this table, one row per criterion, never a total.
-- section_key is denormalized from rubric_templates.sections so the scoring
-- triggers can sum by section without parsing jsonb at write time.
create table criterion_scores (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  section_key text not null,
  criterion_key text not null,
  llm_score int not null check (llm_score >= 0 and llm_score <= max_score),
  max_score int not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, criterion_key)
);

create index criterion_scores_submission_id_idx on criterion_scores (submission_id);

-- Written exclusively by the deterministic scoring service (via trigger),
-- never directly by application code or the LLM call.
create table section_totals (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  section_key text not null,
  computed_total int not null default 0,
  updated_at timestamptz not null default now(),
  unique (submission_id, section_key)
);

create table final_scores (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references submissions (id) on delete cascade,
  computed_total int not null default 0,
  updated_at timestamptz not null default now()
);

create table consistency_flags (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions (id) on delete cascade,
  flag_type text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  description text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index consistency_flags_submission_id_idx on consistency_flags (submission_id);

create table calibration_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sample_size int not null,
  mean_absolute_error numeric not null,
  criterion_agreement_pct numeric not null,
  ranking_agreement_pct numeric not null,
  notes text
);

create table calibration_pairs (
  id uuid primary key default gen_random_uuid(),
  calibration_run_id uuid not null references calibration_runs (id) on delete cascade,
  submission_id uuid not null references submissions (id) on delete cascade,
  human_total numeric not null,
  ai_total numeric not null
);

create index calibration_pairs_run_id_idx on calibration_pairs (calibration_run_id);
