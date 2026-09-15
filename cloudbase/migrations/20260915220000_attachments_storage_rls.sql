-- attachments 桶的 storage.objects RLS：已登录可读；增删改仅管理员（与旧环境一致，此次纳入迁移历史）
drop policy if exists attachments_select on storage.objects;
create policy attachments_select on storage.objects for select to authenticated using (bucket_id = 'attachments');
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and app.is_admin());
drop policy if exists attachments_update on storage.objects;
create policy attachments_update on storage.objects for update to authenticated using (bucket_id = 'attachments' and app.is_admin()) with check (bucket_id = 'attachments' and app.is_admin());
drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects for delete to authenticated using (bucket_id = 'attachments' and app.is_admin());
