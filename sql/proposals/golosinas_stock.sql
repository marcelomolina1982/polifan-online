-- Apply only after reviewing in a test environment.
create table if not exists public.candy_stock (
 product_id text primary key,
 quantity integer not null default 0 check(quantity>=0),
 min_quantity integer not null default 5 check(min_quantity>=0),
 updated_at timestamptz not null default now()
);
create table if not exists public.candy_stock_movements (
 id uuid primary key,
 product_id text not null,
 kind text not null check(kind in ('restock','direct_sale','online_reserve','online_release','online_complete','adjustment')),
 delta integer not null,
 resulting_quantity integer not null check(resulting_quantity>=0),
 created_at timestamptz not null default now(),
 actor uuid not null
);
create index if not exists candy_stock_movements_product_time on public.candy_stock_movements(product_id,created_at desc);
alter table public.candy_stock enable row level security;
alter table public.candy_stock_movements enable row level security;
create policy "Staff can read candy stock" on public.candy_stock for select to authenticated using (exists(select 1 from public.perfiles p where p.id=(select auth.uid())));
create policy "Staff can read candy movements" on public.candy_stock_movements for select to authenticated using (true);
-- Only the authenticated, atomic RPC can write stock and movement rows.
create or replace function public.adjust_candy_stock(p_product_id text,p_delta integer,p_kind text,p_operation_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_qty integer;v_actor uuid;
begin
 v_actor:=auth.uid();
 if v_actor is null or not exists(select 1 from public.perfiles p where p.id=v_actor) then raise exception 'No autorizado'; end if;
 if nullif(btrim(p_product_id),'') is null then raise exception 'Producto inválido'; end if;
 if not exists(select 1 from public.app_state a, jsonb_array_elements(a.data->'customerCatalog') p where a.id='main' and p->>'id'=p_product_id and lower(btrim(p->>'category'))='golosinas') then raise exception 'Producto no pertenece a Golosinas'; end if;
 if p_delta=0 then raise exception 'La cantidad debe ser distinta de cero'; end if;
 if (p_kind='restock' and p_delta<=0) or (p_kind='direct_sale' and p_delta>=0) or p_kind not in ('restock','direct_sale') then raise exception 'Movimiento inválido'; end if;
 if exists(select 1 from public.candy_stock_movements where id=p_operation_id) then
  select resulting_quantity into v_qty from public.candy_stock_movements where id=p_operation_id;
  return v_qty;
 end if;
 insert into public.candy_stock(product_id,quantity) values(p_product_id,0) on conflict(product_id) do nothing;
 select quantity into v_qty from public.candy_stock where product_id=p_product_id for update;
 -- Recheck after acquiring the per-product lock, for idempotent retries.
 if exists(select 1 from public.candy_stock_movements where id=p_operation_id) then
  select resulting_quantity into v_qty from public.candy_stock_movements where id=p_operation_id;
  return v_qty;
 end if;
 if v_qty+p_delta<0 then raise exception 'Stock insuficiente'; end if;
 v_qty:=v_qty+p_delta;
 update public.candy_stock set quantity=v_qty,updated_at=now() where product_id=p_product_id;
 insert into public.candy_stock_movements(id,product_id,kind,delta,resulting_quantity,actor) values(p_operation_id,p_product_id,p_kind,p_delta,v_qty,v_actor);
 return v_qty;
end $$;
revoke all on function public.adjust_candy_stock(text,integer,text,uuid) from public;
grant execute on function public.adjust_candy_stock(text,integer,text,uuid) to authenticated;
