# DESIGN.md · 班级管家 UI 规范（v2 · 冻结）

> 本文件是 UI 升级与后续功能的**设计契约**。类名清单与规范冻结，各模块按此实现，不得临时发明类名。
> 目标：从「能用的原型」升级到「好用、好看、有质感」的产品级界面。
> 基准：`CONTRACT.md`（DOM id 契约**不变量**——只改内部结构，id 一个都不能动，测试依赖它们）。

---

## 1. 设计原则

| # | 原则 | 落地 |
|---|------|------|
| 1 | **清晰优先** | 信息层级用「字号 + 字重 + 颜色」三要素区分，标题/正文/元信息的视觉权重必须拉开 |
| 2 | **卡片语言** | 所有内容块有明确边界：白底 + 1px 边框 + 轻阴影；禁止「透明裸奔」的内容块 |
| 3 | **呼吸感** | 8px 网格；区块间距 16/20/24；卡片内边距 16~20 |
| 4 | **克制的色彩** | 中性灰为主，强调色只用于交互与状态；禁止大面积高饱和 |
| 5 | **中文友好** | 系统字体栈（不引外部字体，国内可用性/离线优先）；数字用 `tabular-nums` |
| 6 | **反馈即时** | 所有可点击元素有 hover/active/focus 态；操作有 toast；异步有 loading |

---

## 2. 设计 Token（CSS 变量，定义于 `:root`）

```css
:root {
  /* 主色：教育青绿（区别于烂大街的 Bootstrap 蓝） */
  --primary: #0d9488;
  --primary-hover: #0f766e;
  --primary-soft: #ccfbf1;
  --primary-text: #0f766e;

  /* 语义色 */
  --success: #16a34a;  --success-soft: #dcfce7;  --success-text: #15803d;
  --warn: #d97706;     --warn-soft: #fef3c7;     --warn-text: #b45309;
  --danger: #dc2626;   --danger-soft: #fee2e2;   --danger-text: #b91c1c;
  --info: #0284c7;     --info-soft: #e0f2fe;     --info-text: #0369a1;
  --ai: #7c3aed;       --ai-soft: #ede9fe;       --ai-text: #6d28d9;

  /* 中性色阶 */
  --text: #0f172a;       /* 主文本 */
  --text-2: #475569;     /* 次要文本 */
  --text-3: #94a3b8;     /* 弱化/占位 */
  --bg: #f6f8fa;         /* 页面背景 */
  --surface: #ffffff;    /* 卡片 */
  --surface-2: #f1f5f9;  /* 次级填充（hover/表头） */
  --border: #e2e8f0;
  --border-strong: #cbd5e1;

  /* 阴影（克制，两档够用） */
  --shadow-sm: 0 1px 3px rgba(15,23,42,.06), 0 1px 2px rgba(15,23,42,.04);
  --shadow-md: 0 4px 16px rgba(15,23,42,.08);
  --shadow-lg: 0 12px 32px rgba(15,23,42,.12);

  /* 圆角 */
  --r-sm: 8px; --r: 12px; --r-lg: 16px; --r-full: 999px;

  /* 间距（8 网格） */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;

  /* 字号 */
  --fs-xs: 12px; --fs-sm: 13px; --fs-base: 15px; --fs-lg: 17px;
  --fs-xl: 20px; --fs-2xl: 24px; --fs-3xl: 30px;

  /* 动效 */
  --t-fast: 150ms ease;
  --t: 200ms cubic-bezier(.4, 0, .2, 1);
}
```

**字体栈**（中文优先，不引外部字体）：
```css
--font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
        "Microsoft YaHei", "Source Han Sans SC", sans-serif;
```

---

## 3. 排版规范

| 场景 | 字号 | 字重 | 颜色 |
|------|------|------|------|
| 页面/视图主标题 | `--fs-xl` 20px | 700 | `--text` |
| 卡片标题 | 16px | 600 | `--text` |
| 列表项标题 | `--fs-base` 15px | 600 | `--text` |
| 正文 | `--fs-base` 15px / 1.6 | 400 | `--text-2` |
| 元信息（时间/地点/学号） | `--fs-sm` 13px | 400 | `--text-3` |
| 徽标/标签 | `--fs-xs` 12px | 500 | 语义色 |
| 统计数字（强调） | `--fs-2xl`~`--fs-3xl` | 700 | 语义色 |
| 表格数字 | `--fs-sm` | 500 | `tabular-nums` |

---

## 4. 组件类名清单（★冻结，各模块必须使用）

### 4.1 布局
`.stack`（垂直间距 16）· `.row`（水平 flex+gap）· `.row-between` · `.grid` / `.grid-2` / `.grid-3` · `.muted`

### 4.2 卡片
- `.card` — 白底 + `--r` + 1px `--border` + `--shadow-sm`
- `.card-head` / `.card-title` / `.card-sub`（右侧说明文字）/ `.card-foot`
- `.card-list` — 卡片列表容器（gap 12）；`.list-row` — 列表项（白底卡片 + hover 边框变主色 + `cursor:pointer`）

### 4.3 徽标
`.badge` + 变体：`.badge-cat`（分类，主色）`.badge-important`（重要，红）`.badge-pinned`（置顶，琥珀）`.badge-success` `.badge-warn` `.badge-danger` `.badge-ai`（AI，紫）`.badge-muted`（灰）

### 4.4 按钮
`.btn` + `.btn-primary` `.btn-ghost` `.btn-danger` `.btn-success` `.btn-ai`（AI 生成，紫色）`.btn-sm` `.btn-lg` `.btn-block` `.btn-icon`（仅图标，正方形）
状态：`:hover`（变色）、`:active`（下沉 1px）、`:disabled`（降透明度 + `cursor:not-allowed`）、`.is-loading`（含 spinner，指针禁用）

### 4.5 筛选与分段
`.segmented`（分段控件容器）> `.seg-item`（`.active`）· `.chip`（圆角胶囊标签，可点击）· `.chip.active`

### 4.6 表格
`.table-wrap`（横向滚动容器 + 圆角边框）> `.table`（`.table-compact`）· `.num`（右对齐等宽数字）· `tr.is-selected`（选中行，主色浅底）

### 4.7 统计
`.stat-grid` > `.stat` > `.stat-value`（大数字）+ `.stat-label`；语义变体 `.stat.success` / `.stat.warn` / `.stat.danger`
`.stat.emphasis`（重点卡：主色浅底 + 主色数字）

### 4.8 表单
`.form-grid`（两列，`.span-2` 跨列）· `.form-field` · `.label`（含 `.req`）· `.input`（input/select/textarea 统一）· `.field-hint` · `.field-error` · `.form-actions`

### 4.9 图标（★新）
`.icon` — 内联 SVG 图标（`width/height: 1em`）；`.icon-lg`（20px）；`.icon-btn`（图标按钮）
**禁止 emoji 当图标**（`📎` ✏️ 等一律换 SVG）。

### 4.10 反馈
- `.empty` > `.empty-icon` + `.empty-title` + `.empty-desc`（+ 可选 `.btn`）
- `#toast`（`.show` 显示；类型类 `.success/.error/.warn/.info`）
- `#modal-mask`（`hidden` 控制）> `#modal-box` > `.modal-title` + `.modal-hint` + `.modal-actions`
- `.skeleton`（骨架屏）· `.spinner`（旋转指示器）

### 4.11 图表
`.chart-grid` / `.chart-box` > `.chart-title` + `.chart`（桌面 280px / 移动 220px）

---

## 5. 图标系统（`docs/src/icons.js`，新文件）

```js
CA.icon(name, size) -> string   // 返回 <svg>…</svg> 字符串，stroke 风格（Lucide 风格，24×24 视图框）
CA.iconEl(name, size) -> SVGElement
```
必需图标（全部 stroke 线性风格，`stroke-width:1.75`，`currentColor`）：
`bell`(通知) `chart`(成绩) `clipboard`(收集) `book`(复习) `settings`(设置)
`plus` `edit` `trash` `star` `star-filled` `pin` `link` `paperclip` `download` `upload`
`search` `close` `check` `user` `users` `clock` `map-pin` `calendar` `chevron-right` `chevron-down`
`sparkles`(AI) `refresh` `filter` `trend-up` `trend-down` `alert` `info` `logout` `eye`

**加载**：`index.html` 在 `app.js` 之前引入 `src/icons.js`。

---

## 6. 时间与数据展示规则（★修 bug 重点）

### 6.1 时间（当前 ISO 直出是严重问题）
**禁止任何地方直接输出 ISO 字符串**（如 `2026-06-24T19:00:00`）。统一走 `CA.util`：

| 函数 | 输出 | 用途 |
|------|------|------|
| `CA.util.fmtSmart(v)` | 今天→`今天 19:00`；明天→`明天 08:00`；昨天→`昨天 15:30`；今年→`06-24 19:00`；跨年→`2026-06-24` | **默认时间展示** |
| `CA.util.fmtDate(v)` | `2026-06-24` | 纯日期 |
| `CA.util.fmtTime(v)` | `19:00` | 纯时间 |
| `CA.util.fmtDateTime(v)` | `2026-06-24 19:00` | 需完整时 |
| `CA.util.relTime(v)` | `3天前` / `2小时后` | 相对时间（动态场景） |

区间时间写法：`06-24 19:00 ~ 20:30`（同一天省略重复日期）；跨天：`06-24 19:00 ~ 06-25 17:00`。

### 6.2 数字
- 分数/统计数字：`font-variant-numeric: tabular-nums`
- 大数（≥10000）：千分位
- 百分比：保留 1 位小数 + `%`

### 6.3 空值
一律显示 `—`（U+2014），不显示空白/`undefined`。

---

## 7. 交互与反馈

- 可点击元素：`cursor:pointer` + hover 态（150–200ms 过渡）
- 列表项 hover：边框变 `--primary` + 轻微上浮（`translateY(-1px)`）
- 按钮 active：下沉 1px；disabled：`opacity:.5` + `cursor:not-allowed`
- 异步操作：按钮进入 `.is-loading`（文案「处理中…」+ 禁用）；AI 生成时显示 `.spinner`
- Toast：底部居中滑入，2.8s 自动消失
- 空态：图标 + 标题 + 说明（+ 可选操作按钮），禁止只有一行灰字
- 键盘：所有交互元素 focus 可见（`outline: 2px solid var(--primary)` + offset 2px）
- 触控目标 ≥44×44px（移动端）；列表项最小高度 56px
- `@media (prefers-reduced-motion: reduce)` 关闭过渡

---

## 8. 响应式

| 断点 | 布局 |
|------|------|
| ≥1024px | 内容最大宽 **1120px** 居中；成绩页工具栏 + 统计 + 表格 + 图表双列 |
| 768–1023px | 单列；图表单列 |
| <768px | 底部固定 tabbar（≥48px + safe-area）；卡片内边距缩至 14；表格改横向滚动（`.table-wrap`）；**禁止横向滚动** |

移动端专项：顶栏精简（品牌副标题 <400px 隐藏）；表格首列（姓名）可 sticky；长文本省略号。

---

## 9. 图表规范（charts.js）

- 配色：主序列 `--primary`；对比序列 `--info` / `--warn`；趋势上升 `--success`、下降 `--danger`
- 网格线极淡（`#eef2f6`）；无边框；`tooltip` 白底圆角阴影
- 坐标轴文字 `--text-3` 12px；**不显示冗余图例**（单序列时）
- 降级（无 ECharts）：CSS 条形图用 `--primary` + 数值标签，仍须可读

---

## 10. 禁止事项（Review 清单）

- ❌ emoji 当图标（📎 ✏️ → SVG）
- ❌ ISO 时间直出
- ❌ 无边界的内容块（必须有卡片/分隔）
- ❌ 模块内硬编码颜色（必须用 CSS 变量）
- ❌ placeholder 当 label
- ❌ 触控目标 <44px
- ❌ 破坏 `CONTRACT.md` 的 DOM id（测试依赖）
- ❌ 移除既有功能的键盘可达性
