// messages.js —— 留言（学生给老师留言 / 老师查看全部并回复）
// 角色：学生（写留言 + 看自己的留言与老师回复）；老师 / 管理员（看全部、标记已读、逐条回复）。
// 契约依据：CONTRACT.md §6.3 DOM id、§7 模块接口；DESIGN.md v4.1 组件类名 / §5 图标（禁 emoji）/ §10 角色差异化
// 数据层：CA.store 走 CloudBase PG（返回 Promise），除 memberName/settings/uid 外一律 await；
//         CA.auth.current() 异步，isAdmin() 同步（读角色缓存）。
// 权限：messages 表 RLS（迁移 20260914210000_add_messages.sql）——
//         select：本人或管理员；insert：本人；update/delete：本人或管理员。
// 对外：CA.views.messages = { mount, unmount }
// 依赖：CA.store / CA.auth / CA.util / CA.icon / CA.app（均为契约接口，缺失时安全降级）
window.CA = window.CA || {};

(function () {
  "use strict";

  // ============================================================
  // 基础工具
  // ============================================================
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg, type) {
    try { if (CA.app && typeof CA.app.toast === "function") CA.app.toast(msg, type); } catch (e) { /* 忽略 */ }
  }

  function toastError(err, fallback) {
    toast((err && err.message) || fallback || "操作失败", "error");
  }

  function errMsg(e) { return (e && e.message) || "操作失败"; }

  function fmtSmart(v) {
    try {
      if (CA.util && typeof CA.util.fmtSmart === "function") return CA.util.fmtSmart(v) || "—";
    } catch (e) { /* 忽略 */ }
    return v ? String(v) : "—";
  }

  // 极简 DOM 构造（与 collect.js 同款）
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
        else el.setAttribute(k, v);
      });
    }
    if (kids != null) {
      [].concat(kids).forEach(function (c) { if (c != null && c !== false) el.appendChild(c); });
    }
    return el;
  }

  // ============================================================
  // 图标（统一走 CA.icon()；icons.js 未就位时内置兜底 SVG，绝不使用 emoji）
  // ============================================================
  var FALLBACK_ICONS = {
    message: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
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

  function iconEl(name, size) {
    return h("span", { class: "icon-wrap", html: icon(name, size) });
  }

  // ============================================================
  // 视图状态
  // ============================================================
  var state = null;
  var mountToken = 0;        // 挂载令牌：卸载/重挂后丢弃过期异步结果
  var styleInjected = false;

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    if (typeof document === "undefined" || !document.createElement) return;
    var host = document.head || document.body;
    if (!host || typeof host.appendChild !== "function") return;
    var css =
      ".ca-messages{display:flex;flex-direction:column;gap:16px}" +
      ".ca-messages .ca-msg-note{font-size:var(--fs-sm);color:var(--text-3);margin-top:10px}" +
      ".ca-messages .ca-msg-compose{display:flex;flex-direction:column;gap:10px;margin-top:12px}" +
      ".ca-messages #message-input{min-height:88px;resize:vertical;font-size:14.5px;line-height:1.6}" +
      ".ca-messages .ca-msg-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}" +
      ".ca-messages .ca-msg-actions .ca-msg-count{margin-left:auto;font-size:var(--fs-xs);color:var(--text-3)}" +
      ".ca-messages .ca-msg-row{display:block}" +
      ".ca-messages .ca-msg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".ca-messages .ca-msg-content{margin:8px 0 0;font-size:14.5px;line-height:1.7;color:var(--text);white-space:pre-wrap;word-break:break-word}" +
      ".ca-messages .ca-msg-meta{display:inline-flex;align-items:center;gap:6px;color:var(--text-3);font-size:var(--fs-xs);margin-top:8px}" +
      ".ca-messages .ca-msg-meta .icon-wrap{display:inline-flex}" +
      ".ca-messages .ca-msg-reply{margin-top:10px;padding:10px 12px;border-left:3px solid var(--role-accent);background:var(--surface-2);border-radius:var(--r-sm)}" +
      ".ca-messages .ca-msg-reply p{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;color:var(--text-2);font-size:14px;line-height:1.6}" +
      ".ca-messages .ca-msg-pending{margin-top:8px;font-size:var(--fs-sm);color:var(--text-3)}" +
      ".ca-messages .ca-msg-reply-form{margin-top:12px;display:flex;flex-direction:column;gap:8px}" +
      ".ca-messages .ca-msg-reply-form .row{gap:8px;flex-wrap:wrap}" +
      ".ca-messages .ca-msg-reply-form textarea{min-height:56px;resize:vertical}" +
      "@media(max-width:520px){.ca-messages .ca-msg-actions .ca-msg-count{margin-left:0;width:100%}}" +
      // 移动端：操作按钮可换行并撑满一行，长文本/回复表单不挤出容器
      "@media(max-width:767px){" +
      ".ca-messages{gap:12px}" +
      ".ca-messages .ca-msg-reply-form .row .btn{flex:0 1 auto}" +
      ".ca-messages .ca-msg-reply-form textarea{min-height:64px}" +
      "}" +
      "@media(max-width:430px){.ca-messages .ca-msg-actions .btn{flex:1 1 auto}}";
    var style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.textContent = css;
    host.appendChild(style);
  }

  // ---------- 同步辅助 ----------
  function isAdmin() {
    try {
      if (CA.auth && typeof CA.auth.isAdmin === "function") return !!CA.auth.isAdmin();
    } catch (e) { /* 降级 */ }
    return !!(state && state.isAdmin);
  }

  function myMemberId() {
    var u = (state && state.me) || {};
    return u.memberId || null;
  }

  function myUid() {
    var u = (state && state.me) || {};
    return u.uid || u.id || null;
  }

  // 留言人显示名：优先名单缓存，其次 uid，最后「学生」
  function senderName(m) {
    if (!m) return "学生";
    if (m.fromMemberId) {
      var n = "";
      try { n = CA.store.memberName ? (CA.store.memberName(m.fromMemberId) || "") : ""; } catch (e) { n = ""; }
      if (n) return n;
    }
    return m.fromUid ? String(m.fromUid) : "学生";
  }

  // 新→旧排序
  function sorted() {
    return (state && state.messages ? state.messages.slice() : []).sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  // ============================================================
  // 数据加载（异步，写缓存）
  // ============================================================
  function safe(p, fallback) {
    return Promise.resolve(p).then(function (v) { return v; }, function () { return fallback; });
  }

  function loadAll() {
    var pMe = (CA.auth && CA.auth.current) ? safe(CA.auth.current(), null) : Promise.resolve(null);
    return Promise.all([CA.store.get("messages"), pMe]).then(function (arr) {
      var list = arr[0] || [];
      state.me = arr[1] || null;
      try {
        state.isAdmin = !!(CA.auth && typeof CA.auth.isAdmin === "function" && CA.auth.isAdmin());
      } catch (e) { /* 保持原值 */ }
      // 学生视角：RLS 已过滤，本地再按本人 uid 稳健收口
      if (!state.isAdmin) {
        var uid = myUid();
        if (uid) list = list.filter(function (m) { return m.fromUid === uid; });
      }
      state.messages = list;
    });
  }

  // ============================================================
  // 渲染：列表行
  // ============================================================
  function emptyState(title, desc) {
    return h("div", { class: "empty" }, [
      h("div", { class: "empty-icon", "aria-hidden": "true", html: icon("message", 40) }),
      h("div", { class: "empty-title", text: title }),
      h("p", { class: "empty-desc", text: desc })
    ]);
  }

  function stagger(box) {
    if (CA.app && typeof CA.app.enter === "function") { CA.app.enter(box); return; }
    if (!box || !box.classList) return;
    box.classList.remove("ca-enter");
    void box.offsetWidth;
    box.classList.add("ca-enter");
    if (box.__enterT) clearTimeout(box.__enterT);
    box.__enterT = setTimeout(function () { if (box.classList) box.classList.remove("ca-enter"); }, 820);
  }

  function metaRow(label) {
    var m = h("div", { class: "ca-msg-meta" });
    m.appendChild(iconEl("clock", 13));
    m.appendChild(h("span", { text: label }));
    return m;
  }

  // 老师回复的展示块（学生 / 老师视角通用，纯展示）
  function replyBlock(m) {
    if (!m.replyContent) return null;
    var box = h("div", { class: "ca-msg-reply" });
    box.appendChild(h("span", { class: "badge badge-cat", text: "老师回复" }));
    box.appendChild(h("p", { text: m.replyContent }));
    box.appendChild(metaRow(m.replyAt ? fmtSmart(m.replyAt) : ""));
    return box;
  }

  // ---------- 学生行 ----------
  function studentRow(m) {
    var row = h("div", { class: "list-row ca-msg-row student-only", "data-msg-id": m.id });
    var main = h("div", { class: "list-main" });
    main.appendChild(h("div", { class: "ca-msg-head" }, [
      h("span", { class: "badge badge-muted", text: "我的留言" })
    ]));
    main.appendChild(h("p", { class: "ca-msg-content", text: m.content }));
    main.appendChild(metaRow(fmtSmart(m.createdAt)));

    var reply = replyBlock(m);
    if (reply) main.appendChild(reply);
    else main.appendChild(h("div", { class: "ca-msg-pending", text: "老师尚未回复" }));

    row.appendChild(main);
    return row;
  }

  // ---------- 老师 / 管理员行（含回复表单） ----------
  function adminRow(m) {
    var row = h("div", { class: "list-row ca-msg-row admin-only", "data-msg-id": m.id });
    var main = h("div", { class: "list-main" });

    var head = h("div", { class: "ca-msg-head" });
    head.appendChild(iconEl("user", 15));
    head.appendChild(h("span", { class: "badge badge-cat", text: senderName(m) }));
    head.appendChild(m.readAt
      ? h("span", { class: "badge badge-success", text: "已读" })
      : h("span", { class: "badge badge-warn", text: "未读" }));
    main.appendChild(head);

    main.appendChild(h("p", { class: "ca-msg-content", text: m.content }));
    main.appendChild(metaRow(fmtSmart(m.createdAt)));

    var oldReply = replyBlock(m);
    if (oldReply) main.appendChild(oldReply);

    // 回复区（老师专属）
    var form = h("div", { class: "ca-msg-reply-form admin-only", "data-reply-for": m.id });
    var ta = h("textarea", {
      class: "input", id: "message-reply-" + m.id, rows: "2",
      placeholder: oldReply ? "修改回复…" : "回复这条留言…"
    });
    if (m.replyContent) ta.value = m.replyContent;
    form.appendChild(ta);

    var actions = h("div", { class: "row ca-msg-actions" });
    var replyBtn = h("button", {
      class: "btn btn-primary btn-sm", type: "button", id: "btn-message-reply-" + m.id
    }, [iconEl("edit", 14), h("span", { text: oldReply ? "更新回复" : "回复" })]);
    replyBtn.addEventListener("click", function () { onReply(m, ta, replyBtn); });
    actions.appendChild(replyBtn);

    if (!m.readAt) {
      var readBtn = h("button", {
        class: "btn btn-quiet btn-sm", type: "button", id: "btn-message-read-" + m.id
      }, [iconEl("check", 14), h("span", { text: "标记已读" })]);
      readBtn.addEventListener("click", function () { onMarkRead(m, readBtn); });
      actions.appendChild(readBtn);
    }
    form.appendChild(actions);
    main.appendChild(form);

    row.appendChild(main);
    return row;
  }

  function renderList() {
    var list = state.listEl;
    if (!list) return;
    list.innerHTML = "";
    var items = sorted();
    if (!items.length) {
      list.appendChild(emptyState(
        isAdmin() ? "还没有留言" : "你还没有留言",
        isAdmin() ? "学生提交留言后会显示在这里，可逐条回复。" : "在上方输入内容，给老师留言。"
      ));
      return;
    }
    var admin = isAdmin();
    items.forEach(function (m) { list.appendChild(admin ? adminRow(m) : studentRow(m)); });
    stagger(list);
  }

  function renderLoading() {
    var list = state && state.listEl;
    if (!list) return;
    list.innerHTML = "";
    for (var i = 0; i < 3; i++) {
      var row = h("div", { class: "skeleton-row", "aria-hidden": "true" });
      var line = h("div", { class: "skeleton-line" });
      line.appendChild(h("div", { class: "skeleton skeleton-title" }));
      line.appendChild(h("div", { class: "skeleton" }));
      row.appendChild(line);
      list.appendChild(row);
    }
  }

  function renderLoadError(err) {
    var list = state && state.listEl;
    if (!list) return;
    list.innerHTML = "";
    var box = emptyState("加载失败", errMsg(err) || "无法加载留言，请稍后重试。");
    var btn = h("button", { class: "btn btn-sm", type: "button", text: "重新加载" });
    btn.addEventListener("click", function () {
      btn.disabled = true; btn.textContent = "加载中…";
      loadAll().then(function () {
        if (!state) return;
        renderList();
      }).catch(function (e2) {
        toastError(e2, "加载留言失败");
        btn.disabled = false; btn.textContent = "重新加载";
      });
    });
    box.appendChild(btn);
    list.appendChild(box);
  }

  // ============================================================
  // 学生 · 提交留言
  // ============================================================
  function onSubmitMessage(ta, btn) {
    var text = String(ta && ta.value || "").trim();
    if (!text) { toast("请输入留言内容", "error"); return Promise.resolve(); }
    if (text.length > 500) { toast("留言过长（最多 500 字）", "error"); return Promise.resolve(); }

    btn.disabled = true;
    var idle = btn.textContent;
    btn.textContent = "发送中…";
    // from_uid 省略时由建表默认 auth.uid() 兜底；仅在有值时显式带上
    var payload = { content: text };
    var uid = myUid(); if (uid) payload.fromUid = uid;
    var mid = myMemberId(); if (mid) payload.fromMemberId = mid;
    return Promise.resolve(CA.store.add("messages", payload)).then(function () {
      ta.value = "";
      toast("留言已提交", "success");
      return loadAll().then(function () { if (state) renderList(); });
    }).catch(function (err) {
      toastError(err, "留言提交失败");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = idle;
    });
  }

  // ============================================================
  // 老师 · 回复 / 标记已读
  // ============================================================
  function onReply(m, ta, btn) {
    var text = String(ta && ta.value || "").trim();
    if (!text) { toast("请输入回复内容", "error"); return Promise.resolve(); }
    if (text.length > 500) { toast("回复过长（最多 500 字）", "error"); return Promise.resolve(); }

    var now = new Date().toISOString();
    var patch = { replyContent: text, replyAt: now };
    if (!m.readAt) patch.readAt = now;   // 回复即视为已读

    btn.disabled = true;
    return Promise.resolve(CA.store.update("messages", m.id, patch)).then(function () {
      toast("回复已发送", "success");
      return loadAll().then(function () { if (state) renderList(); });
    }).catch(function (err) {
      toastError(err, "回复失败");
    }).then(function () {
      btn.disabled = false;
    });
  }

  function onMarkRead(m, btn) {
    btn.disabled = true;
    return Promise.resolve(CA.store.update("messages", m.id, { readAt: new Date().toISOString() })).then(function () {
      return loadAll().then(function () { if (state) renderList(); });
    }).catch(function (err) {
      toastError(err, "标记已读失败");
      btn.disabled = false;
    });
  }

  // ============================================================
  // 刷新 / 挂载
  // ============================================================
  function refresh() {
    if (!state || !state.root) return Promise.resolve();
    return loadAll().then(function () {
      if (state && state.root) renderList();
    });
  }

  function mount(rootEl) {
    var token = ++mountToken;
    state = {
      root: rootEl,
      isAdmin: false,
      me: null,
      messages: [],
      listEl: null
    };
    injectStyles();
    rootEl.innerHTML = "";

    var wrap = h("div", { class: "ca-messages" });

    // 顶部工具栏：标题 + 角色语境说明 + 刷新
    var toolbar = h("div", { class: "card ca-msg-toolbar" });
    var head = h("div", { class: "card-head" });
    head.appendChild(h("div", { class: "card-title" }, [iconEl("message", 20), h("span", { text: "留言" })]));
    var refreshBtn = h("button", { class: "btn btn-quiet btn-sm", type: "button", id: "btn-message-refresh" },
      [iconEl("refresh", 14), h("span", { text: "刷新" })]);
    refreshBtn.addEventListener("click", function () {
      refreshBtn.disabled = true;
      refresh().catch(function (e) { toastError(e, "刷新失败"); }).then(function () { refreshBtn.disabled = false; });
    });
    head.appendChild(refreshBtn);
    toolbar.appendChild(head);
    toolbar.appendChild(h("div", {
      class: "ca-msg-note",
      text: "学生：写下想对老师说的话，并在这里查看老师的回复。老师 / 管理员：查看全部留言、标记已读并逐条回复。"
    }));

    // 学生写留言（.student-only，老师端由 CSS 隐藏）
    var compose = h("div", { class: "ca-msg-compose student-only" });
    var ta = h("textarea", {
      class: "input", id: "message-input", rows: "3", maxlength: "500",
      placeholder: "写下你想对老师说的话（最多 500 字）"
    });
    compose.appendChild(ta);
    var composeActions = h("div", { class: "row ca-msg-actions" });
    var sendBtn = h("button", { class: "btn btn-lime", type: "button", id: "btn-message-send" },
      [iconEl("edit", 16), h("span", { text: "提交留言" })]);
    sendBtn.addEventListener("click", function () { onSubmitMessage(ta, sendBtn); });
    composeActions.appendChild(sendBtn);
    composeActions.appendChild(h("span", { class: "ca-msg-count", text: "最多 500 字" }));
    compose.appendChild(composeActions);
    toolbar.appendChild(compose);

    wrap.appendChild(toolbar);

    var list = h("div", { class: "card-list", id: "message-list" });
    state.listEl = list;
    wrap.appendChild(list);

    rootEl.appendChild(wrap);
    renderLoading();

    return loadAll().then(function () {
      if (token !== mountToken || !state || state.root !== rootEl) return;   // 已卸载/重挂：丢弃过期结果
      renderList();
    }, function (err) {
      if (token !== mountToken || !state || state.root !== rootEl) return;
      toastError(err, "加载留言失败");
      renderLoadError(err);
    });
  }

  function unmount() {
    mountToken++;   // 使在途异步结果失效
    state = null;
  }

  // ============================================================
  // 对外
  // ============================================================
  CA.views = CA.views || {};
  CA.views.messages = { mount: mount, unmount: unmount };
  CA.messages = { esc: esc, sorted: sorted };
})();
