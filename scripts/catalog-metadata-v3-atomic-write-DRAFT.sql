-- PREPARATION ONLY: DO NOT EXECUTE ON PRODUCTION BEFORE COORDINATED CUTOVER.
-- The app_state/customerCatalog and public_catalog still power deployed clients.
-- Metadata updates touch one small row. Image is updated ONLY when provided.
begin;
grant select, insert, update, delete on public.catalog_product_metadata_v3 to authenticated;
create policy catalog_product_metadata_v3_authenticated_insert
  on public.catalog_product_metadata_v3 for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy catalog_product_metadata_v3_authenticated_update
  on public.catalog_product_metadata_v3 for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy catalog_product_metadata_v3_authenticated_delete
  on public.catalog_product_metadata_v3 for delete to authenticated
  using ((select auth.uid()) is not null);

create or replace function public.mutate_catalog_metadata_v3(
  p_action text,p_id text,p_payload jsonb default null,
  p_expected_updated_at timestamptz default null,p_image text default null)
returns table(applied boolean, revision timestamptz, status text)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_revision timestamptz;
  v_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if p_action is null or p_action not in ('create','update','delete') then
    raise exception 'Invalid action' using errcode='22023';
  end if;
  if p_id is null or btrim(p_id)<>p_id or length(p_id)=0 or length(p_id)>256 then
    raise exception 'Invalid product ID' using errcode='22023';
  end if;
  if (p_action='create' and p_expected_updated_at is not null)
    or (p_action in ('update','delete') and p_expected_updated_at is null) then
    raise exception 'Invalid expected revision' using errcode='22023';
  end if;
  if p_action='delete' and (p_image is not null or p_payload is not null) then
    raise exception 'Delete does not take new data' using errcode='22023';
  end if;
  if p_action in ('create','update') and
    (p_payload is null or jsonb_typeof(p_payload)<>'object'
       or p_payload->>'id' is distinct from p_id
       or p_payload ?| array['image','imageData','photo']) then
    raise exception 'Only product metadata is allowed' using errcode='22023';
  end if;
  if (p_action='create' and (p_image is null or length(p_image)=0))
    or (p_image is not null and (length(p_image)=0 or length(p_image)>8000000)) then
    raise exception 'Invalid image' using errcode='22023';
  end if;

  if p_action='create' then
    insert into public.catalog_product_metadata_v3(id,payload,updated_at)
    values(p_id,p_payload,clock_timestamp())
    on conflict (id) do nothing
    returning updated_at into v_revision;
  elsif p_action='update' then
    update public.catalog_product_metadata_v3
       set payload=p_payload,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
     where id=p_id and updated_at=p_expected_updated_at
    returning updated_at into v_revision;
  else
    delete from public.catalog_product_metadata_v3
    where id=p_id and updated_at=p_expected_updated_at
    returning updated_at into v_revision;
  end if;

  if v_revision is null then
    select v.updated_at into v_revision from public.catalog_product_metadata_v3 v where v.id=p_id;
    v_status:='conflict';
  else
    v_status:=case p_action when 'create' then 'created'
              when 'update' then 'updated' else 'deleted' end;
    if p_action='delete' then
      delete from public.catalog_product_images where product_id=p_id;
    elsif p_image is not null then
      insert into public.catalog_product_images(product_id,image,updated_at)
      values(p_id,p_image,clock_timestamp())
      on conflict(product_id) do update set image=excluded.image,updated_at=excluded.updated_at
      where public.catalog_product_images.image is distinct from excluded.image;
    end if;
  end if;
  return query select v_status<>'conflict',v_revision,v_status;
end;
$$;
revoke all on function public.mutate_catalog_metadata_v3(text,text,jsonb,timestamptz,text) from public,anon;
grant execute on function public.mutate_catalog_metadata_v3(text,text,jsonb,timestamptz,text) to authenticated;
commit;
-- The coordinated cutover must remove the heavy catalog from app_state
-- and update all readers/public catalog publishing. Do not deploy in isolation.
