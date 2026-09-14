-- P1a 权限加固（修正 CloudBase PG 的默认权限）
-- 迁移版本：20260914181500
--
-- 背景：CloudBase PG 在 public schema 上配置了 ALTER DEFAULT PRIVILEGES，
--       新建表会自动把 `arwdDxtm` 授予 authenticated（Supabase 风格，默认全权限 + 靠 RLS）。
--       实测由此产生两个问题：
--       (1) users 表出现【表级 UPDATE】→ 登录用户可 update 自身 role='admin' 提权
--           （RLS 的 with check (uid=auth.uid()) 无法拦截，因为行确实是自己的）；
--       (2) 各表被授予 TRUNCATE / TRIGGER / REFERENCES / MAINTAIN，
--           其中 TRUNCATE 不经过 RLS，属高危 DoS 面。
-- 本迁移把 authenticated 收紧到最小必要权限：
--   - 收回 truncate / trigger / references / maintain
--   - users 收回表级 update，仅保留 display_name / must_change_password 两列自助更新
--   （注意顺序：必须先 revoke 表级 update，再 grant 列级 update，否则列级授权会被一并收回）

revoke truncate, trigger, references, maintain
  on public.members, public.users, public.notices, public.favorites, public.subscribers
  from authenticated;

revoke update on public.users from authenticated;
grant update (display_name, must_change_password) on public.users to authenticated;
