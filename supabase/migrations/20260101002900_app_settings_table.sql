-- Key-value application settings table (e.g. leaderboard_published status)
create table if not exists app_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
);

-- Default leaderboard to published: false if not already set
insert into app_settings (key, value)
values ('leaderboard_published', '{"published": false}'::jsonb)
on conflict (key) do nothing;
