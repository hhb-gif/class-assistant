-- P1a 核心表结构 + RLS（班级管家）
-- 目标库：CloudBase PG（PostgreSQL 17），业务 schema = public
-- 约定：所有 owner / 外键列用 text；auth.uid() 返回 text（不是 uuid）
-- 迁移版本：20260914181200
-- 阶段：P1a（基础表：members / users / notices / favorites / subscribers）

-- ============================================================
-- 1. 基础表：members / users
-- ============================================================

-- 班级名单（学号 20230301~20230330）
create table members (
  id          text primary key,
  student_no  text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- 账号资料（uid = auth.uid()）
create table users (
  uid                  text primary key,          -- = auth.uid()
  member_id            text references members(id),
  role                 text not null default 'member',  -- member|admin|superAdmin
  must_change_password boolean not null default true,
  display_name         text,
  created_at           timestamptz not null default now()
);

-- ============================================================
-- 2. 管理员判定函数（SECURITY DEFINER，规避 users 表策略递归）
-- ============================================================

create schema if not exists app;
grant usage on schema app to anon, authenticated;

create or replace function app.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.users u
    where u.uid = auth.uid()
      and u.role in ('admin','superAdmin')
  )
$$;

grant execute on function app.is_admin() to authenticated;

-- ============================================================
-- 3. 业务表：notices / favorites / subscribers
-- ============================================================

-- 通知（附件/链接为 jsonb；deadline 等时间字段保持文本，避免时区解析）
create table notices (
  id           text primary key,
  title        text not null,
  category     text not null,
  content      text,
  time_label   text,
  deadline     text,          -- 保持 ISO/'YYYY-MM-DD HH:mm' 文本，避免时区解析问题
  end_time     text,
  location     text,
  course       text,
  attachments  jsonb not null default '[]'::jsonb,
  links        jsonb not null default '[]'::jsonb,
  pinned       boolean not null default false,
  important    boolean not null default false,
  publisher_id text not null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 收藏
create table favorites (
  id         text primary key,
  user_id    text not null default auth.uid(),
  notice_id  text not null references notices(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, notice_id)
);

-- 订阅
create table subscribers (
  id         text primary key,
  user_id    text not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4. 启用 RLS
-- ============================================================

alter table members     enable row level security;
alter table users       enable row level security;
alter table notices     enable row level security;
alter table favorites   enable row level security;
alter table subscribers enable row level security;

-- ============================================================
-- 5. RLS 策略（仅对 authenticated 生效）
-- ============================================================

-- members：登录用户可读；增/删/改仅管理员
create policy members_select on public.members
  for select to authenticated using (true);
create policy members_insert on public.members
  for insert to authenticated with check (app.is_admin());
create policy members_update on public.members
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy members_delete on public.members
  for delete to authenticated using (app.is_admin());

-- users：本人或管理员可读；本人可写、管理员可写
-- 注：列级授权只管给 authenticated 开放 display_name / must_change_password，
--     因此任何登录用户都无法直接改写自身 role / member_id（防提权）。
create policy users_select on public.users
  for select to authenticated using (uid = auth.uid() or app.is_admin());
create policy users_insert on public.users
  for insert to authenticated with check (app.is_admin());
create policy users_update on public.users
  for update to authenticated using (uid = auth.uid() or app.is_admin())
  with check (uid = auth.uid() or app.is_admin());
create policy users_delete on public.users
  for delete to authenticated using (app.is_admin());

-- notices：登录用户可读；发布者本人或管理员可写
create policy notices_select on public.notices
  for select to authenticated using (true);
create policy notices_insert on public.notices
  for insert to authenticated with check (publisher_id = auth.uid() or app.is_admin());
create policy notices_update on public.notices
  for update to authenticated using (publisher_id = auth.uid() or app.is_admin())
  with check (publisher_id = auth.uid() or app.is_admin());
create policy notices_delete on public.notices
  for delete to authenticated using (publisher_id = auth.uid() or app.is_admin());

-- favorites：仅本人
create policy favorites_select on public.favorites
  for select to authenticated using (user_id = auth.uid());
create policy favorites_insert on public.favorites
  for insert to authenticated with check (user_id = auth.uid());
create policy favorites_delete on public.favorites
  for delete to authenticated using (user_id = auth.uid());

-- subscribers：仅本人
create policy subscribers_select on public.subscribers
  for select to authenticated using (user_id = auth.uid());
create policy subscribers_insert on public.subscribers
  for insert to authenticated with check (user_id = auth.uid());
create policy subscribers_delete on public.subscribers
  for delete to authenticated using (user_id = auth.uid());

-- ============================================================
-- 6. GRANT（本设计用 text 主键，无 identity 序列，无需序列授权）
-- ============================================================

grant select, insert, update, delete on public.members     to authenticated;
grant select, insert, update, delete on public.notices     to authenticated;
grant select, insert, update, delete on public.favorites   to authenticated;
grant select, insert, update, delete on public.subscribers to authenticated;

-- users 特例：不给表级 update（否则登录用户可改写自身 role 从而提权）。
-- 本人自助仅开放 display_name / must_change_password 两列；
-- 管理员的全权改写（role / member_id 等）应经 service_role（云函数）执行。
grant select, insert, delete on public.users to authenticated;
grant update (display_name, must_change_password) on public.users to authenticated;
