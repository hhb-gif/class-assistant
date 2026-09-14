// 应用编排：启动、路由、顶栏绑定、toast/modal、占位与设置视图
// 契约：CONTRACT.md 第 6、7 节。视图模块（notices/scores）由本文件创建容器并 mount。
window.CA = window.CA || {};

CA.app = (function () {
  var current = "notices";
  var activeModule = null;
  var toastTimer = null;

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

  // ---------- 顶栏（身份切换 + AI 开关） ----------
  function bindTopbar() {
    var sel = document.getElementById("role-switcher");
    if (sel) {
      sel.innerHTML = "";
      CA.auth.list().forEach(function (u) {
        sel.appendChild(el("option", { value: u.id, text: u.name + "（" + roleLabel(u.role) + "）" }));
      });
      sel.value = CA.auth.current().id;
      sel.addEventListener("change", function () {
        var u = CA.auth.switchTo(sel.value);
        if (u) toast("已切换身份：" + u.name, "info");
        rerender();
      });
    }

    var ai = document.getElementById("ai-toggle");
    if (ai) {
      ai.checked = CA.store.settings().aiEnabled !== false;
      ai.addEventListener("change", function () {
        CA.store.setSettings({ aiEnabled: ai.checked });
        toast(ai.checked ? "AI 助手已开启" : "AI 助手已关闭，基础功能不受影响", ai.checked ? "success" : "info");
        rerender();
      });
    }
  }

  // ---------- 路由 ----------
  function bindTabbar() {
    var bar = document.getElementById("tabbar");
    if (!bar) return;
    bar.addEventListener("click", function (ev) {
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

    try {
      if (view === "notices" && CA.views && CA.views.notices) {
        activeModule = CA.views.notices;
        activeModule.mount(section);
      } else if (view === "scores" && CA.views && CA.views.scores) {
        activeModule = CA.views.scores;
        activeModule.mount(section);
      } else if (view === "collect" && CA.views && CA.views.collect) {
        activeModule = CA.views.collect;
        activeModule.mount(section);
      } else if (view === "review" && CA.views && CA.views.review) {
        activeModule = CA.views.review;
        activeModule.mount(section);
      } else if (view === "collect") {
        renderCollect(section);
      } else if (view === "review") {
        renderReview(section);
      } else if (view === "settings") {
        renderSettings(section);
      } else {
        renderPlaceholder(section, "该模块暂未就绪", "请检查对应脚本是否加载成功。");
      }
    } catch (err) {
      renderPlaceholder(section, "该模块加载出错", (err && err.message) || String(err));
      toast("视图加载出错：" + ((err && err.message) || err), "error");
    }
    enter(section); // 视图进入淡入 + 列表 stagger
  }

  function rerender() { switchView(current); }

  // ---------- 占位视图 ----------
  function renderPlaceholder(root, title, desc) {
    root.appendChild(el("div", { class: "empty" }, [
      el("div", { class: "empty-icon", html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/></svg>' }),
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
        el("div", { class: "empty-title", text: "班级题库 / 练习 / 间隔复习" }),
        el("p", { class: "empty-desc", text: "计划支持：老师导入或按知识点 AI 出题入库；学生练习（选择/填空/判断）、错题本；SM-2 间隔复习调度（1/6/15/38 天梯度，来自复习伴侣已验证逻辑）。" })
      ])
    ]));
  }

  // ---------- 设置视图 ----------
  function renderSettings(root) {
    var me = CA.auth.current();
    var aiEnabled = CA.ai && CA.ai.enabled ? CA.ai.enabled() : false;
    var aiCfgReady = false;
    try { aiCfgReady = !!(CA.llm && CA.llm.ready && CA.llm.ready()); } catch (e) { aiCfgReady = false; }
    var aiModel = (CA.ai && CA.ai.info) ? (CA.ai.info().model || "") : "";

    var wrap = el("div", { class: "stack" });

    // 1) 当前身份
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [el("div", { class: "card-title", text: "当前身份" })]),
      el("div", { class: "row" }, [
        el("div", { class: "avatar", text: (me.name || "?").slice(0, 1) }),
        el("div", { class: "list-main" }, [
          el("div", { class: "list-title", text: me.name + " · " + roleLabel(me.role) }),
          el("div", { class: "list-meta", text: me.title || (me.studentNo ? "学号 " + me.studentNo : "") })
        ]),
        el("span", { class: "badge", text: roleLabel(me.role) })
      ]),
      el("p", { class: "muted", text: "本地演示环境：用右上角下拉框切换老师 / 班委 / 学生视角，权限与界面会随之变化。" })
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
      el("p", { class: "muted", text: "AI 为可选增强：接入走 OpenAI 兼容通道（前端零密钥的代理模式）。关闭后，通知发布、成绩录入与分析图表等基础功能完全不受影响。开关位于右上角。" }),
      el("div", { class: "btn-group" }, [
        el("button", { class: "btn btn-sm", text: "测试连接", onclick: onTestAi })
      ])
    ]));

    // 3) 班级名单（仅管理员）
    if (CA.auth.isAdmin()) {
      var members = CA.store.get("members").slice().sort(function (a, b) { return String(a.studentNo).localeCompare(String(b.studentNo)); });
      var rows = [el("tr", null, [el("th", { text: "姓名" }), el("th", { text: "学号" }), el("th", { text: "身份绑定" })])];
      var userByNo = {};
      CA.store.get("users").forEach(function (u) { if (u.studentNo) userByNo[u.studentNo] = u; });
      members.forEach(function (m) {
        var u = userByNo[m.studentNo];
        rows.push(el("tr", null, [
          el("td", { text: m.name }),
          el("td", { class: "num", text: m.studentNo }),
          el("td", {}, [el("span", { class: "badge " + (u ? "badge-success" : "badge-muted"), text: u ? roleLabel(u.role) : "未绑定" })])
        ]));
      });
      wrap.appendChild(el("div", { class: "card" }, [
        el("div", { class: "card-head" }, [
          el("div", { class: "card-title", text: "班级名单" }),
          el("div", { class: "card-sub", text: members.length + " 人 · 高二(3)班" })
        ]),
        el("div", { class: "table-wrap" }, [el("table", { class: "table table-compact" }, rows)])
      ]));
    }

    // 4) 演示数据
    wrap.appendChild(el("div", { class: "card" }, [
      el("div", { class: "card-head" }, [el("div", { class: "card-title", text: "演示数据" })]),
      el("p", { class: "muted", text: "所有数据保存在本机浏览器（localStorage），不上传任何服务器。重置将恢复 30 名学生 × 3 次考试的演示数据。" }),
      el("div", { class: "btn-group" }, [
        el("button", { class: "btn btn-sm", text: "导出数据 JSON", onclick: onExport }),
        el("button", { class: "btn btn-sm btn-danger", text: "重置演示数据", onclick: onReset })
      ])
    ]));

    root.appendChild(wrap);
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
    if (!window.confirm("确定重置为初始演示数据吗？当前所有修改（通知、成绩等）都会被清除。")) return;
    CA.store.reset();
    toast("演示数据已重置", "success");
    bindTopbar();   // 身份/开关回到默认
    rerender();
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

  function boot() {
    try { CA.store.init(); } catch (e) { /* 存储不可用时静默 */ }
    bindTopbar();
    bindTabbar();
    bindModalClose();
    // 支持 ?view=scores 直达某视图（调试/分享用），非法值回落到通知
    var wanted = null;
    try { wanted = new URLSearchParams(window.location.search).get("view"); } catch (e) { wanted = null; }
    var views = ["notices", "scores", "collect", "review", "settings"];
    switchView(views.indexOf(wanted) >= 0 ? wanted : "notices");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  return {
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    rerender: rerender,
    switchView: switchView,
    enter: enter
  };
})();
