# DESIGN.md · 班级管家 UI 规范（v4.1 · 冻结）

> 本文件是 UI 升级与后续功能的**设计契约**。类名清单与规范冻结，各模块按此实现，不得临时发明类名。
> v4 目标：**推翻 v3 的「Soft UI + 极简/瑞士」克制路线**（用户判定仍有「廉价感」），换为**大胆、强轮廓、高辨识度**的 **软角新粗野主义（Rounded Neo-brutalism）**，并用 Agnes 生成的插画资产承载「活泼但专业」的 K12 气质。
> **v4.1（本版）只做一件事：配色和谐化。** 结构与质感（描边宽度、硬投影 offset、圆角、间距、字阶、动效）**全部冻结不变**；仅重估 `:root` 配色类 token 与 `§21` 精修层中的色值，解决 v4「多个高饱和强调色互抢、角色色与主色关系散」的问题。详见 §2.1。
> 基准：`CONTRACT.md`（DOM id 契约**不变量**——id 一个都不能动，测试依赖它们）。
> 依据：`ui-ux-pro-max` 设计库（`--design-system` + `--domain style` 检索结论，见 §1.1）。

---

## 0. v4 设计决策摘要（先读这段）

| 维度 | v3（被否决） | v4 | 解决什么「廉价感」 |
|------|-------------|----|---------------------|
| 风格 | Soft UI Evolution + Minimalism/Swiss | **Rounded Neo-brutalism**（粗墨描边 + 硬边投影 + 块面色块） | 「柔和扁平 = 模板脸」，没有识别度 |
| 轮廓 | 发丝描边 `1px #e3e8ed` | **2–3px 墨色实边 `--line`**（结构件） | 边界几乎看不见，块面糊在一起 |
| 阴影 | 5 档柔阴影（blur） | **硬边实色投影（0 blur）** `3px 3px 0 --line` | 柔阴影单薄、廉价 |
| 主色 | 教育青绿 `#0d9488` | **墨蓝 `#2B4ACB`**（唯一主色，全端统一） | 青绿俗套、无性格；v4 的「紫竞靛蓝」又与天蓝/紫 AI 抢戏 |
| 画布 | 微青灰 + 顶部光晕 | **奶油纸底 `#FFF7EC` + 点阵网格 + 极淡纹理图** | 默认灰白底（Bootstrap/Tailwind 脸） |
| 圆角 | 6/8/12/16/20 | **8/10/14/18/22**（软角：保留 K12 亲和，不做 0px 硬直角） | 圆角随意、无体系 |
| 标题字 | 系统栈 700 | 系统栈 **700–800 + 紧字距 + 全大写拉丁眉标** | 字重分层弱，缺「海报感」 |
| 插画 | 无（仅线性 SVG 空态） | **Agnes 生成的 7 张插画资产**（`docs/assets/`） | 一眼看出是「AI 拼的默认组件」 |
| 角色 | 三态（青绿/琥珀/平静） | **同族四态**：老师=墨蓝 / 协作=紫罗兰 / 学生=青蓝 / 未登录=墨蓝（同一冷色族不同明度色相微调），含顶色条、导航 active、主视觉横幅 | 老师学生界面气质不分；v4 各角色一个撞色导致「散」 |
| 动效 | 柔缓 140–340ms | **机械按压**（按下沉入阴影，~110ms）+ 贴纸弹出 | 过渡绵软，缺「手感」 |

**兼容性承诺**：v2/v3 已有的全部 **token 名**与**类名**均保留；v4 只**重估 token 取值**、**增强/新增类名**，不改任何模块接口。

---

## 1. 设计原则与风格定位

| # | 原则 | 落地 |
|---|------|------|
| 1 | **强轮廓** | 所有结构件（卡片/按钮/输入/徽标/导航）有 2–3px 墨色实边 `--line: #1E2230`（深墨蓝，非纯黑）；禁止「无边界内容块」 |
| 2 | **硬投影** | 结构件配 `Npx Npx 0 var(--line)` 硬边投影（0 blur）；hover 上浮、按下沉入（阴影归零） |
| 3 | **块面对比（不靠撞色）** | 大色块 + 墨边硬投影制造对比；一屏内 ≤2 个彩色块（主色 + 语义色），其余留白；禁止大面积渐变与低对比灰；**禁止新增高饱和撞色**（v4.1） |
| 4 | **活泼但专业** | 老师/协作端靠**结构密度 + 墨色秩序**显专业；学生端靠**大圆角 + 贴纸装饰 + 青蓝强调色**显活泼 |
| 5 | **中文友好** | 系统字体栈（**不引外链字体**）；数字 `tabular-nums`；正文行高 ≥1.6；中文可读性优先于字形噱头 |
| 6 | **反馈即时** | hover/active/focus 齐备；机械按压 ≤120ms；异步 `.is-loading`；toast 2.8s |
| 7 | **角色即语境** | 同一份组件靠 `body.role-*` 切换四套气质（顶色条 / 导航 active / 主视觉 / 密度） |
| 8 | **零构建** | 纯 CSS + 原生 JS；插画由 CSS `url()` 引用，不改 `index.html` |

### 1.1 风格定位（引 ui-ux-pro-max 结论）

- **选定：Rounded Neo-brutalism（软角新粗野主义）**
  - 设计库 `--domain style` 命中 **Neubrutalism**（Result 9）：`Bold borders / black outlines / primary colors / thick shadows / no gradients / flat colors / playful / Gen Z`；**Light ✓ · Dark ✓ · 性能 ⚡ Excellent · 可达性 ✓ WCAG AAA · 复杂度 Low**，实现要点 `border: 3px solid black; box-shadow: 5px 5px 0 black`。
  - 叠加 **Vibrant & Block-based**（Result 10）的「块面布局 + 大字号」与 **Memphis**（Result 1）的「几何形状 + 贴纸感 + 微旋转」做装饰层。**注（v4.1）**：其「4–6 撞色」按 §2.1 收敛为「1 主色 + 1 强调色 + 降饱和语义色」，保留块面而不堆撞色。
  - 「软角」修正：原版新粗野主义为 `border-radius: 0`，对 K12 过于生硬；本项目统一取 8–18px 圆角，保留粗描边与硬投影的**力量感**，同时不吓到学生，故称 Rounded Neo-brutalism。

- **候选 A（弃）：Claymorphism 2.0**
  - 设计库 `--design-system`（query：`education K12 classroom tool vibrant bold playful professional`）首选返回 **Claymorphism (Mobile)**（关键词 clay/bubbly/candy/playful；Best For: Children education apps）。
  - **弃用理由**：① 它本质是 v3「Soft UI」的**同族放大版**——同样是柔阴影 + 低对比 + 圆润，正是用户判定「廉价感」的那一类；② 官方性能评级 **⚠ Moderate–Heavy（shadows+blur）**，且依赖移动端 `BlurView`，在纯 CSS/零构建的静态页上没有干净的等价实现；③ 粉彩色低对比与老师端「专业」诉求冲突。故仅保留其「活泼」意图，不采纳其质感。

- **候选 B（弃）：Glassmorphism 2.0 / Vibrant Gradient Mesh**
  - 是 2020–2022 的通用「高级感」范式，**依赖 backdrop-filter 与大面积渐变**（性能 ⚠ Good，文本对比 ⚠ 需反复校准），且**极易与同类 SaaS 撞脸**——恰恰是「廉价感」的另一种来源（一眼看出是模板）。故否决。

- **字体否决**：设计库两次推荐 `Baloo 2 / Comic Neue`（儿童教育），与硬约束（**中文系统字体栈、不引外链字体**）冲突，且中文无对应字重，**不采用**；改用「同款意图」在系统栈上实现：**标题 700–800 + `--ls-tight`，拉丁眉标全大写 + `--ls-caps`**。

---

## 2. 设计 Token（CSS 变量，定义于 `styles.css` `:root`）

```css
:root {
  /* ---- 主色：墨蓝 Ink Blue（v4.1 唯一主色，全端统一） ---- */
  --primary: #2B4ACB;        /* 身份色；模块 `var(--primary)` 自动受益 */
  --primary-500: #4C68E2;
  --primary-600: #2B4ACB;
  --primary-700: #2239A8;
  --primary-800: #1B2E86;
  --primary-hover: #243FB8;
  --primary-soft: #E9EDFB;
  --primary-soft-2: #D9E0F8;
  --primary-line: #B3C0EE;
  --primary-text: #2239A8;   /* 白底 9.5:1，主色浅底 8.1:1 */
  --primary-ring: rgba(43, 74, 203, .24);
  --primary-glow: rgba(43, 74, 203, .10);
  --primary-scrim: rgba(27, 46, 134, .85);    /* 主色海报块上的荧光笔（深一档的蓝，白字下可见） */

  /* ---- 强调色：陶土橙 Terracotta（主色的暖色补色：截止 / 置顶 / 注意力） ---- */
  --accent: #CF5A1C;
  --accent-soft: #FBEBDF;
  --accent-text: #97430F;    /* 浅底 5.8:1 / 白底 6.7:1 */

  /* ---- 语义色（统一降饱和：彼此可共存，不与主色抢焦点） ---- */
  --success: #2E7D5B; --success-strong: #226148; --success-soft: #E2F1E9; --success-text: #1E5F45;
  --warn:    #8C6800; --warn-soft:    #F6EEDA; --warn-text:    #6B4F00;
  --danger:  #C4353F; --danger-strong: #A82732; --danger-soft: #FBE5E6; --danger-text: #98232C;
  --info:    #0E7C92; --info-soft:    #E0F1F3; --info-text:    #0B5D70;
  --ai:      #9E3E8C; --ai-soft:      #F0E6F2; --ai-text:      #7A2E6E;

  /* ---- 墨色与中性阶（深墨蓝墨线 + 暖灰文本；奶油纸底保留） ---- */
  --line: #1E2230;            /* ★v4.1 结构墨线：近黑但投蓝，比纯黑更贴合蓝青主色 */
  --line-2: #343A4D;
  --line-soft: rgba(30, 34, 48, .85);
  --mask: rgba(18, 20, 28, .58);
  --text: #191A21;
  --text-2: #4E4958;
  --text-3: #6E6879;          /* v4.1：加深至正文可读 4.5:1 */
  --text-invert: #ffffff;
  --bg: #FFF7EC;              /* 奶油纸底 */
  --bg-2: #FBEFDD;
  --surface: #ffffff;
  --surface-2: #FFF3E4;
  --surface-3: #F7E8D3;
  --surface-warm: #FFFBF4;    /* ★v4.1 顶栏 / 底栏 / 奇数行「暖纸面」 */
  --border: #E2D6C4;          /* 内部细线（表格行等） */
  --border-strong: #C9B9A3;
  --border-faint: #F0E7D9;
  --dot: rgba(30, 34, 48, .10);   /* ★v4 点阵网格 */

  /* ---- 阴影：硬边实色投影（0 blur）★v4 ---- */
  --shadow-xs: 2px 2px 0 var(--line);
  --shadow-sm: 3px 3px 0 var(--line);
  --shadow-md: 4px 4px 0 var(--line);
  --shadow-lg: 6px 6px 0 var(--line);
  --shadow-xl: 8px 8px 0 var(--line);
  --shadow-primary: 4px 4px 0 var(--primary-700);

  /* ---- 圆角（软角：不做 0px 硬直角） ---- */
  --r-xs: 6px; --r-sm: 8px; --r: 14px; --r-lg: 18px; --r-xl: 22px; --r-full: 999px;

  /* ---- 间距（8 网格，不变） ---- */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-7: 28px; --sp-8: 32px;
  --sp-10: 40px; --sp-12: 48px;

  /* ---- 字号阶梯（正文 ≥15px，不变） ---- */
  --fs-2xs: 11px;
  --fs-xs: 12px; --fs-sm: 13px; --fs-base: 15px; --fs-md: 16px; --fs-lg: 17px;
  --fs-xl: 20px; --fs-2xl: 24px; --fs-3xl: 30px; --fs-4xl: 36px;

  /* ---- 行高 / 字重 / 字距 ---- */
  --lh-tight: 1.25; --lh-snug: 1.4; --lh-base: 1.6; --lh-relaxed: 1.75;
  --fw-normal: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700; --fw-black: 800;
  --ls-tight: -.022em; --ls-caps: .10em;

  /* ---- 动效：机械按压 + 贴纸弹出 ---- */
  --t-fast: 110ms cubic-bezier(.2, .8, .2, 1);
  --t: 160ms cubic-bezier(.2, .8, .2, 1);
  --t-slow: 220ms cubic-bezier(.22, 1, .36, 1);
  --t-spring: 320ms cubic-bezier(.34, 1.56, .64, 1);
  --ease-out: cubic-bezier(.22, 1, .36, 1);

  /* ---- 字体栈（中文优先，不引外部字体） ---- */
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
          "Microsoft YaHei", "Source Han Sans SC", sans-serif;

  /* ---- 骨架尺寸 ---- */
  --topbar-h: 60px;
  --tabbar-h: 56px;
  --content-max: 1120px;

  /* ---- ★v4 角色色（同一冷色族派生；由 body.role-* 覆盖） ---- */
  --role-accent: #2B4ACB;
  --role-accent-2: #4C68E2;   /* 角色品牌块渐变亮端 */
  --role-accent-3: #1B2E86;   /* 角色品牌块渐变暗端 */
  --role-on-accent: #ffffff;
  --role-soft: #E9EDFB;
  --role-marker: rgba(43, 74, 203, .55);   /* 荧光笔（随角色） */
  --atmos-a: rgba(43, 74, 203, .06);       /* 背景层冷暖渐变（随角色） */
  --atmos-b: rgba(207, 90, 28, .03);
  --hero-image: url("assets/hero-teacher.png");
}
```

**兼容性承诺**：v2 已有 token 名（`--primary`/`--shadow-sm|md|lg`/`--r-sm|r|r-lg|r-full`/`--fs-*`/`--sp-*`/`--t*`）与 v3/v4 新增 token 名**全部保留**，模块无需改动即自动受益于 v4.1 取值。v4.1 仅**改色值、新增少量颜色变量**（`--surface-warm`/`--line-soft`/`--mask`/`--primary-scrim`/`--role-accent-2|3`/`--role-marker`/`--atmos-a|b`），**未改动任何结构类 token**（描边宽度、硬投影 offset、圆角、间距、字号、动效）。

### 2.1 配色和谐化（v4.1 决策）

**问题**：v4 同屏出现 靛蓝 `#4A3AFF` + 亮橙 `#F26A0A` + 柠檬绿 `#B8F13B` + 天蓝 `#2E90FA` + 紫 `#A855F7` + 红 `#F04438`，共 6 个高饱和色相互抢焦点；且 teacher/admin/student 各取一个**互相无关**的撞色，角色与主色没有共同血缘。

**解法（三条规则）**：
1. **收敛为 1 主 + 1 强调**：主色统一为 **墨蓝 `#2B4ACB`**（降一档彩度、由「紫竞」移向可协调的蓝青），强调色统一为**陶土橙 `#CF5A1C`**（主色的暖色补色，专供截止/置顶/注意力）。绿色/紫色不再参与「身份表达」。
2. **语义色整体降饱和**，各占独立色相、彼此亮度接近，可同屏共存：success 152° / warn 45° / danger 356° / info 192° / ai 305°。语义色只做「信息标签」，不与主色争身份。
3. **角色色同族派生**（同一冷色族：蓝 230° → 协作紫 268° → 学生青 200°），只靠**明度与色相微调**区分气质，不再各用一个撞色；品牌块的渐变、顶色条、导航 active、荧光笔全部由 `--role-accent-2/3`、`--role-marker` 统一派生。

**色相分布**（避免相邻争抢）：`356° 危险 → 22° 强调 → 45° 警示 → 152° 成功 → 192° 信息 → 200° 学生 → 230° 主色/老师 → 268° 协作 → 305° AI`。

**对比度（WCAG，实测）**：白字/主色 **7.13:1**（AAA）；主色文字/白底 **9.47:1**、/主色浅底 **8.10:1**；各语义 `*-text` 在 `*-soft` 上 5.6–7.1:1；`--text-3` 元信息 **5.0:1**（v4 的 `#857F94` 仅 3.5:1，本版修正）；墨线/奶油底 14.9:1（非文本）。角色实底/字：老师(白/蓝) 7.1:1、协作(白/紫) 6.8:1、学生(墨/青) 5.2:1。

**2 候选对比（含落选说明）**：

| 候选 | 主色 | 强调 | 角色 | 结论 |
|------|------|------|------|------|
| **A（选定）蓝青主色 + 陶土橙强调** | 墨蓝 `#2B4ACB` | 陶土橙 `#CF5A1C` | 蓝/紫/青 同族 | 冷主色 + 暖补色是经典互补；语义色降饱和后同屏不打架；奶油底上的暖橙与冷蓝形成明确主次。**采纳** |
| B（弃）青绿主色 + 琥珀强调（LMS 惯例） | `#0D9488` 青绿 | `#D97706` 琥珀 | 青绿/蓝/青 | ① 正是 v3 被用户判定「廉价/俗套」的青绿；② 青绿与语义 success、与角色学生青在色相上过近，语义色更难分离；③ 与「墨线 + 硬投影」的粗野质感互补性弱。故否决 |

> 依据 `ui-ux-pro-max`：`--domain style "Neubrutalism"`（高对比墨边 + 硬投影 + 平涂色，本版保留其质感）、`--domain color "..."`（Education / LMS / Pet-Tech 三组均指向「冷主色 + 暖强调」的互补结构；LMS 青绿方案因上述理由落选）。**结构与质感零改动**，只换配色系统。

**角色色覆盖（`body.role-*`）**：

| 角色 | `--role-accent` | `--role-on-accent` | `--role-soft` | 品牌块亮/暗端 | `--role-marker` |
|------|-----------------|--------------------|---------------|----------------|-----------------|
| `.role-teacher`（superAdmin） | `#2B4ACB` 墨蓝 | `#fff` | `#E9EDFB` | `#4C68E2` / `#1B2E86` | `rgba(43,74,203,.55)` |
| `.role-admin`（admin） | `#5E45C0` 协作紫 | `#fff` | `#ECE7F9` | `#7E68D6` / `#3D2A8A` | `rgba(94,69,192,.45)` |
| `.role-student`（member/student） | `#2F9BE0` 学生青 | `#1E2230`（墨） | `#E4F3FD` | `#6CBEF0` / `#1B7EC2` | `rgba(47,155,224,.50)` |
| `.role-guest`（未登录） | `#2B4ACB` 墨蓝 | `#fff` | `#E9EDFB` | `#4C68E2` / `#1B2E86` | `rgba(43,74,203,.55)` |

**保留的类名（仅换色，不换名）**：`.btn-lime` / `.badge-lime` / `.ca-sticker` 历史上是「学生端柠檬绿」，v4.1 起统一渲染为 `var(--role-accent)`（即「角色强调色」）；类名因 `CONTRACT.md` 冻结而保留，语义变为「角色强调款」。

---

## 3. 排版规范

| 场景 | 字号 | 字重 | 行高 | 颜色 |
|------|------|------|------|------|
| 主视觉横幅标题 | `--fs-2xl`~`--fs-3xl` | 800 | `--lh-tight` | `--text` |
| 页面/视图主标题 | `--fs-xl` 20px | 800 | `--lh-tight` | `--text` |
| 卡片标题 | `--fs-md` 16px | 700 | `--lh-snug` | `--text` |
| 列表项标题 | `--fs-base` 15px | 600 | `--lh-snug` | `--text` |
| 正文 | `--fs-base` 15px | 400 | `--lh-base` 1.6 | `--text-2` |
| 长正文（通知详情） | `--fs-base` 15px | 400 | `--lh-relaxed` 1.75 | `--text-2` |
| 元信息（时间/地点/学号） | `--fs-sm` 13px | 500 | `--lh-snug` | `--text-3` |
| 眉标（eyebrow，全大写拉丁） | `--fs-2xs` 11px | 700 | 1 | `--text-3` + `--ls-caps` |
| 徽标/标签 | `--fs-xs` 12px | 600 | 1 | 语义色 |
| 统计数字（强调） | `--fs-2xl`~`--fs-3xl` | 800 | 1.1 | 语义色 |
| 表格数字 | `--fs-sm` | 600 | 1 | `tabular-nums` |
| 按钮文字 | 14px（`.btn-sm` 13px / `.btn-lg` 15px） | 700 | 1.2 | 语义 |

**规则**：正文最小 15px；标题一律 `--fw-bold`~`--fw-black` + `--ls-tight`；全大写拉丁眉标用 `--ls-caps`；数字一律 `font-variant-numeric: tabular-nums`。**中文标题不加大字距**（中文加字距会散架），字距只作用于拉丁/数字。

---

## 4. 组件类名清单（★冻结，各模块必须使用）

> **v4 只增不删**：以下 v2/v3 类名全部保留，v4 新增项标注 **(v4 新)**。

### 4.1 布局
`.stack` · `.row` · `.row-between` · `.grid` / `.grid-2` / `.grid-3` · `.muted` · `.dim` · `.divider` · `.text-sm` · `.text-xs` · `.eyebrow` · `.section-title` · `.hairline` · `.surface-tint` · `.metric-strip`
- **(v4 新)** `.block-row`（块面横向排列，间距 16，可换行）· `.stacked-cards`（卡片纵向 18px）· `.grid-auto`（自适应 min 260px）

### 4.2 卡片
`.card` · `.card-head` / `.card-title` / `.card-sub` / `.card-foot` · `.card-list` · `.list-row` · `.card-accent` · `.card-inset` · `.accent-bar`
- **v4 质感**：`.card` = 白底 + `2px solid var(--line)` + `--shadow-md`（硬投影）+ `--r`(14)；`:hover` 上浮 2px 且投影增至 6px。
- **(v4 新)** `.card-flat`（无投影，仅墨边，用于嵌套）· `.card-ink`（主色实底 + 反白文字，做「海报块」；白字 7.1:1、弱化白字 5.2:1，均达 WCAG AA）· `.card-sticker`（卡右上角贴纸位，`position:relative`）

### 4.3 徽标
`.badge` + `.badge-cat` `.badge-important` `.badge-pinned` `.badge-success` `.badge-warn` `.badge-danger` `.badge-ai` `.badge-muted` `.badge-dot` `.badge-outline` `.badge-role` `.fav-star`
- **v4 质感**：徽标统一 `1.5px solid var(--line)`（描边款）+ 圆角 full + 字重 600。
- **(v4 新)** `.badge-ink`（墨底反白，最高强调）· `.badge-lime`（角色强调实底，v4.1 起随 `--role-accent`，不再固定柠檬绿）· `.badge-sky`（信息青 `--info`）

### 4.4 按钮
`.btn` + `.btn-primary` `.btn-ghost` `.btn-danger` `.btn-success` `.btn-ai` `.btn-quiet` `.btn-labeled` `.btn-sm` `.btn-lg` `.btn-block` `.btn-icon` `.btn-group`
状态：`:hover`（上浮 1px，投影 +1px）、`:active`（**下沉 Npx 且投影归零 = 机械按压**）、`:disabled`、`:focus-visible`（主色 3px 实环）、`.is-loading`
- **v4 质感**：`2px solid var(--line)` + 3px 硬投影 + `--fw-bold`。
- **(v4 新)** `.btn-ink`（墨底反白主行动）· `.btn-lime`（角色强调实底，v4.1 起随 `--role-accent`，学生端主行动）· `.btn-press`（显式声明机械按压，供非 `.btn` 元素复用）

### 4.5 筛选与分段
`.segmented` > `.seg-item`（`.active`）· `.chip` · `.chip.active` · `.filter-btn` · `.filter-count`
- **v4 质感**：`.segmented` = 墨边容器 + 硬投影；`.seg-item.active` = 墨底反白。

### 4.6 表格
`.table-wrap` · `.table`（`.table-compact`）· `.num` · `tr.is-selected`
- **v4 质感**：`.table thead th` = **墨底反白 + 全大写眉标**；行 hover = `--primary-soft` + 左侧 3px 主色内嵌条。

### 4.7 统计
`.stat-grid` > `.stat` > `.stat-value` + `.stat-label`；`.stat.success` / `.stat.warn` / `.stat.danger` / `.stat.emphasis` / `.stat-strong`
- **v4 质感**：`.stat` = 白底 + 墨边 + 硬投影；`.stat.emphasis` = 主色浅底 + 主色墨边；`.stat-strong .stat-value` 30px/800。

### 4.8 表单
`.form-grid`（`.span-2`）· `.form-field` / `.field` · `.label`（`.req`）· `.input` · `.field-hint` · `.field-error` · `.form-actions` · `.check`
- **v4 质感**：输入框 `2px solid var(--line)` + `--r-sm`；`:focus` = 无毛边 + `3px 3px 0 var(--primary)` 硬环。

### 4.9 图标（★）
`.icon` · `.icon-lg` · `.icon-btn` · `.icon-slot` / `.icon-wrap`
- 图标一律内联 SVG（`docs/src/icons.js`），`stroke-width: 1.75`，`currentColor`。**禁止 emoji 当图标**。
- **v4 质感**：`.icon-btn` 墨边 + 硬投影，按下沉入。

### 4.10 反馈
`.empty` > `.empty-icon` + `.empty-title` + `.empty-desc`（+ 可选 `.btn`）· `.empty-art` · `#toast` · `#modal-mask` > `#modal-box` > `.modal-title` / `.modal-hint` / `.modal-actions` · `.skeleton*` · `.spinner` · `.loading` / `.spinner-wrap`
- **v4 质感**：`.empty-icon` = 主色浅底圆圈 + `2px` 墨边 + 硬投影；`#toast` = 墨底 + 3px 彩色左边条；`#modal-box` = 墨边 + `8px 8px 0` 硬投影。
- **(v4 新)** `.ca-art`（插画空态容器：160×160，`background-size: contain`）+ 语义修饰 `.ca-art-notices` / `.ca-art-scores` / `.ca-art-collect` / `.ca-art-review`（引用 `docs/assets/empty-*.png`）。模块空态只需给 `.empty-icon` 追加 `ca-art ca-art-notices` 即换为插画，**无需改结构**。

### 4.11 图表
`.chart-grid` / `.chart-box` > `.chart-title` + `.chart` · `.bar-chart` 系列 · `.bar-row` / `.bar-label` / `.bar-track` / `.bar-fill` / `.bar-value`

### 4.12 角色与可见性

| 类名 | 作用 | 用法 |
|------|------|------|
| `.role-teacher` | 老师（`superAdmin`）语境 | 由 app.js 加在 `<body>` |
| `.role-admin` | 管理员（`admin`/学习委员）语境 | 由 app.js 加在 `<body>` |
| `.role-student` | 学生（`member`/`student`）语境 | 由 app.js 加在 `<body>` |
| `.role-guest` | 未登录（登录/改密页） | 由 app.js 加在 `<body>` |
| `.admin-only` | 仅管理端可见的元素 | `.role-student` 下隐藏 |
| `.student-only` | 仅学生端可见的元素 | `.role-teacher`/`.role-admin` 下隐藏 |
| `.manage-actions` | 管理动作容器（编辑/删除/发布） | notices 详情操作区 |
| `.reader-emphasis` | 阅读强调容器 | 学生端通知正文/收藏区 |

> 模块**不得**自行判角色切换 DOM 结构；只可加上述类名，差异由 CSS 承担。

### 4.13 认证视图（login-view.js）
`.auth-view` · `.auth-card` · `.auth-brand` · `.auth-eyebrow` · `.auth-error`
- **(v4 新)** `.auth-hero`（品牌横幅插画，`16:9` 裁切）· `.auth-mark`（现有）

### 4.14 ★v4 新增：结构层（app.js 注入，模块只读）

| 类名 / id | 作用 |
|-----------|------|
| `#ca-atmos.atmos` | 页面背景层（`position:fixed; z-index:-1`）：奶油底 + 点阵网格 + 极淡纹理图；`pointer-events:none` |
| `#ca-hero.ca-hero` | 角色主视觉横幅（`#view-root` 之前）：插画 + 眉标 + 标题 + 副标题；`role-guest` 下隐藏 |
| `.ca-hero-art` | 横幅内插画位（`background-image: var(--hero-image)`，右侧裁切） |
| `.ca-sticker` | 贴纸装饰（微旋转 + 墨边 + 硬投影），学生端默认启用 |
| `.ca-marker` | 荧光笔底纹（`linear-gradient` 半透明角色色 `--role-marker`，用于关键词强调；随角色变化） |

---

## 5. 图标系统（`docs/src/icons.js`）

```js
CA.icon(name, size) -> string   // <svg>…</svg> 字符串
CA.iconEl(name, size) -> SVGElement
CA.icons.hydrate(root)          // 补全导航图标 + 替换残留 emoji 字形（自动 MutationObserver）
```
必需图标：`bell` `chart` `clipboard` `book` `settings` `plus` `edit` `trash` `star` `star-filled` `pin` `link` `paperclip` `download` `upload` `search` `close` `check` `user` `users` `clock` `map-pin` `calendar` `chevron-right` `chevron-down` `sparkles` `refresh` `filter` `trend-up` `trend-down` `alert` `info` `logout` `eye`。

**加载**：`index.html` 在 `app.js` 之前引入 `src/icons.js`。导航图标由 `hydrate` 自动注入，**无需模块处理**。

---

## 6. 时间与数据展示规则

### 6.1 时间
**禁止任何地方直接输出 ISO 字符串**（如 `2026-06-24T19:00:00`）。统一走 `CA.util`：

| 函数 | 输出 | 用途 |
|------|------|------|
| `CA.util.fmtSmart(v)` | 今天→`今天 19:00`；明天→`明天 08:00`；昨天→`昨天 15:30`；今年→`06-24 19:00`；跨年→`2026-06-24` | **默认时间展示** |
| `CA.util.fmtDate(v)` | `2026-06-24` | 纯日期 |
| `CA.util.fmtTime(v)` | `19:00` | 纯时间 |
| `CA.util.fmtDateTime(v)` | `2026-06-24 19:00` | 需完整时 |
| `CA.util.relTime(v)` | `3天前` / `2小时后` | 相对时间（动态场景） |

区间写法：`06-24 19:00 ~ 20:30`；跨天：`06-24 19:00 ~ 06-25 17:00`。

### 6.2 数字
`tabular-nums`；大数（≥10000）千分位；百分比保留 1 位小数 + `%`。

### 6.3 空值
一律显示 `—`（U+2014）。

---

## 7. 交互与反馈

- 可点击元素：`cursor:pointer` + hover 态（110–220ms）
- 列表项 hover：边框保持墨色，**上浮 2px 且投影增大**，背景转 `--primary-soft`
- 按钮按下：**机械按压** —— `transform: translate(3px,3px)` 且 `box-shadow: none`（沉入自己的投影）
- 异步操作：按钮 `.is-loading`（禁用 + spinner，文案「处理中…」）
- Toast：底部居中滑入，2.8s 自动消失；左侧 4px 语义色条
- 空态：**优先使用 `.ca-art` 插画** + 标题 + 说明（+ 可选操作按钮），禁止只有一行灰字
- 键盘：所有交互元素 `:focus-visible` = `outline: 3px solid var(--primary)` + `offset 2px`
- 触控目标 ≥44×44px（移动端）；列表项最小高度 56px
- `@media (prefers-reduced-motion: reduce)` 关闭过渡与动画（全局兜底已实现）

---

## 8. 响应式

| 断点 | 布局 |
|------|------|
| ≥1024px | 内容最大宽 **1120px** 居中；老师/协作端放宽至 **1200px**；横幅插画右置 |
| 768–1023px | 单列；图表单列；横幅插画右置缩窄 |
| <768px | 底部固定 tabbar（≥48px + safe-area）；横幅改为**纯色块**（隐藏插画以省流量）；卡片内边距 14；表格横滚；**禁止横向滚动** |

移动端专项：顶栏精简（品牌副标题 <400px 隐藏）；表格首列 sticky；长文本省略号；横幅高度 ≤104px。

---

## 9. 图表规范（charts.js）

- 配色映射 v4.1：主序列 `--primary`(墨蓝)；对比序列 `--info`(信息青) / `--accent`(陶土橙)；上升 `--success`、下降 `--danger`
- 网格线极淡（`--border-faint`）；无边框；tooltip 白底 + 墨边 + 硬投影
- 坐标轴文字 `--text-3` 12px；单序列不显示冗余图例
- 降级（无 ECharts）：CSS 条形图用 `--primary` 实色 + 墨边，数值标签可读
- ℹ️ `charts.js` 已改「读 CSS 变量」（`cssVar('--primary')` 等），v4.1 换 token 后**自动生效**；其内置 `FALLBACK` 仍是 v4 旧值（仅当变量缺失时兜底），建议后续同步为新色值（本版未改 JS，见报告「未实测项」）

---

## 10. 角色差异化设计（核心）

### 10.1 机制

登录成功后，`app.js` 按 `CA.auth.current().role` 给 `<body>` 设置**唯一**角色类（并写 `data-role` 便于 JS 读取）：

| role | body 类 | 气质 | 密度档 |
|------|---------|------|--------|
| `superAdmin` | `role-teacher` | 班主任 / 管理台（墨蓝） | 8/10（紧凑） |
| `admin` | `role-admin` | 班委 / 协作端（协作紫） | 8/10（紧凑） |
| `member` / `student` | `role-student` | 学生 / 内容台（学生青） | 4/10（宽松） |
| 未登录 | `role-guest` | 认证页（墨蓝） | 6/10 |

- 切换/退出登录时由 `app.js` 重设。
- 模块可用 `CA.app.role()` 读取归一化角色（`"teacher" | "admin" | "student" | "guest"`），但**优先用 CSS**，不要自建角色判断。
- 视图容器 `<section id="view-*">` 位于 `body` 之内，`.role-*` 选择器对模块内部同样生效。

### 10.2 老师 / 协作端（管理导向）

- **顶色条**：`#topbar` 顶部 `5px solid var(--role-accent)`（墨蓝 / 协作紫）。
- **品牌副标题**：`role-teacher` → 「· 管理端」；`role-admin` → 「· 协作端」。
- **导航 active**：墨底反白 + `3px 3px 0 var(--role-accent)` 硬投影，胶囊收紧至 9px 圆角。
- **横幅**：矮幅（≤120px），副标题列「发布通知 / 录入成绩 / 管理名单」，插画右置。
- **内容区**：宽度上限 1200px；卡片内边距 16、列表 gap 10；`.stat-strong` 大号 KPI 优先。
- **动作入口**：发布 / 编辑 / 删除用 `.manage-actions` + `.btn-labeled` **显式带文字**；`#ai-toggle-wrap` 正常显示。

### 10.3 学生（消费导向）

- **顶色条**：学生青 `#2F9BE0`（`--role-accent`）。
- **品牌副标题**：「· 学生端」。
- **导航 active**：学生青实底 + **墨色文字**（`--role-on-accent`，保证对比）+ 硬投影，胶囊全圆角。
- **横幅**：高幅（≤140px），插画右置，副标题列「看通知 / 查成绩 / 做收集 / 去复习」。
- **内容区**：卡片内边距 20、圆角 18、列表 gap 14；正文行高 `--lh-relaxed`；`.reader-emphasis` 字号略放大。
- **弱化管理**：`.admin-only` 隐藏；`#ai-toggle-wrap` 隐藏（AI 为老师写作工具，元素保留仅 `display:none`，不破坏 id 契约）；`.fav-action` 为第一动作。
- **活泼装饰**：`.ca-sticker` 默认启用（微旋转贴纸）。

### 10.4 认证页（guest）

- `.auth-view` 居中；`.auth-card` = 墨边 + `8px 8px 0` 硬投影 + `--r-xl`。
- 卡顶 `.auth-hero` 横幅（`assets/hero-teacher.png`，16:9 裁切，`--r` 圆角，墨边）。
- 登录/改密：品牌区 + 眉标 + 大留白 + 46px 主按钮；错误态 `.auth-error` 红底 + 墨边 + 左侧 4px 红条。

---

## 11. 视觉资产（`docs/assets/`，Agnes 生成）

| 文件 | 尺寸 | 用途 | 引用方式 |
|------|------|------|---------|
| `hero-teacher.png` | 1312×736 (16:9) | 老师/协作端 + 认证页横幅 | `body.role-teacher/role-admin { --hero-image }`；`.auth-hero` |
| `hero-student.png` | 1312×736 (16:9) | 学生端横幅 | `body.role-student { --hero-image }` |
| `empty-notices.png` | 1024×1024 (1:1) | 通知空态 | `.ca-art-notices` |
| `empty-scores.png` | 1024×1024 (1:1) | 成绩空态 | `.ca-art-scores` |
| `empty-collect.png` | 1024×1024 (1:1) | 收集空态 | `.ca-art-collect` |
| `empty-review.png` | 1024×1024 (1:1) | 复习空态 | `.ca-art-review` |
| `bg-texture.png` | 1312×736 (16:9) | 页面背景纹理（低对比，不抢内容） | `#ca-atmos` |

**插画风格约定（后续生成必须一致）**：Rounded Neo-brutalism 扁平矢量，粗墨描边、硬边实色投影、奶油纸底、几何形状、**画面内无任何文字**；主色块取墨蓝/学生青、强调块取陶土橙，**避免整图高饱和撞色**（与 v4.1 配色一致）。

**性能**：所有插画 >500KB，仅供横幅/空态使用（非重复铺满）；移动端 <768px 隐藏横幅插画（改纯色块），避免首屏大图。

---

## 12. 禁止事项（Review 清单）

- ❌ emoji 当图标（📎 ✏️ → SVG）
- ❌ ISO 时间直出
- ❌ 无边界的内容块（必须有墨边卡片/分隔）
- ❌ 模块内硬编码颜色（必须用 CSS 变量）
- ❌ 新增高饱和撞色 / 第 3 个品牌色（v4.1：配色只有「1 主色 + 1 强调色 + 语义色」，见 §2.1）
- ❌ 使用 blur/柔阴影做结构件（除 `#modal-mask` 遮罩外）——破坏新粗野主义质感
- ❌ 粉彩色 / 低对比灰字（正文对比 ≥4.5:1，标题 ≥7:1）
- ❌ 整屏渐变或大面积低对比背景（纹理图透明度 ≤8%）
- ❌ placeholder 当 label
- ❌ 触控目标 <44px
- ❌ 破坏 `CONTRACT.md` 的 DOM id（测试依赖）
- ❌ 移除既有功能的键盘可达性
- ❌ 在模块内自建角色分支改 DOM 结构（应用 `.role-*` + `.admin-only`/`.student-only`）
- ❌ 引入外部字体 / 框架 / 构建步骤（纯静态零构建）
- ❌ 在 Wave 1 修改模块文件（notices/scores/collect/review/charts/store/auth/ai/cloud）；其 v4 套用见 §13 Wave 2

---

## 13. Wave 2 套用指引（模块如何迁移到 v4）

本波只交付**壳层（DESIGN.md / styles.css / app.js / login-view.js）+ 资产**；模块**零改动**即可受益于 token 重估，但要达到 v4 完整观感，Wave 2 按下列清单微调（**只加类名，不改 DOM id**）：

1. **空态换插画**：给各模块 `.empty-icon` 追加 `ca-art ca-art-<view>`（例：`class="empty-icon ca-art ca-art-notices"`），即用 Agnes 插画替代线性 SVG。
2. **图表配色**：`charts.js` 已改为读 CSS 变量（自动随 v4.1 生效）；建议同步其 `FALLBACK` 常量为 v4.1 色值（见 §9 备注）。
3. **海报块**：概览类卡片改用 `.card-ink`（主色实底反白 KPI）提升视觉重心。
4. **贴纸点缀**：学生端关键卡片加 `.ca-sticker`（微旋转徽标）与 `.ca-marker`（荧光底纹强调），二者均随 `--role-accent` 取色。
5. **按钮统一**：主行动换 `.btn-primary`/`.btn-ink`，次要管理动作 `.btn-quiet`+`.btn-labeled`；学生端主行动 `.btn-lime`（角色强调实底）。
6. **表格密度**：老师端给表格加 `.table-compact`；确保表头墨底反白不被模块自定义覆盖。
7. **验证**：`node docs/test/*.mjs` 全绿（模块逻辑未改，应保持）、360/768/1280 三档无横向滚动、`prefers-reduced-motion` 下无动画。
