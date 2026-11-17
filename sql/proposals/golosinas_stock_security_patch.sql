-- Security corrections for proposed candy stock migration. Review in test database only.
drop policy if exists "Staff can read candy movements" on public.candy_stock_movements;
create policy "Staff can read candy movements" on public.candy_stock_movements
for select to authenticated
using (exists(select 1 from public.perfiles p where p.id=(select auth.uid())));
