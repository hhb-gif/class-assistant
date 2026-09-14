-- 修复 notices 越权发布漏洞：原 notices_insert 允许任何 authenticated 用户以自身 uid 插入通知。
-- 依据 ROADMAP §4.3 / CONTRACT §5：notice.publish 仅 admin/superAdmin；notice.manageAll 仅 superAdmin。

create or replace function app.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.users u
    where u.uid = auth.uid()
      and u.role = 'superAdmin'
  )
$$;

grant execute on function app.is_super_admin() to authenticated;

drop policy if exists notices_insert on public.notices;
create policy notices_insert on public.notices
  for insert to authenticated with check (app.is_admin());

drop policy if exists notices_update on public.notices;
create policy notices_update on public.notices
  for update to authenticated
  using (publisher_id = auth.uid() or app.is_super_admin())
  with check (publisher_id = auth.uid() or app.is_super_admin());

drop policy if exists notices_delete on public.notices;
create policy notices_delete on public.notices
  for delete to authenticated
  using (publisher_id = auth.uid() or app.is_super_admin());
