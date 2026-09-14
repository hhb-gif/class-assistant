// 登录壳：登录视图 + 强制改密视图
// 契约依据：ROADMAP §4.3（学号即账号 + 首登强制改密）、PLAN-P1 §3 a5（app.js 登录门）、
//           DESIGN.md §4（.card/.form-field/.input/.btn/.field-error；禁 emoji、禁 ISO 直出）。
// 暴露：CA.views.login          = { mount(rootEl, opts), unmount() }
//       CA.views.changePassword = { mount(rootEl, opts), unmount() }
//   opts.onSuccess(me) 登录/改密成功回调（由 app.js 接管后续编排）
//   opts.onLogout()    改密页「退出登录」回调（可选，不传则隐藏该按钮）
//   opts.error         需要展示的初始化错误（可选）
//   opts.cloudDown     云端不可用标记（可选，展示 SDK/CORS 失败的可读提示）
// 仅调用 CA.auth.login / CA.auth.changePassword / CA.auth.logout；不修改 auth.js/cloud.js/store.js。
// 注：浏览器端真实渲染与登录联调未实测（见交付报告「未实测项」）。
window.CA = window.CA || {};
CA.views = CA.views || {};

(function () {
  "use strict";

  var MIN_PWD_LEN = 8;

  // ---------- 基础 DOM 工具 ----------
  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else n.setAttribute(k, v);
      });
    }
    if (typeof children === "string") n.textContent = children;
    else if (Array.isArray(children)) {
      children.forEach(function (c) {
        if (c == null || c === false) return;
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // 图标节点：优先 CA.iconEl，退回 CA.icon 字符串，最终退化为空占位（不抛错、不用 emoji）
  function iconNode(name, size) {
    var slot = h("span", { class: "icon-slot" });
    if (window.CA && CA.iconEl) {
      var el = CA.iconEl(name, size);
      if (el) { slot.appendChild(el); return slot; }
    }
    if (window.CA && CA.icon) slot.innerHTML = CA.icon(name, size);
    return slot;
  }

  function errText(e) {
    if (!e) return "未知错误";
    return e.message || e.msg || e.code || String(e);
  }

  function toast(msg, type) {
    if (window.CA && CA.app && typeof CA.app.toast === "function") CA.app.toast(msg, type);
  }

  // 密码策略前端预检（服务端仍会最终校验）：
  // ≥8 位，且包含「小写字母 / 大写字母 / 数字 / 符号」中至少 3 类（对应 ROADMAP §8 密码策略）。
  function passwordIssue(pwd) {
    if (!pwd || pwd.length < MIN_PWD_LEN) return "密码至少 " + MIN_PWD_LEN + " 位";
    var kinds = 0;
    if (/[a-z]/.test(pwd)) kinds++;
    if (/[A-Z]/.test(pwd)) kinds++;
    if (/[0-9]/.test(pwd)) kinds++;
    if (/[^A-Za-z0-9]/.test(pwd)) kinds++;
    if (kinds < 3) return "密码需包含大小写字母、数字、符号中的至少 3 类";
    return "";
  }

  // 错误提示条（默认隐藏，有错误时展示；.field-error + v3 .auth-error，不使用 alert 弹窗）
  function errorBox(id) {
    var box = h("div", { class: "field-error auth-error", id: id, role: "alert", "aria-live": "assertive" });
    box.style.display = "none";
    return box;
  }
  function showErr(box, msg) {
    if (!box) return;
    box.textContent = msg || "";
    box.style.display = msg ? "" : "none";
  }

  // 按钮加载态（复用 DESIGN.md §4.4 的 .is-loading / .spinner）
  function setBtnLoading(btn, loading, label, loadingLabel) {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.className = "btn btn-primary btn-block btn-lg" + (loading ? " is-loading" : "");
    clear(btn);
    if (loading) {
      btn.appendChild(h("span", { class: "spinner" }));
      btn.appendChild(document.createTextNode(loadingLabel || "处理中…"));
    } else {
      btn.appendChild(document.createTextNode(label || "提交"));
    }
  }

  // 居中卡片外壳：限制宽度并垂直留白（响应式下由 #view-root 的 padding 兜底）
  // v3：加 .auth-view 供精修层定位（不改 id，不影响登录逻辑）
  function sectionWrap(id, card) {
    card.style.maxWidth = "400px";
    card.style.margin = "6vh auto 0";
    return h("section", { id: id, class: "auth-view" }, [card]);
  }

  // v4 品牌横幅插画（Agnes 生成资产，纯装饰；图片缺失时自动隐藏，不影响登录）
  function authHero() {
    var img = h("img", { class: "auth-hero", src: "assets/hero-teacher.png", alt: "", "aria-hidden": "true" });
    img.addEventListener("error", function () { img.style.display = "none"; });
    return img;
  }

  // v3/v4 认证品牌区：几何色块 + 眉标 + 标题 + 副标题（纯视觉，无 id、无逻辑）
  function authBrand(iconName, eyebrow, title, sub) {
    var mark = h("div", { class: "auth-mark", "aria-hidden": "true" }, [iconNode(iconName, 20)]);
    var text = h("div", { class: "auth-brand-text" }, [
      h("div", { class: "auth-eyebrow", text: eyebrow }),
      h("div", { class: "auth-title", text: title }),
      sub ? h("div", { class: "auth-sub", text: sub }) : null
    ]);
    return h("div", { class: "auth-brand" }, [mark, text]);
  }

  // ================= 登录视图 =================
  var _login = null;

  function mountLogin(rootEl, opts) {
    opts = opts || {};
    var root = rootEl || document.getElementById("view-root");
    if (!root) return;
    clear(root);

    var errBox = errorBox("login-error");
    if (opts.cloudDown) {
      showErr(errBox, "云端暂时不可用：" + errText(opts.error) +
        "（请检查网络，或确认当前站点是否已在云环境安全域名白名单内）");
    } else if (opts.error) {
      showErr(errBox, errText(opts.error));
    }

    var userInput = h("input", {
      class: "input", id: "login-username", name: "username", type: "text",
      placeholder: "学号 / 账号", autocomplete: "username", required: "required"
    });
    var pwdInput = h("input", {
      class: "input", id: "login-password", name: "password", type: "password",
      placeholder: "请输入密码", autocomplete: "current-password", required: "required"
    });
    var submit = h("button", {
      class: "btn btn-primary btn-block btn-lg", id: "login-submit", type: "submit", text: "登录"
    });

    var form = h("form", { id: "login-form", class: "stack", novalidate: "novalidate" }, [
      h("div", { class: "form-field" }, [
        h("label", { class: "label", for: "login-username" }, ["账号", h("span", { class: "req", text: "*" })]),
        userInput
      ]),
      h("div", { class: "form-field" }, [
        h("label", { class: "label", for: "login-password" }, ["密码", h("span", { class: "req", text: "*" })]),
        pwdInput
      ]),
      errBox,
      h("div", { class: "form-actions" }, [submit]),
      h("p", { class: "field-hint auth-foot", text: "首次登录请使用管理员发放的初始账号与密码，登录后系统会要求修改密码。" })
    ]);

    var card = h("div", { class: "card auth-card" }, [
      authHero(),
      authBrand("user", "班级管家", "登录", "请使用学号登录"),
      form
    ]);

    root.appendChild(sectionWrap("view-login", card));

    var busy = false;
    function onSubmit(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busy) return;
      var u = (userInput.value || "").trim();
      var p = pwdInput.value || "";
      if (!u) { showErr(errBox, "请输入账号（学号）"); try { userInput.focus(); } catch (e1) {} return; }
      if (!p) { showErr(errBox, "请输入密码"); try { pwdInput.focus(); } catch (e2) {} return; }
      if (!(window.CA && CA.auth && typeof CA.auth.login === "function")) {
        showErr(errBox, "认证模块未加载（请检查 src/auth.js）");
        return;
      }
      showErr(errBox, "");
      busy = true;
      setBtnLoading(submit, true, "登录", "登录中…");
      var p0;
      try { p0 = CA.auth.login(u, p); } catch (e) { p0 = Promise.reject(e); }
      Promise.resolve(p0).then(function (me) {
        busy = false;
        setBtnLoading(submit, false, "登录", "登录中…");
        if (typeof opts.onSuccess === "function") opts.onSuccess(me);
      }).catch(function (e) {
        busy = false;
        setBtnLoading(submit, false, "登录", "登录中…");
        var msg = errText(e);
        showErr(errBox, "登录失败：" + msg);
        toast("登录失败：" + msg, "error");
        pwdInput.value = "";
        try { pwdInput.focus(); } catch (e3) {}
      });
    }

    form.addEventListener("submit", onSubmit);
    _login = { form: form, onSubmit: onSubmit };
    setTimeout(function () { try { userInput.focus(); } catch (e) {} }, 0);
  }

  function unmountLogin() {
    if (_login && _login.form) _login.form.removeEventListener("submit", _login.onSubmit);
    _login = null;
  }

  // ================= 强制改密视图 =================
  var _chpwd = null;

  function mountChangePassword(rootEl, opts) {
    opts = opts || {};
    var root = rootEl || document.getElementById("view-root");
    if (!root) return;
    clear(root);

    var errBox = errorBox("chpwd-error");

    var oldInput = h("input", {
      class: "input", id: "chpwd-old", name: "old", type: "password",
      placeholder: "当前密码（首次登录为初始密码）", autocomplete: "current-password", required: "required"
    });
    var newInput = h("input", {
      class: "input", id: "chpwd-new", name: "new", type: "password",
      placeholder: "新密码", autocomplete: "new-password", required: "required"
    });
    var confirmInput = h("input", {
      class: "input", id: "chpwd-confirm", name: "confirm", type: "password",
      placeholder: "再次输入新密码", autocomplete: "new-password", required: "required"
    });
    var submit = h("button", {
      class: "btn btn-primary btn-block btn-lg", id: "chpwd-submit", type: "submit", text: "确认修改"
    });
    var logoutBtn = h("button", {
      class: "btn btn-ghost btn-block", id: "chpwd-logout", type: "button", text: "退出登录"
    });
    logoutBtn.style.marginTop = "8px";
    logoutBtn.style.display = opts.onLogout ? "" : "none";

    var form = h("form", { id: "change-password-form", class: "stack", novalidate: "novalidate" }, [
      h("div", { class: "form-field" }, [
        h("label", { class: "label", for: "chpwd-old" }, ["当前密码", h("span", { class: "req", text: "*" })]),
        oldInput
      ]),
      h("div", { class: "form-field" }, [
        h("label", { class: "label", for: "chpwd-new" }, ["新密码", h("span", { class: "req", text: "*" })]),
        newInput,
        h("div", { class: "field-hint", id: "chpwd-hint", text: "至少 8 位，且包含大小写字母、数字、符号中的至少 3 类。" })
      ]),
      h("div", { class: "form-field" }, [
        h("label", { class: "label", for: "chpwd-confirm" }, ["确认新密码", h("span", { class: "req", text: "*" })]),
        confirmInput
      ]),
      errBox,
      h("div", { class: "form-actions" }, [submit]),
      logoutBtn
    ]);

    var card = h("div", { class: "card auth-card" }, [
      authHero(),
      authBrand("alert", "账号安全", "首次登录 · 请修改密码", "为保障账号安全，需先修改初始密码"),
      form
    ]);

    root.appendChild(sectionWrap("view-change-password", card));

    var busy = false;
    function onSubmit(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busy) return;
      var oldPwd = oldInput.value || "";
      var newPwd = newInput.value || "";
      var confirmPwd = confirmInput.value || "";
      if (!oldPwd) { showErr(errBox, "请输入当前密码"); try { oldInput.focus(); } catch (e1) {} return; }
      var issue = passwordIssue(newPwd);
      if (issue) { showErr(errBox, issue); try { newInput.focus(); } catch (e2) {} return; }
      if (newPwd === oldPwd) { showErr(errBox, "新密码不能与当前密码相同"); try { newInput.focus(); } catch (e3) {} return; }
      if (newPwd !== confirmPwd) { showErr(errBox, "两次输入的新密码不一致"); try { confirmInput.focus(); } catch (e4) {} return; }
      if (!(window.CA && CA.auth && typeof CA.auth.changePassword === "function")) {
        showErr(errBox, "认证模块未加载（请检查 src/auth.js）");
        return;
      }
      showErr(errBox, "");
      busy = true;
      setBtnLoading(submit, true, "确认修改", "修改中…");
      var p0;
      try { p0 = CA.auth.changePassword(oldPwd, newPwd); } catch (e) { p0 = Promise.reject(e); }
      Promise.resolve(p0).then(function () {
        busy = false;
        setBtnLoading(submit, false, "确认修改", "修改中…");
        toast("密码修改成功", "success");
        if (typeof opts.onSuccess === "function") opts.onSuccess();
      }).catch(function (e) {
        busy = false;
        setBtnLoading(submit, false, "确认修改", "修改中…");
        var msg = errText(e);
        showErr(errBox, "修改失败：" + msg);
        toast("修改失败：" + msg, "error");
      });
    }

    function onLogoutClick() {
      if (typeof opts.onLogout === "function") opts.onLogout();
    }

    form.addEventListener("submit", onSubmit);
    logoutBtn.addEventListener("click", onLogoutClick);
    _chpwd = { form: form, onSubmit: onSubmit, logoutBtn: logoutBtn, onLogoutClick: onLogoutClick };
    setTimeout(function () { try { oldInput.focus(); } catch (e) {} }, 0);
  }

  function unmountChangePassword() {
    if (_chpwd) {
      _chpwd.form.removeEventListener("submit", _chpwd.onSubmit);
      _chpwd.logoutBtn.removeEventListener("click", _chpwd.onLogoutClick);
    }
    _chpwd = null;
  }

  CA.views.login = { mount: mountLogin, unmount: unmountLogin };
  CA.views.changePassword = { mount: mountChangePassword, unmount: unmountChangePassword };
})();
