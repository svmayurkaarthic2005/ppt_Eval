-- Phase 12: a cheap Stage 1 pass runs for every submission; only a subset
-- (top-N by preliminary score, anything Stage 1 flagged, anything an admin
-- marks) goes through Stage 2's expensive rendering + per-criterion image
-- LLM calls. These columns carry Stage 1's output and the Stage 2 trigger
-- conditions that don't fit the existing status enum.
alter table submissions add column preliminary_score int;
alter table submissions add column preliminary_flagged boolean not null default false;
alter table submissions add column manual_review_requested boolean not null default false;

alter type job_type add value 'stage1_preliminary';
alter type job_type add value 'stage2_deep_analysis';
