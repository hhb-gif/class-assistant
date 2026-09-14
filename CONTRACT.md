# CONTRACT · 班级管家本地原型（M1 + M2）

> 本文件是并行子 agent 的协作契约。**只写自己名下的文件，跨模块调用一律按本契约，不得临时发明接口。**
> 上层文档：`../GOALS.md`（目标书）。参考架构：`E:\OpenCode\review-helper\docs\CONTRACT-v2.md`

## 0. 技术约束（硬性）

| 项 | 约定 |
|----|------|
| 形态 | 纯静态 Web，运行目录 `docs/`，**零构建、零 npm 依赖**（图表走 CDN） |
| 本地运行 | `D:\Miniconda3\envs\opencode\python.exe -m http.server 8899`（在 `class-assistant/` 下执行）→ http://127.0.0.1:8899/docs/ 。**端口必须是 8899**：LLM 代理（SCF）的 `ALLOWED_ORIGINS` 白名单只含 `127.0.0.1:8899` / `localhost:8899` / 生产域名，其他端口会被 403 拒绝 |
| 模块模式 | IIFE 挂 `window.CA` 命名空间，**中文注释**，`var/const/function` + 无 class 亦可，ES2017 语法 |
| 数据 | localStorage，单一 DB key `ca_db`（JSON） |
| 角色 | 本地切换模拟登录（superAdmin / admin / student），无真实鉴权 |
| LLM | 复用 `src/llm.js`（已就位，**不可改**），配置见 `src/config.js`（代理模式，前端零密钥） |
| 外部库 | ECharts 5（CDN：`https://cdn.bootcdn.net/ajax/libs/echarts/5.5.0/echarts.min.js`），加载失败必须降级（CSS 条形图） |

## 1. 文件所有权

| Agent | 可写文件 |
|-------|---------|
| **A · 数据层** | `docs/src/store.js`、`docs/src/seed.js`、`docs/src/auth.js`、`docs/test/store_test.mjs` |
| **B · UI 壳** | `docs/index.html`、`docs/styles.css` |
| **C · 通知模块** | `docs/src/notices.js`、`docs/test/notices_test.mjs` |
| **D · 成绩模块** | `docs/src/scores.js`、`docs/src/charts.js`、`docs/test/scores_test.mjs` |
| **主 agent（已完成/进行中）** | `docs/src/llm.js`、`docs/src/config.js`、`docs/src/config.example.js`、`docs/src/ai.js`、`docs/src/app.js`、`CONTRACT.md` |

**任何人不得改动他人文件**；发现契约缺陷 → 在完成报告中列出，不要擅自改。

## 2. 加载顺序（index.html 必须遵循）

```
src/config.js → src/llm.js → src/store.js → src/seed.js → src/auth.js
→ src/charts.js → src/ai.js → src/notices.js → src/scores.js → src/app.js
```

## 3. 数据模型（`ca_db`，字段级冻结）

```js
DB = {
  version: 1,
  users: [   // 可切换身份（角色切换器数据源）
    { id, name, role, title, studentNo? }
    // role: "superAdmin" | "admin" | "student"
    // 例：{ id:"u_teacher", name:"王老师", role:"superAdmin", title:"班主任" }
  ],
  members: [ { id, name, studentNo } ],            // 班级名单（30 人，学号 20230301~20230330）
  notices: [ {
    id, title, category, content,
    timeLabel, deadline, endTime, location, course,
    attachments: [ { name, size, type } ],          // size 字节
    links: [ { title, url } ],
    pinned, important,                               // boolean
    publisherId, createdAt, updatedAt                // ISO 字符串
  } ],
  // category ∈ "考试安排" | "作业信息" | "活动信息" | "班级通知" | "其他"
  // timeLabel ∈ "考试时间" | "截止时间" | "报名截止" | "活动时间" | "相关时间"
  favorites: [ { userId, noticeId, createdAt } ],
  subjects: [ { id, name, fullScore, order } ],    // 语文/数学/英语 150；物理/化学 100
  exams:    [ { id, name, date, createdAt } ],      // 3 次考试
  scores:   [ { id, examId, subjectId, memberId, score } ],
  settings: {
    currentUserId,        // 当前身份
    aiEnabled,            // boolean，默认 true
    aiModel              // 展示用模型名（默认取 CA_CONFIG.llm.model）
  }
}
```

## 4. store API（Agent A 实现，C/D 按此调用）

```js
CA.store.init()                    // 无 ca_db 时写种子；已有则不动；version 不符则重置。幂等
CA.store.get(coll)                 // 返回集合的深拷贝数组；coll ∈ users|members|notices|favorites|subjects|exams|scores
CA.store.find(coll, id)            // 单个或 null
CA.store.query(coll, fn)           // filter(fn) 结果（深拷贝）
CA.store.add(coll, obj)            // 生成 id（CA.store.uid(前缀)）+ createdAt/updatedAt，写库，返回新对象
CA.store.update(coll, id, patch)   // 合并 patch，刷新 updatedAt，返回更新后对象
CA.store.remove(coll, id)          // 删除，返回 boolean
CA.store.settings()                // settings 深拷贝
CA.store.setSettings(patch)        // 合并保存
CA.store.reset()                   // 清 ca_db 重新播种（演示重置）
CA.store.uid(prefix)               // "prefix_" + 时间戳36进制 + 随机4位
CA.store.memberName(memberId)      // 便捷：名单 id → 姓名（无则 ""）
```

## 5. auth API（Agent A 实现）

```js
CA.auth.current()        // 当前 user 对象（settings.currentUserId 对应；缺失则取 users[0]）
CA.auth.switchTo(userId) // 切换身份（写 settings）
CA.auth.list()           // users 数组（角色切换器用）
CA.auth.isAdmin()        // role === "admin" || "superAdmin"
CA.auth.isSuperAdmin()
CA.auth.can(action)      // 权限动作表，见下
```

| action | 允许角色 |
|--------|---------|
| `notice.publish` | admin, superAdmin |
| `notice.manageAll` | superAdmin（编辑/删除他人通知；admin 只能管自己的） |
| `score.edit` | admin, superAdmin |
| `member.manage` | superAdmin |
| `settings.ai` | superAdmin |

## 6. DOM id 契约（Agent B 实现）

### 6.1 骨架（必须完全一致）

```html
<body>
  <header id="topbar">
    <div id="brand">班级管家<span id="brand-sub">高二(3)班演示</span></div>
    <div id="topbar-right">
      <label id="ai-toggle-wrap" title="AI 助手开关">
        <input type="checkbox" id="ai-toggle"><span>AI 助手</span>
      </label>
      <select id="role-switcher"></select>
    </div>
  </header>
  <nav id="tabbar">
    <!-- button.nav-item[data-view] × 5：notices / scores / collect / review / settings -->
  </nav>
  <main id="view-root"></main>
  <div id="toast"></div>
  <div id="modal-mask" hidden><div id="modal-box"></div></div>
</body>
```

### 6.2 视图容器（app.js 创建，各模块独占）

`#view-root` 内同一时刻只有一个：`<section id="view-notices">` / `#view-scores` / `#view-collect` / `#view-review` / `#view-settings`。

### 6.3 各模块内部 id（自定，但以下跨模块 id 必须存在）

| 模块 | 必须存在的 id | 说明 |
|------|--------------|------|
| notices | `#notices-filters` | 分类筛选（button[data-cat]，含「全部」） |
| notices | `#notices-list` | 列表容器 |
| notices | `#notice-detail` | 详情容器（可为抽屉/面板） |
| notices | `#btn-notice-new` | 发布按钮（无权限时隐藏） |
| notices | `#notice-form` | 发布/编辑表单容器（默认隐藏） |
| notices | `#ai-parse-input`、`#btn-ai-parse`、`#ai-parse-hint` | AI 一句话草稿（无 AI 时整块隐藏） |
| scores | `#exam-select`、`#score-subject-filter` | 考试/科目筛选 |
| scores | `#score-table` | 成绩表格容器 |
| scores | `#btn-score-import`、`#score-import-input` | 批量录入（粘贴文本导入） |
| scores | `#chart-dist`、`#chart-trend`、`#chart-subject` | 三个图表容器 |
| scores | `#btn-ai-report`、`#ai-report-box` | AI 班级分析报告 |
| scores | `#btn-ai-comment`、`#ai-comment-box` | AI 个人评语 |
| scores | `#student-score-panel` | 学生视角面板（学生角色时替代表格） |

### 6.4 响应式要求（Agent B）

- ≥1024px：内容区最大宽 1080px 居中；tabbar 横向在顶栏下方
- 768~1023px：同上，图表两列变一列
- <768px：**底部固定 tabbar**（≥48px 触控区，safe-area-inset-bottom），topbar 精简，**无横向滚动**
- 三档（360 / 768 / 1280）实测无横向滚动条
- 设计基调：专业教育工具风，主色 #2563eb 系，卡片圆角 12px，浅灰背景 #f5f7fa，中文字体优先系统栈

## 7. 模块接口契约

```js
// 视图模块（notices / scores）暴露：
CA.views.notices = { mount(rootEl), unmount() }
CA.views.scores  = { mount(rootEl), unmount() }

// mount: 传入该视图容器元素，模块自行渲染并绑定事件
// unmount: 清理定时器/事件（挂载在 root 内的事件随 DOM 移除，不需特判）
```

app.js 负责：tab 切换 → 销毁旧视图 → 建容器 → `mount()`；顶栏角色切换 → `CA.auth.switchTo` → 重渲染当前视图；AI 开关 → `store.setSettings({aiEnabled})` → 重渲染。

## 8. ai.js 契约（主 agent 实现，C/D 调用）

```js
CA.ai.enabled()                                  // settings.aiEnabled && CA.llm.ready()
CA.ai.parseNotice(text)                          // -> Promise<draft>
//   draft = { title, category, timeLabel, deadline, endTime, location, course, content, important, warnings[] }
//   内部：CA.llm.generateJson + 字段白名单校验 + 非法值置空并入 warnings；失败抛 Error(可读文案)
CA.ai.analyzeExam(examId)                        // -> Promise<{ markdown, stats }>
CA.ai.studentComment(memberId, examId)           // -> Promise<string>（一段 80~150 字评语）
CA.ai.BUSY                                        // 简单忙标志（可选）
```

C/D 调用 AI 时必须：先 `CA.ai.enabled()` 判断；`try/catch` 后用 `CA.app.toast(msg)` 报错；生成期间按钮置 disabled + 文案「生成中…」。

## 9. 演示数据规格（Agent A · seed.js 必须确定性生成）

- 班级：高二(3)班；users 共 5 个可切换身份：王老师(superAdmin/班主任)、李思远(admin/学习委员)、张天宇(student/学霸)、陈嘉怡(student/中等)、刘一鸣(student/后进)
- members：30 人，学号 20230301~20230330；上述 5 个 user 姓名须出现在名单中
- subjects：语文150、数学150、英语150、物理100、化学100（order 1~5）
- exams：第一次月考 2026-03-15、期中考试 2026-04-25、第二次月考 2026-05-20
- scores：3 考试 × 5 科 × 30 人 = 450 条，**必须用固定种子的伪随机**（mulberry32 之类），特征：
  - 每人有稳定能力基线（0.55~0.95），每次考试有难度系数，科目有个人偏好波动
  - 刘一鸣明显进步（第 3 次考试较第 1 次提升明显）；张天宇稳定高分；数学整体偏难
  - 分数取整数，裁剪到 [0.4×满分, 满分]
- notices：8 条（覆盖 5 个分类；2 条 pinned、1 条 important；2 条含附件 attachment；1 条含 links），时间散布在 2026-06 前后
- favorites：张天宇收藏 2 条

## 10. 自测要求（完成前必须通过）

- **A**：`node docs/test/store_test.mjs`：init 幂等（连续两次数据不变）、CRUD、reset、settings、seed 两次生成完全一致（JSON 序列化相等）、members 30 人 / scores 450 条断言
- **B**：本地起服务，手工检查 360/768/1280 无横向滚动；tab 5 项可点；角色切换器有 5 项；AI 开关可勾选（页面加载无 JS 报错，控制台干净）
- **C**：`node docs/test/notices_test.mjs`：mock `CA.store`/`CA.auth`/`CA.ai`，验证列表筛选、发布（字段完整）、编辑、删除权限判断、AI 草稿回填不抛错
- **D**：`node docs/test/scores_test.mjs`：统计纯函数断言（均分/中位数/最高最低/及格率/分数段分布/排名定位）+ mock echarts 下 charts 渲染调用不抛错

node 测试统一模式：`global.window = global; global.localStorage = <内存实现>;` 后 `require("../src/xxx.js")`（参考 `E:\OpenCode\review-helper\docs\test\node_test.js`）。

## 11. 完成报告格式（每个 agent 结束时输出）

1. 改动文件清单 + 每文件行数
2. 自测命令 + 输出摘要（贴关键行）
3. 偏离契约之处（若有，说明原因）
4. 给主 agent 的集成注意事项
