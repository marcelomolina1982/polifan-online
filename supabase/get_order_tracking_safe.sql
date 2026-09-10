-- SAFE DRAFT ONLY. Do not apply automatically.
-- Read-only replacement candidate for public.get_order_tracking(text).
-- Critical rules: journeyManaged production is allocated only inside the explicit
-- operational journey queue; component rows count only as complete BASE+TAPA kits.

create or replace function public.get_order_tracking(p_token text)
returns table(order_number text,customer_name text,delivery_date date,delivery_type text,agency_delivery text,pieces integer,order_status text,tracking_stage text,updated_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
 r public.order_tracking_public%rowtype; st jsonb; ord jsonb; j jsonb:='{}'::jsonb;
 derived text:='confirmed'; stored_stage text:='confirmed'; cut_completed_at timestamptz; effective_cut_completed_at timestamptz;
 stock_covers_order boolean:=false; projected_cut_covers_order boolean:=false; finished_cut_covers_order boolean:=false;
begin
 select * into r from public.order_tracking_public where token=p_token limit 1; if not found then return; end if;
 select data into st from public.app_state where id='main'; if st is null then return; end if;
 select x into ord from pg_catalog.jsonb_array_elements(coalesce(st->'orders','[]'::jsonb)) x where x->>'id'=r.order_id::text or x->>'number'=r.order_number limit 1;
 stored_stage:=case lower(trim(coalesce(r.tracking_stage,''))) when 'agendado' then 'confirmed' when 'confirmed' then 'confirmed' when 'en corte' then 'production_cut' when 'en producción' then 'production_cut' when 'en produccion' then 'production_cut' when 'production_cut' then 'production_cut' when 'para embalar' then 'packing' when 'packing' then 'packing' when 'despachado' then 'dispatched' when 'enviado' then 'dispatched' when 'listo para retirar' then 'dispatched' when 'ready_pickup' then 'dispatched' when 'dispatched' then 'dispatched' else 'confirmed' end;
 derived:=stored_stage;
 if ord is not null then
  j:=coalesce(ord->'journey','{}'::jsonb); cut_completed_at:=nullif(j->>'cutCompletedAt','')::timestamptz; effective_cut_completed_at:=cut_completed_at;
  if lower(coalesce(ord->>'status','')) in ('entregado','finalizado') then derived:='delivered';
  elsif lower(coalesce(ord->>'status','')) in ('despachado','enviado','listo para retirar') or lower(coalesce(j->>'stage','')) in ('dispatched','ready_pickup') then derived:='dispatched';
  else
   with target_items as (select lower(trim(i->>'figure')) f,sum(coalesce((i->>'qty')::numeric,0)) qty from pg_catalog.jsonb_array_elements(coalesce(ord->'items','[]'::jsonb)) i where coalesce((i->>'qty')::numeric,0)>0 and coalesce((i->>'inventoryTracked')::boolean,true) group by 1),
   demand as (select lower(trim(i->>'figure')) f,sum(coalesce((i->>'qty')::numeric,0)) qty from pg_catalog.jsonb_array_elements(coalesce(st->'orders','[]'::jsonb)) o cross join lateral pg_catalog.jsonb_array_elements(coalesce(o->'items','[]'::jsonb)) i where coalesce((i->>'qty')::numeric,0)>0 and coalesce((i->>'inventoryTracked')::boolean,true) and lower(coalesce(o->>'status','')) not in ('cancelado','entregado') and (coalesce(o->>'delivery','9999-12-31')<coalesce(ord->>'delivery','9999-12-31') or (coalesce(o->>'delivery','9999-12-31')=coalesce(ord->>'delivery','9999-12-31') and coalesce(nullif(o->>'number','')::numeric,0)<=coalesce(nullif(ord->>'number','')::numeric,0))) group by 1),
   complete_stock as (select lower(trim(m->>'figure')) f,sum(case when lower(coalesce(m->>'component','complete')) not in ('tapa','base') then case when m->>'type' in ('Entrada extra','Ajuste positivo','Entrada de corte') then coalesce((m->>'qty')::numeric,0) else -coalesce((m->>'qty')::numeric,0) end else 0 end) qty from pg_catalog.jsonb_array_elements(coalesce(st->'movements','[]'::jsonb)) m group by 1),
   parts as (select lower(trim(m->>'figure')) f,sum(case when lower(m->>'component')='tapa' then case when m->>'type' in ('Entrada extra','Ajuste positivo','Entrada de corte','Ajuste componente positivo') then coalesce((m->>'qty')::numeric,0) else -coalesce((m->>'qty')::numeric,0) end else 0 end) tapa,sum(case when lower(m->>'component')='base' then case when m->>'type' in ('Entrada extra','Ajuste positivo','Entrada de corte','Ajuste componente positivo') then coalesce((m->>'qty')::numeric,0) else -coalesce((m->>'qty')::numeric,0) end else 0 end) base from pg_catalog.jsonb_array_elements(coalesce(st->'movements','[]'::jsonb)) m group by 1),
   avail as (select t.f,greatest(0,coalesce(c.qty,0))+greatest(0,least(coalesce(p.tapa,0),coalesce(p.base,0))) qty from target_items t left join complete_stock c using(f) left join parts p using(f))
   select exists(select 1 from target_items) and not exists(select 1 from target_items t left join demand d using(f) left join avail a using(f) where coalesce(a.qty,0)<coalesce(d.qty,0)) into stock_covers_order;

   if coalesce((j->>'enabled')::boolean,false) then
    with target_need as (select lower(trim(i->>'figure')) f,sum(coalesce((i->>'qty')::numeric,0)) qty from pg_catalog.jsonb_array_elements(coalesce(ord->'items','[]'::jsonb)) i where coalesce((i->>'qty')::numeric,0)>0 and coalesce((i->>'inventoryTracked')::boolean,true) group by 1),
    journey_demand as (select lower(trim(i->>'figure')) f,sum(coalesce((i->>'qty')::numeric,0)) qty from pg_catalog.jsonb_array_elements(coalesce(st->'orders','[]'::jsonb)) o cross join lateral pg_catalog.jsonb_array_elements(coalesce(o->'items','[]'::jsonb)) i where coalesce((o->'journey'->>'enabled')::boolean,false) and lower(coalesce(o->>'status','')) not in ('cancelado','entregado') and coalesce((i->>'qty')::numeric,0)>0 and coalesce((i->>'inventoryTracked')::boolean,true) and (coalesce(o->>'delivery','9999-12-31')<coalesce(ord->>'delivery','9999-12-31') or (coalesce(o->>'delivery','9999-12-31')=coalesce(ord->>'delivery','9999-12-31') and coalesce(nullif(o->>'number','')::numeric,0)<=coalesce(nullif(ord->>'number','')::numeric,0))) group by 1),
    active_raw as (select lower(trim(bi->>'figure')) f,lower(coalesce(bi->>'component','complete')) component,sum(coalesce((bi->>'qty')::numeric,0)) qty from pg_catalog.jsonb_array_elements(coalesce(st->'cutBatches','[]'::jsonb)) b cross join lateral pg_catalog.jsonb_array_elements(coalesce(b->'items','[]'::jsonb)) bi where b->>'journeyManaged'='true' and lower(coalesce(b->>'status','')) in ('en corte','terminada') and exists(select 1 from pg_catalog.jsonb_array_elements_text(coalesce(b->'deliveryDates','[]'::jsonb)) d(v) where d.v<=ord->>'delivery') group by 1,2),
    active_have as (select f,sum(case when component not in ('base','tapa') then qty else 0 end)+least(sum(case when component='base' then qty else 0 end),sum(case when component='tapa' then qty else 0 end)) qty from active_raw group by f),
    finished_raw as (select lower(trim(bi->>'figure')) f,lower(coalesce(bi->>'component','complete')) component,sum(coalesce((bi->>'qty')::numeric,0)) qty from pg_catalog.jsonb_array_elements(coalesce(st->'cutBatches','[]'::jsonb)) b cross join lateral pg_catalog.jsonb_array_elements(coalesce(b->'items','[]'::jsonb)) bi where b->>'journeyManaged'='true' and lower(coalesce(b->>'status',''))='terminada' and exists(select 1 from pg_catalog.jsonb_array_elements_text(coalesce(b->'deliveryDates','[]'::jsonb)) d(v) where d.v<=ord->>'delivery') group by 1,2),
    finished_have as (select f,sum(case when component not in ('base','tapa') then qty else 0 end)+least(sum(case when component='base' then qty else 0 end),sum(case when component='tapa' then qty else 0 end)) qty from finished_raw group by f)
    select exists(select 1 from target_need) and not exists(select 1 from target_need n left join journey_demand d using(f) left join active_have h using(f) where coalesce(h.qty,0)<coalesce(d.qty,0)), exists(select 1 from target_need) and not exists(select 1 from target_need n left join journey_demand d using(f) left join finished_have h using(f) where coalesce(h.qty,0)<coalesce(d.qty,0)) into projected_cut_covers_order,finished_cut_covers_order;

    -- Legacy compatibility: never write or invent cutCompletedAt. Only derive a conservative
    -- effective timestamp when the whole chronological demand is already covered by finished,
    -- journey-managed batches. The latest finishedAt among eligible finished batches is used,
    -- so the 3-hour gate can never start earlier than the physical production evidence.
    if finished_cut_covers_order and effective_cut_completed_at is null then
      select max(nullif(b->>'finishedAt','')::timestamptz) into effective_cut_completed_at
      from pg_catalog.jsonb_array_elements(coalesce(st->'cutBatches','[]'::jsonb)) b
      where b->>'journeyManaged'='true'
        and lower(coalesce(b->>'status',''))='terminada'
        and nullif(b->>'finishedAt','') is not null
        and exists(select 1 from pg_catalog.jsonb_array_elements_text(coalesce(b->'deliveryDates','[]'::jsonb)) d(v) where d.v<=ord->>'delivery')
        and exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(b->'items','[]'::jsonb)) bi join pg_catalog.jsonb_array_elements(coalesce(ord->'items','[]'::jsonb)) oi on lower(trim(bi->>'figure'))=lower(trim(oi->>'figure')));
    end if;
   end if;

   if stock_covers_order and coalesce(j->>'productionAt','')='' and cut_completed_at is null then derived:='packing';
   elsif finished_cut_covers_order and effective_cut_completed_at is not null and pg_catalog.now()>=effective_cut_completed_at+interval '3 hours' then derived:='packing';
   elsif projected_cut_covers_order or lower(coalesce(j->>'stage',''))='production_cut' or stored_stage='production_cut' then derived:='production_cut'; else derived:='confirmed'; end if;
  end if;
 end if;
 return query select r.order_number,r.customer_name,r.delivery_date,r.delivery_type,r.agency_delivery,r.pieces,r.order_status,derived,greatest(r.updated_at,coalesce(nullif(ord->>'updatedAt','')::timestamptz,r.updated_at));
end; $$;

-- Deployment hardening (apply together with the function, never separately):
-- revoke execute on function public.get_order_tracking(text) from public;
-- revoke execute on function public.get_order_tracking(text) from authenticated;
-- grant execute on function public.get_order_tracking(text) to anon;
