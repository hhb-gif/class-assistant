-- 收紧 notices 的 UPDATE / DELETE：必须是管理员，且（普通管理员只能改自己发布的 / 超级管理员全部）
-- 迁移版本：20260915010400
--
-- 背景（问题）：P1a 原策略为
--     using (publisher_id = auth.uid() or app.is_super_admin())
--   它把「谁能改通知」定义成「发布者本人」，**缺少 admin 前置条件**。
--   notices 因此成了全库唯一「写策略未强制 app.is_admin()」的表
--   （scores / surveys / members / class_materials 等都是 app.is_admin()）。
--   一旦某条通知的 publisher_id 等于某个非管理员账号的 uid
--   （历史数据、以后新增的写入路径、角色被降级的人…），该账号即可改/删通知。
--
-- 目标（对齐 UI 与 ROADMAP §4.3 的真实意图）：
--   「发布者本人或 admin/superAdmin」要理解为「**管理员**之中：普通管理员只能动自己发布的，
--     超级管理员可动全部」。非管理员一律拒绝，即使 publisher_id 恰好是自己。
--
-- 与 UI 一致性：notices.js 的 canManage() = can(notice.manageAll) || (发布者本人 && can(notice.publish))
--   而 can(notice.publish) 仅 admin/superAdmin 为真 ⇒ 前后端语义现在完全一致。

-- ============================================================
-- UPDATE：必须 admin/superAdmin；普通管理员仅限自己发布的
-- ============================================================
drop policy if exists notices_update on public.notices;
create policy notices_update on public.notices
  for update to authenticated
  using (app.is_admin() and (app.is_super_admin() or publisher_id = auth.uid()))
  with check (app.is_admin() and (app.is_super_admin() or publisher_id = auth.uid()));

-- ============================================================
-- DELETE：同上
-- ============================================================
drop policy if exists notices_delete on public.notices;
create policy notices_delete on public.notices
  for delete to authenticated
  using (app.is_admin() and (app.is_super_admin() or publisher_id = auth.uid()));

-- INSERT 保持不变（20260914190000 已收紧为 app.is_admin()），此处仅备注：
--   查删改三条写策略现在都由 app.is_admin() 把门。
