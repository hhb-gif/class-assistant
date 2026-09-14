// 应用编排：启动、路由、顶栏绑定、toast/modal、占位与设置视图
// 契约：CONTRACT.md 第 6、7 节。视图模块（notices/scores）由本文件创建容器并 mount。
window.CA = window.CA || {};

CA.app = (function () {
  var current = "notices";
  var activeModule = null;
  var toastTimer = null;
  var _authed = false;   // 登录门状态：false=停在登录/改密页，true=已进入应用

  // ---------- 提示与弹窗 ----------
  function toast(msg, type) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.classList.remove("show", "success", "error", "warn", "info");
    el.textContent = msg == null ? "" : String(msg);
    if (type) el.classList.add(type);
    void el.offsetWidth; // 强制 reflow：连续提示也能重新触发过渡
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }

  function openModal(node) {
    var mask = document.getElementById("modal-mask");
    var box = document.getElementById("modal-box");
    if (!mask || !box) return;
    if (typeof node === "string") box.innerHTML = node;
    else {
      box.innerHTML = "";
      if (node) box.appendChild(node);
    }
    mask.hidden = false;
  }

  function closeModal() {
    var box = document.getElementById("modal-box");
    var mask = document.getElementById("modal-mask");
    if (box) box.innerHTML = "";
    if (mask) mask.hidden = true;
  }

  // ---------- DOM 工具 ----------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function roleLabel(role) {
    if (role === "superAdmin") return "超级管理员";
    if (role === "admin") return "管理员";
    return "学生";
  }

  // ---------- 角色类机制（DESIGN.md §10） ----------
  // 归一化：superAdmin→teacher，admin→admin，其余→student；未登录→guest。
  // 登录成功后由 applyRole() 给 <body> 设置唯一角色类，CSS 据此切换「管理台 / 内容台」两套气质；
  // 模块一律用 CSS（.role-* / .admin-only / .student-only）读取，勿自建角色分支改 DOM 结构。
  function roleClassOf(role) {
    if (role === "superAdmin") return "role-teacher";
    if (role === "admin") return "role-admin";
    // 数据里的学生角色是 member（迁移/RLS 口径）；student 仅为兼容旧写法
    if (role === "member" || role === "student") return "role-student";
    return "role-guest";
  }

  function applyRole(me) {
    var body = document.body;
    if (!body || !body.classList) return;
    body.classList.remove("role-teacher", "role-admin", "role-student", "role-guest");
    body.classList.add(roleClassOf(me && me.role));
    body.setAttribute("data-role", (me && me.role) ? me.role : "guest");
  }

  // 读取当前归一化角色：teacher | admin | student | guest（供模块按需读取，优先用 CSS）
  function currentRole() {
    var body = document.body;
    if (!body || !body.classList) return "guest";
    if (body.classList.contains("role-teacher")) return "teacher";
    if (body.classList.contains("role-admin")) return "admin";
    if (body.classList.contains("role-student")) return "student";
    return "guest";
  }

  // ---------- v4 角色 chrome：背景层 + 角色主视觉横幅（DESIGN.md §4.14/§10） ----------
  // 只做视觉层注入，不改任何模块 DOM，不动 CONTRACT §6 的 id 契约。
  var ROLE_META = {
    teacher: { eyebrow: "管理台", sub: "发布通知、录入成绩、管理名单" },
    admin: { eyebrow: "协作端", sub: "协助发布通知、录入成绩与信息收集" },
    student: { eyebrow: "学生端", sub: "查看通知、成绩与收集，随时复习" },
    guest: { eyebrow: "", sub: "" }
  };

  // 背景层：#ca-atmos（fixed，z-index:0，CSS 负责点阵网格 + 纹理图）；纯 CSS 兜底不影响观感
  function ensureAtmos() {
    if (!document.body || document.getElementById("ca-atmos")) return;
    var d = document.createElement("div");
    d.id = "ca-atmos";
    d.className = "atmos";
    d.setAttribute("aria-hidden", "true");
    document.body.insertBefore(d, document.body.firstChild);
  }

  // 主视觉横幅：#ca-hero（插在 #view-root 之前；role-guest 下由 CSS 隐藏）
  function ensureHero() {
    var h = document.getElementById("ca-hero");
    if (h) return h;
    h = el("div", { id: "ca-hero", class: "ca-hero", "aria-hidden": "true" });
    h.appendChild(el("div", { class: "ca-hero-inner" }, [
      el("div", { class: "ca-hero-body" }, [
        el("div", { class: "ca-hero-eyebrow" }),
        el("div", { class: "ca-hero-title" }),
        el("p", { class: "ca-hero-sub" })
      ]),
      el("div", { class: "ca-hero-art" })
    ]));
    var root = document.getElementById("view-root");
    if (root && root.parentNode) root.parentNode.insertBefore(h, root);
    else document.body.appendChild(h);
    return h;
  }

  // 按角色 + 当前用户填充横幅文案（插画由 CSS var(--hero-image) 按 body.role-* 决定）
  function renderHero(me) {
    var h = ensureHero();
    if (!h) return;
    var meta = ROLE_META[currentRole()] || ROLE_META.guest;
    var name = (me && (me.name || me.studentNo)) || "";
    var eyebrow = h.querySelector(".ca-hero-eyebrow");
    var title = h.querySelector(".ca-hero-title");
    var sub = h.querySelector(".ca-hero-sub");
    if (eyebrow) eyebrow.textContent = meta.eyebrow;
    if (title) title.textContent = name ? (name + "，欢迎回来") : "班级管家";
    if (sub) sub.textContent = meta.sub;
  }

  // 入场动效：给容器加 .ca-enter，子项（列表/卡片）按 CSS 延迟依次淡入
  function enter(el) {
    if (!el || !el.classList) return;
    el.classList.remove("ca-enter");
    void el.offsetWidth; // 强制 reflow，重复调用也能重放
    el.classList.add("ca-enter");
    if (el.__enterT) clearTimeout(el.__enterT);
    el.__enterT = setTimeout(function () {
      if (el && el.classList) el.classList.remove("ca-enter");
    }, 820);
  }

  // ---------- 顶栏（当前用户 + 退出登录 + AI 开关） ----------
  // 真实登录取代原「假身份切换下拉」：#role-switcher 由 <select> 改为只读身份展示元素，
  // 保留其 id 以维持 CONTRACT §6.1 的 DOM id 契约（不再向下拉塞 option，也不再调用 switchTo）。
  function renderUserChip(me) {
    var chip = document.getElementById("role-switcher");
    if (chip) {
      chip.innerHTML = "";
      // 覆盖残留的 select 样式（下拉箭头/指针），使其呈现为纯身份标签
      chip.style.backgroundImage = "none";
      chip.style.cursor = "default";
      chip.style.paddingRight = "12px";
      if (me) {
        chip.appendChild(el("span", { class: "badge badge-cat", text: roleLabel(me.role) }));
        chip.appendChild(el("span", { text: " " + (me.name || me.studentNo || "已登录") }));
      }
    }
    var out = document.getElementById("btn-logout");
    if (out && !out.__caBound) {
      out.__caBound = true;
      out.addEventListener("click", onLogout);
    }
  }

  // 退出登录：清会话 → 回登录页
  function onLogout() {
    var btn = document.getElementById("btn-logout");
    if (btn) { btn.disabled = true; btn.textContent = "正在退出…"; }
    Promise.resolve()
      .then(function () {
        return (window.CA && CA.auth && typeof CA.auth.logout === "function") ? CA.auth.logout() : true;
      })
      .catch(function (e) { toast("退出登录失败：" + ((e && e.message) || e), "error"); })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = "退出登录"; }
        showLogin();
      });
  }

  // AI 开关：登录前也可切换（设备级偏好）；仅登录后触发重渲染，避免未登录时挂载业务视图
  function bindAiToggle() {
    var ai = document.getElementById("ai-toggle");
    if (!ai || ai.__caBound) return;
    ai.__caBound = true;
    try { ai.checked = CA.store.settings().aiEnabled !== false; } catch (e) { /* 本地偏好不可用则保持默认 */ }
    ai.addEventListener("change", function () {
      try { CA.store.setSettings({ aiEnabled: ai.checked }); } catch (e) { /* 忽略存储异常 */ }
      toast(ai.checked ? "AI 助手已开启" : "AI 助手已关闭，基础功能不受影响", ai.checked ? "success" : "info");
      if (_authed) rerender();
    });
  }

  // ---------- 路由 ----------
  function bindTabbar() {
    var bar = document.getElementById("tabbar");
    if (!bar) return;
    bar.addEventListener("click", function (ev) {
      if (!_authed) return;   // 未登录时忽略导航（此时 tabbar 也已隐藏）
      var btn = ev.target && ev.target.closest ? ev.target.closest(".nav-item") : null;
      if (btn) switchView(btn.getAttribute("data-view"));
    });
  }

  function switchView(view) {
    current = view;
    if (activeModule && typeof activeModule.unmount === "function") {
      try { activeModule.unmount(); } catch (e) { /* 卸载失败不阻断切换 */ }
    }
    activeModule = null;

    var root = document.getElementById("view-root");
    if (!root) return;
    root.innerHTML = "";

    Array.prototype.forEach.call(document.querySelectorAll("#tabbar .nav-item"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === view);
    });

    var section = el("section", { id: "view-" + view });
    root.appendChild(section);

    // 视图渲染可能是异步的（设置视图读云端、模块 mount 也可能返回 Promise）；
    // 捕获返回值，异步失败时兜底报错，避免未处理拒绝与白屏。
    var pending = null;
    try {
      if (view === "notices" && CA.views && CA.views.notices) {
        activeModule = CA.views.notices;
        pending = activeModule.mount(section);
      } else if (view === "scores" && CA.views && CA.views.scores) {
        activeModule = CA.views.scores;
        pending = activeModule.mount(section);
      } else if (view === "collect" && CA.views && CA.views.collect) {
        activeModule = CA.views.collect;
        pending = activeModule.mount(section);
      } else if (view === "review" && CA.views && CA.views.review) {
        activeModule = CA.views.review;
        pending = activeModule.mount(section);
      } else if (view === "messages" && CA.views && CA.views.messages) {
        activeModule = CA.views.messages;
        pending = activeModule.mount(section);
      } else if (view === "collect") {
        renderCollect(section);
      } else if (view === "review") {
        renderReview(section);
      } else if (view === "settings") {
        pending = renderSettings(section);   // 异步：内部先渲染 loading，再填充
      } else {
        renderPlaceholder(section, "该模块暂未就绪", "请检查对应脚本是否加载成功。");
      }
    } catch (err) {
      renderPlaceholder(section, "该模块加载出错", (err && err.message) || String(err));
      toast("视图加载出错：" + ((err && err.message) || err), "error");
    }
    // 异步渲染容错：等待期间用户可能已切到别的视图，仅当该 section 仍是当前视图时才覆盖报错
    if (pending && typeof pending.then === "function") {
      Promise.resolve(pending).catch(function (err) {
        if (document.getElementById("view-" + view) === section) {
          section.innerHTML = "";
          renderPlaceholder(section, "该模块加载出错", (err && err.message) || String(err));
        }
        toast("视图加载出错：" + ((err && err.message) || err), "error");
      });
    }
    enter(section); // 视图进入淡入 + 列表 stagger
  }

  function rerender() { switchView(current); }

  // ---------- 占位视图 ----------
  // v4：空态优先用 Agnes 插画（.ca-art，见 DESIGN.md §4.10/§11），无对应插画时退回线性 SVG
  var EMPTY_ART = {
    notices: "ca-art-notices",
    scores: "ca-art-scores",
    collect: "ca-art-collect",
    review: "ca-art-review"
  };

  function emptyIcon() {
    var art = EMPTY_ART[current];
    if (art) return el("div", { class: "empty-icon ca-art " + art, "aria-hidden": "true" });
    return el("div", { class: "empty-icon", "aria-hidden": "true", html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/></svg>' });
  }

  function renderPlaceholder(root, title, desc) {
    root.appendChild(el("div", { class: "empty" }, [
      emptyIcon(),
      el("div", { class: "empty-title", text: title }),
      el("p", { class: "empty-desc", text: desc })
    ]));
  }

  function renderCollect(root) {
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [
        el("div", { class: "card-title", text: "信息收集" }),
        el("div", { class: "card-sub", text: "M3 · 规划中" })
      ]),
      el("div", { class: "empty" }, [
        el("div", { class: "empty-icon ca-art ca-art-collect", "aria-hidden": "true" }),
        el("div", { class: "empty-title", text: "接龙 / 报名 / 问卷即将上线" }),
        el("p", { class: "empty-desc", text: "计划支持：单选、多选、文本题；截止时间与已交/未交名单；结果自动统计可视化；AI 对开放性文本回答自动归类汇总。" })
      ])
    ]));
  }

  function renderReview(root) {
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [
        el("div", { class: "card-title", text: "学习复习" }),
        el("div", { class: "card-sub", text: "M4 · 规划中（复用复习伴侣引擎）" })
      ]),
      el("div", { class: "empty" }, [
        el("div", { class: "empty-icon ca-art ca-art-review", "aria-hidden": "true" }),
        el("div", { class: "empty-title", text: "班级题库 / 练习 / 间隔复习" }),
        el("p", { class: "empty-desc", text: "计划支持：老师导入或按知识点 AI 出题入库；学生练习（选择/填空/判断）、错题本；SM-2 间隔复习调度（1/6/15/38 天梯度，来自复习伴侣已验证逻辑）。" })
      ])
    ]));
  }

  // ---------- 设置视图 ----------
  // 异步：CA.auth.current() / CA.store.get() 返回 Promise。内部先渲染 loading 骨架避免白屏，
  // 数据就绪后再填充；失败时抛可读错误，由 switchView 的异步兜底渲染错误占位。
  function renderSettings(root) {
    // 1) 立即渲染 loading 骨架（点击「设置」后不白屏）
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [el("div", { class: "card-title", text: "设置" })]),
      el("div", { class: "empty" }, [
        el("div", { class: "empty-title", text: "正在加载设置…" }),
        el("p", { class: "empty-desc", text: "正在读取身份与班级名单，请稍候。" })
      ])
    ]));

    return Promise.resolve()
      .then(function () {
        if (!(window.CA && CA.auth && typeof CA.auth.current === "function")) {
          throw new Error("auth.js 未加载（请检查 index.html 脚本顺序）");
        }
        return CA.auth.current();   // 异步：await 身份
      })
      .then(function (me) {
        me = me || {};
        var isAdmin = !!(CA.auth && CA.auth.isAdmin && CA.auth.isAdmin());   // isAdmin 同步，不 await
        // 仅管理员需要名单/用户表；普通用户跳过，避免触发无权限查询
        var pMembers = isAdmin ? CA.store.get("members") : Promise.resolve([]);
        var pUsers = isAdmin ? CA.store.get("users") : Promise.resolve([]);
        return Promise.all([pMembers, pUsers]).then(function (arr) {
          return { me: me, isAdmin: isAdmin, members: arr[0] || [], users: arr[1] || [] };
        });
      })
      .then(function (data) {
        var me = data.me;
        var aiEnabled = CA.ai && CA.ai.enabled ? CA.ai.enabled() : false;        // 同步
        var aiCfgReady = false;
        try { aiCfgReady = !!(CA.llm && CA.llm.ready && CA.llm.ready()); } catch (e) { aiCfgReady = false; }
        var aiModel = (CA.ai && CA.ai.info) ? (CA.ai.info().model || "") : "";   // 同步

        var wrap = el("div", { class: "stack" });

        // 1) 当前身份
        wrap.appendChild(el("div", { class: "card" }, [
          el("div", { class: "card-head" }, [el("div", { class: "card-title", text: "当前身份" })]),
          el("div", { class: "row" }, [
            el("div", { class: "avatar", text: String(me.name || "?").slice(0, 1) }),
            el("div", { class: "list-main" }, [
              el("div", { class: "list-title", text: (me.name || "未知用户") + " · " + roleLabel(me.role) }),
              el("div", { class: "list-meta", text: me.title || (me.studentNo ? "学号 " + me.studentNo : "") })
            ]),
            el("span", { class: "badge", text: roleLabel(me.role) })
          ]),
          el("p", { class: "muted", text: data.isAdmin
            ? "当前为管理端视角（DESIGN.md §10）：可发布通知、录入成绩、管理班级名单；界面按管理台密度呈现。切换为学生账号可查看学生端界面。"
            : "当前为学生端视角（DESIGN.md §10）：可查看通知、成绩与收集内容，界面按内容台密度呈现。" })
        ]));

        // 2) AI 助手
        wrap.appendChild(el("div", { class: "card" }, [
          el("div", { class: "card-head" }, [
            el("div", { class: "card-title", text: "AI 助手" }),
            el("span", { class: "badge " + (aiEnabled ? "badge-ai" : "badge-muted"), text: aiEnabled ? "已开启" : "已关闭" })
          ]),
          el("div", { class: "stat-grid" }, [
            el("div", { class: "stat" }, [el("div", { class: "stat-value", text: aiModel || "未配置" }), el("div", { class: "stat-label", text: "当前模型" })]),
            el("div", { class: "stat " + (aiCfgReady ? "success" : "warn") }, [el("div", { class: "stat-value", text: aiCfgReady ? "就绪" : "未就绪" }), el("div", { class: "stat-label", text: "通道状态" })]),
            el("div", { class: "stat" }, [el("div", { class: "stat-value", text: aiEnabled ? "可用" : "已停用" }), el("div", { class: "stat-label", text: "当前开关" })])
          ]),
          el("p", { class: "muted", text: data.isAdmin
            ? "AI 为可选增强：接入走 OpenAI 兼容通道（前端零密钥的代理模式）。关闭后，通知发布、成绩录入与分析图表等基础功能完全不受影响。开关位于右上角。"
            : "AI 为可选增强，由老师 / 管理员在发布通知、分析成绩时使用。你不受其影响：查看通知、成绩与收集等功能始终可用。" }),
          el("div", { class: "btn-group" }, [
            el("button", { class: "btn btn-sm", text: "测试连接", onclick: onTestAi })
          ])
        ]));

        // 3) 班级名单（仅管理员）
        if (data.isAdmin) {
          var members = (data.members || []).slice().sort(function (a, b) { return String(a.studentNo).localeCompare(String(b.studentNo)); });
          var rows = [el("tr", null, [el("th", { text: "姓名" }), el("th", { text: "学号" }), el("th", { text: "身份绑定" })])];
          // users 与 members 的绑定关系：新表用 memberId，兼容旧形态的 studentNo
          var userByNo = {};
          var userByMemberId = {};
          (data.users || []).forEach(function (u) {
            if (u.studentNo) userByNo[u.studentNo] = u;
            if (u.memberId) userByMemberId[u.memberId] = u;
          });
          members.forEach(function (m) {
            var u = userByNo[m.studentNo] || userByMemberId[m.id] || null;
            rows.push(el("tr", null, [
              el("td", { text: m.name }),
              el("td", { class: "num", text: m.studentNo }),
              el("td", {}, [el("span", { class: "badge " + (u ? "badge-success" : "badge-muted"), text: u ? roleLabel(u.role) : "未绑定" })])
            ]));
          });
          wrap.appendChild(el("div", { class: "card" }, [
            el("div", { class: "card-head" }, [
              el("div", { class: "card-title", text: "班级名单" }),
              el("div", { class: "card-sub", text: members.length + " 人" })
            ]),
            el("div", { class: "table-wrap" }, [el("table", { class: "table table-compact" }, rows)])
          ]));
        }

        // 4) 数据管理（导出 / 重置）
        wrap.appendChild(el("div", { class: "card" }, [
          el("div", { class: "card-head" }, [el("div", { class: "card-title", text: "数据管理" })]),
          el("div", { class: "btn-group" }, [
            el("button", { class: "btn btn-sm", text: "导出数据 JSON", onclick: onExport }),
            el("button", { class: "btn btn-sm btn-danger", text: "重置数据", onclick: onReset })
          ])
        ]));

        // 2) 数据就绪：替换 loading 骨架
        root.innerHTML = "";
        root.appendChild(wrap);
      });
  }

  function onTestAi() {
    if (!(CA.llm && CA.llm.ready && CA.llm.ready())) { toast("LLM 通道未配置（缺 config.js）", "error"); return; }
    toast("正在测试 AI 连接…", "info");
    CA.llm.testConnection().then(function (r) {
      toast("AI 连接成功：" + (r.reply || "ok") + "（" + r.ms + "ms）", "success");
    }).catch(function (e) {
      toast("AI 连接失败：" + ((e && e.message) || e), "error");
    });
  }

  function onExport() {
    try {
      var raw = window.localStorage.getItem("ca_db") || "{}";
      var blob = new Blob([raw], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "class-assistant-data-" + (CA.util ? CA.util.fmtDate(new Date()) : Date.now()) + ".json";
      document.body.appendChild(a);
      a.click();
      a.parentNode.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("已导出数据 JSON", "success");
    } catch (e) { toast("导出失败：" + ((e && e.message) || e), "error"); }
  }

  function onReset() {
    if (!window.confirm("确定重置数据吗？当前所有修改（通知、成绩等）都会被清除。")) return;
    var p;
    try { p = CA.store.reset(); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p)
      .catch(function (e) { toast("重置失败：" + ((e && e.message) || e), "error"); })
      .then(function () {
        toast("数据已重置", "success");
        if (_authed) rerender();
      });
  }

  // ---------- 启动 ----------
  function bindModalClose() {
    var mask = document.getElementById("modal-mask");
    if (mask) {
      mask.addEventListener("click", function (ev) {
        if (ev.target === mask) closeModal();
      });
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeModal();
    });
  }

  // ---------- 启动编排（登录门） ----------
  // 流程：CA.cloud.init() → CA.auth.current()（内部 session + users 角色）
  //   未登录            → CA.views.login.mount(#view-root)，隐藏 tabbar 与顶栏身份控件
  //   已登录+需改密     → CA.views.changePassword.mount(#view-root)
  //   已登录正常        → CA.store.init()（预加载 members 缓存）→ 原 switchView 流程
  // 任一环节异常都停在登录页并给出可读提示，避免白屏。

  // 顶栏/导航/主视觉的登录态开关
  function setChrome(visible) {
    var bar = document.getElementById("tabbar");
    if (bar) bar.style.display = visible ? "" : "none";
    var chip = document.getElementById("role-switcher");
    if (chip) chip.style.display = visible ? "" : "none";
    var out = document.getElementById("btn-logout");
    if (out) out.style.display = visible ? "" : "none";
    var hero = document.getElementById("ca-hero");
    if (hero) hero.style.display = visible ? "" : "none";
  }

  // ?view=xxx 直达（登录后生效），非法值回落通知
  function targetView() {
    var wanted = null;
    try { wanted = new URLSearchParams(window.location.search).get("view"); } catch (e) { wanted = null; }
    var views = ["notices", "scores", "collect", "review", "messages", "settings"];
    return views.indexOf(wanted) >= 0 ? wanted : "notices";
  }

  // 卸载当前业务视图（登录/改密页挂在 #view-root，由各自 unmount 清理）
  function unmountActive() {
    if (activeModule && typeof activeModule.unmount === "function") {
      try { activeModule.unmount(); } catch (e) { /* 卸载失败不阻断 */ }
    }
    activeModule = null;
  }

  function showLogin(o) {
    o = o || {};
    _authed = false;
    applyRole(null);          // 回登录页 → role-guest
    setChrome(false);
    unmountActive();
    if (CA.views && CA.views.login && typeof CA.views.login.unmount === "function") {
      try { CA.views.login.unmount(); } catch (e) { /* 忽略 */ }
    }
    var root = document.getElementById("view-root");
    if (!root) return;
    if (CA.views && CA.views.login && typeof CA.views.login.mount === "function") {
      try {
        CA.views.login.mount(root, {
          onSuccess: function (me) {
            // 登录成功仍需过强制改密门（login() 返回的 me 已含 mustChangePassword）
            if (me && me.mustChangePassword) { showChangePassword(); return; }
            enterApp(me);
          },
          error: o.error || null,
          cloudDown: !!o.cloudDown
        });
      } catch (e) {
        root.innerHTML = "";
        renderPlaceholder(root, "登录页加载失败", (e && e.message) || String(e));
      }
    } else {
      root.innerHTML = "";
      renderPlaceholder(root, "登录视图未加载", "请检查 src/login-view.js 是否已随 index.html 引入。");
    }
  }

  function showChangePassword() {
    _authed = false;
    applyRole(null);          // 改密页 → role-guest
    setChrome(false);
    unmountActive();
    var root = document.getElementById("view-root");
    if (!root) return;
    if (CA.views && CA.views.changePassword && typeof CA.views.changePassword.mount === "function") {
      try {
        CA.views.changePassword.mount(root, {
          // 改密成功后重新读取身份（auth.changePassword 已把 mustChangePassword 置 false）
          onSuccess: function () { enterApp(null); },
          onLogout: function () { onLogout(); }
        });
      } catch (e) {
        root.innerHTML = "";
        renderPlaceholder(root, "改密页加载失败", (e && e.message) || String(e));
      }
    } else {
      root.innerHTML = "";
      renderPlaceholder(root, "改密视图未加载", "请检查 src/login-view.js 是否已随 index.html 引入。");
    }
  }

  // 进入应用：显示顶栏/导航 → 渲染用户 → 预加载 members → 原视图流程
  function enterApp(me) {
    var go = function (u) {
      _authed = true;
      setChrome(true);
      applyRole(u);            // 按角色设置 body.role-*，驱动顶栏/导航/卡片密度差异
      renderHero(u);           // v4：按角色填充主视觉横幅（插画由 CSS var(--hero-image) 决定）
      renderUserChip(u);
      if (CA.views && CA.views.login && typeof CA.views.login.unmount === "function") {
        try { CA.views.login.unmount(); } catch (e) { /* 忽略 */ }
      }
      var p;
      try { p = CA.store.init(); } catch (e) { p = Promise.resolve(false); }
      Promise.resolve(p)
        .catch(function () { /* members 预加载失败不阻塞进入，业务视图会各自报错 */ })
        .then(function () { switchView(targetView()); });
    };
    if (me) { go(me); return; }
    if (!(window.CA && CA.auth && typeof CA.auth.current === "function")) { showLogin(); return; }
    CA.auth.current().then(go).catch(function (e) {
      showLogin({ error: e });   // 会话失效/身份读取失败 → 回登录页
    });
  }

  function boot() {
    bindTabbar();
    bindModalClose();
    bindAiToggle();
    ensureAtmos();      // v4：注入背景层（点阵网格 + 纹理图）
    ensureHero();       // v4：注入角色主视觉横幅占位（登录后填充文案）
    setChrome(false);   // 默认隐藏身份控件 + 横幅，等待登录门判定

    Promise.resolve()
      .then(function () {
        // 1) 云端单例初始化（SDK/CORS 失败不抛异常，由 ready()/lastError() 反映）
        if (!(window.CA && CA.cloud)) {
          showLogin({ cloudDown: true, error: new Error("cloud.js 未加载（请检查 index.html 脚本顺序）") });
          return null;
        }
        try { CA.cloud.init(); } catch (e) { /* ready() 会再次尝试并反映失败 */ }
        if (!CA.cloud.ready()) {
          showLogin({ cloudDown: true, error: CA.cloud.lastError() });
          return null;
        }
        // 2) 读取会话与身份，分流
        return CA.auth.current().then(function (me) {
          if (!me) { showLogin(); return; }
          if (me.mustChangePassword) { showChangePassword(); return; }
          enterApp(me);
        });
      })
      .catch(function (e) {
        // 3) 兜底：任何未捕获异常都停在登录页，给出可读提示，不白屏
        showLogin({ error: e });
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  return {
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    rerender: rerender,
    switchView: switchView,
    enter: enter,
    // 角色类机制（DESIGN.md §10）：供模块/调试复用
    role: currentRole,
    roleClassOf: roleClassOf,
    applyRole: applyRole,
    // v4 chrome 接入点：模块 Wave 2 可调用 CA.app.hero(me) 重刷横幅
    hero: renderHero
  };
})();
