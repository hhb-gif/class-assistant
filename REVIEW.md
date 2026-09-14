# REVIEW.md · 复习能力整合契约（RH → 班级管家）

> 目标：把 review-helper（RH）的**复习能力**整合进班级管家的「复习」Tab。
> **不做题库**——这是学生的个人复习空间：上传资料 → AI 提炼要点 + 出题 → 练习 → SM-2 间隔复习 → 本地资料库 → Word 导出。
> 依据：`E:\OpenCode\review-helper\docs\CONTRACT-v2.md` 与本次模块调研报告。UI 规范见 `DESIGN.md`。

---

## 1. 整合方式：原样移植 + 新 UI

**保持 `window.RH` 命名空间不变**（RH 模块零改动复制），只新写一个视图层 `CA.views.review` 调用 `RH.*`。
好处：RH 模块可继续与上游同步；风险最低。

### 1.1 移植清单（复制到 `docs/src/review/`，除标注外**零改动**）

| 文件 | 作用 | 改动 |
|------|------|------|
| `rules.js` | 规则常量 + 数据结构 | 无 |
| `tokenizer.js` | 分词（jieba-wasm，bigram 降级） | 无 |
| `newword.js` | 新词发现 | 无 |
| `keywords.js` | 关键词/术语 | 无 |
| `textrank.js` | TextRank + 融合评分 | 无 |
| `selection.js` | MMR 去冗选择 | 无 |
| `semantic.js` | 语义相似度（可选，失败降级） | 无 |
| `sm2.js` | SM-2 间隔复习算法 | 无 |
| `storage.js` | IndexedDB 持久化 | **改 `DB_NAME`：`rh_study` → `ca_study`**（避免与 RH 主项目同源冲突） |
| `quiz.js` | 规则版出题 + markdown | 无 |
| `summarize.js` | LLM 要点总结 | 无 |
| `quizgen.js` | LLM 选择题生成 | 无 |
| `llm.js` | LLM 服务层（读 `RH_CONFIG`） | 无（用 config 别名桥接） |
| `exporter.js` | Word 导出（JSZip） | 无 |
| `pipeline.js` | 编排（LLM 主路径 + 规则降级） | 无 |
| `parsers.js` | 多格式解析（PDF/DOCX/PPTX/TXT/OCR） | 修 bug：`parsePdf` 内 `ocrScanPdf(pdf, fallbackTitle, totalPages, onProgress)` 引用了不存在的 `onProgress`（改为传 `undefined`），否则扫描件路径抛 ReferenceError |

**不移植**：`public.js`（Supabase 公共库，与本项目无关）、`app.js`（RH 的 UI 层，由我们重写）。

### 1.2 配置桥接
班级管家用 `window.CA_CONFIG`；RH 模块读 `window.RH_CONFIG`。在 `docs/src/config.js` 末尾加一行别名：
```js
window.RH_CONFIG = window.CA_CONFIG;
```

### 1.3 外部依赖（`docs/index.html`）
```html
<!-- 解析与导出依赖（CDN，与本项目 ECharts 同策略） -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<!-- pdf.js worker（必须在使用前设置） -->
<script>if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";</script>
```
脚本顺序（RH 模块在 CA 模块之后、`app.js` 之前）：
```
CA 模块（config→llm→store→seed→auth→charts→ai→icons→notices→scores→collect）
→ src/review/rules.js → tokenizer → newword → keywords → textrank → selection
→ semantic → sm2 → storage → quiz → summarize → quizgen → llm → exporter → pipeline
→ src/review-view.js → src/app.js
```
> 注意：`src/review-view.js` 会注册 `CA.views.review`，`app.js` 已支持动态挂载（见 `app.js` 的 collect/review 分支）。

---

## 2. 复习视图 DOM id 契约（`CA.views.review` 必须实现）

| 区块 | id | 说明 |
|------|----|------|
| 上传 | `#review-upload`、`#review-file-input` | 拖放区 + 文件选择（multiple） |
| 进度 | `#review-progress`、`#review-progress-bar`、`#review-progress-text` | 解析/总结/出题进度 |
| 结果头 | `#review-result`、`#review-doc-title`、`#review-engine-badge` | 引擎徽标：`AI · {model}` 或 `离线模式` |
| 子 Tab | `#review-tabs`（`.segmented`）、`#review-pane-points`、`#review-pane-quiz`、`#review-pane-study`、`#review-pane-library` | 要点 / 练习 / 复习 / 资料库 |
| 要点 | `#review-overview`、`#review-keywords`、`#review-sections` | |
| 练习 | `#review-quiz-list`、`#review-quiz-stats` | |
| 复习 | `#review-study-stats`、`#review-due-list`、`#review-doc-filter` | SM-2 到期卡片 |
| 资料库 | `#review-library-list`、`#review-quiz-import` | 历史文档 + 题库 JSON 导入 |
| 导出 | `#review-export-docx`、`#review-export-quiz` | Word 导出两个入口 |

---

## 3. 功能与交互

1. **上传解析**：拖放/选择文件（PDF/Word/PPT/TXT/MD/图片）→ `RH.parsers.parseFile(file, onProgress)` → 进度条（解析 → 总结 → 出题三阶段）
2. **AI 提炼 + 出题**：`RH.pipeline.run(doc, onProgress)` → VM（要点/关键词/术语/题目/原文结构）；引擎徽标显示 AI 或离线；AI 不可用时走规则降级（引擎徽标「离线模式」）
3. **要点展示**：概述卡 + 关键词 chips + 术语 + 章节要点（重要度标记），点击要点可定位原文（第一版可简化为展示 source 原文片段）
4. **练习**：渲染 VM.quiz（选择题为主），答题 → 即时反馈（对/错 + 解析）→ `RH.storage.recordAnswer(...)` 写卡片
5. **复习（SM-2）**：`RH.storage.getStats()` 统计（总数/到期/已掌握/薄弱）→ `getDueCards()` 今日到期列表 → 答题 → `RH.sm2.review` + 再次 `recordAnswer`；支持按资料筛选
6. **资料库**：`RH.storage.listDocs()` 历史文档 → 打开（恢复 VM）/ 删除 / 下载源文件；题库 JSON 导入
7. **导出**：`RH.exporter.docxBlob(vm)` / `quizDocxBlob(vm)` → 下载 `.docx`
8. **AI 开关联动**：顶栏 AI 关闭时，新上传走规则降级；已生成内容仍可练习/复习
9. **空态**：无文档 / 无到期卡片 / 无练习时用 `.empty` + 说明 + 引导操作

---

## 4. 存储策略

| 数据 | 位置 | 说明 |
|------|------|------|
| 学习卡片（含 SM-2 状态、答题历史） | IndexedDB `ca_study` / `cards` | `RH.storage` 管理 |
| 文档记录（VM + 源文件 Blob） | IndexedDB `ca_study` / `docs` | `RH.storage` 管理 |
| 班级数据（通知/成绩/收集） | localStorage `ca_db` | 与复习数据完全分离 |

> 复习数据独立于班级数据：复习是「个人设备上的学习记录」，不入班级库。

---

## 5. 各 Agent 职责（并行）

| Agent | 文件所有权 | 任务 |
|-------|-----------|------|
| **R1 · 移植** | `docs/src/review/*`（新建）、`docs/src/config.js`（仅加别名一行）、`docs/index.html`（加 CDN + 脚本）、`docs/test/review_smoke_test.html`（新建） | 复制 RH 模块、改 DB_NAME、修 parsers bug、接线、验证 RH 管线在浏览器跑通 |
| **R2 · 复习视图** | `docs/src/review-view.js`（新建）、`docs/test/review_test.mjs`（新建） | 实现 `CA.views.review`（契约 §2/§3），UI 按 `DESIGN.md` |
| **U2 · UI 精修** | `docs/styles.css`、以及为动效对现有模块的**最小必要**改动 | 动效/微交互/骨架屏/空态插画/细节质感打磨 |

**冲突规避**：`index.html` 只由 R1 改；`styles.css` 只由 U2 改；R2 的复习视图专用样式用 `.ca-review-*` 前缀在自身 JS 内注入（沿 `scores.js`/`collect.js` 做法），不动全局样式。

---

## 6. 回归红线

- 现有 306 条断言（store 81 / notices 64 / scores 83 / collect 78）必须全绿
- `CONTRACT.md` 的 DOM id 契约不得破坏
- `DESIGN.md` 第 10 节「禁止事项」继续有效（禁 emoji 图标、禁 ISO 直出、禁硬编码颜色）
- AI 关闭时，班级功能与复习的规则降级路径都可用
