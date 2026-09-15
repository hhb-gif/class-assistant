# MIGRATION.md · CloudBase 环境迁移（账号A 体验版 → 账号B 个人版 PG）

> 状态：**✅ 迁移完成（2026-09-15）** —— 见文末「完成记录」

## 完成记录（2026-09-15）

新环境已就绪并通过浏览器验收：

| 项 | 结果 |
|---|---|
| 迁移目标 | `class-d3gnxrv6252ef676c`（账号B · 个人版 · PG · 到期 2026-10-15 · **关联小程序** `wx7ae52bc48a57d870`） |
| 数据库 | 重放 8 个迁移（含新增 `attachments_storage_rls`）→ 13 张表 + RLS + 函数 ✅ |
| 数据 | members 30 / users 2 / notices 2 / subjects 5 / exams 3 / scores 450 / surveys 2 / survey_responses 43 / messages 1 ✅ |
| 存储 | 建 `attachments` 私有桶 + storage RLS；旧环境 1 个对象为孤儿，未搬 |
| 认证 | 仅建 2 个测试账号：`teacher`(superAdmin→密码已改为 `Teacher@2026T`)、`20230301`(member，首登强制改密) |
| 云函数 | `ai-gateway`（DeepSeek，实测 `连接成功`）、`admin-user`（缺 CAM 密钥，待补） |
| 前端 | `config.js` → 新 envId + publishableKey；`?v=20260915a`；静态托管 + webapps 子域均已部署 |
| 验收 | 老师登录/改密/成绩(30 行)/AI ✅；学生登录 + **RLS 只读自己 15 条成绩** ✅ |
| 访问地址 | `https://app-class-d3gnxrv6252ef676c.webapps.tcloudbase.com/` ／ `https://class-d3gnxrv6252ef676c-1488894548.tcloudbaseapp.com/` |

> 旧环境（账号A · 体验版）已迁出；导出快照保留在 `temp/migration/`（本机，gitignored）。

### 迁移后修复：jsonb 列被存成字符串
导入时 jsonb 列（`surveys.questions`/`notices.attachments`/`notices.links`/`survey_responses.answers`）被写成字符串 → 收集题数显示 `112 道题`。
已用 `update ... set col = (col #>> '{}')::jsonb where jsonb_typeof(col)='string'` 修复并复验（`jsonb_typeof` = `array`）。
详见 `故障记录/2026-09-15-迁移jsonb列变字符串.md`。

> 验收补充（新环境）：老师/学生双角色、成绩（30/15，RLS 生效）、收集（统计/文本回答/未交名单）、通知（置顶徽标）、资料库、留言、AI（`连接成功`）均通过。

---

## 目标

把班级管家从**旧环境**迁到**新环境**（用户在 B 账号新建的 PG 个人版）。

| | 旧（源） | 新（目标） |
|---|---|---|
| EnvId | `class-assistant-d6fw1gdce84d261e` | `class-d3gnxrv6252ef676c` |
| 账号 UIN | 100052763818 | 100052915684 |
| 套餐 | 体验版 | 个人版（**到期 2026-10-15，仅 1 个月**） |
| 区域 | ap-shanghai | ap-shanghai |
| 数据库 | PG | PG ✅ |

> MCP 已切到新环境（`~/.config/opencode/opencode.jsonc`），并把旧 envId 以注释保留以便回退。
> 新环境 API Key：CLI 创建的 `migrate`（已写入 MCP 配置）。

## 阶段 0 · 已完成（导出旧环境数据）

13 张表导出为 JSON，存于 **`temp/migration/*.json`**（temp 已 gitignore）：

| 表 | 行数 |
|---|---|
| members | 30 |
| users | 2 |
| notices | 2 |
| favorites | 0 |
| subscribers | 0 |
| subjects | 5 |
| exams | 3 |
| scores | 450 |
| surveys | 2 |
| survey_responses | 43 |
| survey_anonymous_responses | 0 |
| messages | 1 |
| class_materials | 0 |

- 云存储：bucket `attachments` 有 **1 个对象**（需搬迁）。
- 迁移 SQL：`cloudbase/migrations/` 共 **7 个**（含并行会话的 `class_materials`、`survey_anonymous`）。

## 待办（重启后按序执行）

| # | 步骤 | 工具 |
|---|---|---|
| 1 | 复核新环境（PG、套餐、区域） | `queryEnv(info)` |
| 2 | 重放 7 个迁移（建表 + RLS + 函数 + 权限） | `managePgDatabase(applyMigration)` × 7 |
| 3 | 建 pgstore bucket `attachments` + `storage.objects` RLS | `managePgDatabase(execute)` |
| 4 | 导入数据（逐表 `jsonb_populate_recordset`，on conflict do nothing） | `managePgDatabase(execute)`，数据在 `temp/migration/` |
| 5 | 认证：开用户名密码登录；**只建最少测试账号**（teacher + 1 学生），`users` 行按新 uid 重建 | `manageAppAuth` / `managePermissions(createUser)` |
| 6 | 云函数：部署 `ai-gateway`（+ 并行会话的 `admin-user`），设 `AI_API_KEY`=DeepSeek Key、`AI_BASE_URL`、`AI_MODEL`、`AI_JSON_MODE=1` | `manageFunctions` |
| 7 | 云存储：把 attachments 的 1 个对象搬到新桶 | `manageStorage` / SDK |
| 8 | 前端：`docs/src/config.js` 更新 `envId` + **新 publishableKey**；bump `?v=`；部署静态托管 + webapps | `manageAppAuth(ensurePublishableKey)`、`manageHosting`、`manageApps` |
| 9 | 验收：双角色登录 + 通知/成绩/收集/复习/留言 + AI | 浏览器 |

## 重要提醒

1. **账号数量**：新环境是个人版（200 用户/月），但**真实部署前只建最小测试账号**（用户明确要求，避免再触配额）。
2. **到期**：新环境 **2026-10-15** 到期（1 个月），到期前续费。
3. **users 表不可直接复制**：`uid` 是各环境独立的 Auth uid，必须重建账号后重映射 `member_id`/`role`。
4. **两个账号属不同腾讯云账号**：迁移后旧环境 MCP 不可访问（旧数据已导出）。
5. 迁移完成并验收后，更新 `ROADMAP.md`（访问地址③④）与 `README.md`。
