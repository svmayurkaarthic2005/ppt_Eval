-- PDF deck support: track the original deck file type.
-- The pipeline already detects type from the storage path extension, so this
-- column is purely informational for queries and dashboards. Existing rows
-- are backfilled as 'pptx' since that was the only format before this change.

alter table submissions add column deck_file_type text not null default 'pptx';

comment on column submissions.deck_file_type is
  'Original deck format: pptx or pdf. Detected from the uploaded file extension.';
