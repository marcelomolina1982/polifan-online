-- MIGRATION DRAFT ONLY. Not active until the entire app and public catalog
-- read from catalog_products_v2; legacy app_state is still canonical.
-- One transaction, one product, server-generated strictly increasing revision.
-- Unlike a full app_state update, it never rewrites the large JSON document.
create or replace function public.mutate_catalog_product_v2(
  p_action text,
  p_id text,
  p_payload jsonb default null,
  p_expected_updated_at timestamptz default null
)
returns table(applied boolean, revision timestamptz, status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revision timestamptz;
  v_operation text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if p_action is null or p_action not in ('create','update','delete') then
    raise exception 'Unsupported catalog operation' using errcode='22023';
  end if;
  if p_id is null or length(btrim(p_id))=0 or p_id<>btrim(p_id) or length(p_id)>256 then
    raise exception 'Invalid product identifier' using errcode='22023';
  end if;
  if p_action='create' and p_expected_updated_at is not null then
    raise exception 'New products cannot have an expected revision' using errcode='22023';
  end if;
  if p_action in ('update','delete') and p_expected_updated_at is null then
    raise exception 'Expected revision required' using errcode='22023';
  end if;
  if p_action='delete' and p_payload is not null then
    raise exception 'Delete cannot include product payload' using errcode='22023';
  end if;
  if p_action in ('create','update') and (
    p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_payload->>'id' is distinct from p_id
  ) then
    raise exception 'Invalid product payload' using errcode='22023';
  end if;

  if p_action='create' then
    insert into public.catalog_products_v2(id,payload,updated_at)
    values (p_id,p_payload,clock_timestamp())
    on conflict (id) do nothing
    returning updated_at into v_revision;
  elsif p_action='update' then
    update public.catalog_products_v2
       set payload=p_payload,
           updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
     where id=p_id and updated_at=p_expected_updated_at
    returning updated_at into v_revision;
  else
    delete from public.catalog_products_v2
     where id=p_id and updated_at=p_expected_updated_at
    returning updated_at into v_revision;
  end if;

  if v_revision is null then
    -- Distinguish a conflict from successful mutation without touching any row.
    select v.updated_at into v_revision
      from public.catalog_products_v2 as v where v.id=p_id;
    v_operation := 'conflict';
  else
    v_operation := case p_action when 'create' then 'created'
                     when 'update' then 'updated' else 'deleted' end;
  end if;
  return query select v_operation<>'conflict',v_revision,v_operation;
end;
$$;

-- Revoke default PUBLIC access: the invoker must be signed in and pass RLS.
revoke all on function public.mutate_catalog_product_v2(text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.mutate_catalog_product_v2(text,text,jsonb,timestamptz) to authenticated;

-- IMPORTANT: The RPC intentionally does NOT modify app_state or public_catalog.
-- A dedicated, verified cutover is required before any app calls this function.
