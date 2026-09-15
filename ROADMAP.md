# ROADMAP.md · 班级管家 全局路线图

> 版本：v1.10 ｜ 日期：2026-09-15 ｜ 状态：**已确认，待执行**
> 上游：**[GOALS.md](GOALS.md)**（愿景书，部分已过时）、**[CONTRACT.md](CONTRACT.md)**（原型开发契约）、**[DESIGN.md](DESIGN.md)**（UI 规范）、**[REVIEW.md](REVIEW.md)**（复习整合契约）
>
> **本文件是当前权威执行计划。与 GOALS.md 冲突时，以本文为准。**（GOALS.md 描述的是「小程序 + 分四期」的原始设想，本文记录实际战略转向。）

---

## 0. 一页摘要（TL;DR）

- **原型已跑通**：本地 Web 原型完成 M1 通知/资料 + M2 成绩 + M3 信息收集 + RH 复习能力整合，391 条断言全绿。
- **战略转向**：不再直奔微信小程序，**先做能真实交互的网页产品**；小程序后置。
- **换地基**：数据从「本机 localStorage」升级为「CloudBase 共享后端」——否则用户之间无法交互。
- **四个阶段**：P1 数据层重构 → P2 复习抄 RH → P3 AI 网关迁移 → P4 部署与真机试用。
- **横切红线**：成绩权限必须在服务端；内容安全 Web 阶段暂缓、上线前补。

---

## 1. 现状盘点

### 1.1 已完成（本地原型）

| 模块 | 能力 | 测试 |
|------|------|------|
| 通知/资料 | 分类筛选、置顶/重要、附件与链接、收藏、AI 一句话草稿 | notices 64 |
| 成绩中心 | 表格录入 + 粘贴批量导入、7 项统计、分布/趋势/科目图表、AI 班级分析 + 个人评语、学生只看自己 | scores 83 |
| 信息收集 | 接龙/报名/投票、单选/多选/文本、截止时间、已交未交、结果统计、AI 归类汇总 | collect 78 |
| 学习复习 | 上传资料 → AI 要点 + 出题 → 练习 → SM-2 复习 → 资料库 → Word 导出；离线降级 | review 85 |
| 数据/壳 | store/seed/auth、设计系统 v2、图标系统、AI 网关 | store 81 |

合计 **391 条 node 断言**；另有 4 个浏览器冒烟页（需服务运行、走真实 AI）。

### 1.2 真交互缺口（本次盘点新发现，之前的规划未覆盖）

| # | 缺口 | 证据 | 影响 |
|---|------|------|------|
| 1 | **附件是假的** | `seed.js` 附件为手写元数据 `{name,size,type}`；`notices.js` 无 `FileReader`/上传逻辑 | 「资料分发」只发文件名，接不了真文件 |
| 2 | **内容安全零实现** | 全库无 `msgSecCheck`/内容安全代码；且 Web 端没有微信该接口 | 合规缺口，需重新设计方案 |
| 3 | **数据全在本机** | `CA.store` = localStorage 单键 `ca_db`（同步 API） | 用户之间无法交互 |
| 4 | **异步重构面大** | `CA.store.*` 调用 **84 处**（scores 27 / collect 21 / ai 16 / notices 13 / app 4 / auth 3）+ 391 测试 mock 同步存储 | P1 主要工程量 |
| 5 | **权限只在前端** | `CA.auth.can()` 在浏览器判断 | 换后端后学生可篡改自己的成绩，必须移到服务端 |

---

## 2. 为什么必须换地基

现状 `CA.store.get("notices")` 是**同步返回数组**；多用户共享数据要求网络 I/O，三根柱子必须同时换：

| 柱子 | 现状（单机单用户） | 目标（多用户共享） |
|------|-------------------|-------------------|
| 数据读写 | 同步返回数组 | **异步（Promise）** → 全部调用处改 await |
| 身份 | 右上角假切换 `users[0]` | **真登录 + 会话**（匿名登录绑定名单） |
| 权限 | 前端 `CA.auth.can()` | **服务端安全规则**（成绩按 uid 行级过滤） |

> 第三点是红线：成绩属敏感数据，前端判断权限 = 没有权限。

---

## 3. 决策记录（ADR）

| # | 决策 | 结论 | 理由 | 日期 |
|---|------|------|------|------|
| D1 | 交付形态 | **网页优先（PWA 级），功能跑通；小程序后置** | 原型资产复用率最高，先验证真实需求 | 09-14 |
| D2 | 后端平台 | **腾讯云开发 CloudBase** | 国内节点、零运维、**Web/小程序同一环境多端共用**（与 D1 的小程序终态连续性最好） | 09-14 |
| D3 | 登录方式 | **学号即账号 + 初始密码 = 学号，首登强制改密** | 环境匿名未开；账号由管理员按名单预置，比「姓名+学号」更难被冒用 | 09-14（修订） |
| D4 | 数据边界 | **班级数据上云；复习记录留本机（IndexedDB）** | 复习是个人学习记录，涉及隐私且体积大 | 09-14 |
| D5 | 复习模块 | **抄一份 RH（源码级复制），不干涉 RH 仓库** | 两边独立演进，互不影响 | 09-14 |
| D6 | AI 网关 | **从借用 RH 的 SCF 代理迁到 CloudBase 云函数** | 解耦两个项目 + key 安全 + 免 Origin 白名单折腾 | 09-14 |
| D7 | 内容安全 | **Web 阶段暂缓，人工重审；上线前补方案** | Web 端无微信 msgSecCheck，试用期范围可控 | 09-14 |
| D8 | 重构策略 | **彻底异步化**（store 接口返回 Promise） | 无脏读/冲突隐患，一次到位 | 09-14 |
| D9 | 部署 | **CloudBase 静态托管**（前后端同源打通） | 接后端后 GH Pages 不再适用 | 09-14 |
| D10 | 匿名收集 | **方案 B：独立匿名表 + PG 函数 RPC**（连管理员也读不到明细） | 要的是真匿名；纯前端隐藏 = 掩耳盗铃 | 09-15 |
| D11 | 复习资料 | **资料上云共享，学习记录仍留本机**（修正 D4 的边界表述） | 老师要发资料给全班，但个人学习隐私与体积不应上云 | 09-15 |
| D12 | 写权限口径 | **所有业务表的写策略都必须先过 `app.is_admin()`**；UPDATE/DELETE 前端的「成功」必须靠**回读校验**确认 | `notices` 曾漏掉 admin 前置（按 publisher_id 授权），且 RLS 静默过滤会被前端当成功 | 09-15 |

> 备选方案与否决理由见附录 A（后端选型对比）。

---

## 4. 目标架构

### 4.1 架构图

```
浏览器 / （未来小程序）
  │  @cloudbase/js-sdk v3（登录 + 会话）
  ├── CloudBase PG（PostgreSQL，app.rdb() 链式查询）
  │     班级业务表（见 §4.2）
  │     RLS 行级安全策略做权限（见 §4.3）
  ├── 云存储（pgstore bucket）
  │     通知附件、成绩导入文件（替换「假附件」）
  └── 云函数
        ai-gateway        AI 统一网关（替换 RH SCF 代理）
        verify-member     姓名+学号 → 绑定 uid
        import-scores     批量导入解析与校验
        send-notify       订阅消息（上线后）
        content-check     内容安全（预留，上线前补）
  ·
  本机：复习数据 → IndexedDB `ca_study`（不上云，D4）
```

> ⚠️ **2026-09-14 环境侦察修订**：实测环境 `class-assistant-d6fw1gdce84d261e` 为 **PG 模式**（`RuntimeBackends.postgresql=true`、`nosql=false`、`mysql=false`）。原「文档型数据库 + 安全规则」方案不成立，全部改为 **PG 表 + RLS + `app.rdb()`**。

### 4.2 CloudBase PG 数据表

| 分组 | 表 | 说明 |
|------|----|------|
| 身份 | `users` `members` `invite_codes` | uid 绑定角色；名单 30 人；一次性邀请码 |
| 通知 | `notices` `favorites` `subscribers` | 通知+附件元数据+链接；收藏；订阅 |
| 成绩 | `exams` `subjects` `scores` | 成绩按 `member_id` 关联，不存多余个人信息 |
| 收集 | `surveys` `responses` `survey_anonymous_responses` | 问卷/接龙/报名与提交；**匿名提交独立表（无 member_id，只存加盐 token 哈希）** |
| 资料 | `class_materials` | 班级共享资料的元数据（文件本体在云存储） |
| 审计 | `operation_logs` `ai_usage_logs` `security_counters` `feedbacks` | 操作审计、AI 用量、限流、反馈 |
| ~~复习~~ | ~~`review_cards`~~ 等 | **不建**（D4，复习留本机） |

> DDL 一律走 `managePgDatabase(action=applyMigration)`，本地文件 `cloudbase/migrations/<version>_<name>.sql`（14 位时间戳版本号）。
> ⚠️ **迁移执行器按分号切分语句**：`$$ ... $$` 函数体内不得出现分号，函数必须写成 `language sql` 单条语句
> （用 `CASE`/CTE/子查询表达分支）。血泪教训见 [故障记录/2026-09-15-PG迁移函数体分号截断.md](故障记录/)。

### 4.3 认证与权限（CloudBase Auth + RLS）

1. **登录**：用户名密码（`username` = 学号）。管理员按 `members` 名单**批量预置账号**（MCP `managePermissions(createUser)` 或后端 API），初始密码 = 学号，**首次登录强制改密**
2. **成员映射**：`members.student_no` ↔ 登录用户名；`users.member_id` 关联名单；`users.role ∈ member|admin|superAdmin`
3. **提权**：管理员用一次性邀请码 → 云函数校验 → `role = admin`
4. **权限（RLS 策略；`auth.uid()` 返回 text，owner 列用 `TEXT DEFAULT auth.uid()`）**：

| 表 | SELECT | INSERT / UPDATE / DELETE |
|----|--------|--------------------------|
| `notices` | 已登录用户 | 三条写策略**都必须先过 `app.is_admin()`**（20260915010400 收紧）：INSERT 仅管理员；UPDATE/DELETE 普通管理员限自己发布的、超级管理员全部。**非管理员即使 `publisher_id` 等于自己也被拒** |
| `scores` | 管理员全部；学生**仅自己 member_id** | 仅 admin/superAdmin |
| `surveys` | 已登录用户 | 仅 admin/superAdmin |
| `responses` | 提交者本人或 admin（**仅非匿名问卷**） | 提交者本人（未截止） |
| `class_materials` | 已登录用户（全班可读） | 仅 admin/superAdmin |
| `survey_anonymous_responses` | **无策略 = deny all**（管理员也读不到） | 无策略；只经 `app.submit_anonymous()`（security definer）写入 |
| 敏感/复杂操作 | —— | 一律走云函数 / PG 函数（security definer）服务端校验 |

> ⚠️ **RLS 的静默失败**：UPDATE/DELETE 被策略过滤时，PostgREST 返回的是「0 行受影响、无 error」。
> 前端必须**回读校验**，否则会把越权操作当成功（历史上 `notices.js` 就会弹「已更新/已删除」）。
> 见 §3 D12。

> **匿名收集（D10，方案 B：PG 函数 + RPC）**：`survey_anonymous_responses` 启用 RLS 且**零策略**，
> 表内只存 `md5(盐 ‖ 随机token)`，不存 `member_id`/`uid`。读写只能经
> `app.submit_anonymous` / `app.my_anonymous` / `app.anon_summary`（`security definer`，属主绕过 RLS），
> 管理端仅得聚合票数。代价（已接受）：老师无法催交、无「已交/未交」进度、学生换设备可能重复提交一次。
> token 只存学生本机 `localStorage`。

---

## 5. 路线（分阶段）

### P0 · 骨架与决策 **[已完成]**
- 产出：本文件 + GOALS.md 修订 + 后端/身份/数据边界决策锁定。

### P1 · 数据层重构 **[已完成]**
> 档案：P1a（基础设施 + 认证 + 通知）与 P1b（成绩 + 收集）均已上线并浏览器实测通过。
- **目标**：`CA.store` 从 localStorage 同步 API → **CloudBase PG 异步 API**。
- **策略**：垂直切片 —— **P1a**（基础设施 + 认证 + 通知打通）→ **P1b**（成绩 + 收集 + 附件 + 种子 + 测试）。
- 📋 **详细实施方案见 [PLAN-P1.md](PLAN-P1.md)**。
- **内容**：store 改 Promise；模块 await 化；PG 建表 + RLS；云存储接管附件；种子入云；测试改异步。
- **产出**：可多端共享数据的网页版（通知/成绩/收集三模块）。
- **验收**：两台设备对同一环境，A 发布通知 / 录成绩，B 可见且学生只能看自己。

### P2 · 复习模块（抄 RH）
- **目标**：按 D5，复刻一份与 RH 相同的功能与界面为独立模块（不碰 RH 仓库）。
- **内容**：移植 RH 的 UI 层（现 `review-view.js` 是按 CA 设计系统重写的，非 RH 原界面）；确认与 RH 主站 IndexedDB 是否隔离（同 Origin 风险）。
- **产出**：与 RH 一致的复习视图。
- **验收**：上传→要点→出题→练习→SM-2→导出，全链路可用。

### P3 · AI 网关迁移
- **目标**：解耦 RH，key 进云函数环境变量。
- **内容**：`ai-gateway` 云函数（云开发内置 AI 或 OpenAI 兼容通道调 DeepSeek）；4 个 AI 能力（通知草稿/班级分析/个人评语/归类汇总）与复习出题统一切到网关。
- **验收**：AI 开关关闭时全链路基础功能不受影响；开启时四类 AI 能力可用。

### P4 · 部署与真机试用
- **目标**：老师与真实学生可用。
- **内容**：CloudBase 静态托管 + 自定义域名（如需）；隐私协议；真实种子数据；三角色 × 五视图端到端验收。
- **验收**：对齐 GOALS M1/M2/M3 的「真实使用」标准。

### P5 · 真交互补齐 **[已完成]**
> 触发：用户实测发现「添加选项点了没反应」「勾了匿名还能看到谁没交」——即 UI 有入口但功能是假的。
- **背景**：盘点发现「上传 / 下发 / 增加」类入口真伪混杂（附件上传是真的，但设置页导出/重置、
  账号管理、考试/科目新增、匿名全是假的或缺的）。
- **内容**：
  1. **匿名收集**（D10 方案 B，PG 函数 + RPC）——见 §4.3。
  2. **班级共享资料库**（D11，新表 `class_materials` + 复用 `attachments` 桶；老师上传 → 全班可下载 →
     学生「加入我的复习」交本机 RH 引擎解析）。**修订 D4 边界**：上云的是**资料文件**，
     复习记录与解析结果仍只留本机 IndexedDB，D4 未被破坏。
  3. **成员 / 账号管理**：设置页成员增删改（RLS 已允许管理员）；`admin-user` 云函数
     （`probe`/`list`/`create`/`resetPassword`）走管控面 `tcb:CreateUser` + `exec-pgsql` 写 `users`。
  4. **数据管理修真**：导出改为逐集合读 PG；重置改为真删业务表（保留 members/users，双重确认）。
  5. **Bug 修**：`collect.js` 在 `querySelectorAll()` 结果上直接 `.map()`（NodeList 没有 map），
     导致「添加选项/添加题目/保存」全部静默中断；单测的 DOM 桩返回真数组所以没抓到 —— 桩已改为类 NodeList。
- **验收**：8 个 node 测试套件全绿（784 断言）；迁移已应用并校验；`admin-user` 已部署。
  ⏳ 未做：浏览器真机点验匿名 RPC 与建号（见 §9 待决）。

---

## 6. 横切事项

| 事项 | 现状 | 计划 |
|------|------|------|
| 内容安全 | 零实现（D7） | 试用期人工重审；上线前接腾讯云 TMS 或等小程序 msgSecCheck |
| 测试策略 | 391 断言 mock 同步 localStorage | P1 同步改造为异步 mock；新增多用户权限测试 |
| 数据迁移 | seed.js 确定性生成 | P1 一次性导入云数据库；保留本地 seed 供离线演示 |
| 合规/主体 | 个人主体（GOALS §8） | 网页版需隐私政策；正式小程序挂老师主体 |
| 成本 | 本地零成本 | CloudBase 免费体验 → 个人版 ¥19.9/月（GOALS §7 需更新） |

---

## 7. 风险登记

| # | 风险 | 等级 | 对策 |
|---|------|------|------|
| 1 | P1 异步改造面大，易引入回归 | 高 | 先改 store + 测试，再逐模块迁移；每模块迁移后立即跑测试 |
| 2 | 安全规则配置错误导致成绩泄露 | 高 | 成绩读写全走服务端校验；上线前专门做越权测试 |
| 3 | CloudBase 免费体验到期 | 中 | 预算内转个人版 ¥19.9/月 |
| 4 | RH 复习数据与 CA 同 Origin 冲突 | 中 | P2 明确 IndexedDB `DB_NAME` 隔离策略 |
| 5 | 内容安全缺位被投诉 | 中 | 试用范围可控 + 人工重审；上线前补 |
| 6 | 匿名登录身份可丢（换设备） | 低 | 支持再次名单校验恢复绑定 |

---

## 8. 环境与接入状态

| 项 | 状态 |
|----|------|
| **开发基线（决策 2026-09-15）** | `class-d3gnxrv6252ef676c`（账号B · **个人版** · ap-shanghai · PG）—— **唯一开发/生产基线** ✅ |
| 到期 | **2026-10-15**（1 个月，需续费，否则隔离） |
| 同账号其它环境 | `class-d9gpz1bn873a0b404`（账号B · 个人版 · 到期 2027-03-15）—— **空环境，未使用**（无表/无函数/无前端，仅系统默认文件）；保留或删除待定 |
| 已退役环境 | `class-assistant-d6fw1gdce84d261e`（账号A · 体验版 · PG）—— 迁移来源，**转只读备份、不再开发**；导出快照在 `temp/migration/` |
| 小程序关联 | `WxAppId: wx7ae52bc48a57d870` ✅ |
| 数据后端 | **PostgreSQL（PG 模式）** |
| 用户配额 | 个人版 **200 用户/月**（此前体验版仅 3 → 已解卡） |
| 登录方式 | `usernamePassword=true` |
| CLI / MCP | CLI 账号级 = 账号B（uin `100052915684`）；MCP 绑定 `class-d3gnxrv6252ef676c` ✅ |
| MCP 接入 | opencode 全局配置（本地模式）✅ |
| 环境级 API Key | 已配置（Key 名 `migrate`）⚠️ **仅存全局配置、严禁入库** |
| 🌐 访问地址① | `https://app-class-d3gnxrv6252ef676c.webapps.tcloudbase.com/`（短子域，推荐）✅ |
| 🌐 访问地址② | `https://class-d3gnxrv6252ef676c-1488894548.tcloudbaseapp.com/`（静态托管默认域）✅ |
| PG 业务表 | 13 张（含 `messages`/`class_materials`/`survey_anonymous_responses`）+ RLS ✅ |
| 附件 bucket | `attachments`（私有 pgstore）+ storage RLS ✅ |
| 云函数 | `ai-gateway`（→ DeepSeek，已验证 ✅）、`admin-user`（缺 CAM 密钥，待补） |
| SDK | `cloudbase.full.js@3.9.3`（含 `app.rdb()`）✅ |
| ⚠️ 默认域名限制 | 上述地址均为 CloudBase 默认域名：真实浏览器弹中间页、微信内触发下载 → 正式对外需绑**自定义域名（ICP 备案）** |
| 👤 测试账号 | `teacher` / `Teacher@2026T`（superAdmin）；`20230301` / `Uestc@0230301`（member，首登强制改密） |
| ⚠️ 密码策略 | 初始密码需 **≥3 类字符、≥8 位**，不能用纯学号 |
| ✅ P1a 验收 | 已完成（多用户共享 + RLS 越权阻断 + 首登改密闭环），详情见 `故障记录/2026-09-14-P1a登录与越权修复.md` |
| ✅ P1b | 成绩/收集上云 + RLS；`store` 支持 10 个集合；种子 5 科/3 考/450 成绩/2 收集/42 提交 |
| 🎨 UI v4.1 | **Rounded Neo-brutalism** + **和谐化配色**（墨蓝 `#2B4ACB` + 陶土橙 `#CF5A1C` + 奶油底）；Agnes 插画按新色板重出 7 张；角色差异化；见 `DESIGN.md` |
| ✅ P2 | 复习 Tab = **CA 原生 UI（v4）+ RH 引擎**（弃用 RH 整页 iframe，`docs/rh` 已删）；复习 AI 走 CloudBase 网关 |
| ✅ P3 | AI 网关 = 云函数 `ai-gateway` → DeepSeek（免前端密钥）；**线上实测可用**（`testConnection` / `parseNotice` 通过） |
| ✅ P5 · 迁移 | 新增三条：`20260915010200_class_materials`、`20260915010300_survey_anonymous`、`20260915010400_notices_admin_only_update`（均已 apply + 校验） |
| ✅ P5 · 云函数 | `admin-user`（账号管理）已部署，`InstallDependency=TRUE`、Status Active；新环境已配 `TCB_API_KEY`/`TCB_ENV_ID`，**缺 `TC_SECRET_ID`/`TC_SECRET_KEY`** → `probe` 返回 `NO_CREDENTIAL` |
| ⚠️ 建号前置 | `admin-user` 还差 `TC_SECRET_ID` / `TC_SECRET_KEY`（tcb 管控面）才能建号/重置密码；**配额已非瓶颈**（个人版 200 用户/月，当前仅 3 个账号：`administrator`/`teacher`/`20230301`） |
| 📌 迁移约束 | 迁移执行器按 `;` 切分：**`$$` 函数体内不得有分号**，用 `language sql` 单语句 + `CASE`/CTE 表达（详见故障记录 2026-09-15） |
| 🔒 匿名数据 | `survey_anonymous_responses` RLS 零策略（deny all）；读写仅经 `app.submit_anonymous` / `my_anonymous` / `anon_summary`（+ `public` 同名包装层给 PostgREST 命中） |
| ⚠️ 部署缓存 | 静态托管边缘会缓存 JS；`index.html` 本地资源统一带 `?v=<版本>`，**每次部署须 bump 版本号** |
| 🔑 密钥 | DeepSeek Key 存于云函数环境变量 `AI_API_KEY`（不入库）；**建议使用后轮换** |
| 🗑️ 已清理 | 静态托管里遗留的 `rh/`（弃用的 RH iframe 副本）已删除 |

## 9. 待决问题

- [x] P2 复习界面「抄 RH」的精确形态 → 定为 **CA 原生 UI + RH 引擎**（v1.5 已落地）
- [ ] 是否需要自定义域名（涉及备案）
- [ ] 上线前内容安全的具体方案选型
- [ ] 初始密码策略细节（改密入口、忘记密码找回方式）
- [ ] **`admin-user` 的 CAM 密钥 + `TCB_API_KEY` 是否配置**；体验版用户上限 3 需升配套餐
- [ ] **浏览器真机点验**：匿名问卷提交/回显/聚合、班级资料上传下载、成员增删改、账号建号
- [ ] `admin-user` 的 `resetPassword` 用的 `ModifyUser` 参数名**未验证**（仅按文档对称推断）

---

## 10. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-09-14 | v1.0 | 初稿：确立「网页优先 + CloudBase + 匿名登录 + 复习抄 RH」路线；盘点真交互缺口 |
| 2026-09-14 | v1.0 | 接入 CloudBase 环境 + MCP；记录环境 ID 与接入状态 |
| 2026-09-14 | v1.1 | 环境侦察：确认为 **PG 模式**，数据层由「集合+安全规则」改为「**表 + RLS**」；发现登录方式冲突（匿名未开） |
| 2026-09-14 | v1.2 | **P1a 完成并验收**：登录/改密/通知发布多用户共享跑通；修复 RLS 越权发布漏洞 + `users` 主键列 bug；写故障记录 |
| 2026-09-14 | v1.3 | **P1b 完成**（成绩/收集上云 + RLS）＋ **UI v3**（设计系统升级 + 教师/学生角色差异化）；浏览器实测双角色通过；修复角色命名不一致（`member`）与部署缓存问题 |
| 2026-09-14 | v1.4 | **P2 完成**（复习 iframe 抄 RH）、**P3 完成**（AI 网关→CloudBase 云函数→DeepSeek，线上实测可用）、**UI v4**（Neo-brutalism + Agnes 生图）；浏览器实测通过 |
| 2026-09-14 | v1.5 | UI 配色和谐化（墨蓝+陶土橙）＋ 复习改为 **CA 原生 UI + RH 引擎**（弃 iframe）＋ Agnes 资产按新色板重出 ＋ 复习 AI 接入 CloudBase 网关；浏览器实测通过 |
| 2026-09-14 | v1.6 | 应用户反馈：`.card-ink` 黑底→主色蓝；复习减少框嵌套（4→2 卡）；精简「演示」等废话文案；**新增「留言」Tab**（学生→老师，含回复闭环）；**通知附件真上传/下载** + 存储 RLS；浏览器实测通过 |
| 2026-09-14 | v1.7 | 移除「高二(3)班」文案；**新增 webapps 子域**并实测登录可用；**移动端适配**（底部 6 项导航/紧凑顶栏/响应式卡片，390px 实测）；git 提交推送 |
| 2026-09-14 | v1.8 | 修复 index.html 漏载 `collect.js`（收集恢复）；新增**短子域** `app-…`；通知/收集**点按收起**（toggle，`aria-expanded` 同步） |
| 2026-09-15 | v2.0 | **环境迁移完成**：账号A 体验版 PG → 账号B **个人版 PG**（`class-d3gnxrv6252ef676c`，200 用户/月，关联小程序）；13 张表 + RLS + 数据全部迁移并浏览器验收；AI 网关/附件桶/账号重建；MCP 已切环境 |
| 2026-09-15 | v1.9 | **P5 真交互补齐**：① 修 `collect.js` NodeList `.map` bug（添加选项/题目/保存全部失效）；② **匿名收集 = 真匿名**（D10 方案 B：PG 函数 + RPC、零策略 deny all、加盐 token 哈希）；③ **班级共享资料库**（D11，新表 `class_materials`，老师上传→全班可学，资料上云而学习记录仍留本机）；④ 设置页**成员增删改 + 账号管理 + 真实导出/重置**，新增云函数 `admin-user`；⑤ 新增「资料」Tab（7 项导航）；⑥ 发现并记录**迁移函数体分号截断**约束；测试 542 → **784** 断言，全部通过 |
| 2026-09-15 | v1.10 | **修「学生也能改通知」**：定位到 `notices` 是全库唯一「UPDATE/DELETE 策略没强制 `app.is_admin()`」的表（原按 `publisher_id = auth.uid()` 授权），迁移 `20260915010400` 收紧为「管理员 AND（超管 或 发布者本人）」；前端 `canManage()` 改为**先判管理员能力再比 publisherId**（堵住 `undefined === undefined` 退化）；并补**写后回读校验** —— RLS 静默过滤（0 行受影响、无 error）不再被当成功（D12）。浏览器侧核对：`notices_test` 学生角色改为真实值 `member` + 新增 15 条权限/静默拦截断言；测试 784 → **799** 全绿 |
| 2026-09-15 | v1.11 | **补齐迁移回归**：`20260915010400_notices_admin_only_update` 迁移曾在重放时**漏应用到新环境**（`notices_update`/`notices_delete` 仍是旧策略，缺 `app.is_admin()` 前置），本次以 `includeAll=true` **乱序补应用**并复验两策略 `qual` 均含 `app.is_admin()`（迁移历史共 9 条）；`notices.publisher_id` 由旧环境 uid `2099452365032161282` **重映射**到新 teacher uid `2099862936471105538`（2 行）；前端 `?v=20260915a` → **`?v=20260915b`** 并重部署；8 个本地测试合计 **799** 断言全绿 |
| 2026-09-15 | v1.12 | **确定开发基线**：以账号B 个人版 `class-d3gnxrv6252ef676c` 为**唯一开发/生产基线**；账号A 体验版 `class-assistant-d6fw1gdce84d261e` 转只读备份不再开发；记录账号B 下另一空环境 `class-d9gpz1bn873a0b404`（2027-03-15 到期，未使用）；CLI 账号级登录切至账号B，MCP 绑定基线环境 |
| 2026-09-15 | v1.13 | **设置页账号管理收口**：确定账号由管理员用管理工具统一导入开通，App 内暂不提供自助建号/重置；`app.js` 新增 `ACCOUNT_MGMT_IN_APP=false` 开关（大后期配齐 CAM 密钥后置 true 即恢复），设置页「班级名单」红字「账号服务未就绪 / TC_SECRET_ID…」告警替换为中性提示，行内「创建账号 / 重置密码」按钮不再渲染（`openAccountForm`/`probeAccountService` 等保留待用）；settings 测试 74 → **62** 断言（新增中性说明断言、删除已隐藏 UI 断言），8 个测试合计 799 → **787**；`?v=20260915b` → **`?v=20260915c`** 并重部署 |
| 2026-09-15 | v1.14 | **修「重置数据」两处缺口**：① `store.js` 的 `remove(coll,id)` 补**写后回读校验** —— CloudBase PG 的 RLS 过滤 DELETE 时返回「0 行受影响、无 error」，旧实现只判 `res.error` 会静默当成功（典型：班委删老师通知）；现删除后 `find` 回读，行仍在即抛可读错误（`__ca` 标记避免二次包裹），与 notices D12 口径一致。② 「重置数据」收口为**仅超级管理员**：`app.js` 的 `onReset` 由 `isAdmin()` 改判 `isSuperAdmin()`，按钮不再对班委渲染，说明文案同步标注。store 测试 88 → **94**、settings 62 → **69**，8 个测试合计 787 → **800** 全绿；`?v=20260915c` → **`?v=20260915d`** 并重部署 |

---

## 附录 A · 后端选型对比（D2 佐证）

| 方案 | 国内速度 | 运维 | 小程序连续性 | 认证 | 成本 |
|------|---------|------|-------------|------|------|
| **腾讯云开发 CloudBase** ✅ | 国内节点，快 | 零 | **同环境多端共用** | 微信/匿名/密码/自定义 | 免费体验 → ¥19.9/月 |
| Supabase | 无国内节点，200–500ms+，数据出境 | 零 | 差 | 内置 Auth | 免费层（闲置暂停） |
| 自建 PocketBase / Node | 快 | 高 | 差 | 自己写 | 服务器 + 备案 |
| LeanCloud | 快 | 零 | 中 | 内置 | 免费/低价 |

腾讯云官方结论：「国内产品选 CloudBase，海外产品选 Supabase」。Supabase 的国内延迟、数据出境合规、无微信生态三个硬伤在本项目均存在。
