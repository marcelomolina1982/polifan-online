-- PREPARATION ONLY: do not apply until the application supports catalog v2 reads.
-- Existing app_state remains the source of truth during the transition.
-- Each product update is guarded by its last known revision.
create or replace function public.save_catalog_product_v2(
  p_id text,
  p_payload jsonb,
  p_expected_updated_at timestamptz
)
returns table(saved boolean, revision timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_revision timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_id is null or length(trim(p_id)) = 0
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'id' is distinct from p_id then
    raise exception 'Invalid product payload';
  end if;

  if p_expected_updated_at is null then
    insert into public.catalog_products_v2(id,payload,updated_at)
    values (p_id,p_payload,v_revision)
    on conflict (id) do nothing;
  else
    update public.catalog_products_v2
       set payload=p_payload,updated_at=v_revision
     where id=p_id and updated_at=p_expected_updated_at;
  end if;
  return query select
    exists(select 1 from public.catalog_products_v2
      where id=p_id and updated_at=v_revision),
    (select updated_at from public.catalog_products_v2 where id=p_id);
end;
$$;
-- Deliberately no grants or execution in production until rollout review.
