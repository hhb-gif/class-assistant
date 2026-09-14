# 班级管家 · Class Assistant

面向单个班级的班级管理产品：通知资料分发 · 信息收集统计 · 成绩管理分析 · 学习复习。AI（LLM）为可选增强引擎，整体可开关，关闭后基础功能完全可用。

> 📋 定位与里程碑 **[GOALS.md](GOALS.md)** ｜ UI 规范 **[DESIGN.md](DESIGN.md)** ｜ 开发契约 **[CONTRACT.md](CONTRACT.md)** ｜ 复习整合 **[REVIEW.md](REVIEW.md)**

## 当前进度

- **本地 Web 原型：M1（通知/资料）+ M2（成绩）+ M3（信息收集）+ 复习能力整合 已完成**，UI 已升级到产品级（v2 设计系统 + 精修）
- 数据：班级数据存 localStorage（`ca_db`），学习记录存 IndexedDB（`ca_study`，与 RH 主项目隔离）
- 右上角切换老师/班委/学生视角；AI 开关即时生效
- 待做：迁移微信小程序（云开发）

| 模块 | 能力 |
|------|------|
| 通知/资料 | 分类筛选、置顶/重要、附件与链接、收藏、**AI 一句话生成通知草稿** |
| 成绩中心 | 表格录入 + 粘贴批量导入、7 项统计、分布/趋势/科目对比图表、**AI 班级分析报告 + 个人评语**、学生视角只看自己 |
| 信息收集 | 接龙/报名/投票：单选/多选/文本题、截止时间、已交未交名单、结果统计、**AI 归类汇总** |
| 学习复习 | 上传资料（PDF/Word/PPT/TXT/MD/图片）→ **AI 提炼要点 + 出题** → 练习 → **SM-2 间隔复习**（今日到期/掌握度/薄弱）→ 本地资料库 → Word 导出；AI 关闭时走规则降级（离线模式） |

## 本地运行

```powershell
# 必须用 8899 端口：LLM 代理的 Origin 白名单只放行了 127.0.0.1:8899 / localhost:8899
& "D:\Miniconda3\envs\opencode\python.exe" -m http.server 8899 --directory "E:\OpenCode\class-assistant"
```

浏览器打开 http://127.0.0.1:8899/docs/ 。支持 `?view=scores|collect|review|settings` 直达视图。

> Python 统一使用 conda `opencode` 环境（不用 base）。

## 目录

```
docs/                   # ★ 本地原型（纯静态，零构建）
├── index.html          # 单页骨架
├── styles.css          # 设计系统 v2（token/组件/动效/响应式）
├── src/
│   ├── config.js llm.js           # LLM 配置与服务层（代理模式，前端零密钥）
│   ├── store.js seed.js auth.js   # 班级数据层 · 演示数据 · 角色权限
│   ├── icons.js                   # SVG 图标系统（34 个，禁 emoji）
│   ├── charts.js ai.js            # 图表封装 · AI 网关
│   ├── notices.js scores.js collect.js   # 三大业务模块
│   ├── review-view.js             # 复习视图（对应 REVIEW.md 契约）
│   ├── review/                    # ★ RH 复习能力（16 模块原样移植，window.RH）
│   └── app.js                     # 路由/顶栏/编排
└── test/               # 自测（node 断言 + 浏览器冒烟页）
DESIGN.md               # UI 规范
CONTRACT.md             # 班级功能开发契约
REVIEW.md               # 复习能力整合契约
GOALS.md                # 目标书
故障记录/                # 问题排查记录
```

## 测试

```powershell
node docs/test/store_test.mjs     # 数据层 81
node docs/test/notices_test.mjs   # 通知 64
node docs/test/scores_test.mjs    # 成绩 83
node docs/test/collect_test.mjs   # 信息收集 78
node docs/test/review_test.mjs    # 复习视图 85
# 浏览器（需服务运行，走真实 AI）：
#   /docs/test/review_e2e_test.html   复习链路 E2E（解析→AI要点/出题→存储→视图）
#   /docs/test/review_smoke_test.html RH 管线冒烟
#   /docs/test/views_smoke_test.html  全角色 × 全视图集成
#   /docs/test/ai_smoke_test.html     AI 链路
```

- 关联：[review-helper](https://github.com/hhb-gif/review-mate)（复习引擎与 LLM 服务层来源）
- 参考：[Cheems-sudo/Class-Box](https://github.com/Cheems-sudo/Class-Box)（MIT，数据库设计与 AI 草稿模式）
