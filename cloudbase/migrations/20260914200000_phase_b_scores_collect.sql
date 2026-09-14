-- P1b 表结构 + RLS：成绩（subjects / exams / scores）与信息收集（surveys / survey_responses）
-- 目标库：CloudBase PG（PostgreSQL 17），业务 schema = public
-- 约定：text 主键；用户可见日期（考试日期 exam_date）保持 text；其余时间戳 timestamptz default now()
--       owner 关联列用 text；外键 on delete cascade；unique 约束防重复录入
-- 迁移版本：20260914200000
-- 阶段：P1b（P1a 已建 members / users / notices / favorites / subscribers）
--
-- 数据模型来源（唯一真相）：docs/src/scores.js、docs/src/collect.js、docs/src/seed.js
--   subjects { id, name, fullScore, order }        order 是 SQL 保留字 → sort_order
--   exams    { id, name, date, createdAt }         date → exam_date（保持 text）
--   scores   { id, examId, subjectId, memberId, score }
--   surveys  { id, title, desc, status, anonymous, deadline, createdBy, createdAt, updatedAt, questions[] }
--   responses{ id, surveyId, memberId, answers[], createdAt }
--   （collect.js 以嵌套数组使用 questions / answers；store 是通用集合→表映射，无 join，
--     故用 jsonb 承载嵌套结构，保持模块契约不变，Wave 2 仅需 await 化。）

-- ============================================================
-- 1. 辅助函数：当前登录用户 → members.id
-- ============================================================
-- SECURITY DEFINER：以函数属主身份查询 users，绕过 users 自身 RLS，
-- 避免在 scores / survey_responses 策略里再查 users 造成策略递归；
-- STABLE：同一语句内可复用。
create or replace function app.my_member_id()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select u.member_id from public.users u where u.uid = auth.uid()
$$;

grant execute on function app.my_member_id() to authenticated;

-- ============================================================
-- 2. 成绩表：subjects / exams / scores
-- ============================================================

-- 科目（语文/数学/英语 150；物理/化学 100）
create table subjects (
  id          text primary key,
  name        text not null,
  full_score  integer not null,
  sort_order  integer not null default 0   -- 原字段名 order（SQL 保留字）
);

-- 考试（考试日期保持 text，避免时区解析；createdAt → created_at）
create table exams (
  id         text primary key,
  name       text not null,
  exam_date  text,
  created_at timestamptz not null default now()
);

-- 成绩：按 member_id 关联，不存多余个人信息
create table scores (
  id         text primary key,
  exam_id    text not null references exams(id)    on delete cascade,
  subject_id text not null references subjects(id) on delete cascade,
  member_id  text not null references members(id)  on delete cascade,
  score      numeric(6,2) not null check (score >= 0),
  unique (exam_id, subject_id, member_id)
);
create index scores_exam_idx   on scores(exam_id);
create index scores_member_idx on scores(member_id);

-- ============================================================
-- 3. 信息收集表：surveys / survey_responses
-- ============================================================

create table surveys (
  id          text primary key,
  title       text not null,
  description text,                                  -- 原字段 desc（DESC 为保留字）
  status      text not null default 'open',          -- open | closed
  anonymous   boolean not null default false,
  deadline    text,                                  -- 保持 text（与 notices 一致）
  created_by  text not null default auth.uid(),
  questions   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 提交：一名成员对一张收集表至多一条（collect.js findResponse 语义）
create table survey_responses (
  id         text primary key,
  survey_id  text not null references surveys(id) on delete cascade,
  member_id  text not null references members(id) on delete cascade,
  answers    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (survey_id, member_id)
);
create index survey_responses_survey_idx on survey_responses(survey_id);

-- ============================================================
-- 4. 启用 RLS
-- ============================================================

alter table subjects         enable row level security;
alter table exams            enable row level security;
alter table scores           enable row level security;
alter table surveys          enable row level security;
alter table survey_responses enable row level security;

-- ============================================================
-- 5. RLS 策略（仅对 authenticated 生效）
-- ============================================================

-- subjects：登录用户可读；写仅 admin/superAdmin
create policy subjects_select on public.subjects
  for select to authenticated using (true);
create policy subjects_insert on public.subjects
  for insert to authenticated with check (app.is_admin());
create policy subjects_update on public.subjects
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy subjects_delete on public.subjects
  for delete to authenticated using (app.is_admin());

-- exams：登录用户可读；写仅 admin/superAdmin
create policy exams_select on public.exams
  for select to authenticated using (true);
create policy exams_insert on public.exams
  for insert to authenticated with check (app.is_admin());
create policy exams_update on public.exams
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy exams_delete on public.exams
  for delete to authenticated using (app.is_admin());

-- scores：管理员全部；学生仅自己 member_id（红线：成绩权限在服务端）；写仅 admin/superAdmin
create policy scores_select on public.scores
  for select to authenticated
  using (app.is_admin() or member_id = app.my_member_id());
create policy scores_insert on public.scores
  for insert to authenticated with check (app.is_admin());
create policy scores_update on public.scores
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy scores_delete on public.scores
  for delete to authenticated using (app.is_admin());

-- surveys：登录用户可读；增删改仅 admin/superAdmin
create policy surveys_select on public.surveys
  for select to authenticated using (true);
create policy surveys_insert on public.surveys
  for insert to authenticated with check (app.is_admin());
create policy surveys_update on public.surveys
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy surveys_delete on public.surveys
  for delete to authenticated using (app.is_admin());

-- survey_responses：管理员看全部（结果统计 / 未交名单）；学生只看 / 只改自己的提交。
-- 提交归属由 member_id = app.my_member_id() 强制（其值来自 users.uid = auth.uid()）。
-- 截止时间能否提交由前端 collect.js surveyState 判定，不在此策略内。
create policy survey_responses_select on public.survey_responses
  for select to authenticated
  using (app.is_admin() or member_id = app.my_member_id());
create policy survey_responses_insert on public.survey_responses
  for insert to authenticated
  with check (app.is_admin() or member_id = app.my_member_id());
create policy survey_responses_update on public.survey_responses
  for update to authenticated
  using (app.is_admin() or member_id = app.my_member_id())
  with check (app.is_admin() or member_id = app.my_member_id());
create policy survey_responses_delete on public.survey_responses
  for delete to authenticated
  using (app.is_admin() or member_id = app.my_member_id());

-- ============================================================
-- 6. GRANT（text 主键，无 identity 序列；按表实际需要）
-- ============================================================
grant select, insert, update, delete on public.subjects         to authenticated;
grant select, insert, update, delete on public.exams            to authenticated;
grant select, insert, update, delete on public.scores           to authenticated;
grant select, insert, update, delete on public.surveys          to authenticated;
grant select, insert, update, delete on public.survey_responses to authenticated;

-- ============================================================
-- 7. 权限加固（对齐 20260914181500_harden_privileges.sql）
-- ============================================================
-- CloudBase PG 在 public 上配置了 ALTER DEFAULT PRIVILEGES：新建表会自动把
-- `arwdDxtm`（含 TRUNCATE / TRIGGER / REFERENCES / MAINTAIN）授予 authenticated，
-- 其中 TRUNCATE 不经过 RLS，属高危 DoS 面。此处把新表收紧到最小必要权限。
revoke truncate, trigger, references, maintain
  on public.subjects, public.exams, public.scores, public.surveys, public.survey_responses
  from authenticated;
