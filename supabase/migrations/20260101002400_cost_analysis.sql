-- Migration: Add cost_analysis column to submissions
alter table submissions add column if not exists cost_analysis jsonb;
