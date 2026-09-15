# 班级管家 · Class Assistant

面向**单个班级**的班级管理 Web 应用：通知资料分发 · 成绩管理与分析 · 信息收集统计 · 学习复习 · 师生留言。

AI（LLM）是贯穿各模块的**可选增强引擎**，带全局开关——关闭后，全部基础功能照常可用（走规则降级）。

> 文档索引：**[ROADMAP.md](ROADMAP.md)**（当前路线）｜ [GOALS.md](GOALS.md)（目标书）｜ [DESIGN.md](DESIGN.md)（UI 规范）｜ [CONTRACT.md](CONTRACT.md)（开发契约）｜ [REVIEW.md](REVIEW.md)（复习整合）｜ [故障记录/](故障记录/)

---

## 功能

| 模块 | 能力 |
|------|------|
| **通知 / 资料** | 分类筛选、置顶 / 重要、**附件真上传与签名下载**（云存储）、外链、收藏；**AI 一句话生成通知草稿** |
| **成绩中心** | 录入 + 批量导入、7 项统计、分布 / 趋势 / 科目对比图表；**AI 班级分析报告 + 个人评语**；学生端**只看自己**（服务端 RLS 保证，非前端过滤） |
| **信息收集** | 接龙 / 报名 / 投票：单选 / 多选 / 文本题、截止时间、已交未交名单、结果统计；**AI 归类汇总**；**匿名收集**（真匿名：只存加盐 token 哈希，老师只能看聚合票数，读不到明细也读不到未交名单） |
| **学习复习** | 上传资料（PDF / Word / PPT / TXT / Markdown / 图片 OCR）→ **AI 提炼要点 + 出题** → 练习 → **SM-2 间隔复习** → 资料库 → Word 导出；AI 关闭时走规则降级 |
| **班级资料** | 老师上传共享资料（PDF / Office / 图片，≤20MB）→ **全班可下载** → 学生端「加入我的复习」交本机引擎解析（资料上云，学习记录仍留本机） |
| **师生留言** | 学生给老师留言，老师查看 / 回复 / 标记已读，学生看到回复 |
| **成员与账号管理** | 管理员在设置页**增删改班级名单**（学号唯一 / 级联清理关联数据）、**创建登录账号 / 重置密码**（走 `admin-user` 云函数）、**真实导出与重置数据** |
| **角色差异化** | 超级管理员 / 班委 / 学生三套界面气质与功能入口（`body.role-*` 驱动） |

学生端 AI 能力（多于老师端）：AI 摘要、问问 AI（基于通知答疑）、成绩诊断、AI 学习计划、AI 帮我写（收集表开放题草稿）。

## 在线演示

- 短地址（推荐）：`https://app-class-d3gnxrv6252ef676c.webapps.tcloudbase.com/`
- 备用：`https://class-d3gnxrv6252ef676c-1488894548.tcloudbaseapp.com/`

> **注意**：以上为 CloudBase **默认域名**，平台限制「仅供开发测试」——真实浏览器会弹访问提示中间页，微信内会触发下载（详见 [故障记录/2026-09-14-微信打开默认域名变下载.md](故障记录/)）。正式对外请绑定**自定义域名（需 ICP 备案）**。
> 演示账号由管理员发放（体验版仅允许 3 个用户）。

## 技术方案

- **前端**：纯静态、**零构建**（原生 JS + CSS，无框架 / 无 npm 依赖）；CDN 引入 CloudBase JS SDK 3.9.3、ECharts、pdf.js、JSZip
- **后端**：腾讯云开发 **CloudBase**（PostgreSQL + **行级安全 RLS** + **PG 函数 RPC** + 云存储 + 云函数）
- **认证**：用户名密码（**学号即账号**，首次登录强制改密）
- **AI**：云函数 `ai-gateway` 转发到 OpenAI 兼容通道（当前 DeepSeek）——**密钥只存云函数环境变量，前端零密钥**
- **部署**：CloudBase 静态托管 / webapps 子域

```
浏览器
  │  @cloudbase/js-sdk v3（登录会话）
  ├── CloudBase PostgreSQL（app.rdb() 链式查询 + rpc() 调 PG 函数）
  │     members / users / notices / favorites / subscribers
  │     subjects / exams / scores / surveys / responses / messages
  │     class_materials（班级共享资料）
  │     survey_anonymous_responses（匿名提交，RLS 零策略 = deny all）
  │     —— 权限由 RLS 策略强制（app.is_admin() / app.my_member_id()）
  │     —— 匿名读写只经 app.submit_anonymous / my_anonymous / anon_summary（security definer）
  ├── 云存储（pgstore bucket `attachments`，签名 URL 下载；通知附件 + 班级资料）
  └── 云函数 ai-gateway（AI 网关）· admin-user（账号管理，仅管理员）
本机：复习学习记录（IndexedDB `ca_study`，不入班级库）
```

## 目录结构

```
docs/                     # 前端（纯静态，零构建）
├── index.html
├── styles.css            # 设计系统 v4（Neo-brutalism + 调和配色）
├── assets/               # 视觉资产（AI 生成插画）
├── src/
│   ├── config.js cloud.js llm.js   # 前端配置 · CloudBase 客户端 · LLM 服务层
│   ├── store.js auth.js seed.js    # 异步数据层(PG) · 认证/角色 · 演示种子
│   ├── icons.js charts.js ai.js    # 图标 · 图表 · AI 能力层
│   ├── notices.js scores.js collect.js messages.js materials.js   # 业务模块
│   ├── review-view.js + review/    # 复习：CA 原生 UI + RH 引擎（window.RH）
│   ├── login-view.js app.js        # 登录壳 · 路由编排 · 设置（成员/账号/数据管理）
│   └── ...
├── test/                 # node 断言测试（*.mjs）
cloudbase/migrations/     # PostgreSQL 版本化迁移（建表 + RLS + PG 函数）
cloudfunctions/ai-gateway # AI 网关云函数
cloudfunctions/admin-user # 账号管理云函数（管理员专用）
ROADMAP.md PLAN-P1.md DESIGN.md CONTRACT.md REVIEW.md GOALS.md
故障记录/ reports/
```

## 测试

```powershell
node docs/test/store_test.mjs      # 数据层           94
node docs/test/notices_test.mjs    # 通知/资料       158
node docs/test/scores_test.mjs     # 成绩            148
node docs/test/collect_test.mjs    # 信息收集        131
node docs/test/review_test.mjs     # 复习视图         68
node docs/test/messages_test.mjs   # 留言             43
node docs/test/materials_test.mjs  # 班级资料         89
node docs/test/settings_test.mjs   # 设置/成员/账号   69
# 合计 800 项断言
```

## 本地开发

> 本项目为纯静态，但**认证/数据依赖 CloudBase**。CloudBase 的「Web 安全域名」白名单在**体验版无法添加 localhost**，因此本地直连云端会被 CORS 拦。
> 实际开发/验收统一走**已部署的托管域名**（该域在安全域名白名单内）。

```powershell
# 仅预览静态页面（无云端交互）：
& "D:\Miniconda3\envs\opencode\python.exe" -m http.server 8899 --directory "E:\OpenCode\class-assistant"
# 打开 http://127.0.0.1:8899/docs/
```

## 数据与安全

- 成绩等敏感数据的最小可见性由**服务端 RLS** 强制（学生仅能读自己 `member_id` 的记录）
- 发布/管理类写操作受 RLS 与 `app.is_admin()` 约束（学生越权写入返回 403）
  - ⚠️ 注意：PostgREST 在 UPDATE/DELETE 被 RLS 过滤时返回「0 行受影响、无 error」，
    前端若只看 `error` 会把越权操作当成功。`notices.js` 已对更新/删除做**回读校验**
    （`updated_at` 未推进 / 记录仍在 → 报「操作未生效」）
- **匿名收集是真匿名**：`survey_anonymous_responses` 只存 `md5(盐 + 随机 token)`，不存 `member_id`/`uid`；
  该表启用 RLS 且**零策略**（deny all），连管理员经 PostgREST 也读不到明细，只能通过
  `app.anon_summary()` 拿聚合票数 —— 因此匿名问卷**不提供未交名单与提交进度**
- 匿名 token 只存学生本机 `localStorage`，换设备/清缓存会丢失（可能重复提交一次，设计接受）
- 密钥（LLM API Key）只存云函数环境变量，**不入库**
- 数据库结构变更全部走 `cloudbase/migrations/` 版本化迁移
  ⚠️ 迁移执行器按分号切分语句：**函数体必须是单条 SQL 语句**，`$$` 内不得出现分号
  （踩坑与修法见 [故障记录/2026-09-15-PG迁移函数体分号截断.md](故障记录/)）

## 状态与路线

- **已完成**：云端数据层（通知 / 成绩 / 收集 / 留言 + RLS）、认证与角色、AI 网关、复习模块（CA UI + RH 引擎）、后续 UI v4、移动端适配、**匿名收集（PG 函数 RPC）**、**班级共享资料库**、**成员 / 账号 / 数据管理入口**
- **进行中 / 待定**：`admin-user` 云函数需配置 CAM 密钥与 `TCB_API_KEY` 才能建号（体验版用户上限 3 已满，须升配套餐）；迁移微信小程序（云开发同一环境）、自定义域名与备案
- 详细路线与决策见 **[ROADMAP.md](ROADMAP.md)**

## 相关项目

- [review-helper](https://github.com/hhb-gif/review-mate) — 复习引擎与 LLM 服务层来源（本项目复用其引擎，UI 自研）
- [Cheems-sudo/Class-Box](https://github.com/Cheems-sudo/Class-Box)（MIT）— 数据库与权限设计的参考

## 许可

[MIT](LICENSE) © 2026 hhb-gif
