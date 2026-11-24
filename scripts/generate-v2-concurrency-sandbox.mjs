import assert from 'node:assert/strict'
import fs from 'node:fs'

// The concurrency test runs ONLY in an ephemeral CI PostgreSQL database
// named "sandbox". It must NEVER run against Gestion Polifan production.
// Unlike pg_temp, this separate schema is visible to both test sessions.
const sql=fs.readFileSync(new URL('./patch-v2-set-based-durable-sync-DRAFT.sql',import.meta.url),'utf8')
const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.patch_v2_sections_cas(')
assert.ok(start>=0)
const isolated=sql.slice(start)
  .replaceAll('public.app_state_section_revisions','sandbox_concurrency.app_state_section_revisions')
  .replaceAll('public.app_state','sandbox_concurrency.app_state')
  .replace('public.patch_v2_sections_cas','sandbox_concurrency.patch_v2_sections_cas')
  .replaceAll('auth.uid()',"'11111111-1111-4111-8111-111111111111'::uuid")
  .replace("SET search_path TO 'public'","SET search_path TO 'sandbox_concurrency'")
assert.doesNotMatch(isolated,/(?:public\.app_state|auth\.uid\(\))/)
const setup=`-- CI-ONLY. Hard fail if executed against ANY other PostgreSQL database.
DO $guard$ BEGIN
 IF current_database() <> 'sandbox' THEN
  RAISE EXCEPTION 'Never run this fixture outside the sandbox database';
 END IF;
END $guard$;
CREATE SCHEMA sandbox_concurrency;
CREATE TABLE sandbox_concurrency.app_state(
 id text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz,updated_by uuid);
CREATE TABLE sandbox_concurrency.app_state_section_revisions(
 section_key text PRIMARY KEY,updated_at timestamptz);
INSERT INTO sandbox_concurrency.app_state(id,data)
VALUES('main','{"movements":[{"id":"m1","qty":1}],"orders":[],"cutBatches":[]}'::jsonb),
('movement_m1','{"collection":"movements","item":{"id":"m1","qty":1}}'::jsonb);
INSERT INTO sandbox_concurrency.app_state_section_revisions
VALUES('movements','2026-11-20T10:00:00Z');
${isolated}`
assert.match(setup,/current_database\(\) <> 'sandbox'/)
assert.doesNotMatch(setup,/public\.app_state|auth\.uid\(\)/)
if(process.argv.includes('--check')){
 console.log('OK: concurrency SQL isolated in sandbox_concurrency and restricted to database sandbox')
}else process.stdout.write(setup)
