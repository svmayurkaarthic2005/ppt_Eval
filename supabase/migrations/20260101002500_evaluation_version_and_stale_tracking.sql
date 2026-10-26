-- Migration: Add evaluation tracking and stale flag to submissions
alter table submissions add column if not exists is_stale boolean default false;
alter table submissions add column if not exists evaluation_version integer default 1;
