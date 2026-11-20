-- SCHEMA PREPARATION ONLY. DOES NOT install image compaction.
-- Run before deploying the image-compaction-aware web client.
-- Nullable, no default, no data rewrite expected from PostgreSQL.
-- CURRENT STATUS: DRAFT; NOT EXECUTED ON PRODUCTION.
begin;
alter table public.app_state
  add column if not exists catalog_write_nonce uuid,
  add column if not exists catalog_image_compaction_enabled boolean not null default false;
commit;
-- Verification (read-only):
-- select column_name,udt_name from information_schema.columns
-- where table_schema='public' and table_name='app_state'
--   and column_name='catalog_write_nonce';
-- Do not deploy the client that sends catalog_write_nonce until this succeeds.
