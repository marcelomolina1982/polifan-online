-- Isolated fixture based on live function, for temporary-table tests only.
-- Never deploy this file in production.
CREATE OR REPLACE FUNCTION pg_temp.capture_v2_catalog_write_nonce()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
