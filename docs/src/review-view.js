// review-view.js —— 复习视图（CA 原生 UI · 复用 review-helper 引擎）
// 目标：用班级管家自己的设计系统（DESIGN.md v4）承载复习功能，只复用 RH 的引擎逻辑，
//       不再整搬 RH 界面（P2 iframe 方案已弃用）。
// 契约：REVIEW.md §2（DOM id）/ §3（功能链路）/ §4（存储 ca_study）；CONTRACT.md §7（CA.views.review = {mount, unmount}）。
// 依赖（全部特性探测，缺失时安全降级，绝不抛错阻断视图）：
//   window.RH.*   引擎：parsers.parseFile / pipeline.run / storage.* / sm2.* / exporter.* / llm.info
//   CA.util      时间格式化（禁 ISO 直出）·  CA.icon  图标（禁 emoji）·  CA.app.toast  提示
//   CA.store.settings().aiEnabled  顶栏 AI 开关（关闭时强制走规则降级）
// 说明：界面与样式均由本模块自建；复习专用样式以 .ca-review-* 前缀在自身 JS 内注入（沿 scores.js/collect.js 做法），
//       不改 styles.css（避免与配色 Agent 冲突）。颜色一律用 CSS 变量，不硬编码。
window.CA = window.CA || {};

(function () {
  "use strict";

  var STYLE_ID = "ca-review-style";
  var state = null;      // 当前挂载状态（{ root, refs, D, ... }）
  var mountToken = 0;    // 使在途异步结果失效

  // ============================================================
  // 基础工具
  // ============================================================
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function toast(msg, type) {
    try { if (CA.app && typeof CA.app.toast === "function") CA.app.toast(msg, type); } catch (e) { /* 忽略 */ }
  }

  function toastError(err, fallback) {
    toast((err && err.message) || fallback || "操作失败", "error");
  }

  // 时间展示：统一走 CA.util（禁 ISO 直出）；CA.util 缺失时给最小兜底
  function fmtSmart(v) {
    try {
      if (CA.util && typeof CA.util.fmtSmart === "function") return CA.util.fmtSmart(v) || "—";
    } catch (e) { /* 落到兜底 */ }
    try {
      var d = new Date(v);
      if (!isNaN(d.getTime())) {
        var p = function (n) { return (n < 10 ? "0" : "") + n; };
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
      }
    } catch (e) { /* 忽略 */ }
    return v == null ? "—" : String(v);
  }

  // 极简 DOM 构造（与 collect.js / scores.js 同款）
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k === "value") { el.value = v; el.setAttribute("value", String(v)); }
        else if (k === "checked") { el.checked = !!v; if (v) el.setAttribute("checked", ""); }
        else if (k === "hidden") { el.hidden = !!v; if (v) el.setAttribute("hidden", ""); }
        else if (k === "disabled") { el.disabled = !!v; if (v) el.setAttribute("disabled", ""); }
        else if (k === "multiple") { el.multiple = true; el.setAttribute("multiple", ""); }
        else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      });
    }
    if (kids != null) {
      [].concat(kids).forEach(function (c) { if (c != null && c !== false) el.appendChild(c); });
    }
    return el;
  }

  function addClass(el, name) { if (el && el.className != null) { var s = String(el.className); if (s.split(/\s+/).indexOf(name) < 0) el.className = (s ? s + " " : "") + name; } }
  function removeClass(el, name) { if (el && el.className != null) el.className = String(el.className).split(/\s+/).filter(function (x) { return x && x !== name; }).join(" "); }
  function hasClass(el, name) { return !!(el && el.className != null && String(el.className).split(/\s+/).indexOf(name) >= 0); }
  function clear(el) { if (!el) return; while (el.firstChild) el.removeChild(el.firstChild); }

  // ============================================================
  // 图标（统一走 CA.icon；缺失时内置线性 SVG 兜底，绝不使用 emoji）
  // ============================================================
  var FALLBACK_ICONS = {
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    sparkles: '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    star: '<path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    "chevron-right": '<polyline points="9 18 15 12 9 6"/>'
  };

  function icon(name, size) {
    if (CA.icon && typeof CA.icon === "function") {
      try { return CA.icon(name, size); } catch (e) { /* 落到兜底 */ }
    }
    var body = FALLBACK_ICONS[name] || FALLBACK_ICONS.info;
    var px = size || 16;
    return '<svg class="icon" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + "</svg>";
  }

  function iconEl(name, size) { return h("span", { class: "icon-wrap", html: icon(name, size) }); }

  // ============================================================
  // RH 引擎桥接
  // ============================================================
  function RH() { return window.RH || null; }

  // 顶栏 AI 开关状态（CA.store.settings 同步；取不到时按开启处理）
  function aiEnabled() {
    try {
      if (CA.store && typeof CA.store.settings === "function") {
        var s = CA.store.settings();
        return !(s && s.aiEnabled === false);
      }
    } catch (e) { /* 忽略 */ }
    return true;
  }

  // 当前 LLM 模型名（引擎徽标用）
  function modelName() {
    try {
      if (window.RH && RH.llm && typeof RH.llm.info === "function") {
        var info = RH.llm.info() || {};
        return info.model || "";
      }
    } catch (e) { /* 忽略 */ }
    return "";
  }

  // 跑管线：AI 关闭时临时关闭 RH.llm.ready（等价「AI 不可用」），使 RH.pipeline 走规则降级。
  // 只动引擎的就绪探测函数、不改 RH 源码，finally 恢复（幂等）。
  function runPipeline(doc, onProgress) {
    var rh = RH();
    if (!rh || !rh.pipeline || typeof rh.pipeline.run !== "function") {
      return Promise.reject(new Error("复习引擎未加载（请检查 src/review/** 脚本顺序）"));
    }
    var llm = rh.llm;
    var restore = null;
    if (!aiEnabled() && llm && typeof llm.ready === "function") {
      var orig = llm.ready;
      try {
        llm.ready = function () { return false; };
        restore = function () { try { llm.ready = orig; } catch (e) { /* 忽略 */ } };
      } catch (e) { restore = null; }
    }
    return Promise.resolve()
      .then(function () { return rh.pipeline.run(doc, onProgress); })
      .then(function (vm) { if (restore) restore(); return vm; },
        function (err) { if (restore) restore(); throw err; });
  }

  function stripExt(name) { return String(name || "").replace(/\.[^.]+$/, "") || "未命名文档"; }

  function fileExt(f) { return ((f && f.name) ? String(f.name).split(".").pop() : "").toLowerCase(); }

  var OK_EXTS = ["pdf", "docx", "doc", "pptx", "ppt", "txt", "md", "png", "jpg", "jpeg", "webp", "bmp"];
  var ACCEPT = ".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp";

  // ============================================================
  // 复习专用样式（模块自注入；只用 CSS 变量，不硬编码颜色）
  // ============================================================
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      "/* 复习视图（CA 原生 v4）：顶部主卡（上传/进度/结果头一体）+ 子 Tab 单一内容卡 · 区块用分隔线组织，不逐项套卡 */",
      "#view-review { margin-top: 0; }",
      ".ca-review { display: flex; flex-direction: column; gap: var(--sp-4); }",
      ".ca-review .icon-wrap { display: inline-flex; align-items: center; color: inherit; }",
      // 统一隐藏规则：覆盖下方 flex 容器的 display，保证 [hidden] 生效
      ".ca-review [hidden] { display: none; }",
      // ---- 顶部主卡：标题 + 结果头 + 上传 + 进度（同一视觉边界） ----
      ".ca-review-main > .card-head { margin-bottom: var(--sp-3); }",
      ".ca-review-docbar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3);",
      "  flex-wrap: wrap; padding-bottom: var(--sp-3); margin-bottom: var(--sp-3); border-bottom: 2px solid var(--border); }",
      ".ca-review-docbar-main { display: flex; align-items: center; gap: 10px; min-width: 0; }",
      ".ca-review-doc-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
      "  font-size: var(--fs-lg); font-weight: var(--fw-bold); letter-spacing: var(--ls-tight); color: var(--text); }",
      ".ca-review-actions { justify-content: flex-end; flex: none; }",
      // 拖放区（唯一虚线边界，不再外套卡片）
      ".ca-review-upload { border: 2px dashed var(--line); border-radius: var(--r); background: var(--surface-2);",
      "  padding: 26px 18px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;",
      "  transition: background var(--t), border-color var(--t), box-shadow var(--t); }",
      ".ca-review-upload.is-drag { background: var(--primary-soft); border-color: var(--primary); box-shadow: var(--shadow-sm); }",
      ".ca-review-upload .empty-icon { margin-bottom: 2px; }",
      ".ca-review-hint { font-size: var(--fs-sm); color: var(--text-3); }",
      // 进度：主卡内子块（顶部一条分隔线，无独立边框）
      ".ca-review-progress { margin-top: var(--sp-4); padding-top: var(--sp-4); border-top: 2px solid var(--border); }",
      ".ca-review-progress-text { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }",
      ".ca-review-track { height: 14px; border: 2px solid var(--line); border-radius: var(--r-full);",
      "  background: var(--surface); overflow: hidden; margin-top: 10px; }",
      ".ca-review-bar { display: block; height: 100%; width: 0; background: var(--primary);",
      "  border-radius: var(--r-full); transition: width var(--t); }",
      // ---- 结果：子 Tab + 单一内容卡 ----
      ".ca-review-result { display: flex; flex-direction: column; gap: var(--sp-3); }",
      "#review-tabs { align-self: flex-start; }",
      ".ca-review-content { padding: var(--sp-5); }",
      ".review-pane { display: flex; flex-direction: column; gap: var(--sp-4); }",
      ".review-pane[hidden] { display: none; }",
      // ---- 内容区块：留白 + 分隔线，不叠卡片 ----
      ".ca-review-block { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }",
      ".ca-review-block + .ca-review-block { border-top: 2px solid var(--border); padding-top: var(--sp-3); }",
      ".ca-review-block-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }",
      ".ca-review-block-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-md);",
      "  font-weight: var(--fw-bold); letter-spacing: var(--ls-tight); color: var(--text); }",
      ".ca-review-block-title .icon { color: var(--primary); }",
      // 要点
      ".ca-review-overview { margin: 0; font-size: var(--fs-md); line-height: var(--lh-relaxed); color: var(--text-2); }",
      ".ca-review-chips { display: flex; flex-wrap: wrap; gap: 6px; }",
      ".ca-review-sections { gap: var(--sp-4); }",
      ".ca-review-section { border-left: 4px solid var(--primary-line); padding-left: var(--sp-3); min-width: 0; }",
      ".ca-review-section-title { display: flex; align-items: center; justify-content: space-between; gap: 8px;",
      "  font-weight: var(--fw-bold); margin-bottom: 6px; }",
      ".ca-review-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }",
      ".ca-review-point { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; padding: 9px 8px;",
      "  border-radius: var(--r-sm); cursor: pointer; transition: background var(--t-fast); }",
      ".ca-review-point + .ca-review-point { border-top: 1px solid var(--border); }",
      ".ca-review-point:hover { background: var(--surface-2); }",
      ".ca-review-point-text { flex: 1; min-width: 0; line-height: var(--lh-snug); }",
      ".ca-review-source { flex-basis: 100%; margin-top: 2px; padding: 8px 10px; border: 2px solid var(--line);",
      "  border-radius: var(--r-sm); background: var(--surface); color: var(--text-2); font-size: var(--fs-sm);",
      "  line-height: var(--lh-base); }",
      // 练习 / 复习题（平铺 + 分隔线，无逐题卡片）
      ".ca-review-quiz-item { padding: var(--sp-4) 0; }",
      ".ca-review-quiz-item:first-child { padding-top: 0; }",
      ".ca-review-quiz-item + .ca-review-quiz-item { border-top: 2px solid var(--border); }",
      ".ca-review-q-text { font-weight: var(--fw-semibold); line-height: var(--lh-base); margin: 8px 0 10px; }",
      ".ca-review-options { display: flex; flex-direction: column; gap: 6px; }",
      ".ca-review-option { justify-content: flex-start; text-align: left; width: 100%; }",
      ".ca-review-option.selected { border-color: var(--primary); box-shadow: var(--shadow-sm); }",
      ".ca-review-feedback { margin-top: 10px; padding: 10px 12px; border: 2px solid var(--line);",
      "  border-radius: var(--r-sm); font-size: var(--fs-sm); line-height: var(--lh-base); }",
      ".ca-review-feedback.ok { background: var(--success-soft); color: var(--success-text); }",
      ".ca-review-feedback.bad { background: var(--danger-soft); color: var(--danger-text); }",
      ".ca-review-feedback[hidden] { display: none; }",
      // 复习统计：平铺指标条（去掉 4 个卡片）
      ".ca-review-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-3); }",
      ".ca-review-stats .stat { padding: 4px 0 4px var(--sp-3); background: transparent; border: 0;",
      "  border-left: 4px solid var(--primary-line); border-radius: 0; box-shadow: none; }",
      ".ca-review-stats .stat.emphasis { background: transparent; border-left-color: var(--primary); box-shadow: none; }",
      ".ca-review-stats .stat.success { border-left-color: var(--success); }",
      ".ca-review-stats .stat.danger { border-left-color: var(--danger); }",
      ".ca-review-stats .stat .stat-value { font-size: var(--fs-xl); }",
      // 资料库：平铺行 + 分隔线
      ".ca-review-lib-row { display: flex; align-items: center; gap: 12px; padding: var(--sp-3) 0; }",
      ".ca-review-lib-row + .ca-review-lib-row { border-top: 1px solid var(--border); }",
      ".ca-review-lib-row .list-main { flex: 1; min-width: 0; }",
      ".ca-review-lib-row .list-title { font-weight: var(--fw-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
      ".ca-review-lib-row .list-meta { font-size: var(--fs-sm); color: var(--text-3); }",
      "@media (max-width: 767px) {",
      "  #review-tabs { align-self: stretch; }",
      "  .ca-review-content { padding: 14px; }",
      "  .ca-review-upload { padding: 18px 12px; }",
      "  .ca-review-docbar { gap: 8px; }",
      // 窄屏标题/资料名改为可换行，避免被 ellipsis 截断关键信息
      "  .ca-review-doc-title { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }",
      "  .ca-review-actions { flex: 1 1 100%; justify-content: flex-start; flex-wrap: wrap; gap: 8px; }",
      "  .ca-review-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }",
      "  .ca-review-lib-row { flex-wrap: wrap; }",
      "  .ca-review-lib-row .list-title { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }",
      "  .ca-review-block-title { font-size: var(--fs-base); }",
      "  .ca-review-overview { font-size: var(--fs-base); }",
      "}"
    ].join("\n");
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ============================================================
  // DOM 骨架（mount 时同步构建：§2 全部 id 立即存在，异步数据随后填充）
  // ============================================================
  function buildSkeleton(rootEl) {
    var refs = {};
    var wrap = h("div", { class: "ca-review" });

    // ---- 顶部主卡：标题 + 结果头 + 上传 + 进度（同一视觉边界） ----
    var mainCard = h("div", { class: "card ca-review-main" });
    mainCard.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconEl("book", 20), h("span", { text: "复习" })]),
      h("span", { class: "badge badge-ai admin-only", text: "AI 增强" })
    ]));

    // 结果头（文档标题 + 引擎徽标 + 导出）：生成前隐藏，与卡内标题共用一层边框
    var docTitle = h("div", { class: "ca-review-doc-title", id: "review-doc-title", text: "—" });
    var engineBadge = h("span", { class: "badge badge-muted", id: "review-engine-badge", text: "离线模式" });
    var exportDocx = h("button", { class: "btn btn-sm", type: "button", id: "review-export-docx" }, [iconEl("download", 15), h("span", { text: "导出要点" })]);
    var exportQuiz = h("button", { class: "btn btn-sm", type: "button", id: "review-export-quiz" }, [iconEl("download", 15), h("span", { text: "导出试题" })]);
    var docbar = h("div", { class: "ca-review-docbar", hidden: true }, [
      h("div", { class: "ca-review-docbar-main" }, [docTitle, engineBadge]),
      h("div", { class: "row ca-review-actions" }, [exportDocx, exportQuiz])
    ]);
    mainCard.appendChild(docbar);

    var drop = h("div", { class: "ca-review-upload", id: "review-upload" });
    drop.appendChild(h("div", { class: "empty-icon ca-art ca-art-review", "aria-hidden": "true" }));
    drop.appendChild(h("div", { class: "empty-title", text: "上传资料，生成复习要点与练习" }));
    drop.appendChild(h("p", { class: "empty-desc", text: "支持 PDF / Word / PPT / TXT / Markdown / 图片（OCR）。可拖放或点击选择，支持多文件。" }));
    var pickBtn = h("button", { class: "btn btn-primary", type: "button" }, [iconEl("upload", 16), h("span", { text: "选择文件" })]);
    drop.appendChild(pickBtn);
    drop.appendChild(h("div", { class: "ca-review-hint", text: "AI 关闭时自动走离线规则引擎，要点与出题照常可用。" }));
    var fileInput = h("input", { type: "file", id: "review-file-input", accept: ACCEPT, multiple: true, hidden: true });
    drop.appendChild(fileInput);
    refs.upload = drop;
    refs.fileInput = fileInput;
    refs.pickBtn = pickBtn;
    mainCard.appendChild(drop);

    // 进度：主卡内子块（一条分隔线，无独立卡片）
    var progText = h("div", { class: "ca-review-progress-text", id: "review-progress-text", text: "准备中…" });
    var progBar = h("i", { class: "ca-review-bar", id: "review-progress-bar" });
    var progBlock = h("div", { class: "ca-review-progress", id: "review-progress", hidden: true }, [
      h("div", { class: "row-between" }, [progText, h("span", { class: "badge badge-muted", text: "处理中" })]),
      h("div", { class: "ca-review-track" }, [progBar])
    ]);
    refs.progress = progBlock;
    refs.progText = progText;
    refs.progBar = progBar;
    mainCard.appendChild(progBlock);

    wrap.appendChild(mainCard);

    // ---- 结果区：子 Tab + 单一内容卡 ----
    var result = h("div", { class: "ca-review-result", id: "review-result", hidden: true });

    // 子 Tab
    var tabs = h("div", { class: "segmented", id: "review-tabs" });
    var PANES = [
      { key: "points", label: "要点" },
      { key: "quiz", label: "练习" },
      { key: "study", label: "复习" },
      { key: "library", label: "资料库" }
    ];
    var paneEls = {};
    PANES.forEach(function (p, i) {
      var btn = h("button", { class: "seg-item" + (i === 0 ? " active" : ""), type: "button", "data-pane": p.key, text: p.label });
      btn.addEventListener("click", function () { switchPane(p.key); });
      tabs.appendChild(btn);
      paneEls[p.key] = btn;
    });
    result.appendChild(tabs);

    // 内容卡：四个子 Tab 面板共用一层边框
    var content = h("div", { class: "card ca-review-content" });

    // 要点面板（区块用标题 + 分隔线组织，无逐块卡片）
    var panePoints = h("div", { class: "review-pane", id: "review-pane-points" });
    var overview = h("p", { class: "ca-review-overview", id: "review-overview" });
    var overviewBlock = h("div", { class: "ca-review-block", hidden: true }, [
      h("div", { class: "ca-review-block-title", text: "全文速览" }),
      overview
    ]);
    var keywords = h("div", { class: "ca-review-chips", id: "review-keywords" });
    var keywordsBlock = h("div", { class: "ca-review-block", hidden: true }, [
      h("div", { class: "ca-review-block-title", text: "关键词" }),
      keywords
    ]);
    var sections = h("div", { class: "ca-review-block ca-review-sections", id: "review-sections" });
    panePoints.appendChild(overviewBlock);
    panePoints.appendChild(keywordsBlock);
    panePoints.appendChild(sections);
    content.appendChild(panePoints);

    // 练习面板
    var quizStats = h("div", { class: "ca-review-quiz-stats card-sub", id: "review-quiz-stats", text: "—" });
    var quizList = h("div", { class: "ca-review-quiz-list", id: "review-quiz-list" });
    var paneQuiz = h("div", { class: "review-pane", id: "review-pane-quiz", hidden: true }, [
      h("div", { class: "ca-review-block-head" }, [
        h("div", { class: "ca-review-block-title", text: "练习" }),
        quizStats
      ]),
      quizList
    ]);
    content.appendChild(paneQuiz);

    // 复习面板（SM-2）
    var docFilter = h("select", { class: "input", id: "review-doc-filter" }, [h("option", { value: "", text: "全部资料" })]);
    var studyStats = h("div", { class: "ca-review-stats", id: "review-study-stats" });
    var startDue = h("button", { class: "btn btn-primary btn-sm", type: "button", id: "review-start-due" }, [h("span", { text: "开始今日复习" })]);
    var startAll = h("button", { class: "btn btn-sm", type: "button", id: "review-start-all" }, [h("span", { text: "复习全部" })]);
    var dueList = h("div", { class: "ca-review-due-list", id: "review-due-list" });
    var paneStudy = h("div", { class: "review-pane", id: "review-pane-study", hidden: true }, [
      h("div", { class: "ca-review-block-head" }, [
        h("div", { class: "ca-review-block-title" }, [iconEl("clock", 18), h("span", { text: "间隔复习" })]),
        h("div", { class: "row" }, [h("label", { class: "label", text: "资料筛选" }), docFilter])
      ]),
      studyStats,
      h("div", { class: "row ca-review-study-actions" }, [startDue, startAll]),
      dueList
    ]);
    content.appendChild(paneStudy);

    // 资料库面板
    var importInput = h("input", { type: "file", accept: ".json", hidden: true });
    var importBtn = h("button", { class: "btn btn-sm", type: "button", id: "review-quiz-import" }, [iconEl("upload", 15), h("span", { text: "导入题库 JSON" })]);
    var libList = h("div", { class: "ca-review-lib-list", id: "review-library-list" });
    var paneLib = h("div", { class: "review-pane", id: "review-pane-library", hidden: true }, [
      h("div", { class: "ca-review-block-head" }, [
        h("div", { class: "ca-review-block-title", text: "资料库" }),
        importBtn
      ]),
      importInput,
      libList
    ]);
    content.appendChild(paneLib);

    result.appendChild(content);

    wrap.appendChild(result);
    rootEl.appendChild(wrap);

    return {
      wrap: wrap,
      refs: refs,
      result: result,
      tabs: tabs,
      tabBtns: paneEls,
      panes: {
        points: panePoints,
        quiz: paneQuiz,
        study: paneStudy,
        library: paneLib
      },
      docbar: docbar,
      overviewBlock: overviewBlock,
      overview: overview,
      keywordsBlock: keywordsBlock,
      keywords: keywords,
      sections: sections,
      quizList: quizList,
      quizStats: quizStats,
      studyStats: studyStats,
      dueList: dueList,
      startDue: startDue,
      startAll: startAll,
      docFilter: docFilter,
      libList: libList,
      importInput: importInput,
      importBtn: importBtn,
      exportDocx: exportDocx,
      exportQuiz: exportQuiz,
      docTitle: docTitle,
      engineBadge: engineBadge
    };
  }

  // ============================================================
  // Tab 切换
  // ============================================================
  function switchPane(name) {
    if (!state || !state.ui) return;
    state.pane = name;
    Object.keys(state.ui.panes).forEach(function (k) {
      var pane = state.ui.panes[k];
      var btn = state.ui.tabBtns[k];
      if (pane) pane.hidden = (k !== name);
      if (btn) btn.className = "seg-item" + (k === name ? " active" : "");
    });
    if (name === "study") refreshStudy();
    if (name === "library") refreshLibrary();
  }

  // ============================================================
  // 上传 / 解析 / 管线
  // ============================================================
  function setProgress(text, ratio) {
    if (!state || !state.ui) return;
    if (state.ui.refs.progText) state.ui.refs.progText.textContent = text || "";
    if (state.ui.refs.progBar) state.ui.refs.progBar.style.width = Math.round((ratio == null ? 0 : ratio) * 100) + "%";
  }

  var STAGE_LABEL = { parse: "解析", summarize: "AI 提炼要点", quiz: "AI 出题", fallback: "离线规则引擎" };

  function onProgress(stage, msg, ratio) {
    var label = STAGE_LABEL[stage] || stage || "处理中";
    setProgress(msg ? (label + " · " + msg) : label, ratio);
  }

  function showProgress(on) {
    if (state && state.ui && state.ui.refs.progress) state.ui.refs.progress.hidden = !on;
  }

  function asArray(fileList) {
    if (!fileList) return [];
    if (typeof fileList.length === "number" && typeof fileList !== "string") {
      var out = [];
      for (var i = 0; i < fileList.length; i++) out.push(fileList[i]);
      return out;
    }
    return [fileList];
  }

  function handleFiles(fileList) {
    var files = asArray(fileList).filter(function (f) { return f && f.name; });
    if (!files.length) return Promise.resolve();
    for (var i = 0; i < files.length; i++) {
      if (OK_EXTS.indexOf(fileExt(files[i])) < 0) { toast("不支持的格式：." + fileExt(files[i]), "error"); return Promise.resolve(); }
    }
    var rh = RH();
    if (!rh || !rh.parsers || typeof rh.parsers.parseFile !== "function") {
      toast("复习引擎未加载，无法解析", "error");
      return Promise.resolve();
    }

    var token = mountToken;
    showProgress(true);
    setProgress("准备中…", 0.02);

    var parsedList = [];
    var chain = Promise.resolve();
    files.forEach(function (f, idx) {
      chain = chain.then(function () {
        var multi = files.length > 1;
        return rh.parsers.parseFile(f, function (msg, ratio) {
          onProgress("parse", multi ? ("第" + (idx + 1) + "/" + files.length + "个 " + f.name + (msg ? " · " + msg : "")) : msg, ratio);
        });
      }).then(function (doc) { parsedList.push(doc); });
    });

    return chain.then(function () {
      var merged = files.length > 1
        ? { title: stripExt(files[0].name), sections: parsedList.reduce(function (a, p) { return a.concat(p.sections || []); }, []) }
        : parsedList[0];
      setProgress("AI 提炼要点", 0.68);
      return runPipeline(merged, onProgress).then(function (vm) {
        return { merged: merged, vm: vm };
      });
    }).then(function (r) {
      if (token !== mountToken || !state) return;   // 已切换/卸载：丢弃过期结果
      var D = buildD(r.merged, r.vm, files);
      state.D = D;
      state.quizAnswered = {};
      renderResult();
      showProgress(false);
      toast("已生成复习要点与练习", "success");
      var rh2 = RH();
      if (rh2 && rh2.storage && typeof rh2.storage.saveDoc === "function") {
        try {
          rh2.storage.saveDoc(D.title, {
            backend: D.backend, overview: D.overview, engine: D.engine,
            sections: D.sections, quiz: D.quiz, keywords: D.keywords, terms: D.terms,
            original_sections: D.original_sections, markdown: "",
            sourceBlob: D.sourceBlob, sourceName: D.sourceName, sourceNames: D.sourceNames
          }).then(function () { if (state && state.D === D) { refreshLibrary(); refreshStudy(); } }).catch(function () { /* 存库失败不阻断 */ });
        } catch (e) { /* 忽略 */ }
      }
    }).catch(function (err) {
      if (token !== mountToken || !state) return;
      showProgress(false);
      setProgress("", 0);
      toastError(err, "解析失败");
    });
  }

  function flattenOriginal(parsed) {
    return (parsed.sections || []).map(function (s) {
      return { title: s.title, blocks: s.blocks || [], rich: s.rich || null };
    });
  }

  function buildD(parsed, vm, files) {
    vm = vm || {};
    parsed = parsed || {};
    var list = files || [];
    return {
      title: vm.title || parsed.title || "未命名文档",
      engine: vm.engine || "rule",
      backend: vm.backend || "",
      overview: vm.overview || "",
      keywords: vm.keywords || [],
      terms: vm.terms || [],
      sections: vm.sections || [],
      quiz: vm.quiz || [],
      original_sections: vm.original_sections || flattenOriginal(parsed),
      sourceBlob: list[0] || null,
      sourceName: list[0] ? list[0].name : "",
      sourceNames: list.map(function (f) { return f && f.name; }).filter(Boolean)
    };
  }

  // ============================================================
  // 结果渲染
  // ============================================================
  function renderResult() {
    if (!state || !state.ui || !state.D) return;
    var ui = state.ui, D = state.D;
    ui.result.hidden = false;
    if (ui.docbar) ui.docbar.hidden = false;
    if (ui.docTitle) ui.docTitle.textContent = D.title + " · 复习";
    renderEngineBadge();

    // 要点
    if (ui.overviewBlock) ui.overviewBlock.hidden = !D.overview;
    if (ui.overview) ui.overview.textContent = D.overview || "";
    var kws = (D.keywords || []).concat(D.terms || []);
    if (ui.keywordsBlock) ui.keywordsBlock.hidden = !kws.length;
    if (ui.keywords) {
      clear(ui.keywords);
      kws.forEach(function (k) { ui.keywords.appendChild(h("span", { class: "chip", text: k })); });
    }
    renderSections();

    // 练习
    renderQuiz("review-quiz-list", D.quiz || [], { study: false });

    // 复习统计 / 资料库
    refreshStudy();
    refreshLibrary();
    switchPane(state.pane || "points");
  }

  function renderEngineBadge() {
    var badge = state.ui.engineBadge;
    if (!badge) return;
    var D = state.D || {};
    if (D.engine === "llm") {
      var model = modelName() || D.backend || "LLM";
      badge.textContent = "AI · " + model;
      badge.className = "badge badge-ai";
      badge.title = "AI 主路径（总结 + 出题）";
    } else if (D.engine === "import") {
      badge.textContent = "题库导入";
      badge.className = "badge badge-muted";
      badge.title = "从 JSON 题库导入";
    } else {
      badge.textContent = "离线模式";
      badge.className = "badge badge-muted";
      badge.title = "AI 未开启或调用失败，已自动降级本地规则引擎";
    }
  }

  function impBadge(importance) {
    if (importance === "high") return h("span", { class: "badge badge-danger", text: "重点" });
    if (importance === "medium") return h("span", { class: "badge badge-warn", text: "要点" });
    if (importance === "low") return h("span", { class: "badge badge-muted", text: "了解" });
    return null;
  }

  function renderSections() {
    var box = state.ui.sections;
    if (!box) return;
    clear(box);
    var sections = (state.D && state.D.sections) || [];
    if (!sections.length) {
      box.appendChild(emptyBlock("暂无要点", "本次未提炼出要点，可检查资料内容或重新上传。", null));
      return;
    }
    sections.forEach(function (sec, si) {
      var points = sec.points || (sec.items || []).map(function (it) { return { point: it, source: "", importance: "" }; });
      var block = h("div", { class: "ca-review-section" });
      block.appendChild(h("div", { class: "ca-review-section-title" }, [
        h("span", { text: sec.title || ("第" + (si + 1) + "章") }),
        h("span", { class: "muted text-xs", text: points.length + " 条" })
      ]));
      var ul = h("ul", { class: "ca-review-points" });
      points.forEach(function (p) {
        var pointText = (p && p.point) || "";
        var li = h("li", { class: "ca-review-point" });
        var badge = impBadge(p && p.importance);
        if (badge) li.appendChild(badge);
        if (p && p.kind === "example") li.appendChild(h("span", { class: "badge badge-outline", text: "例" }));
        li.appendChild(h("span", { class: "ca-review-point-text", text: pointText }));
        // 点击要点：展开/收起 source 原文片段（REVIEW.md §3.3 第一版简化定位）
        var srcBox = null;
        if (p && p.source) {
          li.addEventListener("click", function () {
            if (srcBox && srcBox.parentNode) { li.removeChild(srcBox); srcBox = null; return; }
            srcBox = h("div", { class: "ca-review-source", text: "原文：" + p.source });
            li.appendChild(srcBox);
          });
          li.title = "点击查看原文片段";
        }
        ul.appendChild(li);
      });
      block.appendChild(ul);
      box.appendChild(block);
    });
  }

  function emptyBlock(title, desc, art) {
    var box = h("div", { class: "empty" });
    if (art) box.appendChild(h("div", { class: "empty-icon ca-art " + art, "aria-hidden": "true" }));
    box.appendChild(h("div", { class: "empty-title", text: title }));
    if (desc) box.appendChild(h("p", { class: "empty-desc", text: desc }));
    return box;
  }

  // ============================================================
  // 练习题渲染与答题（练习 / 复习共用）
  // ============================================================
  var QTYPE_NAME = { choice: "选择", judge: "判断", cloze: "填空" };

  function renderQuiz(containerId, list, opts) {
    opts = opts || {};
    var box = document.getElementById(containerId);
    if (!box) return;
    clear(box);
    if (!list || !list.length) {
      box.appendChild(opts.study
        ? emptyBlock("暂无待复习卡片", "练习中答对的题会在 1 天后进入复习队列；也可点「复习全部」立即复习。", null)
        : emptyBlock("暂无练习题", "当前资料未生成题目。AI 出题失败时可在重新上传后重试。", null));
      if (containerId === "review-quiz-list") updateQuizStats(list || []);
      return;
    }
    list.forEach(function (q, qi) { box.appendChild(quizItem(q, qi, containerId, opts.study)); });
    if (containerId === "review-quiz-list") updateQuizStats(list);
  }

  function quizItem(q, qi, containerId, study) {
    var card = h("div", { class: "ca-review-quiz-item" });
    card.appendChild(h("div", { class: "row-between" }, [
      h("span", { class: "badge badge-muted", text: QTYPE_NAME[q.type] || q.type || "题目" }),
      h("span", { class: "muted text-xs", text: study && q.docTitle ? q.docTitle : (q.difficulty ? ("难度 " + q.difficulty) : "") })
    ]));
    card.appendChild(h("div", { class: "ca-review-q-text", text: q.question || "" }));

    var feedback = h("div", { class: "ca-review-feedback", hidden: true });
    var answered = false;

    function settle(ok, val, markBtn) {
      if (answered) return;
      answered = true;
      if (markBtn) addClass(markBtn, "selected");
      feedback.hidden = false;
      feedback.className = "ca-review-feedback " + (ok ? "ok" : "bad");
      clear(feedback);
      var ansText = q.type === "choice" && q.answerIndex != null
        ? (String.fromCharCode(65 + q.answerIndex) + ". " + (q.answer || ""))
        : (q.answer == null ? "" : q.answer);
      feedback.appendChild(h("div", { text: (ok ? "正确" : "答案：" + ansText) }));
      if (q.explanation) feedback.appendChild(h("div", { class: "muted", text: q.explanation }));
      // SM-2 记账：storage.recordAnswer 内部已调用 RH.sm2.review
      var rh = RH();
      var docTitle = q.docTitle || (study ? "" : (state.D && state.D.title) || "");
      if (rh && rh.storage && typeof rh.storage.recordAnswer === "function" && docTitle) {
        try { rh.storage.recordAnswer(docTitle, q, ok, val).then(function () { if (state) refreshStudy(); }).catch(function () {}); } catch (e) { /* 忽略 */ }
      }
      if (!study) {
        state.quizAnswered = state.quizAnswered || {};
        state.quizAnswered[containerId + "::" + qi] = { ok: ok };
        updateQuizStats(currentQuizList());
      }
    }

    var optionsBox = h("div", { class: "ca-review-options" });
    if (q.type === "choice" && Array.isArray(q.options)) {
      q.options.forEach(function (opt, oi) {
        var btn = h("button", { class: "btn btn-sm ca-review-option", type: "button", text: String.fromCharCode(65 + oi) + ". " + (opt == null ? "" : opt) });
        btn.addEventListener("click", function () { settle(oi === q.answerIndex, String.fromCharCode(65 + oi), btn); });
        optionsBox.appendChild(btn);
      });
    } else if (q.type === "judge") {
      [["正确", "正确"], ["错误", "错误"]].forEach(function (pair) {
        var btn = h("button", { class: "btn btn-sm ca-review-option", type: "button", text: pair[0] });
        btn.addEventListener("click", function () { settle(pair[1] === q.answer, pair[1], btn); });
        optionsBox.appendChild(btn);
      });
    } else {
      var input = h("input", { class: "input", type: "text", placeholder: "填入空格中的内容" });
      var submit = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "提交" });
      function doCloze() {
        var val = String(input.value || "").trim();
        if (!val) return;
        var norm = function (s) { return String(s).replace(/\s+/g, "").replace(/[，,。;；:：]/g, ""); };
        var ok = norm(val) === norm(q.answer) || norm(q.answer).indexOf(norm(val)) >= 0;
        settle(ok, val, null);
        input.disabled = true;
        submit.disabled = true;
      }
      submit.addEventListener("click", doCloze);
      if (input.addEventListener) input.addEventListener("keydown", function (ev) { if (ev && ev.key === "Enter") doCloze(); });
      optionsBox.appendChild(input);
      optionsBox.appendChild(submit);
    }
    card.appendChild(optionsBox);
    card.appendChild(feedback);
    return card;
  }

  function currentQuizList() { return (state.D && state.D.quiz) || []; }

  function updateQuizStats(list) {
    var el = state.ui.quizStats;
    if (!el) return;
    list = list || [];
    var answered = state.quizAnswered || {};
    var keys = Object.keys(answered);
    var ok = keys.filter(function (k) { return answered[k].ok; }).length;
    el.textContent = "已答 " + keys.length + "/" + list.length + " · 正确 " + ok;
  }

  // ============================================================
  // 复习（SM-2 · 到期卡片）
  // ============================================================
  function refreshStudy() {
    var rh = RH();
    if (!state || !state.ui) return Promise.resolve();
    if (!rh || !rh.storage) { renderStudyStats(null); return Promise.resolve(); }
    return Promise.resolve()
      .then(function () { return rh.storage.getStats ? rh.storage.getStats() : null; })
      .then(function (stats) {
        if (!state) return;
        renderStudyStats(stats);
        return rh.storage.getAllCards ? rh.storage.getAllCards() : [];
      })
      .then(function (cards) {
        if (!state) return;
        renderDocFilter(cards || []);
      })
      .catch(function () { if (state) renderStudyStats(null); });
  }

  function renderStudyStats(stats) {
    var box = state.ui.studyStats;
    if (!box) return;
    clear(box);
    var s = stats || { total: 0, due: 0, mastered: 0, weak: 0 };
    var defs = [
      { label: "已录题目", value: s.total || 0, cls: "" },
      { label: "今日待复习", value: s.due || 0, cls: "emphasis" },
      { label: "已掌握", value: s.mastered || 0, cls: "success" },
      { label: "错题", value: s.weak || 0, cls: "danger" }
    ];
    defs.forEach(function (d) {
      box.appendChild(h("div", { class: "stat " + d.cls }, [
        h("div", { class: "stat-value", text: String(d.value) }),
        h("div", { class: "stat-label", text: d.label })
      ]));
    });
  }

  function renderDocFilter(cards) {
    var sel = state.ui.docFilter;
    if (!sel) return;
    var titles = [];
    (cards || []).forEach(function (c) { if (c && c.docTitle && titles.indexOf(c.docTitle) < 0) titles.push(c.docTitle); });
    var cur = sel.value || "";
    clear(sel);
    sel.appendChild(h("option", { value: "", text: "全部资料" }));
    titles.forEach(function (t) { sel.appendChild(h("option", { value: t, text: t.length > 18 ? t.slice(0, 18) + "…" : t })); });
    // 保留原选择（若已不存在则回落"全部"）
    sel.value = titles.indexOf(cur) >= 0 ? cur : "";
  }

  function loadDue(all) {
    var rh = RH();
    if (!rh || !rh.storage) { toast("复习存储未加载", "error"); return Promise.resolve(); }
    var filterEl = state.ui.docFilter;
    var filter = filterEl && filterEl.value ? filterEl.value : "";
    var p = all
      ? (rh.storage.getAllCards ? rh.storage.getAllCards() : Promise.resolve([]))
      : (rh.storage.getDueCards ? rh.storage.getDueCards() : Promise.resolve([]));
    return Promise.resolve(p).then(function (cards) {
      if (!state) return;
      var list = (cards || []).map(function (c) {
        return { qid: c.qid, type: c.type, question: c.question, options: c.options, answer: c.answer,
          answerIndex: c.answerIndex, explanation: c.explanation, docTitle: c.docTitle };
      });
      if (filter) list = list.filter(function (c) { return c.docTitle === filter; });
      renderQuiz("review-due-list", list, { study: true });
    }).catch(function (err) { toastError(err, "读取复习卡片失败"); });
  }

  // ============================================================
  // 资料库
  // ============================================================
  function refreshLibrary() {
    var rh = RH();
    var box = state && state.ui && state.ui.libList;
    if (!box) return Promise.resolve();
    if (!rh || !rh.storage || typeof rh.storage.listDocs !== "function") {
      clear(box);
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(function () { return rh.storage.listDocs(); })
      .then(function (docs) {
        if (!state || state.ui.libList !== box) return;
        clear(box);
        docs = docs || [];
        if (!docs.length) {
          box.appendChild(emptyBlock("资料库为空", "上传资料后会在这里保存文档与源文件，可随时打开继续学习。", null));
          return;
        }
        docs.forEach(function (d) { box.appendChild(libraryRow(d)); });
      })
      .catch(function () { if (state && state.ui.libList === box) { clear(box); } });
  }

  function libraryRow(d) {
    var row = h("div", { class: "ca-review-lib-row" });
    var nPts = (d.sections || []).reduce(function (a, s) { return a + ((s.points || s.items || []).length); }, 0);
    row.appendChild(h("div", { class: "list-main" }, [
      h("div", { class: "list-title", text: d.title || "未命名文档" }),
      h("div", { class: "list-meta", text: fmtSmart(d.time) + " · " + (d.sections || []).length + " 章 · " + nPts + " 要点 · " + (d.quiz || []).length + " 题" })
    ]));
    var group = h("div", { class: "btn-group" });
    var openBtn = h("button", { class: "btn btn-sm", type: "button", text: "打开" });
    openBtn.addEventListener("click", function () { openDoc(d.title); });
    group.appendChild(openBtn);
    if (d.sourceBlob && typeof URL !== "undefined" && URL.createObjectURL) {
      var srcBtn = h("button", { class: "btn btn-sm", type: "button" }, [iconEl("download", 14), h("span", { text: "源文件" })]);
      srcBtn.addEventListener("click", function () { downloadSource(d); });
      group.appendChild(srcBtn);
    }
    var delBtn = h("button", { class: "btn btn-sm btn-ghost-danger", type: "button" }, [iconEl("trash", 14)]);
    delBtn.addEventListener("click", function () { deleteDoc(d.title); });
    group.appendChild(delBtn);
    row.appendChild(group);
    return row;
  }

  function openDoc(title) {
    var rh = RH();
    if (!rh || !rh.storage || typeof rh.storage.getDoc !== "function") return;
    Promise.resolve(rh.storage.getDoc(title)).then(function (rec) {
      if (!state || !rec) { if (!rec) toast("记录不存在", "error"); return; }
      state.D = {
        title: rec.title || title, engine: rec.engine || "", backend: rec.backend || "",
        overview: rec.overview || "", keywords: rec.keywords || [], terms: rec.terms || [],
        sections: rec.sections || [], quiz: rec.quiz || [],
        original_sections: rec.original_sections || [], sourceBlob: rec.sourceBlob || null,
        sourceName: rec.sourceName || "", sourceNames: rec.sourceNames || []
      };
      state.quizAnswered = {};
      renderResult();
      switchPane("points");
      toast("已打开「" + (rec.title || title) + "」", "success");
    }).catch(function (err) { toastError(err, "打开失败"); });
  }

  function deleteDoc(title) {
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm("删除「" + title + "」？学习记录会保留。")) return;
    var rh = RH();
    if (!rh || !rh.storage || typeof rh.storage.deleteDoc !== "function") return;
    Promise.resolve(rh.storage.deleteDoc(title)).then(function () {
      if (!state) return;
      if (state.D && state.D.title === title) { state.D = null; state.ui.result.hidden = true; }
      refreshLibrary();
      toast("已删除", "success");
    }).catch(function (err) { toastError(err, "删除失败"); });
  }

  function downloadSource(rec) {
    try {
      var blob = rec.sourceBlob;
      if (!blob) { toast("未保存源文件", "error"); return; }
      var url = URL.createObjectURL(blob);
      triggerDownload(url, rec.sourceName || (rec.title + ".bin"));
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { toastError(e, "下载失败"); }
  }

  function triggerDownload(url, filename) {
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    if (typeof a.click === "function") a.click();
    if (a.parentNode) a.parentNode.removeChild(a);
  }

  // 题库 JSON 导入（rh-quiz-v1：{title, questions:[...]} 或裸数组）
  function importQuizFile(file) {
    if (!file) return;
    if (typeof file.text !== "function") { toast("无法读取该文件", "error"); return; }
    Promise.resolve(file.text()).then(function (text) {
      var json = JSON.parse(text);
      var questions = json.questions || (Array.isArray(json) ? json : null);
      if (!questions || !questions.length) throw new Error("JSON 中没有 questions 数组");
      var title = json.title || stripExt(file.name);
      var D = {
        title: title, engine: "import", backend: "quiz-import",
        overview: "", keywords: [], terms: [], sections: [], quiz: questions,
        original_sections: [], sourceBlob: null, sourceName: file.name, sourceNames: [file.name]
      };
      state.D = D;
      state.quizAnswered = {};
      renderResult();
      switchPane("quiz");
      var rh = RH();
      if (rh && rh.storage && typeof rh.storage.saveDoc === "function") {
        try { rh.storage.saveDoc(title, { engine: D.engine, backend: D.backend, sections: [], quiz: questions, keywords: [], terms: [], overview: "", original_sections: [], markdown: "", sourceName: file.name }).then(function () { if (state) refreshLibrary(); }).catch(function () {}); } catch (e) { /* 忽略 */ }
      }
      toast("已导入 " + questions.length + " 道题", "success");
    }).catch(function (err) { toastError(err, "导入失败"); });
  }

  // ============================================================
  // 导出 Word（RH.exporter）
  // ============================================================
  function exportDoc() {
    var rh = RH();
    if (!state || !state.D) { toast("请先上传或打开一份资料", "info"); return; }
    if (!rh || !rh.exporter || typeof rh.exporter.docxBlob !== "function") { toast("导出模块未加载", "error"); return; }
    Promise.resolve(rh.exporter.docxBlob(state.D)).then(function (blob) {
      var url = URL.createObjectURL(blob);
      triggerDownload(url, (rh.exporter.filenameDocx ? rh.exporter.filenameDocx(state.D) : (state.D.title + "_复习要点.docx")));
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function (err) { toastError(err, "导出失败"); });
  }

  function exportQuiz() {
    var rh = RH();
    if (!state || !state.D || !(state.D.quiz || []).length) { toast("当前资料没有题目", "info"); return; }
    if (!rh || !rh.exporter || typeof rh.exporter.quizDocxBlob !== "function") { toast("导出模块未加载", "error"); return; }
    Promise.resolve(rh.exporter.quizDocxBlob(state.D)).then(function (blob) {
      var url = URL.createObjectURL(blob);
      triggerDownload(url, (rh.exporter.filenameQuizDocx ? rh.exporter.filenameQuizDocx(state.D) : (state.D.title + "_自测卷.docx")));
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function (err) { toastError(err, "导出失败"); });
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindEvents(ui) {
    // 选择文件
    if (ui.refs.pickBtn) ui.refs.pickBtn.addEventListener("click", function () { ui.refs.fileInput.click(); });
    if (ui.refs.fileInput) ui.refs.fileInput.addEventListener("change", function (ev) {
      var t = ev && ev.target ? ev.target : ui.refs.fileInput;
      handleFiles(t.files);
      try { t.value = ""; } catch (e) { /* 允许重复选择同一文件 */ }
    });

    // 拖放
    var drop = ui.refs.upload;
    if (drop && drop.addEventListener) {
      ["dragenter", "dragover"].forEach(function (t) {
        drop.addEventListener(t, function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); addClass(drop, "is-drag"); });
      });
      ["dragleave", "dragend"].forEach(function (t) {
        drop.addEventListener(t, function () { removeClass(drop, "is-drag"); });
      });
      drop.addEventListener("drop", function (ev) {
        removeClass(drop, "is-drag");
        if (ev && ev.preventDefault) ev.preventDefault();
        var dt = ev && ev.dataTransfer;
        if (dt && dt.files) handleFiles(dt.files);
      });
    }

    // 导出
    if (ui.exportDocx) ui.exportDocx.addEventListener("click", exportDoc);
    if (ui.exportQuiz) ui.exportQuiz.addEventListener("click", exportQuiz);

    // 复习：开始
    if (ui.startDue) ui.startDue.addEventListener("click", function () { loadDue(false); });
    if (ui.startAll) ui.startAll.addEventListener("click", function () { loadDue(true); });
    if (ui.docFilter) ui.docFilter.addEventListener("change", function () { loadDue(false); });

    // 题库导入
    if (ui.importBtn && ui.importInput) {
      ui.importBtn.addEventListener("click", function () { ui.importInput.click(); });
      ui.importInput.addEventListener("change", function (ev) {
        var t = ev && ev.target ? ev.target : ui.importInput;
        var f = t.files && t.files[0];
        importQuizFile(f);
        try { t.value = ""; } catch (e) { /* 忽略 */ }
      });
    }
  }

  // ============================================================
  // 生命周期
  // ============================================================
  function mount(rootEl) {
    if (!rootEl || typeof rootEl.appendChild !== "function") return;
    var token = ++mountToken;
    injectStyles();

    state = { root: rootEl, D: null, pane: "points", quizAnswered: {} };
    clear(rootEl);
    var ui = buildSkeleton(rootEl);
    state.ui = ui;

    bindEvents(ui);

    // 异步：资料库 / 复习统计；有历史文档时恢复最近一篇（便于直接进入资料库）
    return Promise.resolve()
      .then(function () { return refreshStudy(); })
      .then(function () { return refreshLibrary(); })
      .then(function () {
        if (token !== mountToken || !state) return;
        var rh = RH();
        if (state.D || !rh || !rh.storage || typeof rh.storage.listDocs !== "function") return;
        return Promise.resolve(rh.storage.listDocs()).then(function (docs) {
          if (token !== mountToken || !state || state.D) return;
          if (docs && docs.length) openDoc(docs[0].title);
        });
      })
      .catch(function () { /* 启动期失败不阻断视图（app.js 会因 reject 清空视图） */ });
  }

  function unmount() {
    mountToken++;
    state = null;
  }

  // ============================================================
  // 对外
  // ============================================================
  CA.views = CA.views || {};
  CA.views.review = { mount: mount, unmount: unmount };
})();
