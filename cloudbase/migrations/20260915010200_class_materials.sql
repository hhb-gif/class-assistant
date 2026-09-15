-- WS-C 班级共享资料库：class_materials（老师上传 → 全班可学）
-- 目标库：CloudBase PG（PostgreSQL 17），业务 schema = public
-- 迁移版本：20260915010200
--
-- 数据模型来源（唯一真相）：docs/src/materials.js、docs/src/store.js
--   class_materials { id, title, subject, description, fileName→file_name, filePath→file_path,
--                     fileSize→file_size, fileType→file_type, uploaderUid→uploader_uid,
--                     createdAt→created_at, updatedAt→updated_at }
--   嵌套：无（一行一条资料；文件二进制不放表，只存云存储 key）。
--
-- 上传权限边界（说明）：
--   * 「谁有资格创建/修改/删除资料」在**表级**由 app.is_admin() 约束（RLS 下三写策略），
--     authenticated 的写权限因此只对 admin/superAdmin 生效；学生仅有 select。
--   * 文件本体写入云存储桶，沿用现有 attachments 桶策略（私有桶 + 签名 URL 下载）。
--     桶级「按目录细分读写权限」为后续加固项，本次不在迁移内处理。
--   * 读取对全班开放（select using (true)）：登录用户均可浏览/下载共享资料。

-- ============================================================
-- 1. 表结构
-- ============================================================
create table class_materials (
  id           text primary key,
  title        text not null,
  subject      text,
  description  text,
  file_name    text not null,
  file_path    text not null,                    -- 云存储 bucket 内 key（不含桶名）
  file_size    integer,
  file_type    text,
  uploader_uid text not null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 列表按上传时间倒序（最新在前），与 materials.js 排序一致
create index class_materials_created_idx on class_materials(created_at desc);

-- ============================================================
-- 2. 启用 RLS
-- ============================================================
alter table class_materials enable row level security;

-- ============================================================
-- 3. RLS 策略（仅对 authenticated 生效）
-- ============================================================
-- select：全班可读（共享资料库对登录用户开放）
create policy class_materials_select on public.class_materials
  for select to authenticated using (true);

-- insert / update / delete：仅 admin/superAdmin（app.is_admin()，见 20260914200000 同款）
create policy class_materials_insert on public.class_materials
  for insert to authenticated with check (app.is_admin());
create policy class_materials_update on public.class_materials
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy class_materials_delete on public.class_materials
  for delete to authenticated using (app.is_admin());

-- ============================================================
-- 4. GRANT（text 主键，无 identity 序列）
-- ============================================================
grant select, insert, update, delete on public.class_materials to authenticated;

-- ============================================================
-- 5. 权限加固（对齐 20260914181500_harden_privileges.sql / 20260914200000 第 7 节）
-- ============================================================
-- CloudBase PG 在 public 上配置了 ALTER DEFAULT PRIVILEGES：新建表会自动把
-- `arwdDxtm`（含 TRUNCATE / TRIGGER / REFERENCES / MAINTAIN）授予 authenticated，
-- 其中 TRUNCATE 不经过 RLS，属高危 DoS 面。此处把新表收紧到最小必要权限。
revoke truncate, trigger, references, maintain
  on public.class_materials
  from authenticated;
