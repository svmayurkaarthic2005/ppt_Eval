-- Storage buckets and RLS. Files are organized one folder per submission:
-- <bucket>/<submission_id>/<file>. A submission's files are readable by the
-- uploading team (via teams.owner_user_id) and by service_role; service_role
-- already bypasses RLS entirely, so its storage policy is here for clarity,
-- not strictly required.

insert into storage.buckets (id, name, public)
values
  ('pptx-uploads', 'pptx-uploads', false),
  ('problem-statements', 'problem-statements', false),
  ('rendered-slides', 'rendered-slides', false)
on conflict (id) do nothing;

create policy "team reads own submission files"
on storage.objects for select
to authenticated
using (
  bucket_id in ('pptx-uploads', 'problem-statements', 'rendered-slides')
  and exists (
    select 1
    from submissions s
    join teams t on t.id = s.team_id
    where s.id::text = (storage.foldername(name))[1]
      and t.owner_user_id = auth.uid()
  )
);

create policy "service role reads all submission files"
on storage.objects for select
to service_role
using (bucket_id in ('pptx-uploads', 'problem-statements', 'rendered-slides'));

-- Uploads/writes go through the API (service_role), which bypasses RLS;
-- no authenticated-role write policy is defined here on purpose.

-- Enable RLS on the application tables too (Supabase defaults new tables to
-- RLS-off). service_role bypasses RLS and so needs no explicit policy;
-- authenticated users can read only their own team's rows.
alter table teams enable row level security;
alter table submissions enable row level security;
alter table slides enable row level security;
alter table evidence_items enable row level security;
alter table criterion_scores enable row level security;
alter table section_totals enable row level security;
alter table final_scores enable row level security;
alter table consistency_flags enable row level security;

create policy "team reads own row" on teams
for select to authenticated
using (owner_user_id = auth.uid());

create policy "team reads own submissions" on submissions
for select to authenticated
using (exists (
  select 1 from teams t where t.id = submissions.team_id and t.owner_user_id = auth.uid()
));

create policy "team reads own slides" on slides
for select to authenticated
using (exists (
  select 1 from submissions s
  join teams t on t.id = s.team_id
  where s.id = slides.submission_id and t.owner_user_id = auth.uid()
));

create policy "team reads own evidence" on evidence_items
for select to authenticated
using (exists (
  select 1 from submissions s
  join teams t on t.id = s.team_id
  where s.id = evidence_items.submission_id and t.owner_user_id = auth.uid()
));

create policy "team reads own criterion scores" on criterion_scores
for select to authenticated
using (exists (
  select 1 from submissions s
  join teams t on t.id = s.team_id
  where s.id = criterion_scores.submission_id and t.owner_user_id = auth.uid()
));

create policy "team reads own section totals" on section_totals
for select to authenticated
using (exists (
  select 1 from submissions s
  join teams t on t.id = s.team_id
  where s.id = section_totals.submission_id and t.owner_user_id = auth.uid()
));

create policy "team reads own final score" on final_scores
for select to authenticated
using (exists (
  select 1 from submissions s
  join teams t on t.id = s.team_id
  where s.id = final_scores.submission_id and t.owner_user_id = auth.uid()
));

create policy "team reads own consistency flags" on consistency_flags
for select to authenticated
using (exists (
  select 1 from submissions s
  join teams t on t.id = s.team_id
  where s.id = consistency_flags.submission_id and t.owner_user_id = auth.uid()
));

-- rubric_templates, calibration_runs, calibration_pairs are organizer-only
-- (read via service_role / admin dashboard), so RLS stays off: no
-- authenticated-role policy means no row is visible to that role once RLS
-- is enabled, so simplest is to leave it disabled here rather than add a
-- deny-all policy that does nothing more than the default.
