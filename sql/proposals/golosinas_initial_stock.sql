-- Proposed staff-only initial inventory setup. Test before applying.
-- A product can be initialized only once; existing quantities cannot be overwritten.
create or replace function public.initialize_candy_stock(p_product_id text,p_quantity integer,p_min_quantity integer default 5)
returns integer language plpgsql security definer set search_path='' as $$
declare v_actor uuid;
begin
 v_actor:=auth.uid();
 if v_actor is null or not exists(select 1 from public.perfiles p where p.id=v_actor) then
  raise exception 'No autorizado';
 end if;
 if p_quantity is null or p_quantity<0 or p_min_quantity is null or p_min_quantity<0 then
  raise exception 'Cantidades inválidas';
 end if;
 if not exists(
  select 1 from public.app_state a, jsonb_array_elements(a.data->'customerCatalog') p
  where a.id='main' and p->>'id'=p_product_id and lower(btrim(p->>'category'))='golosinas'
 ) then raise exception 'Producto no pertenece a Golosinas'; end if;
 insert into public.candy_stock(product_id,quantity,min_quantity)
 values(p_product_id,p_quantity,p_min_quantity)
 on conflict(product_id) do nothing;
 if not found then raise exception 'Stock inicial ya cargado; usá Ingresar para reponer'; end if;
 return p_quantity;
end $$;
revoke all on function public.initialize_candy_stock(text,integer,integer) from public;
grant execute on function public.initialize_candy_stock(text,integer,integer) to authenticated;
