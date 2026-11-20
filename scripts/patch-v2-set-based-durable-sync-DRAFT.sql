-- DRAFT, not deployed. Snapshot of the existing live function on 2026-11-20.
-- Set-based durable synchronization, with ON CONFLICT only for changed records.
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

  -- Set-based durable synchronization: avoids thousands of single-row
  -- UPSERT attempts and quadratic membership checks on the old arrays.
  for v_name, v_prefix in values ('orders','order_'), ('cutBatches','batch_'), ('movements','movement_')
  loop
    if p_patch ? v_name then
      -- Compare against the DURABLE table itself. Never assume unchanged
      -- JSON in the main document means a durable row is present or correct.
      insert into public.app_state(id,data,updated_at,updated_by)
      select v_prefix||btrim(coalesce(n.item->>'id','')),
             jsonb_build_object('collection',v_name,'item',n.item),
             v_updated,v_actor
        from (
          -- The original per-item loop lets the LAST entry win if two
          -- distinct raw ids normalize to the same durable id (m1 / " m1 ").
          -- A single INSERT ... ON CONFLICT must deduplicate first.
          select distinct on (btrim(coalesce(x.item->>'id',''))) x.item
          from jsonb_array_elements(v_new->v_name) with ordinality x(item,position)
          order by btrim(coalesce(x.item->>'id','')),x.position desc
        ) n
        left join public.app_state d on d.id=v_prefix||btrim(coalesce(n.item->>'id',''))
       where d.id is null
          or d.data is distinct from jsonb_build_object('collection',v_name,'item',n.item)
      on conflict(id) do update
        set data=excluded.data,
            updated_at=excluded.updated_at,
            updated_by=excluded.updated_by
      where public.app_state.data is distinct from excluded.data;

      -- Hash-join the two arrays to identify genuine removals in one pass.
      -- A deleted record is still retained as an explicit tombstone.
      insert into public.app_state(id,data,updated_at,updated_by)
      select v_prefix||btrim(o.item->>'id'),
             jsonb_build_object('collection',v_name,'deleted',true,
                                'deletedId',btrim(o.item->>'id'),'deletedAt',v_updated),
             v_updated,v_actor
        from (
          -- Deduplicate legacy old IDs by their canonical durable key,
          -- avoiding repeated tombstone attempts in one SQL statement.
          select distinct on (btrim(coalesce(x.item->>'id',''))) x.item
          from jsonb_array_elements(coalesce(v_old->v_name,'[]'::jsonb))
             with ordinality x(item,position)
          order by btrim(coalesce(x.item->>'id','')),x.position desc
        ) o
        left join jsonb_array_elements(v_new->v_name) n(item)
          on btrim(coalesce(n.item->>'id',''))=btrim(coalesce(o.item->>'id',''))
       where n.item is null
         and btrim(coalesce(o.item->>'id',''))<>''
      on conflict(id) do update
        set data=excluded.data,
            updated_at=excluded.updated_at,
            updated_by=excluded.updated_by
      where public.app_state.data is distinct from excluded.data;
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
