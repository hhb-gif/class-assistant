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
| **信息收集** | 接龙 / 报名 / 投票：单选 / 多选 / 文本题、截止时间、已交未交名单、结果统计；**AI 归类汇总** |
| **学习复习** | 上传资料（PDF / Word / PPT / TXT / Markdown / 图片 OCR）→ **AI 提炼要点 + 出题** → 练习 → **SM-2 间隔复习** → 资料库 → Word 导出；AI 关闭时走规则降级 |
| **师生留言** | 学生给老师留言，老师查看 / 回复 / 标记已读，学生看到回复 |
| **角色差异化** | 超级管理员 / 班委 / 学生三套界面气质与功能入口（`body.role-*` 驱动） |

学生端 AI 能力（多于老师端）：AI 摘要、问问 AI（基于通知答疑）、成绩诊断、AI 学习计划、AI 帮我写（收集表开放题草稿）。

## 在线演示

- 短地址（推荐）：`https://app-class-assistant-d6fw1gdce84d261e.webapps.tcloudbase.com/`
- 备用：`https://class-assistant-d6fw1gdce84d261e-1485216264.tcloudbaseapp.com/`

> **注意**：以上为 CloudBase **默认域名**，平台限制「仅供开发测试」——真实浏览器会弹访问提示中间页，微信内会触发下载（详见 [故障记录/2026-09-14-微信打开默认域名变下载.md](故障记录/)）。正式对外请绑定**自定义域名（需 ICP 备案）**。
> 演示账号由管理员发放（体验版仅允许 3 个用户）。

## 技术方案

- **前端**：纯静态、**零构建**（原生 JS + CSS，无框架 / 无 npm 依赖）；CDN 引入 CloudBase JS SDK 3.9.3、ECharts、pdf.js、JSZip
- **后端**：腾讯云开发 **CloudBase**（PostgreSQL + **行级安全 RLS** + 云存储 + 云函数）
- **认证**：用户名密码（**学号即账号**，首次登录强制改密）
- **AI**：云函数 `ai-gateway` 转发到 OpenAI 兼容通道（当前 DeepSeek）——**密钥只存云函数环境变量，前端零密钥**
- **部署**：CloudBase 静态托管 / webapps 子域

```
浏览器
  │  @cloudbase/js-sdk v3（登录会话）
  ├── CloudBase PostgreSQL（app.rdb() 链式查询）
  │     members / users / notices / favorites / subscribers
  │     subjects / exams / scores / surveys / survey_responses / messages
  │     —— 权限由 RLS 策略强制（app.is_admin() / app.my_member_id()）
  ├── 云存储（pgstore bucket `attachments`，签名 URL 下载）
  └── 云函数 ai-gateway → DeepSeek
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
│   ├── notices.js scores.js collect.js messages.js   # 业务模块
│   ├── review-view.js + review/    # 复习：CA 原生 UI + RH 引擎（window.RH）
│   ├── login-view.js app.js        # 登录壳 · 路由编排
│   └── ...
├── test/                 # node 断言测试（*.mjs）
cloudbase/migrations/     # PostgreSQL 版本化迁移（建表 + RLS）
cloudfunctions/ai-gateway # AI 网关云函数
ROADMAP.md PLAN-P1.md DESIGN.md CONTRACT.md REVIEW.md GOALS.md
故障记录/ reports/
```

## 测试

```powershell
node docs/test/store_test.mjs      # 数据层           88
node docs/test/notices_test.mjs    # 通知/资料       143
node docs/test/scores_test.mjs     # 成绩             99
node docs/test/collect_test.mjs    # 信息收集        101
node docs/test/review_test.mjs     # 复习视图         68
node docs/test/messages_test.mjs   # 留言             43
# 合计 542 项断言
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
- 密钥（LLM API Key）只存云函数环境变量，**不入库**
- 数据库结构变更全部走 `cloudbase/migrations/` 版本化迁移

## 状态与路线

- **已完成**：云端数据层（通知 / 成绩 / 收集 / 留言 + RLS）、认证与角色、AI 网关、复习模块（CA UI + RH 引擎）、后续 UI v4、移动端适配
- **进行中 / 待定**：迁移微信小程序（云开发同一环境）、自定义域名与备案
- 详细路线与决策见 **[ROADMAP.md](ROADMAP.md)**

## 相关项目

- [review-helper](https://github.com/hhb-gif/review-mate) — 复习引擎与 LLM 服务层来源（本项目复用其引擎，UI 自研）
- [Cheems-sudo/Class-Box](https://github.com/Cheems-sudo/Class-Box)（MIT）— 数据库与权限设计的参考

## 许可

[MIT](LICENSE) © 2026 hhb-gif
