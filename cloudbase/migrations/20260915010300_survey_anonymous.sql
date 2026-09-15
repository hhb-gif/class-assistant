-- 匿名收集（方案 B：PG 函数 + RPC，不使用云函数）
-- 目标库：CloudBase PG（PostgreSQL 17），业务 schema = public，辅助对象 schema = app
-- 迁移版本：20260915010300
-- 阶段：P4 前的「匿名收集」能力（surveys.anonymous = true 时启用）
--
-- 设计目标（真匿名）：管理员通过 PostgREST 也读不到匿名提交明细。
--   1) survey_anonymous_responses 开启 RLS 且「一条策略都不建」= deny all：
--      浏览器端（authenticated / anon）无论怎么查都是 0 行，也无法直接 insert/update/delete。
--   2) 唯一的读写通道是下方 security definer 函数；函数属主 = 建表者（表 owner），
--      默认绕过 RLS，因此能在 deny all 的表上安全地写入 / 聚合。
--   3) 表里只存「加盐 md5(token)」，不存 token 明文、不存 member_id / uid，
--      因此即便有人拿到整张表，也无法把答案对应回具体成员。
--
-- 数据模型来源（唯一真相）：docs/src/collect.js（匿名分支）
--   survey_anonymous_responses { id, survey_id, token_hash, answers[], created_at }
--   前端 answers 与非匿名一致，为 [{ qid, value }]（value: string | string[]）。
--
-- 权限口径：仅 authenticated 可调用 RPC；anon 一律拒绝（函数内 auth.uid() 判空兜底）。
--
-- ⚠️ 写法约束（重要，勿轻易改回）：
--   本项目的迁移执行器按分号切分语句，**不支持 `$$` 函数体内出现分号**。
--   因此这里所有函数一律写成 `language sql` 的**单条语句**形式（用 CASE / CTE / 子查询
--   表达分支与写入），函数体内不得出现分号。多语句 PL/pgSQL 会被截断并报 42601。
--   submit_anonymous 的写入用 data-modifying CTE（VOLATILE 函数允许）。

-- ============================================================
-- 1. 匿名提交表
-- ============================================================
-- unique(survey_id, token_hash) 实现「同机同问卷重复提交 = 覆盖更新」（upsert 语义）。
create table survey_anonymous_responses (
  id         text primary key,
  survey_id  text not null references surveys(id) on delete cascade,
  token_hash text not null,
  answers    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (survey_id, token_hash)
);
create index survey_anonymous_responses_survey_idx on survey_anonymous_responses(survey_id);

-- ============================================================
-- 2. 启用 RLS 且「故意不建任何策略」
-- ============================================================
-- 【有意为之】deny all：管理员也只能通过 app.anon_summary() 拿到聚合票数，
-- 不能 SELECT 明细。这是「真匿名」的关键——没有任何策略 = PostgreSQL 默认拒绝一切行。
-- 唯一写入通道是 security definer 的 app.submit_anonymous()（属主绕过 RLS）。
alter table survey_anonymous_responses enable row level security;

-- ============================================================
-- 3. 盐表（谁都不给权限）
-- ============================================================
-- 盐只用于 token_hash；轮换盐会使历史 token_hash 全部失效（老 token 查不到 / 覆盖不到自己的提交）。
create schema if not exists app;
grant usage on schema app to anon, authenticated;
create table app.anon_salt (salt text not null);
insert into app.anon_salt (salt) values (md5(random()::text || clock_timestamp()::text));
revoke all on app.anon_salt from anon, authenticated;

-- ============================================================
-- 4. 哈希函数：token -> 加盐 md5
-- ============================================================
-- 用内建 md5() 而非 pgcrypto 的 sha256，避免依赖扩展。
-- token 是前端生成的随机串（非用户口令），加盐 md5 已足够对抗「拿名单反查」。
create or replace function app.anon_hash(p_token text)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select md5((select salt from app.anon_salt limit 1) || p_token)
$$;

-- ============================================================
-- 5. 生成匿名记录 id（PG13+ 内置 gen_random_uuid；零扩展依赖）
-- ============================================================
create or replace function app.anon_gen_id()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select 'ar_' || replace(gen_random_uuid()::text, '-', '')
$$;

-- ============================================================
-- 6. 提交（新增 / 覆盖）—— 单语句 CTE 版
-- ============================================================
-- 分支语义：
--   err.code 为 null（全部校验通过）→ ins 插入/更新 1 行 → 返回 {ok:true}
--   err.code 非 null                → ins 插入 0 行      → 返回 {ok:false, code}
-- deadline 是 text，可能非标准格式：只有匹配 YYYY-MM-DD 前缀才尝试解析，
-- 否则视为无截止（null < now() 为 null，不会误判）。
create or replace function app.submit_anonymous(p_survey_id text, p_token text, p_answers jsonb)
returns json
language sql
security definer
volatile
set search_path = public, pg_temp
as $$
  with err as (
    select case
      when auth.uid() is null then 'NOT_AUTHENTICATED'
      when p_survey_id is null or length(p_survey_id) = 0 then 'BAD_INPUT'
      when p_token is null or length(p_token) < 8 or length(p_token) > 128 then 'BAD_INPUT'
      when p_answers is null or length(p_answers::text) >= 65536 then 'BAD_INPUT'
      when not exists (select 1 from public.surveys s where s.id = p_survey_id) then 'SURVEY_NOT_FOUND'
      when exists (select 1 from public.surveys s where s.id = p_survey_id and s.status is distinct from 'open') then 'CLOSED'
      when exists (
        select 1 from public.surveys s
        where s.id = p_survey_id
          and case
                when coalesce(s.deadline, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then s.deadline::timestamp
                else null
              end < now()
      ) then 'EXPIRED'
      else null
    end as code
  ),
  ins as (
    insert into public.survey_anonymous_responses (id, survey_id, token_hash, answers)
    select app.anon_gen_id(), p_survey_id, app.anon_hash(p_token), p_answers
    where (select code from err) is null
    on conflict (survey_id, token_hash) do update set answers = excluded.answers
    returning 1 as n
  )
  select json_build_object('ok', true)
  where exists (select 1 from ins)
  union all
  select json_build_object('ok', false, 'code', e.code)
  from err e
  where e.code is not null
$$;

-- ============================================================
-- 7. 查询「我在本问卷的匿名提交」—— 单语句版
-- ============================================================
create or replace function app.my_anonymous(p_survey_id text, p_token text)
returns json
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then json_build_object('ok', false, 'code', 'NOT_AUTHENTICATED')
    when p_survey_id is null or length(p_survey_id) = 0
      or p_token is null or length(p_token) < 8 or length(p_token) > 128
      then json_build_object('ok', false, 'code', 'BAD_INPUT')
    when r.answers is null then json_build_object('ok', true, 'found', false, 'answers', null)
    else json_build_object('ok', true, 'found', true, 'answers', r.answers)
  end
  from (
    select (
      select a.answers
      from public.survey_anonymous_responses a
      where a.survey_id = p_survey_id and a.token_hash = app.anon_hash(p_token)
      limit 1
    ) as answers
  ) r
$$;

-- ============================================================
-- 8. 管理端聚合（只给票数 / 文本，绝不含身份）—— 单语句版
-- ============================================================
-- 先把 answers 里的 value 统一摊平成「一行一个文本值」（多选数组逐项展开，
-- 标量值包成单元素数组走同一条路），再按 qid 聚合。
create or replace function app.anon_summary(p_survey_id text)
returns json
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then json_build_object('ok', false, 'code', 'NOT_AUTHENTICATED')
    when p_survey_id is null or length(p_survey_id) = 0 then json_build_object('ok', false, 'code', 'BAD_INPUT')
    when not exists (select 1 from public.surveys s where s.id = p_survey_id) then json_build_object('ok', false, 'code', 'SURVEY_NOT_FOUND')
    else (
      with flat as (
        select ans->>'qid' as qid,
               jsonb_array_elements_text(
                 case
                   when jsonb_typeof(ans->'value') = 'array' then ans->'value'
                   else jsonb_build_array((ans->'value') #>> '{}')
                 end
               ) as val
        from public.survey_anonymous_responses r
        cross join lateral jsonb_array_elements(coalesce(r.answers, '[]'::jsonb)) ans
        where r.survey_id = p_survey_id
      )
      select json_build_object(
        'ok', true,
        'submitted', (select count(*) from public.survey_anonymous_responses x where x.survey_id = p_survey_id),
        'questions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'qid', q->>'qid',
            'type', t.qt,
            'title', coalesce(q->>'title', ''),
            'options', coalesce(q->'options', '[]'::jsonb),
            'counts', case when t.qt = 'text' then '{}'::jsonb else (
              select coalesce(jsonb_object_agg(f.val, f.cnt), '{}'::jsonb)
              from (
                select val, count(*) as cnt
                from flat
                where qid = q->>'qid' and coalesce(val, '') <> ''
                group by val
              ) f
            ) end,
            'texts', case when t.qt = 'text' then (
              select coalesce(jsonb_agg(f.val), '[]'::jsonb)
              from flat f
              where f.qid = q->>'qid' and coalesce(f.val, '') <> ''
            ) else '[]'::jsonb end
          ))
          from public.surveys s
          cross join lateral jsonb_array_elements(coalesce(s.questions, '[]'::jsonb)) q
          cross join lateral (select coalesce(q->>'type', 'single') as qt) t
          where s.id = p_survey_id
        ), '[]'::jsonb)
      )
    )
  end
$$;

-- ============================================================
-- 9. GRANT（三个 RPC 函数给 authenticated；内部工具函数不给前端）
-- ============================================================
grant execute on function app.submit_anonymous(text, text, jsonb) to authenticated;
grant execute on function app.my_anonymous(text, text) to authenticated;
grant execute on function app.anon_summary(text) to authenticated;

-- 函数默认对 PUBLIC 开放 EXECUTE，这里收回，只保留 authenticated。
revoke all on function app.submit_anonymous(text, text, jsonb) from public;
revoke all on function app.my_anonymous(text, text) from public;
revoke all on function app.anon_summary(text) from public;
revoke all on function app.anon_hash(text) from public;
revoke all on function app.anon_gen_id() from public;

-- ============================================================
-- 10. RPC 入口兼容层（public 薄包装）
-- ============================================================
-- PostgREST 的 /rpc/<fn> 只在「暴露的 schema」内查找函数；CloudBase PG 默认只暴露 public，
-- 而业务函数按本项目惯例放在 app schema。为让前端
-- CA.cloud.app.rdb().rpc("submit_anonymous", ...) 能命中，在 public 建同名薄包装转发到
-- app.*（真正执行仍在 security definer 的 app 函数内，权限边界不变）。
create or replace function public.submit_anonymous(p_survey_id text, p_token text, p_answers jsonb)
returns json
language sql
as $$ select app.submit_anonymous(p_survey_id, p_token, p_answers) $$;

create or replace function public.my_anonymous(p_survey_id text, p_token text)
returns json
language sql
as $$ select app.my_anonymous(p_survey_id, p_token) $$;

create or replace function public.anon_summary(p_survey_id text)
returns json
language sql
as $$ select app.anon_summary(p_survey_id) $$;

grant execute on function public.submit_anonymous(text, text, jsonb) to authenticated;
grant execute on function public.my_anonymous(text, text) to authenticated;
grant execute on function public.anon_summary(text) to authenticated;
revoke all on function public.submit_anonymous(text, text, jsonb) from public;
revoke all on function public.my_anonymous(text, text) from public;
revoke all on function public.anon_summary(text) from public;

-- ============================================================
-- 11. 权限加固（对齐 20260914181500_harden_privileges.sql）
-- ============================================================
-- CloudBase PG 的 ALTER DEFAULT PRIVILEGES 会把 arwdDxtm（含 TRUNCATE 等）
-- 自动授予 authenticated；TRUNCATE 不经过 RLS，属高危 DoS 面，此处收紧。
revoke truncate, trigger, references, maintain
  on public.survey_anonymous_responses
  from authenticated;
