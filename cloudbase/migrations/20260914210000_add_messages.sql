-- 留言功能表结构 + RLS（班级管家）
-- 目标库：CloudBase PG（PostgreSQL 17），业务 schema = public
-- 约定：text 主键；owner 列 text default auth.uid()；时间戳 timestamptz default now()
-- 迁移版本：20260914210000
-- 阶段：P4 前新增「留言」能力（学生在 P1b 之后新增）
--
-- 数据模型来源（唯一真相）：docs/src/messages.js、docs/src/store.js MAPS.messages
--   messages { id, fromUid, fromMemberId, content, createdAt, readAt, replyContent, replyAt }
--
-- 权限口径（沿用 ROADMAP §4.3 RLS，仅对 authenticated 生效）：
--   select：学生仅看自己（from_uid = auth.uid()），老师/管理员看全部（app.is_admin()）
--   insert：只能是本人留言（from_uid = auth.uid()）
--   update：本人可改（删改自己的 / 标记已读），管理员可回复与标记已读
--   delete：本人或管理员
-- 复用 P1a 的 app.is_admin()（SECURITY DEFINER，规避 users 表策略递归）。

-- ============================================================
-- 1. 表结构
-- ============================================================
create table messages (
  id             text primary key,
  from_uid       text not null default auth.uid(),      -- 留言人登录 uid
  from_member_id text references members(id),            -- 可选：关联班级名单
  content        text not null,                          -- 留言正文
  created_at     timestamptz not null default now(),
  read_at        timestamptz,                            -- 老师标记已读时间
  reply_content  text,                                   -- 老师回复正文
  reply_at       timestamptz                             -- 回复时间
);

-- 学生按本人筛选、管理员按时间倒序查看
create index messages_from_uid_idx on messages(from_uid);
create index messages_created_at_idx on messages(created_at desc);

-- ============================================================
-- 2. 启用 RLS
-- ============================================================
alter table messages enable row level security;

-- ============================================================
-- 3. RLS 策略（仅对 authenticated 生效）
-- ============================================================
-- select：学生只看自己；老师/管理员看全部
create policy messages_select on public.messages
  for select to authenticated
  using (from_uid = auth.uid() or app.is_admin());

-- insert：只能以本人身份留言
create policy messages_insert on public.messages
  for insert to authenticated
  with check (from_uid = auth.uid());

-- update：本人或管理员（老师回复 / 标记已读；学生可改自己的）
create policy messages_update on public.messages
  for update to authenticated
  using (from_uid = auth.uid() or app.is_admin())
  with check (from_uid = auth.uid() or app.is_admin());

-- delete：本人或管理员
create policy messages_delete on public.messages
  for delete to authenticated
  using (from_uid = auth.uid() or app.is_admin());

-- ============================================================
-- 4. GRANT（text 主键，无 identity 序列）
-- ============================================================
grant select, insert, update, delete on public.messages to authenticated;

-- ============================================================
-- 5. 权限加固（对齐 20260914181500_harden_privileges.sql）
-- ============================================================
-- CloudBase PG 的 ALTER DEFAULT PRIVILEGES 会把 arwdDxtm（含 TRUNCATE 等）
-- 自动授予 authenticated；TRUNCATE 不经过 RLS，属高危 DoS 面，此处收紧到最小必要权限。
revoke truncate, trigger, references, maintain on public.messages from authenticated;
