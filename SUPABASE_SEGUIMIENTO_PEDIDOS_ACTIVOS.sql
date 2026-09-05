-- Seguimiento público sólo para pedidos activos con entrega hoy o posterior.
-- La fecha de corte usa siempre America/Argentina/Buenos_Aires.

create or replace function public.sync_order_tracking_from_app_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb;
  orders_out jsonb := '[]'::jsonb;
  ids text[] := '{}';
  oid text;
  qty integer;
  delivery_date_value date;
  eligible boolean;
  tracking_token text;
  journey_data jsonb;
begin
  if new.id <> 'main' then return new; end if;

  for o in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb))
  loop
    oid := nullif(o->>'id','');
    delivery_date_value := case
      when (o->>'delivery') ~ '^\d{4}-\d{2}-\d{2}$' then (o->>'delivery')::date
      else null
    end;
    eligible := oid is not null
      and delivery_date_value >= (now() at time zone 'America/Argentina/Buenos_Aires')::date
      and coalesce(o->>'status','') not in ('Cancelado','Entregado');

    if eligible then
      journey_data := coalesce(o->'journey','{}'::jsonb) || jsonb_build_object(
        'enabled', true,
        'stage', coalesce(nullif(o->'journey'->>'stage',''),'confirmed'),
        'confirmedAt', coalesce(nullif(o->'journey'->>'confirmedAt',''),nullif(o->>'createdAt',''),now()::text),
        'whatsappConfirmedStatus', coalesce(nullif(o->'journey'->>'whatsappConfirmedStatus',''),'simulated-private')
      );
      o := jsonb_set(o,'{journey}',journey_data,true);

      select coalesce(sum(coalesce((i->>'qty')::numeric,0)),0)::int
        into qty
        from jsonb_array_elements(coalesce(o->'items','[]'::jsonb)) i;

      insert into public.order_tracking_public(
        order_id,order_number,customer_name,delivery_date,delivery_type,
        agency_delivery,pieces,order_status,tracking_stage,updated_at
      ) values (
        oid,
        o->>'number',
        coalesce(nullif(o->>'client',''),trim(concat_ws(' ',o->>'firstName',o->>'lastName'))),
        delivery_date_value,
        coalesce(nullif(o->>'deliveryType',''),nullif(o->>'carrier',''),'Logística GBA/CABA'),
        nullif(o->>'agencyDelivery',''),
        qty,
        o->>'status',
        public.resolve_tracking_stage(o),
        now()
      )
      on conflict(order_id) do update set
        order_number=excluded.order_number,
        customer_name=excluded.customer_name,
        delivery_date=excluded.delivery_date,
        delivery_type=excluded.delivery_type,
        agency_delivery=excluded.agency_delivery,
        pieces=excluded.pieces,
        order_status=excluded.order_status,
        tracking_stage=excluded.tracking_stage,
        updated_at=now()
      returning token into tracking_token;

      ids := array_append(ids,oid);
      o := jsonb_set(o,'{trackingToken}',to_jsonb(tracking_token),true) - 'customerTrackingToken';
    else
      o := o - 'trackingToken' - 'customerTrackingToken';
    end if;

    orders_out := orders_out || jsonb_build_array(o);
  end loop;

  new.data := jsonb_set(new.data,'{orders}',orders_out,true);
  if array_length(ids,1) is null then
    delete from public.order_tracking_public;
  else
    delete from public.order_tracking_public where not(order_id = any(ids));
  end if;
  return new;
end
$$;

drop trigger if exists trg_sync_order_tracking on public.app_state;
create trigger trg_sync_order_tracking
before insert or update of data on public.app_state
for each row execute function public.sync_order_tracking_from_app_state();

revoke all on function public.sync_order_tracking_from_app_state() from public, anon, authenticated;
revoke all on function public.get_order_tracking_admin(text) from public, anon;
grant execute on function public.get_order_tracking_admin(text) to authenticated;
grant execute on function public.get_order_tracking(text) to anon, authenticated;
alter function public.resolve_tracking_stage(jsonb) set search_path = public;

-- Activa y agrega el enlace en los pedidos que cumplen la regla hoy.
update public.app_state set data=data where id='main';
