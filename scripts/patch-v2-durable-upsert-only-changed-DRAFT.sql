-- DRAFT, not deployed. Snapshot of the existing live function on 2026-11-20.
-- Only difference: ON CONFLICT update durable records IF the JSON changed.
-- Saves unnecessary heap / WAL updates for thousands of unchanged movements.
-- This does NOT shrink app_state.main and does NOT change catalog compaction.
-- Must be validated on isolated tables and live revision semantics first.
CREATE OR REPLACE FUNCTION public.patch_v2_sections_cas(p_patch jsonb, p_expected_revisions jsonb, p_updated_by uuid DEFAULT NULL::uuid)
 RETURNS TABLE(updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET statement_timeout TO '90s'
AS $function$
declare
  v_updated timestamptz := now();
  v_actor uuid := coalesce(auth.uid(), p_updated_by);
  v_old jsonb;
  v_new jsonb;
  v_name text;
  v_prefix text;
  v_item jsonb;
  v_old_item jsonb;
  v_id text;
  v_key text;
  v_expected timestamptz;
  v_current timestamptz;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'p_patch debe ser un objeto JSON'; end if;
  if p_expected_revisions is null or jsonb_typeof(p_expected_revisions) <> 'object' then raise exception 'p_expected_revisions debe ser un objeto JSON'; end if;

  select s.data into v_old from public.app_state s where s.id='main' for update;
  if v_old is null then raise exception 'No existe app_state/main'; end if;

  for v_key in select jsonb_object_keys(p_patch)
  loop
    if not (p_expected_revisions ? v_key) then raise exception 'Conflicto de sincronización: falta revisión esperada para %', v_key; end if;
    select r.updated_at into v_current from public.app_state_section_revisions r where r.section_key=v_key;
    begin
      v_expected := nullif(p_expected_revisions->>v_key,'')::timestamptz;
    exception when others then
      raise exception 'Conflicto de sincronización: revisión inválida para %', v_key;
    end;
    if v_current is distinct from v_expected then
      raise exception 'Conflicto de sincronización en %. Recargá la sección antes de guardar.', v_key;
    end if;
  end loop;

  v_new := v_old || p_patch;

  for v_name in select unnest(array['orders','cutBatches','movements'])
  loop
    if p_patch ? v_name then
      if jsonb_typeof(v_new->v_name) <> 'array' then raise exception '% debe ser un array', v_name; end if;
      if exists(select 1 from jsonb_array_elements(v_new->v_name) x where btrim(coalesce(x->>'id',''))='') then raise exception '% contiene registros sin id', v_name; end if;
      if exists(select 1 from (select x->>'id' id,count(*) c from jsonb_array_elements(v_new->v_name) x group by 1 having count(*)>1) d) then raise exception '% contiene ids duplicados', v_name; end if;
    end if;
  end loop;

  if p_patch ? 'orders' then
    if exists(select 1 from jsonb_array_elements(v_new->'orders') o where coalesce((o->>'total')::numeric,0)<0) then raise exception 'orders contiene totales negativos'; end if;
    if exists(
      select 1 from jsonb_array_elements(v_new->'orders') o,
      lateral jsonb_array_elements(coalesce(o->'items','[]'::jsonb)) i
      where coalesce((i->>'inventoryTracked')::boolean,true)=true
        and coalesce((i->>'manualItem')::boolean,false)=false
        and coalesce((i->>'qty')::numeric,0)<=0
    ) then raise exception 'orders contiene cantidades de producción no positivas'; end if;

    if exists(
      with new_counts as (
        select o->>'number' number, count(*) c
        from jsonb_array_elements(v_new->'orders') o
        where btrim(coalesce(o->>'number',''))<>''
        group by 1
      ), durable_counts as (
        select data->'item'->>'number' number, count(*) c
        from public.app_state
        where id like 'order_%'
          and coalesce((data->>'deleted')::boolean,false)=false
          and btrim(coalesce(data->'item'->>'number',''))<>''
        group by 1
      )
      select 1
      from new_counts n
      left join durable_counts d using(number)
      where n.c > 1 and n.c > coalesce(d.c,0)
    ) then raise exception 'orders intenta crear un número de pedido duplicado'; end if;
  end if;

  if p_patch ? 'movements' and exists(select 1 from jsonb_array_elements(v_new->'movements') m where coalesce((m->>'qty')::numeric,0)<0) then
    raise exception 'movements contiene cantidades negativas';
  end if;

  for v_name, v_prefix in values ('orders','order_'), ('cutBatches','batch_'), ('movements','movement_')
  loop
    if p_patch ? v_name then
      for v_item in select value from jsonb_array_elements(coalesce(v_new->v_name,'[]'::jsonb))
      loop
        v_id := btrim(coalesce(v_item->>'id',''));
        insert into public.app_state(id,data,updated_at,updated_by)
        values(v_prefix||v_id,jsonb_build_object('collection',v_name,'item',v_item),v_updated,v_actor)
        on conflict(id) do update set data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by
        where public.app_state.data is distinct from excluded.data;
      end loop;
      for v_old_item in select value from jsonb_array_elements(coalesce(v_old->v_name,'[]'::jsonb))
      loop
        v_id := btrim(coalesce(v_old_item->>'id',''));
        if v_id<>'' and not exists(select 1 from jsonb_array_elements(coalesce(v_new->v_name,'[]'::jsonb)) n where btrim(coalesce(n->>'id',''))=v_id) then
          insert into public.app_state(id,data,updated_at,updated_by)
          values(v_prefix||v_id,jsonb_build_object('collection',v_name,'deleted',true,'deletedId',v_id,'deletedAt',v_updated),v_updated,v_actor)
          on conflict(id) do update set data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by
        where public.app_state.data is distinct from excluded.data;
        end if;
      end loop;
    end if;
  end loop;

  update public.app_state s set data=v_new,updated_at=v_updated,updated_by=v_actor where s.id='main';
  for v_key in select jsonb_object_keys(p_patch)
  loop
    insert into public.app_state_section_revisions(section_key,updated_at)
    values(v_key,v_updated)
    on conflict(section_key) do update set updated_at=excluded.updated_at;
  end loop;
  return query select v_updated;
end;
$function$;
