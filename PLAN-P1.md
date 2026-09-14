# PLAN-P1.md · 数据层重构实施方案

> 版本：v1.0 ｜ 日期：2026-09-14 ｜ 上游：**[ROADMAP.md](ROADMAP.md)** §5 P1、**[ROADMAP.md](ROADMAP.md)** §4 目标架构
> 状态：**待确认后执行**
>
> 目标：把 `CA.store`（同步 localStorage）改为基于 **CloudBase PG** 的异步数据层，让通知/成绩/收集真正多用户共享。

---

## 0. 验收标准（P1 完成时）

1. 两台设备打开同一站点，A 发布通知 / 录入成绩 → B 登录后能看到；
2. 学生账号**只能读到自己的成绩**（越权读/写被 RLS 拒绝）；
3. 附件能真实上传、下载（不再是假文件名）；
4. `node docs/test/*.mjs` 全部通过（改造后的异步版本）；
5. 数据存在云端（换设备/清缓存不丢），复习数据仍留本机。

---

## 1. 策略：垂直切片，不搞大爆炸

| 迭代 | 范围 | 为什么 |
|------|------|--------|
| **P1a** | 基础设施 + 认证 + **通知** 一条完整链路 | 一次验证所有技术假设（SDK / RLS / 异步 store / 登录 / 部署），风险最小 |
| **P1b** | 成绩 + 收集 + 附件云存储 + 种子入云 + 全量测试 | 地基验证通过后批量铺开 |

> 已过评审的 `notices.js` 作为第一个迁移样本，踩到的坑（异步渲染、错误态）复用到 scores/collect。

---

## 2. P1-0 · 预备（前置，不写业务代码）

| # | 步骤 | 工具/方法 | 产出 |
|---|------|-----------|------|
| 0.1 | 确认 CDN 版 `@cloudbase/js-sdk` 支持 `app.rdb()` | 浏览器加载 `cloudbase.full.js` 打 `typeof app.rdb` | 结论：CDN 可用 / 需改用打包 |
| 0.2 | 生成 Publishable Key（前端公开，可入库） | MCP `manageAppAuth(action=ensurePublishableKey)` | `publishableKey` |
| 0.3 | 加 Web 安全域名（localhost:8899 等） | MCP `manageEnv(action=addSecurityDomain, domains=[...])` | 本地/线上 Origin 放行 |
| 0.4 | 建 pgstore bucket（附件用） | MCP/PG storage 管理面 | bucket 就绪 |
| 0.5 | 落地 `cloudbase/migrations/` 目录规范 | 手动 | 建表流程可复用 |

> `config.js` 只放 **envId + publishableKey**（公开）；**API Key 绝不进前端**。

> **P1-0 执行结果（2026-09-14）**
> - ✅ CDN 锁定 **`cloudbase.full.js@3.9.3`**（含 `app.rdb()` + `app.auth`）；官方示例的 `3.0.1` 已 404。
> - ✅ 初始化参数是 **`accessKey`**（不是 `publishableKey`）。
> - ⚠️ **改密 API 变更**：`updateUser({password})` v3 不可用 → 改用 **`resetPasswordForOld({old_password,new_password})`**。
> - ⚠️ **阻塞 · Web 安全域名**：`addSecurityDomain` 在**体验版套餐被拒**（`CreateAuthDomain 当前套餐无法执行`）。localhost 未进白名单 → 本机浏览器直连 CloudBase 可能被 CORS 拦；**静态托管域名已在白名单**。
>   - 对策（待定）：① 部署到静态托管域调试（推荐，零成本）；② 升级个人版后加自定义域名。
> - ✅ 已建：5 张表 + 18 条 RLS 策略 + `app.is_admin()`；`attachments`（私有 pgstore bucket）；30 名成员种子。
> - 🔴 **安全修正**：环境默认权限会把 `UPDATE/TRUNCATE` 授予 `authenticated`，会导致学生自改 `role` 提权 —— 已用第二个迁移收紧（`users` 仅列级 `UPDATE`）。
> - 🔴 **账号预置受阻（待决策）**：① 体验版用户配额上限 = **3**（含内置 administrator），需升配套餐才能建 30+ 账号；② 密码策略要求 **≥3 类字符、≥8 位**，纯学号密码被拒 → 建议 `Cs@<学号>`。真实 uid 是 **19 位数字串**（非 `u_xxx`），`public.users.uid` 必须写平台 uid。

---

## 3. P1a · 迁移步骤

| # | 步骤 | 工具/方法 | 产出 |
|---|------|-----------|------|
| a1 | 建表 + RLS：`members` `users` `notices` `favorites` `subscribers` | `managePgDatabase(applyMigration)` + `cloudbase/migrations/*.sql` | 表结构 + 策略落地 |
| a2 | 新模块 `docs/src/cloud.js`：初始化 SDK，导出 `app / db(app.rdb()) / auth` | CDN SDK | 单例客户端 |
| a3 | 重写 `docs/src/store.js`：localStorage → PG，接口保持同名但返回 **Promise**；驼峰↔下划线映射 | 手写适配层 | 异步 store |
| a4 | 重写 `docs/src/auth.js`：`auth.getSession()` + 读 `users.role`；新增登录/改密视图 | 手写 | 登录态与角色 |
| a5 | `app.js` 启动流程：加**登录门**（未登录 → 登录页；`must_change_password` → 强制改密页） | 手写 | 登录闭环 |
| a6 | `notices.js` 全量 `await` 化 + loading / 错误态 | 手写 | 通知模块上云 |
| a7 | 批量预置 30 个账号（学号=账号，初始密码=学号）+ `members` 种子 | MCP `managePermissions(createUser)` / SQL | 可登录的测试账号 |
| a8 | 本地 8899 双设备/双浏览器验证：A 发通知 → B 可见 | 手工 | **P1a 验收** |

---

## 4. P1b · 迁移步骤

| # | 步骤 | 工具/方法 | 产出 |
|---|------|-----------|------|
| b1 | 建表 + RLS：`exams` `subjects` `scores` `surveys` `survey_items` `survey_submissions` `operation_logs` `ai_usage_logs` `security_counters` `feedbacks` `invite_codes` | migrations | 全量表结构 |
| b2 | `scores.js` await 化；**学生只看自己**由 RLS 保证（前端仅做展示降级） | 手写 | 成绩模块上云 |
| b3 | `collect.js` await 化（提交/统计跨用户） | 手写 | 收集模块上云 |
| b4 | 附件真上传/下载：`app.storage.from(bucket).upload()` + `createSignedUrl()`；`storage.objects` RLS | 手写 + SQL | 资料分发可用 |
| b5 | 种子数据入云：30 人 / 3 考试 / 450 成绩 经 `execute` 写入（显式 owner） | SQL/脚本 | 演示环境就绪 |
| b6 | 测试改造：store mock → PG mock；notices/scores/collect 测试改 async | 手写 | 回归全绿 |
| b7 | 越权测试：以学生身份尝试读他人成绩 / 改通知 → 必须被拒 | SQL 角色模拟 + 手工 | 权限验收 |

---

## 5. 数据库设计要点（PG + RLS）

- **主键**：`BIGINT GENERATED ALWAYS AS IDENTITY`；业务 id 另加 `text` 列（兼容现有 `CA.store.uid`）。
- **owner 列**：`owner_id TEXT DEFAULT auth.uid()`（`auth.uid()` 返回 text，**不能用 uuid**）。
- **角色**：`users(uid TEXT PK, member_id TEXT, role TEXT, must_change_password BOOL)`。
- **RLS 管理员判定**：策略内子查询 `EXISTS(SELECT 1 FROM public.users u WHERE u.uid = auth.uid() AND u.role IN ('admin','superAdmin'))`；`users` 表自身只允许 self 读。若出现策略递归 → 抽 `SECURITY DEFINER` 函数 `app.is_admin()`。
- **成绩**：`scores(exam_id, subject_id, member_id, score)`；策略 `member_id = (SELECT member_id FROM users WHERE uid = auth.uid()) OR app.is_admin()`。
- **GRANT**：建表后 `GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated`；`serial/identity` 序列需 `GRANT USAGE, SELECT ON SEQUENCE`。
- **DDL 纪律**：一律 `applyMigration`（14 位时间戳 + snake_case 名），不默认走 `execute`。

---

## 6. 风险与验证点

| 风险 | 验证点 | 对策 |
|------|--------|------|
| CDN 版 SDK 无 `rdb()` | P1-0.1 | 回退 npm + esbuild（牺牲零构建）或换 SDK 版本 |
| RLS 策略递归/写错 → 数据全不可读 | P1a a1 后立即以 `authenticated` 角色试读 | 先建策略再写前端；越权测试兜底 |
| 异步化引入渲染回归 | 每个模块迁移后立刻跑对应测试 | 逐模块迁移，不批量改 |
| 学生身份可冒用 | 初始密码=学号较弱 | 首登强制改密 + `security_counters` 限流 |
| 免费体验版到期 | 到期 2027-03-14 | 预算内升级个人版 |

---

## 7. 分工

| 事项 | 谁 |
|------|----|
| 建表/RLS/账号预置/安全域名/bucket（MCP 可做） | **我**（用 MCP） |
| 前端重构、异步 store、登录页、测试改造 | **我** |
| Publishable Key 确认、API Key 轮换 | **你**（控制台，1 分钟） |
| 双设备/双浏览器肉眼验收、UI 观感 | **你** |
| 云端真实连通性（RLS 是否生效） | **我建 + 你验**（我看不到浏览器） |

---

## 8. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-09-14 | v1.0 | 初稿：垂直切片策略（P1a 通知 / P1b 其余）；PG + RLS 落地要点 |
