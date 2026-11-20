-- DRAFT / DO NOT APPLY to production until its tests and rollback are verified.
-- Must be deployed BEFORE AppV2 is switched to patch_v2_sections_cas_compat.
-- Existing patch_v2_sections_cas remains untouched and usable by old browsers.
-- This is a compatibility bridge; it does not activate catalog compaction.
begin;
set local lock_timeout='500ms';
set local statement_timeout='15s';

create or replace function public.capture_v2_catalog_write_nonce()
returns trigger language plpgsql security invoker set search_path=''
as $body$
declare
 v_session_nonce text;
begin
 if new.id is distinct from 'main' then return new; end if;
 -- Direct clients already providing a *fresh* nonce remain supported.
 if new.catalog_write_nonce is not null and
    new.catalog_write_nonce is distinct from old.catalog_write_nonce then
   return new;
 end if;
 v_session_nonce:=nullif(pg_catalog.current_setting('app.polifan_write_nonce',true),'');
 -- Clear an old nonce on writes from outdated browsers. This makes the
 -- readiness check honest even with several PCs accessing the same database.
 new.catalog_write_nonce:=case when v_session_nonce is not null
                           then v_session_nonce::uuid else null end;
 return new;
end;
$body$;

-- Alphabetical name means this executes before zz_compact... AFTER cutover.
create trigger aa_capture_v2_catalog_write_nonce
before update of data on public.app_state for each row
when (new.id='main')
execute function public.capture_v2_catalog_write_nonce();

create or replace function public.patch_v2_sections_cas_compat(
 p_patch jsonb,p_expected_revisions jsonb,p_updated_by uuid,p_write_nonce uuid)
returns table(updated_at timestamptz,canonical_catalog jsonb,compaction_active boolean)
language plpgsql security invoker set search_path=''
as $body$
declare
 v_updated timestamptz;
 v_active boolean;
 v_catalog jsonb;
begin
 if (select auth.uid()) is null then
   raise exception 'No autorizado' using errcode='28000';
 end if;
 if p_write_nonce is null then
   raise exception 'Falta identificador de guardado' using errcode='22023';
 end if;
 if p_patch is null or pg_catalog.jsonb_typeof(p_patch)<>'object' then
   raise exception 'Cambio inválido' using errcode='22023';
 end if;
 perform pg_catalog.set_config('app.polifan_write_nonce',p_write_nonce::text,true);

 -- Reuse all of the existing V2 CAS validation, order deduplication,
 -- durable records and synchronized section revision checks.
 select v.updated_at into v_updated
 from public.patch_v2_sections_cas(p_patch,p_expected_revisions,p_updated_by) v;
 if v_updated is null then raise exception 'Faltó confirmar el guardado';end if;

 select a.catalog_image_compaction_enabled,
   case when a.catalog_image_compaction_enabled and p_patch ? 'customerCatalog'
        then a.data->'customerCatalog' else null end
 into v_active,v_catalog
 from public.app_state a where a.id='main';
 if v_active is null then raise exception 'No existe el estado principal';end if;
 return query select v_updated,v_catalog,v_active;
end;
$body$;
revoke all on function public.patch_v2_sections_cas_compat(jsonb,jsonb,uuid,uuid) from public,anon;
grant execute on function public.patch_v2_sections_cas_compat(jsonb,jsonb,uuid,uuid) to authenticated;
commit;

-- This bridge does not install zz_compact_main_catalog_images_before_write.
-- Rollback (only after reverting the new AppV2 client to the old RPC):
-- drop trigger if exists aa_capture_v2_catalog_write_nonce on public.app_state;
-- drop function if exists public.capture_v2_catalog_write_nonce();
-- drop function if exists public.patch_v2_sections_cas_compat(jsonb,jsonb,uuid,uuid);
