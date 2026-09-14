// 通知 / 资料分发模块（Agent N · UI 重构）
// 契约依据：CONTRACT.md §3 数据模型、§6.3 DOM id、§7 模块接口、§8 ai.js 契约
// 设计依据：DESIGN.md §4 组件类名、§5 图标（禁止 emoji）、§6 时间规则（禁止 ISO 直出）
// 暴露：CA.views.notices = { mount(rootEl), unmount() }
// 零依赖 · IIFE · 中文注释 · ES2017
window.CA = window.CA || {};
CA.views = CA.views || {};

CA.views.notices = (function () {
  "use strict";

  // ================= 常量 =================
  var CATEGORIES = ["考试安排", "作业信息", "活动信息", "班级通知", "其他"];
  var TIME_LABELS = ["考试时间", "截止时间", "报名截止", "活动时间", "相关时间"];
  var SOON_MS = 3 * 24 * 60 * 60 * 1000; // 距截止 3 天内视为「临近截止」

  // ================= 模块状态 =================
  var rootEl = null;                 // mount 传入的视图容器
  var state = {
    activeCat: "全部",               // 当前分类筛选
    detailId: null,                  // 详情面板展示的通知 id
    editingId: null,                 // 正在编辑的通知 id（null=新建）
    formOpen: false,                 // 表单是否展开
    aiBusy: false,                   // AI 解析进行中
  };

  // ================= 通用小工具 =================
  // 局部 HTML 转义（防 XSS）：凡经 innerHTML 注入的动态文本，必须先过此函数
  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 创建元素：h("div", { class:"x", text:"hi" }) / h("span", {}, "文本")
  function h(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "dataset") {
          for (var dk in attrs[k]) node.dataset[dk] = attrs[k][dk];
        } else {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (text != null) node.textContent = text;
    return node;
  }

  // 清空子节点（不用 innerHTML，避免依赖 HTML 解析）
  function clear(node) {
    while (node && node.children && node.children.length) {
      node.removeChild(node.children[0]);
    }
  }

  // ================= 图标（DESIGN.md §5，禁止 emoji） =================
  // 统一封装 CA.iconEl / CA.icon；两者都不可用时退化为带 .icon 钩子的占位 span（不抛错）
  function iconNode(name, size) {
    if (CA.iconEl) {
      try {
        var el = CA.iconEl(name, size);
        if (el) return el;
      } catch (e) { /* 图标系统异常不阻断渲染 */ }
    }
    if (CA.icon) {
      try {
        var holder = document.createElement("span");
        holder.innerHTML = CA.icon(name, size);
        if (holder.firstChild) return holder.firstChild;
      } catch (e2) { /* 同上 */ }
    }
    var span = h("span", { class: "icon" });
    span.setAttribute("data-icon", name || "");
    return span;
  }

  // ================= 时间（DESIGN.md §6.1，禁止 ISO 直出） =================
  // 优先 CA.util；测试/单测环境缺 CA.util 时退回本地等价实现
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function toDate(v) {
    if (v == null || v === "") return null;
    var d = (v instanceof Date) ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function localFmtSmart(v) {
    var d = toDate(v);
    if (!d) return "";
    var n = new Date();
    var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var n0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var diffDays = Math.round((d0 - n0) / 86400000);
    var hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    if (diffDays === 0) return "今天 " + hm;
    if (diffDays === 1) return "明天 " + hm;
    if (diffDays === -1) return "昨天 " + hm;
    if (d.getFullYear() === n.getFullYear()) return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + hm;
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function localFmtRange(a, b) {
    var da = toDate(a), db = toDate(b);
    if (!da) return "";
    if (!db) return localFmtSmart(a);
    var sameDay = da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
    return localFmtSmart(a) + " ~ " + (sameDay ? (pad2(db.getHours()) + ":" + pad2(db.getMinutes())) : localFmtSmart(b));
  }
  function fmtSmartV(v) {
    if (CA.util && typeof CA.util.fmtSmart === "function") return CA.util.fmtSmart(v);
    return localFmtSmart(v);
  }
  function fmtRangeV(a, b) {
    if (CA.util && typeof CA.util.fmtRange === "function") return CA.util.fmtRange(a, b);
    return localFmtRange(a, b);
  }

  // 字节大小格式化
  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  // 截止时间是否临近（未过期且 3 天内）
  function isDeadlineSoon(deadline) {
    if (!deadline) return false;
    var t = Date.parse(deadline);
    if (isNaN(t)) return false;
    var diff = t - Date.now();
    return diff >= 0 && diff <= SOON_MS;
  }

  // 通知时间展示（区间用 fmtRange，单点用 fmtSmart；绝不输出原始 ISO）
  function noticeTimeText(n) {
    var label = n.timeLabel || "时间";
    var hasA = !!n.deadline, hasB = !!n.endTime;
    if (hasA && hasB) return label + " " + fmtRangeV(n.deadline, n.endTime);
    if (hasA) return label + " " + fmtSmartV(n.deadline);
    if (hasB) return label + " " + fmtSmartV(n.endTime);
    return "";
  }

  // 附件类型徽标：按扩展名归类
  function attType(name) {
    var ext = String(name || "").split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].indexOf(ext) >= 0) return { key: "img", label: "图片" };
    if (["xls", "xlsx", "csv"].indexOf(ext) >= 0) return { key: "sheet", label: "表格" };
    if (["ppt", "pptx"].indexOf(ext) >= 0) return { key: "slide", label: "演示" };
    if (["zip", "rar", "7z", "tar", "gz"].indexOf(ext) >= 0) return { key: "zip", label: "压缩包" };
    if (ext === "pdf") return { key: "pdf", label: "PDF" };
    if (["doc", "docx", "txt", "md"].indexOf(ext) >= 0) return { key: "doc", label: "文档" };
    return { key: "file", label: "文件" };
  }

  // 向上查找带指定 data-* 的祖先（浏览器 / 测试桩通用）
  function closestData(node, key) {
    while (node) {
      if (node.dataset && node.dataset[key] != null) return node;
      node = node.parentNode;
    }
    return null;
  }

  // 由 userId 取展示名（发布人）
  function userName(id) {
    var list = (CA.auth && CA.auth.list) ? (CA.auth.list() || []) : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].name || "";
    }
    return "";
  }

  // ================= 渲染小构件（DESIGN.md §4） =================
  // 徽标：badge(cls, iconName, text)
  function badge(cls, iconName, text) {
    var b = h("span", { class: "badge" + (cls ? " " + cls : "") });
    if (iconName) b.appendChild(iconNode(iconName, 13));
    if (text) b.appendChild(h("span", { text: text }));
    return b;
  }

  // 元信息项：图标 + 文本
  function metaItem(iconName, text, extraClass) {
    var s = h("span", { class: "meta-item" + (extraClass ? " " + extraClass : "") });
    if (iconName) s.appendChild(iconNode(iconName, 14));
    s.appendChild(h("span", { text: text }));
    return s;
  }

  // ================= 空态插画（几何线条风，~120px，DESIGN §4.10） =================
  var EMPTY_ART = {
    bell:
      '<circle class="ea-soft" cx="88" cy="34" r="14"/>' +
      '<circle class="ea-soft" cx="26" cy="90" r="7"/>' +
      '<rect class="ea-plate" x="20" y="28" width="52" height="38" rx="10"/>' +
      '<path class="ea-line" d="M32 44h28M32 54h20"/>' +
      '<path class="ea-accent" d="M72 56c-9 0-14 6.5-14 15 0 7-2.5 10-5 12.5h38c-2.5-2.5-5-5.5-5-12.5 0-8.5-5-15-14-15z"/>' +
      '<path class="ea-accent" d="M66.5 88a5.5 5.5 0 0 0 11 0"/>' +
      '<path class="ea-accent" d="M72 51v4.5"/>',
    clipboard:
      '<circle class="ea-soft" cx="88" cy="32" r="13"/>' +
      '<rect class="ea-plate" x="30" y="26" width="56" height="70" rx="12"/>' +
      '<rect class="ea-clip" x="49" y="19" width="18" height="13" rx="6"/>' +
      '<circle class="ea-accent" cx="45" cy="50" r="5"/><path class="ea-accent" d="M43 50l1.7 1.7 3-3.3"/><path class="ea-dash" d="M58 50h17"/>' +
      '<circle class="ea-accent" cx="45" cy="68" r="5"/><path class="ea-accent" d="M43 68l1.7 1.7 3-3.3"/><path class="ea-dash" d="M58 68h17"/>' +
      '<circle class="ea-soft" cx="45" cy="84" r="5"/><path class="ea-dash" d="M58 84h17"/>'
  };

  function emptyArtSvg(name) {
    var body = EMPTY_ART[name] || EMPTY_ART.bell;
    return '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">' + body + "</svg>";
  }

  // 空态：.empty > .empty-art + .empty-title + .empty-desc
  function emptyState(artName, title, desc) {
    var e = h("div", { class: "empty" });
    var art = h("div", { class: "empty-art" });
    art.innerHTML = emptyArtSvg(artName);
    e.appendChild(art);
    e.appendChild(h("div", { class: "empty-title", text: title }));
    if (desc) e.appendChild(h("p", { class: "empty-desc", text: desc }));
    return e;
  }

  // 列表入场 stagger：优先复用 app.js 的 enter，缺失时本地降级
  function stagger(box) {
    if (CA.app && typeof CA.app.enter === "function") { CA.app.enter(box); return; }
    if (!box || !box.classList) return;
    box.classList.remove("ca-enter");
    void box.offsetWidth;
    box.classList.add("ca-enter");
    if (box.__enterT) clearTimeout(box.__enterT);
    box.__enterT = setTimeout(function () { if (box.classList) box.classList.remove("ca-enter"); }, 820);
  }

  // ================= 权限 =================
  function currentUser() {
    return (CA.auth && CA.auth.current) ? CA.auth.current() : null;
  }

  function canPublish() {
    return !!(CA.auth && CA.auth.can && CA.auth.can("notice.publish"));
  }

  // 编辑/删除统一权限判定：
  //  - superAdmin（notice.manageAll）→ 可管理全部
  //  - admin → 仅自己发布的（且拥有发布权）
  function canManage(notice) {
    if (!CA.auth || !CA.auth.can) return false;
    if (CA.auth.can("notice.manageAll")) return true;
    var u = currentUser();
    return !!(u && notice && notice.publisherId === u.id && CA.auth.can("notice.publish"));
  }

  // ================= 收藏 =================
  function favRecordsOf(noticeId) {
    var u = currentUser();
    if (!u) return [];
    return CA.store.query("favorites", function (f) {
      return f.userId === u.id && f.noticeId === noticeId;
    });
  }

  function isFav(noticeId) {
    return favRecordsOf(noticeId).length > 0;
  }

  function toggleFav(noticeId) {
    var u = currentUser();
    if (!u) { CA.app.toast("请先选择身份"); return; }
    var recs = favRecordsOf(noticeId);
    if (recs.length) CA.store.remove("favorites", recs[0].id);
    else CA.store.add("favorites", { userId: u.id, noticeId: noticeId });
    renderList();   // 列表收藏态同步
    renderDetail(); // 详情收藏态同步
  }

  // ================= 排序 / 筛选 =================
  // 置顶优先，其次按创建时间倒序
  function sortForList(list) {
    return list.slice().sort(function (a, b) {
      var pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      var ta = Date.parse(a.createdAt || "") || 0;
      var tb = Date.parse(b.createdAt || "") || 0;
      return tb - ta;
    });
  }

  // ================= 骨架渲染（只执行一次） =================
  function renderShell() {
    clear(rootEl);
    var stack = h("div", { class: "stack" });

    // ---- 工具栏卡片：标题 + 发布按钮 ----
    var toolbar = h("div", { class: "card notices-toolbar" });
    var thead = h("div", { class: "card-head" });
    var ttitle = h("div", { class: "card-title" });
    ttitle.appendChild(iconNode("bell", 18));
    ttitle.appendChild(h("span", { text: "通知与资料" }));
    thead.appendChild(ttitle);

    var btnNew = h("button", { id: "btn-notice-new", class: "btn btn-primary", type: "button" });
    btnNew.appendChild(iconNode("plus", 16));
    btnNew.appendChild(h("span", { text: "发布通知" }));
    thead.appendChild(btnNew);
    toolbar.appendChild(thead);
    stack.appendChild(toolbar);

    // ---- AI 一句话草稿卡片（#ai-parse-wrap 整块显隐）----
    var aiWrap = h("div", { id: "ai-parse-wrap", class: "card ai-parse" });
    var aiHead = h("div", { class: "card-head" });
    var aiTitle = h("div", { class: "card-title" });
    aiTitle.appendChild(iconNode("sparkles", 18));
    aiTitle.appendChild(h("span", { text: "AI 一句话草稿" }));
    aiHead.appendChild(aiTitle);
    aiHead.appendChild(badge("badge-ai", null, "AI"));
    aiWrap.appendChild(aiHead);

    var aiInput = h("textarea", {
      id: "ai-parse-input",
      class: "input",
      rows: "2",
      placeholder: "一句话描述（例：下周三 15:00 报告厅开家长会，请带成绩单）",
    });
    aiWrap.appendChild(aiInput);

    var aiFoot = h("div", { class: "row-between" });
    var aiHint = h("div", { id: "ai-parse-hint", class: "field-hint", text: "描述后点击右侧按钮，AI 会生成结构化草稿供你核对。" });
    var aiBtn = h("button", { id: "btn-ai-parse", class: "btn btn-ai", type: "button" });
    aiBtn.appendChild(iconNode("sparkles", 16));
    aiBtn.appendChild(h("span", { class: "btn-label", text: "AI 生成草稿" }));
    aiFoot.appendChild(aiHint);
    aiFoot.appendChild(aiBtn);
    aiWrap.appendChild(aiFoot);
    stack.appendChild(aiWrap);

    // ---- 分类筛选：分段控件 ----
    var filters = h("div", { id: "notices-filters", class: "segmented" });
    stack.appendChild(filters);

    // ---- 列表 / 详情 / 表单 ----
    var list = h("div", { id: "notices-list", class: "card-list" });
    var detail = h("div", { id: "notice-detail" });
    var form = buildForm();
    stack.appendChild(list);
    stack.appendChild(detail);
    stack.appendChild(form);

    rootEl.appendChild(stack);

    // ---- 事件绑定（全部挂在 root 内元素上，随 DOM 移除自动回收）----
    btnNew.addEventListener("click", onCreateClick);
    aiBtn.addEventListener("click", onAiClick);

    // 分类筛选：委托
    filters.addEventListener("click", function (e) {
      var btn = closestData(e.target || e.srcElement, "cat");
      if (!btn) return;
      state.activeCat = btn.dataset.cat;
      renderFilters();
      renderList();
      stagger(list);
    });

    // 列表点击 → 详情：委托
    list.addEventListener("click", function (e) {
      var item = closestData(e.target || e.srcElement, "noticeId");
      if (!item) return;
      state.detailId = item.dataset.noticeId;
      renderList();    // 更新选中态
      renderDetail();
    });

    // 详情操作：委托（收藏 / 编辑 / 删除 / 附件下载提示）
    detail.addEventListener("click", function (e) {
      var act = closestData(e.target || e.srcElement, "action");
      if (!act) return;
      var action = act.dataset.action;
      var id = state.detailId;
      if (action === "fav") toggleFav(id);
      else if (action === "edit") openEditForm(id);
      else if (action === "delete") handleDelete(id);
      else if (action === "attach") CA.app.toast("演示环境不支持真实下载", "info");
    });

    // 表单提交 / 取消
    form.addEventListener("submit", handleSubmit);
    var cancel = form.querySelector("#btn-notice-cancel");
    if (cancel) cancel.addEventListener("click", function () { closeForm(); });
  }

  // ================= 表单 =================
  // 带 .input 统一样式的下拉
  function selectInput(name, options, def) {
    var s = h("select", { name: name, class: "input" });
    for (var i = 0; i < options.length; i++) {
      var val = options[i];
      var opt = h("option", { value: val }, val || "—");
      if (val === def) opt.selected = true;
      s.appendChild(opt);
    }
    s.value = def;
    return s;
  }

  // .form-grid > .form-field > .label (+ .req) + 控件
  function formField(labelText, inputEl, opts) {
    opts = opts || {};
    var wrap = h("div", { class: "form-field" + (opts.span2 ? " span-2" : "") });
    var lbl = h("label", { class: "label", text: labelText });
    if (opts.required) lbl.appendChild(h("span", { class: "req", text: " *" }));
    wrap.appendChild(lbl);
    wrap.appendChild(inputEl);
    if (opts.hint) wrap.appendChild(h("div", { class: "field-hint", text: opts.hint }));
    return wrap;
  }

  // 复选框字段：.label + .row > input + 说明
  function checkField(labelText, inputEl, hintText) {
    var wrap = h("div", { class: "form-field" });
    wrap.appendChild(h("label", { class: "label", text: labelText }));
    var row = h("label", { class: "row" });
    row.appendChild(inputEl);
    row.appendChild(h("span", { class: "muted", text: hintText || "启用" }));
    wrap.appendChild(row);
    return wrap;
  }

  function buildForm() {
    var form = h("form", { id: "notice-form", class: "card notice-form" });
    form.hidden = true;

    var head = h("div", { class: "card-head" });
    head.appendChild(h("div", { class: "card-title form-heading", text: "发布通知" }));
    form.appendChild(head);

    var grid = h("div", { class: "form-grid" });

    var title = h("input", { name: "title", class: "input", type: "text", placeholder: "通知标题", maxlength: "60" });
    var category = selectInput("category", CATEGORIES, "班级通知");
    var timeLabel = selectInput("timeLabel", [""].concat(TIME_LABELS), "");
    var deadline = h("input", { name: "deadline", class: "input", type: "text", placeholder: "如 2026-06-20 18:00" });
    var endTime = h("input", { name: "endTime", class: "input", type: "text", placeholder: "如 2026-06-20 20:00" });
    var location = h("input", { name: "location", class: "input", type: "text", placeholder: "地点" });
    var course = h("input", { name: "course", class: "input", type: "text", placeholder: "课程（可选）" });
    var content = h("textarea", { name: "content", class: "input", rows: "5", placeholder: "通知正文" });
    var pinned = h("input", { name: "pinned", type: "checkbox" });
    var important = h("input", { name: "important", type: "checkbox" });

    grid.appendChild(formField("标题", title, { required: true, span2: true }));
    grid.appendChild(formField("分类", category));
    grid.appendChild(formField("时间标签", timeLabel, { hint: "可选，用于说明下方时间的含义" }));
    grid.appendChild(formField("截止时间", deadline));
    grid.appendChild(formField("结束时间", endTime));
    grid.appendChild(formField("地点", location));
    grid.appendChild(formField("课程", course));
    grid.appendChild(formField("正文", content, { span2: true }));
    grid.appendChild(checkField("置顶", pinned, "发布后置顶显示"));
    grid.appendChild(checkField("重要", important, "标记为重要通知"));
    form.appendChild(grid);

    var actions = h("div", { class: "form-actions" });
    actions.appendChild(h("button", { id: "btn-notice-cancel", class: "btn", type: "button" }, "取消"));
    actions.appendChild(h("button", { id: "btn-notice-save", class: "btn btn-primary", type: "submit" }, "保存"));
    form.appendChild(actions);

    return form;
  }

  function setField(scope, name, val) {
    var el = scope.querySelector('[name="' + name + '"]');
    if (el && val != null) el.value = val;
  }

  function setChecked(scope, name, val) {
    var el = scope.querySelector('[name="' + name + '"]');
    if (el) el.checked = !!val;
  }

  // 渲染表单：显隐 + 标题 + 回填（state.editingId 决定编辑/新建）
  function renderForm() {
    var form = rootEl.querySelector("#notice-form");
    if (!form) return;
    var open = state.formOpen && canPublish();
    form.hidden = !open;
    var heading = form.querySelector(".form-heading");
    if (heading) heading.textContent = state.editingId ? "编辑通知" : "发布通知";

    var src = state.editingId ? CA.store.find("notices", state.editingId) : null;
    setField(form, "title", src ? src.title : "");
    setField(form, "category", src ? src.category : "班级通知");
    setField(form, "timeLabel", src ? src.timeLabel : "");
    setField(form, "deadline", src ? src.deadline : "");
    setField(form, "endTime", src ? src.endTime : "");
    setField(form, "location", src ? src.location : "");
    setField(form, "course", src ? src.course : "");
    setField(form, "content", src ? src.content : "");
    setChecked(form, "pinned", src ? src.pinned : false);
    setChecked(form, "important", src ? src.important : false);
  }

  // 从表单收集数据（字段对齐数据模型，附件/链接由发布时补默认空数组）
  function collectForm() {
    var f = rootEl.querySelector("#notice-form");
    if (!f) return null;
    var val = function (name) { var e = f.querySelector('[name="' + name + '"]'); return e ? String(e.value || "") : ""; };
    var chk = function (name) { var e = f.querySelector('[name="' + name + '"]'); return !!(e && e.checked); };
    return {
      title: val("title").trim(),
      category: val("category") || "其他",
      content: val("content"),
      timeLabel: val("timeLabel"),
      deadline: val("deadline"),
      endTime: val("endTime"),
      location: val("location"),
      course: val("course"),
      pinned: chk("pinned"),
      important: chk("important"),
    };
  }

  // ================= 筛选与列表 =================
  function renderFilters() {
    var wrap = rootEl.querySelector("#notices-filters");
    if (!wrap) return;
    clear(wrap);
    var all = CA.store.get("notices");
    var cats = ["全部"].concat(CATEGORIES);
    cats.forEach(function (cat) {
      var count = cat === "全部"
        ? all.length
        : all.filter(function (n) { return n.category === cat; }).length;
      var b = h("button", { class: "seg-item" + (state.activeCat === cat ? " active" : ""), type: "button" });
      b.dataset.cat = cat;
      b.appendChild(h("span", { class: "filter-name", text: cat }));
      b.appendChild(h("span", { class: "filter-count", text: String(count) }));
      wrap.appendChild(b);
    });
  }

  // 列表项：.card-list > .list-row
  function buildListItem(n) {
    var soon = isDeadlineSoon(n.deadline);
    var item = h("div", { class: "list-row" });
    item.dataset.noticeId = n.id;
    item.dataset.cat = n.category || "";
    if (state.detailId === n.id) item.className += " is-active";

    var main = h("div", { class: "list-main" });

    // 徽标行：重要 / 置顶 / 分类 / 收藏
    var badges = h("div", { class: "row" });
    if (n.important) badges.appendChild(badge("badge-important", "alert", "重要"));
    if (n.pinned) badges.appendChild(badge("badge-pinned", "pin", "置顶"));
    if (n.category) badges.appendChild(badge("badge-cat", null, n.category));
    if (isFav(n.id)) {
      var fav = badge("fav-star", "star-filled", null);
      fav.title = "已收藏";
      badges.appendChild(fav);
    }
    if (badges.children.length) main.appendChild(badges);

    // 标题
    main.appendChild(h("div", { class: "notice-title", text: n.title || "（无标题）" }));

    // 元信息：时间 / 地点 / 课程 / 附件 / 临近截止
    var meta = h("div", { class: "notice-meta row" });
    var tt = noticeTimeText(n);
    if (tt) meta.appendChild(metaItem("clock", tt));
    if (n.location) meta.appendChild(metaItem("map-pin", n.location));
    if (n.course) meta.appendChild(metaItem("book", n.course));

    var atts = n.attachments || [];
    if (atts.length) {
      var att = h("span", { class: "meta-item" });
      att.appendChild(iconNode("paperclip", 14));
      att.appendChild(h("span", { class: "att-count", text: atts.length + " 个附件" }));
      meta.appendChild(att);
    }

    if (soon) {
      var chip = h("span", { class: "chip" });
      chip.appendChild(iconNode("clock", 13));
      chip.appendChild(h("span", { text: "临近截止" }));
      meta.appendChild(chip);
    }

    if (meta.children.length) main.appendChild(meta);
    item.appendChild(main);
    return item;
  }

  function renderList() {
    var box = rootEl.querySelector("#notices-list");
    if (!box) return;
    clear(box);
    var all = CA.store.get("notices");
    var filtered = state.activeCat === "全部"
      ? all
      : all.filter(function (n) { return n.category === state.activeCat; });
    var sorted = sortForList(filtered);
    if (!sorted.length) {
      box.appendChild(emptyState("bell", "暂无通知", "当前分类下还没有通知，发布后可在这里查看。"));
      return;
    }
    sorted.forEach(function (n) {
      box.appendChild(buildListItem(n));
    });
  }

  // ================= 详情 =================
  function renderDetail() {
    var box = rootEl.querySelector("#notice-detail");
    if (!box) return;
    clear(box);
    var n = state.detailId ? CA.store.find("notices", state.detailId) : null;
    if (!n) {
      box.appendChild(emptyState("clipboard", "未选择通知", "从上方列表选择一条通知，这里会显示完整内容与附件。"));
      return;
    }

    var wrap = h("div", { class: "stack" });

    // ---- 头部卡片：徽标 + 标题 + 元信息 + 操作 ----
    var head = h("div", { class: "card" });
    var badges = h("div", { class: "row" });
    if (n.important) badges.appendChild(badge("badge-important", "alert", "重要"));
    if (n.pinned) badges.appendChild(badge("badge-pinned", "pin", "置顶"));
    if (n.category) badges.appendChild(badge("badge-cat", null, n.category));
    head.appendChild(badges);
    head.appendChild(h("h3", { class: "detail-title", text: n.title || "（无标题）" }));

    var meta = h("div", { class: "detail-meta row" });
    var tt = noticeTimeText(n);
    if (tt) meta.appendChild(metaItem("clock", tt));
    if (n.location) meta.appendChild(metaItem("map-pin", n.location));
    if (n.course) meta.appendChild(metaItem("book", n.course));
    var pub = userName(n.publisherId);
    if (pub) meta.appendChild(metaItem("user", "发布人：" + pub));
    if (meta.children.length) head.appendChild(meta);

    // 操作区：收藏（所有人）；编辑/删除（可管理）
    var actions = h("div", { class: "detail-actions row" });
    var fav = isFav(n.id);
    var favBtn = h("button", { id: "notice-fav-btn", class: "btn btn-ghost", type: "button", title: fav ? "取消收藏" : "收藏" });
    favBtn.dataset.action = "fav";
    favBtn.dataset.fav = fav ? "1" : "0";
    if (fav) favBtn.className += " is-fav";
    favBtn.appendChild(iconNode(fav ? "star-filled" : "star", 16));
    favBtn.appendChild(h("span", { text: fav ? "已收藏" : "收藏" }));
    actions.appendChild(favBtn);

    if (canManage(n)) {
      var editBtn = h("button", { class: "btn btn-icon", type: "button", title: "编辑" });
      editBtn.dataset.action = "edit";
      editBtn.appendChild(iconNode("edit", 16));
      editBtn.appendChild(h("span", { class: "sr-only", text: "编辑" }));
      actions.appendChild(editBtn);

      var delBtn = h("button", { class: "btn btn-icon btn-danger", type: "button", title: "删除" });
      delBtn.dataset.action = "delete";
      delBtn.appendChild(iconNode("trash", 16));
      delBtn.appendChild(h("span", { class: "sr-only", text: "删除" }));
      actions.appendChild(delBtn);
    }
    head.appendChild(actions);
    wrap.appendChild(head);

    // ---- 正文卡片 ----
    var contentCard = h("div", { class: "card" });
    contentCard.appendChild(h("div", { class: "card-title", text: "通知正文" }));
    var content = h("div", { class: "detail-content" });
    content.innerHTML = escapeHtml(n.content || "—").replace(/\n/g, "<br>");
    contentCard.appendChild(content);
    wrap.appendChild(contentCard);

    // ---- 附件卡片：.attach 胶囊 ----
    var atts = n.attachments || [];
    if (atts.length) {
      var aw = h("div", { class: "card" });
      aw.appendChild(h("div", { class: "card-title", text: "附件" }));
      var alist = h("div", { class: "row" });
      atts.forEach(function (a) {
        var t = attType(a.name);
        var row = h("button", { class: "attach", type: "button" });
        row.dataset.action = "attach";
        row.appendChild(iconNode("paperclip", 14));
        row.appendChild(h("span", { class: "att-name", text: a.name }));
        row.appendChild(badge("badge-muted", null, t.label));
        row.appendChild(h("span", { class: "att-size", text: fmtSize(a.size) }));
        alist.appendChild(row);
      });
      aw.appendChild(alist);
      wrap.appendChild(aw);
    }

    // ---- 链接卡片 ----
    var links = n.links || [];
    if (links.length) {
      var lw = h("div", { class: "card" });
      lw.appendChild(h("div", { class: "card-title", text: "相关链接" }));
      var lrow = h("div", { class: "row" });
      links.forEach(function (l) {
        var a = h("a", { class: "attach", href: l.url, target: "_blank", rel: "noopener noreferrer" });
        a.appendChild(iconNode("link", 14));
        a.appendChild(h("span", { text: l.title || l.url }));
        lrow.appendChild(a);
      });
      lw.appendChild(lrow);
      wrap.appendChild(lw);
    }

    box.appendChild(wrap);
  }

  // ================= 交互处理 =================
  function onCreateClick() {
    if (!canPublish()) { CA.app.toast("无发布权限"); return; }
    state.editingId = null;
    state.formOpen = true;
    renderForm();
    var input = rootEl.querySelector('[name="title"]');
    if (input && input.focus) input.focus();
  }

  function openEditForm(id) {
    var n = CA.store.find("notices", id);
    if (!n) return;
    if (!canPublish()) { CA.app.toast("无编辑权限"); return; }
    if (!canManage(n)) { CA.app.toast("只能编辑自己发布的通知"); return; }
    state.editingId = id;
    state.formOpen = true;
    renderForm();
  }

  function closeForm() {
    state.formOpen = false;
    state.editingId = null;
    renderForm();
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    var data = collectForm();
    if (!data) return;
    if (!data.title) { CA.app.toast("请填写标题"); return; }

    if (state.editingId) {
      var exist = CA.store.find("notices", state.editingId);
      if (!canManage(exist)) { CA.app.toast("无权编辑该通知"); return; }
      CA.store.update("notices", state.editingId, data);
      CA.app.toast("已更新通知", "success");
    } else {
      if (!canPublish()) { CA.app.toast("无发布权限"); return; }
      var u = currentUser() || {};
      var payload = {};
      for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k]; }
      payload.attachments = [];
      payload.links = [];
      payload.publisherId = u.id;
      CA.store.add("notices", payload);
      CA.app.toast("已发布通知", "success");
    }

    state.formOpen = false;
    state.editingId = null;
    renderFilters();
    renderList();
    renderDetail();
    renderForm();
  }

  function handleDelete(id) {
    var n = CA.store.find("notices", id);
    if (!n) return;
    if (!canManage(n)) { CA.app.toast("只能删除自己发布的通知"); return; }
    var ok = true;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      ok = window.confirm("确认删除该通知？");
    }
    if (!ok) return;
    CA.store.remove("notices", id);
    if (state.detailId === id) state.detailId = null;
    CA.app.toast("已删除通知", "success");
    renderFilters();
    renderList();
    renderDetail();
  }

  // ---- AI 一句话草稿 ----
  function setAiBusy(busy) {
    state.aiBusy = !!busy;
    var btn = rootEl.querySelector("#btn-ai-parse");
    if (!btn) return;
    btn.disabled = !!busy;
    btn.className = busy ? "btn btn-ai is-loading" : "btn btn-ai";
    var label = btn.querySelector(".btn-label");
    if (label) label.textContent = busy ? "生成中…" : "AI 生成草稿";
  }

  function applyDraft(draft) {
    if (!draft || !canPublish()) return;
    if (!state.formOpen) { state.editingId = null; state.formOpen = true; }
    renderForm();
    var form = rootEl.querySelector("#notice-form");
    if (!form) return;

    if (draft.title != null) setField(form, "title", draft.title);
    if (draft.category && CATEGORIES.indexOf(draft.category) >= 0) setField(form, "category", draft.category);
    if (draft.timeLabel && TIME_LABELS.indexOf(draft.timeLabel) >= 0) setField(form, "timeLabel", draft.timeLabel);
    if (draft.deadline != null) setField(form, "deadline", draft.deadline);
    if (draft.endTime != null) setField(form, "endTime", draft.endTime);
    if (draft.location != null) setField(form, "location", draft.location);
    if (draft.course != null) setField(form, "course", draft.course);
    if (draft.content != null) setField(form, "content", draft.content);
    if (draft.important != null) setChecked(form, "important", !!draft.important);

    var hint = rootEl.querySelector("#ai-parse-hint");
    if (hint) {
      var warns = draft.warnings || [];
      hint.textContent = warns.length ? ("提示：" + warns.join("；")) : "草稿已生成，请核对内容后发布";
    }
  }

  function onAiClick() {
    if (state.aiBusy) return;
    var input = rootEl.querySelector("#ai-parse-input");
    var text = input ? String(input.value || "").trim() : "";
    if (!text) { CA.app.toast("请先输入一句话描述"); return; }
    if (!(CA.ai && CA.ai.enabled && CA.ai.enabled())) { CA.app.toast("AI 助手未开启"); return; }

    setAiBusy(true);

    var p;
    try {
      p = CA.ai.parseNotice(text);
    } catch (err) {
      CA.app.toast((err && err.message) || "AI 解析失败");
      setAiBusy(false);
      return;
    }

    Promise.resolve(p)
      .then(function (draft) {
        applyDraft(draft);
        CA.app.toast("已生成草稿，请核对后发布", "success");
      })
      .catch(function (err) {
        CA.app.toast((err && err.message) || "AI 解析失败");
      })
      .then(function () { setAiBusy(false); });
  }

  // ================= 权限相关的可见性 =================
  function renderPermission() {
    var btnNew = rootEl.querySelector("#btn-notice-new");
    if (btnNew) btnNew.hidden = !canPublish();
    var aiWrap = rootEl.querySelector("#ai-parse-wrap");
    var aiOn = !!(CA.ai && CA.ai.enabled && CA.ai.enabled());
    if (aiWrap) aiWrap.hidden = !(canPublish() && aiOn);
  }

  // ================= 渲染总入口 =================
  function renderAll() {
    if (!canPublish()) {
      state.formOpen = false;
      state.editingId = null;
    }
    renderFilters();
    renderList();
    renderDetail();
    renderForm();
    renderPermission();
  }

  // ================= 生命周期 =================
  function mount(root) {
    rootEl = root;
    state.activeCat = "全部";
    state.detailId = null;
    state.editingId = null;
    state.formOpen = false;
    state.aiBusy = false;
    renderShell();
    renderAll();
  }

  function unmount() {
    if (rootEl) clear(rootEl);
    rootEl = null;
  }

  // 仅暴露契约要求的接口
  return { mount: mount, unmount: unmount };
})();
