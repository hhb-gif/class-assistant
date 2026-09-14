// collect.js —— 信息收集（接龙 / 报名 / 投票 / 问卷）
// 角色：管理员（发起 / 结果统计 / 未交名单 / AI 汇总 / 关闭·删除）与学生（填写 / 查看自己的提交）。
// 对外：CA.views.collect = { mount, unmount }
//       CA.collect.stats(surveyId) / validate(draft) / buildResponse(survey, answers, memberId) / renderMarkdown(md)
// 依赖：CA.store / CA.auth / CA.util / CA.ai / CA.icon / CA.app（均为契约接口，缺失时安全降级）
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

  function round1(v) {
    var n = Number(v);
    return isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  function toast(msg, type) {
    try { if (CA.app && typeof CA.app.toast === "function") CA.app.toast(msg, type); } catch (e) { /* 忽略 */ }
  }

  function fmtSmart(v) {
    try {
      if (CA.util && typeof CA.util.fmtSmart === "function") return CA.util.fmtSmart(v) || "—";
    } catch (e) { /* 忽略 */ }
    return v ? String(v) : "—";
  }

  function nowMs() { return Date.now(); }

  // 极简 DOM 构造（与 scores.js 同款）
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
    "clipboard": '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "user": '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "close": '<path d="M18 6 6 18M6 6l12 12"/>',
    "trash": '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    "sparkles": '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
    "alert": '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.3 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.3a2 2 0 0 0-3.4 0Z"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    "eye": '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
  };

  function icon(name, size) {
    if (CA.icon && typeof CA.icon === "function") {
      try { return CA.icon(name, size); } catch (e) { /* 落到兜底 */ }
    }
    var body = FALLBACK_ICONS[name] || FALLBACK_ICONS.info || "";
    var px = size || 16;
    return '<svg class="icon" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + "</svg>";
  }

  function iconEl(name, size) {
    return h("span", { class: "icon-wrap", html: icon(name, size) });
  }

  // ============================================================
  // 纯函数（便于单测）
  // ============================================================

  // 校验草稿：返回 { ok, errors[], draft:{title,desc,deadline,anonymous,questions[]} }
  function validate(raw) {
    var d = raw || {};
    var errors = [];
    var title = String(d.title == null ? "" : d.title).trim();
    if (!title) errors.push("请填写标题");
    else if (title.length > 60) errors.push("标题过长（最多 60 字）");

    var deadline = String(d.deadline == null ? "" : d.deadline).trim();
    if (!deadline) errors.push("请填写截止时间");
    else if (isNaN(new Date(deadline).getTime())) errors.push("截止时间格式不正确");

    var qs = Array.isArray(d.questions) ? d.questions : [];
    if (!qs.length) errors.push("至少添加 1 道题目");

    var normalized = [];
    qs.forEach(function (q, i) {
      var type = q && q.type ? String(q.type) : "single";
      var n = {
        qid: q && q.qid ? String(q.qid) : "q" + (i + 1),
        type: type,
        title: q && q.title != null ? String(q.title).trim() : "",
        required: !!(q && q.required),
        options: []
      };
      if (["single", "multi", "text"].indexOf(type) < 0) {
        errors.push("第 " + (i + 1) + " 题题型非法");
        n.type = "single";
      }
      if (!n.title) errors.push("第 " + (i + 1) + " 题缺少题干");
      if (n.type === "text") {
        n.options = [];
      } else {
        var seen = {};
        var uniq = [];
        (q && Array.isArray(q.options) ? q.options : []).forEach(function (o) {
          var s = String(o == null ? "" : o).trim();
          if (s && !seen[s]) { seen[s] = 1; uniq.push(s); }
        });
        if (uniq.length < 2) errors.push("第 " + (i + 1) + " 题至少需要 2 个不同选项");
        n.options = uniq;
      }
      normalized.push(n);
    });

    return {
      ok: errors.length === 0,
      errors: errors,
      draft: {
        title: title,
        desc: String(d.desc == null ? "" : d.desc).trim(),
        deadline: deadline,
        anonymous: !!d.anonymous,
        questions: normalized
      }
    };
  }

  // 构造一条提交记录（不生成 id，由 store 负责；更新场景外部保留原 id）
  // answers 支持 {qid:value} 映射或 [{qid,value}] 数组；value：single→string / multi→string[] / text→string
  function buildResponse(survey, answers, memberId) {
    var map = {};
    if (Array.isArray(answers)) {
      answers.forEach(function (a) { if (a && a.qid != null) map[a.qid] = a.value; });
    } else if (answers && typeof answers === "object") {
      map = answers;
    }
    var out = [];
    ((survey && survey.questions) || []).forEach(function (q) {
      var v = map[q.qid];
      if (q.type === "text") {
        var s = v == null ? "" : String(v).trim();
        if (s !== "" || q.required) out.push({ qid: q.qid, value: s });
      } else if (q.type === "multi") {
        var arr = Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
        arr = arr.map(function (x) { return String(x); }).filter(function (x) { return x !== ""; });
        out.push({ qid: q.qid, value: arr });
      } else {
        out.push({ qid: q.qid, value: v == null ? "" : String(v) });
      }
    });
    return { surveyId: survey ? survey.id : null, memberId: memberId, answers: out };
  }

  // 本地统计（不依赖 ai.js）：票数 / 文本 / 未交名单 / 百分比拆分
  function computeStats(surveyId) {
    var survey = CA.store.find("surveys", surveyId);
    if (!survey) return null;
    var responses = CA.store.query("responses", function (r) { return r.surveyId === surveyId; });
    var members = CA.store.get("members") || [];
    var answered = {};
    responses.forEach(function (r) { answered[r.memberId] = true; });
    var missingIds = members.filter(function (m) { return !answered[m.id]; }).map(function (m) { return m.id; });
    var missing = missingIds.map(function (mid) {
      var name = "";
      try { name = CA.store.memberName ? CA.store.memberName(mid) : ""; } catch (e) { name = ""; }
      if (!name) {
        for (var i = 0; i < members.length; i++) if (members[i].id === mid) { name = members[i].name; break; }
      }
      return name || mid;
    });

    var questions = (survey.questions || []).map(function (q) {
      var counts = {};
      var texts = [];
      responses.forEach(function (r) {
        var a = (r.answers || []).filter(function (x) { return x.qid === q.qid; })[0];
        if (!a) return;
        if (q.type === "text") { if (a.value) texts.push(String(a.value)); return; }
        var vals = Array.isArray(a.value) ? a.value : [a.value];
        vals.forEach(function (v) { if (v != null && v !== "") counts[v] = (counts[v] || 0) + 1; });
      });
      var votes = 0;
      Object.keys(counts).forEach(function (k) { votes += counts[k]; });
      // 选项拆分：优先使用问卷定义顺序，补上定义外的自由选项
      var labels = (q.options || []).slice();
      Object.keys(counts).forEach(function (k) { if (labels.indexOf(k) < 0) labels.push(k); });
      var breakdown = labels.map(function (label) {
        var c = counts[label] || 0;
        return { label: label, count: c, percent: votes ? round1(c / votes * 100) : 0 };
      });
      return {
        qid: q.qid, type: q.type, title: q.title, options: q.options || [],
        counts: counts, texts: texts, votes: votes, breakdown: breakdown, answered: responses.length
      };
    });

    return {
      survey: survey,
      total: members.length,
      submitted: responses.length,
      missing: missing,
      missingIds: missingIds,
      questions: questions
    };
  }

  // 对外统计：优先复用 CA.ai.surveyStats 的 missing/submitted/total，题目票数本地计算
  function stats(surveyId) {
    var local = computeStats(surveyId);
    if (!local) return null;
    try {
      if (CA.ai && typeof CA.ai.surveyStats === "function") {
        var s = CA.ai.surveyStats(surveyId);
        if (s && typeof s === "object") {
          if (Array.isArray(s.missing)) local.missing = s.missing.slice();
          if (typeof s.submitted === "number") local.submitted = s.submitted;
          if (typeof s.total === "number") local.total = s.total;
        }
      }
    } catch (e) { /* 统计失败不影响本地结果 */ }
    return local;
  }

  // markdown -> 安全 HTML：先整体转义，再解析 ## 标题 / **粗体** / - 列表 / 段落
  function renderMarkdown(md) {
    var lines = esc(String(md == null ? "" : md)).split(/\r?\n/);
    var out = [];
    var inList = false;
    function inline(s) {
      return s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    }
    function closeList() { if (inList) { out.push("</ul>"); inList = false; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^[-*]\s+/.test(line)) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>");
        continue;
      }
      closeList();
      if (!line) continue;
      if (/^###\s+/.test(line)) { out.push("<h4>" + inline(line.replace(/^###\s+/, "")) + "</h4>"); continue; }
      if (/^#{1,2}\s+/.test(line)) { out.push("<h3>" + inline(line.replace(/^#{1,2}\s+/, "")) + "</h3>"); continue; }
      out.push("<p>" + inline(line) + "</p>");
    }
    closeList();
    return out.length ? out.join("") : '<p class="muted">（无内容）</p>';
  }

  // ============================================================
  // 视图状态
  // ============================================================
  var state = null;
  var styleInjected = false;

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    if (typeof document === "undefined" || !document.createElement) return;
    var host = document.head || document.body;
    if (!host || typeof host.appendChild !== "function") return;
    var css =
      ".ca-collect{display:flex;flex-direction:column;gap:16px}" +
      ".ca-collect .list-row{display:flex;align-items:center;gap:12px;padding:12px 14px}" +
      ".ca-collect .list-row .list-main{flex:1;min-width:0}" +
      ".ca-collect .list-row .row{gap:8px;flex:none}" +
      ".ca-collect .list-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".ca-collect .list-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}" +
      ".ca-collect .list-meta .icon-wrap{display:inline-flex;color:var(--text-3)}" +
      ".ca-collect .q-item{border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;margin-bottom:12px;background:var(--surface)}" +
      ".ca-collect .q-item .row{gap:8px}" +
      ".ca-collect .opt{display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:14px;color:var(--text-2)}" +
      ".ca-collect .opt input{width:auto;min-width:0;margin:0}" +
      ".ca-collect .q-block{padding:12px 0;border-top:1px dashed var(--border)}" +
      ".ca-collect .q-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}" +
      ".ca-collect .q-title{font-weight:600;color:var(--text)}" +
      ".ca-collect .opt-row{display:grid;grid-template-columns:minmax(90px,1.1fr) minmax(60px,2fr) auto;align-items:center;gap:10px;padding:5px 0}" +
      ".ca-collect .opt-name{font-size:14px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ca-collect .opt-count{font-size:12.5px;color:var(--text-3);font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".ca-collect .bar{height:8px;border-radius:999px;background:var(--surface-2);overflow:hidden}" +
      ".ca-collect .bar>i{display:block;height:100%;border-radius:999px;background:var(--primary);transition:width .2s}" +
      ".ca-collect .text-list{display:flex;flex-direction:column;gap:6px}" +
      ".ca-collect .text-item{padding:8px 10px;background:var(--surface-2);border-radius:var(--r-sm);font-size:14px;color:var(--text-2);line-height:1.5}" +
      ".ca-collect .md{font-size:14px;line-height:1.7;color:var(--text-2)}" +
      ".ca-collect .md h3{font-size:15px;margin:10px 0 6px;color:var(--text)}" +
      ".ca-collect .md h4{font-size:14px;margin:8px 0 4px;color:var(--text)}" +
      ".ca-collect .md p{margin:6px 0}" +
      ".ca-collect .md ul{margin:6px 0;padding-left:20px}" +
      ".ca-collect .md code{background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:12px}" +
      "@media(max-width:768px){.ca-collect .opt-row{grid-template-columns:1fr auto;grid-template-areas:'name count' 'bar bar'}" +
      ".ca-collect .opt-row .opt-name{grid-area:name}.ca-collect .opt-row .opt-count{grid-area:count}.ca-collect .opt-row .bar{grid-area:bar}}";
    var style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.textContent = css;
    host.appendChild(style);
  }

  // ---------- 数据辅助 ----------
  function currentUser() {
    try { return (CA.auth && CA.auth.current && CA.auth.current()) || {}; } catch (e) { return {}; }
  }
  function isAdmin() {
    try { return !!(CA.auth && CA.auth.isAdmin && CA.auth.isAdmin()); } catch (e) { return false; }
  }
  function aiEnabled() {
    try { return !!(CA.ai && typeof CA.ai.enabled === "function" && CA.ai.enabled()); } catch (e) { return false; }
  }
  function typeLabel(t) {
    return t === "multi" ? "多选" : (t === "text" ? "文本" : "单选");
  }

  // 截止 / 关闭状态
  function surveyState(s) {
    if (s.status === "closed") return { key: "closed", label: "已关闭", cls: "badge-muted", fillable: false };
    if (s.deadline && new Date(s.deadline).getTime() < nowMs()) {
      return { key: "expired", label: "已截止", cls: "badge-warn", fillable: false };
    }
    return { key: "open", label: "进行中", cls: "badge-success", fillable: true };
  }

  function sortedSurveys() {
    return (CA.store.get("surveys") || []).slice().sort(function (a, b) {
      var ta = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      var tb = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      if (ta !== tb) return ta - tb;
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
  }

  // 当前学生对应的名单 id（与 scores.js 同策略：学号优先，其次姓名）
  function myMemberId() {
    var u = currentUser();
    var members = CA.store.get("members") || [];
    if (u.studentNo) {
      for (var i = 0; i < members.length; i++) if (String(members[i].studentNo) === String(u.studentNo)) return members[i].id;
    }
    if (u.name) {
      for (var j = 0; j < members.length; j++) if (members[j].name === u.name) return members[j].id;
    }
    return null;
  }

  function findResponse(surveyId, memberId) {
    var all = CA.store.get("responses") || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].surveyId === surveyId && all[i].memberId === memberId) return all[i];
    }
    return null;
  }

  function progressOf(surveyId) {
    return (CA.store.query("responses", function (r) { return r.surveyId === surveyId; }) || []).length;
  }

  // ============================================================
  // 列表
  // ============================================================
  // 空态插画（几何线条风，~120px）
  var EMPTY_ART = {
    clipboard:
      '<circle class="ea-soft" cx="88" cy="32" r="13"/>' +
      '<rect class="ea-plate" x="30" y="26" width="56" height="70" rx="12"/>' +
      '<rect class="ea-clip" x="49" y="19" width="18" height="13" rx="6"/>' +
      '<circle class="ea-accent" cx="45" cy="50" r="5"/><path class="ea-accent" d="M43 50l1.7 1.7 3-3.3"/><path class="ea-dash" d="M58 50h17"/>' +
      '<circle class="ea-accent" cx="45" cy="68" r="5"/><path class="ea-accent" d="M43 68l1.7 1.7 3-3.3"/><path class="ea-dash" d="M58 68h17"/>' +
      '<circle class="ea-soft" cx="45" cy="84" r="5"/><path class="ea-dash" d="M58 84h17"/>'
  };
  function emptyArtSvg(name) {
    var body = EMPTY_ART[name] || EMPTY_ART.clipboard;
    return '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">' + body + "</svg>";
  }

  function emptyState(title, desc, iconName) {
    return h("div", { class: "empty" }, [
      h("div", { class: "empty-art", html: emptyArtSvg(iconName) }),
      h("div", { class: "empty-title", text: title }),
      h("p", { class: "empty-desc", text: desc })
    ]);
  }

  // 入场 stagger：优先复用 app.js 的 enter，缺失时本地降级
  function stagger(box) {
    if (CA.app && typeof CA.app.enter === "function") { CA.app.enter(box); return; }
    if (!box || !box.classList) return;
    box.classList.remove("ca-enter");
    void box.offsetWidth;
    box.classList.add("ca-enter");
    if (box.__enterT) clearTimeout(box.__enterT);
    box.__enterT = setTimeout(function () { if (box.classList) box.classList.remove("ca-enter"); }, 820);
  }

  function renderList() {
    var list = state.listEl;
    if (!list) return;
    list.innerHTML = "";
    var all = sortedSurveys();
    var surveys = state.isAdmin ? all : all.filter(function (s) { return s.status === "open"; });

    if (!surveys.length) {
      list.appendChild(emptyState(
        state.isAdmin ? "还没有收集表" : "暂无进行中的收集",
        state.isAdmin ? "点击右上角「新建收集」发起接龙 / 报名 / 投票 / 问卷。" : "老师发布后会显示在这里。",
        "clipboard"
      ));
      return;
    }

    var mid = state.isAdmin ? null : myMemberId();
    surveys.forEach(function (s) { list.appendChild(listRow(s, mid)); });
    stagger(list);
  }

  function listRow(s, mid) {
    var st = surveyState(s);
    var total = (CA.store.get("members") || []).length;
    var submitted = progressOf(s.id);

    var row = h("div", { class: "list-row", "data-survey-id": s.id, role: "button", tabindex: "0" });
    var main = h("div", { class: "list-main" });

    var title = h("div", { class: "list-title" }, [
      h("span", { class: "list-title-text", text: s.title }),
      h("span", { class: "badge " + st.cls, text: st.label })
    ]);
    if (s.anonymous) title.appendChild(h("span", { class: "badge badge-muted", text: "匿名" }));
    main.appendChild(title);

    var meta = h("div", { class: "list-meta" });
    meta.appendChild(iconEl("clock", 13));
    meta.appendChild(h("span", { text: "截止 " + fmtSmart(s.deadline) }));
    meta.appendChild(h("span", { text: "·" }));
    meta.appendChild(h("span", { text: ((s.questions || []).length) + " 道题" }));
    main.appendChild(meta);
    row.appendChild(main);

    var side = h("div", { class: "row" });
    if (state.isAdmin) {
      side.appendChild(h("span", { class: "chip", text: "已交 " + submitted + "/" + total }));
    } else {
      var mine = mid ? findResponse(s.id, mid) : null;
      if (mine) side.appendChild(h("span", { class: "badge badge-success", text: "已提交" }));
      else if (st.fillable) side.appendChild(h("span", { class: "badge badge-muted", text: "待填写" }));
    }
    row.appendChild(iconEl("chevron-right", 16));
    row.appendChild(side);

    row.addEventListener("click", function () { selectSurvey(s.id); });
    return row;
  }

  // ============================================================
  // 详情分发
  // ============================================================
  function selectSurvey(id) {
    state.selectedId = id;
    state.reEditing = false;
    state.detailEl.hidden = false;
    refreshDetail();
  }

  function clearDetail() {
    state.selectedId = null;
    state.reEditing = false;
    if (state.detailEl) { state.detailEl.hidden = true; state.detailEl.innerHTML = ""; }
  }

  function refreshDetail() {
    if (!state.selectedId) { clearDetail(); return; }
    var s = CA.store.find("surveys", state.selectedId);
    if (!s) { clearDetail(); return; }
    if (state.isAdmin) renderResult(s);
    else renderFill(s);
  }

  // ============================================================
  // 管理员 · 结果
  // ============================================================
  function renderResult(s) {
    var det = state.detailEl;
    det.hidden = false;
    det.innerHTML = "";
    var st = surveyState(s);
    var data = stats(s.id) || computeStats(s.id);

    var card = h("div", { class: "card" });
    var head = h("div", { class: "card-head" });
    head.appendChild(h("div", { class: "card-title" }, [
      iconEl("clipboard", 18),
      h("span", { text: s.title }),
      h("span", { class: "badge " + st.cls, text: st.label })
    ]));
    if (s.anonymous) head.appendChild(h("span", { class: "badge badge-muted", text: "匿名收集" }));

    var actions = h("div", { class: "row" });
    var editBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button", "data-act": "edit" }, [iconEl("edit", 14), h("span", { text: "编辑" })]);
    editBtn.addEventListener("click", function () { openForm(s); });
    actions.appendChild(editBtn);

    var toggleBtn = h("button", { class: "btn btn-sm", type: "button", "data-act": "toggle" });
    if (s.status === "closed") {
      toggleBtn.appendChild(iconEl("check", 14));
      toggleBtn.appendChild(h("span", { text: "重新开启" }));
    } else {
      toggleBtn.appendChild(iconEl("clock", 14));
      toggleBtn.appendChild(h("span", { text: "关闭收集" }));
    }
    toggleBtn.addEventListener("click", function () {
      CA.store.update("surveys", s.id, { status: s.status === "closed" ? "open" : "closed" });
      toast(s.status === "closed" ? "已重新开启" : "已关闭收集", "success");
      refresh();
    });
    actions.appendChild(toggleBtn);

    var delBtn = h("button", { class: "btn btn-danger btn-sm", type: "button", "data-act": "delete" }, [iconEl("trash", 14), h("span", { text: "删除" })]);
    delBtn.addEventListener("click", function () { onDelete(s); });
    actions.appendChild(delBtn);

    head.appendChild(actions);
    card.appendChild(head);

    if (s.desc) card.appendChild(h("p", { class: "muted", text: s.desc }));

    // 统计概览
    var total = data ? data.total : (CA.store.get("members") || []).length;
    var submitted = data ? data.submitted : 0;
    card.appendChild(h("div", { class: "stat-grid" }, [
      h("div", { class: "stat emphasis" }, [h("div", { class: "stat-value", text: String(submitted) }), h("div", { class: "stat-label", text: "已提交" })]),
      h("div", { class: "stat" }, [h("div", { class: "stat-value", text: String(Math.max(0, total - submitted)) }), h("div", { class: "stat-label", text: "未提交" })]),
      h("div", { class: "stat" }, [h("div", { class: "stat-value", text: fmtSmart(s.deadline) }), h("div", { class: "stat-label", text: "截止时间" })])
    ]));

    // 逐题统计
    (data ? data.questions : []).forEach(function (q, qi) {
      var block = h("div", { class: "q-block" });
      block.appendChild(h("div", { class: "q-head" }, [
        h("div", { class: "q-title", text: (qi + 1) + ". " + q.title }),
        h("span", { class: "badge badge-muted", text: typeLabel(q.type) })
      ]));
      if (q.type === "text") {
        if (q.texts && q.texts.length) {
          var list = h("div", { class: "text-list" });
          q.texts.forEach(function (t) { list.appendChild(h("div", { class: "text-item", text: t })); });
          block.appendChild(list);
        } else {
          block.appendChild(h("div", { class: "muted", text: "暂无文本回答" }));
        }
      } else {
        (q.breakdown || []).forEach(function (b) {
          block.appendChild(h("div", { class: "opt-row" }, [
            h("span", { class: "opt-name", text: b.label }),
            h("div", { class: "bar" }, [h("i", { style: "width:" + b.percent + "%" })]),
            h("span", { class: "opt-count", text: b.count + " 票（" + b.percent + "%）" })
          ]));
        });
      }
      card.appendChild(block);
    });

    // 未提交名单（管理端专属）
    var missing = (data && data.missing) || [];
    var missingCard = h("div", { class: "card" });
    missingCard.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconEl("users", 16), h("span", { text: "未提交名单" })]),
      h("span", { class: "card-sub", text: missing.length + " 人" })
    ]));
    if (missing.length) {
      missingCard.appendChild(h("p", { class: "muted", text: missing.join("、") }));
    } else {
      missingCard.appendChild(h("p", { class: "muted", text: "全部已提交" }));
    }
    det.appendChild(card);
    det.appendChild(missingCard);

    // AI 汇总（管理端专属）
    det.appendChild(renderAiCard(s));
  }

  function onDelete(s) {
    var okConfirm = true;
    try {
      if (typeof window.confirm === "function") okConfirm = window.confirm("确定删除收集表「" + s.title + "」吗？相关提交记录也会一并删除，且不可恢复。");
    } catch (e) { okConfirm = true; }
    if (!okConfirm) return;
    // 先删除其下提交记录，再删除收集表
    (CA.store.query("responses", function (r) { return r.surveyId === s.id; }) || []).forEach(function (r) {
      CA.store.remove("responses", r.id);
    });
    CA.store.remove("surveys", s.id);
    toast("已删除收集表", "success");
    clearDetail();
    refresh();
  }

  function renderAiCard(s) {
    var card = h("div", { class: "card" });
    var on = aiEnabled();
    var btn = h("button", {
      class: "btn btn-ai btn-sm", id: "btn-ai-summary", type: "button",
      disabled: !on, hidden: !on
    }, [iconEl("sparkles", 14), h("span", { text: "生成汇总" })]);
    card.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconEl("sparkles", 16), h("span", { text: "AI 归类汇总" })]),
      btn
    ]));
    card.appendChild(h("div", {
      class: "md", id: "ai-summary-box",
      html: '<p class="muted">' + (on ? "点击「生成汇总」，AI 将归纳选项与文本回答，给出结论与建议。" : "AI 助手未开启，汇总不可用。") + "</p>"
    }));

    btn.addEventListener("click", function () { generateSummary(s, btn); });
    return card;
  }

  function generateSummary(s, btn) {
    if (!aiEnabled()) return;
    var box = state.detailEl.querySelector("#ai-summary-box");
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "生成中…";
    if (box) box.innerHTML = '<p class="muted">AI 正在归纳本次收集结果…</p>';
    Promise.resolve()
      .then(function () { return CA.ai.summarizeResponses(s.id); })
      .then(function (res) {
        var md = res && res.markdown != null ? res.markdown : (typeof res === "string" ? res : "");
        if (box) box.innerHTML = renderMarkdown(md);
      })
      .catch(function (e) {
        var msg = (e && e.message) || "未知错误";
        if (box) box.innerHTML = '<p class="field-error">生成失败：' + esc(msg) + "</p>";
        toast("AI 汇总失败：" + msg, "error");
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = old;
      });
  }

  // ============================================================
  // 学生 · 填写 / 已提交
  // ============================================================
  function renderFill(s) {
    var det = state.detailEl;
    det.hidden = false;
    det.innerHTML = "";
    var st = surveyState(s);
    var mid = myMemberId();
    var existing = mid ? findResponse(s.id, mid) : null;

    var card = h("div", { class: "card" });
    var head = h("div", { class: "card-head" });
    head.appendChild(h("div", { class: "card-title" }, [
      iconEl("clipboard", 18),
      h("span", { text: s.title }),
      h("span", { class: "badge " + st.cls, text: st.label })
    ]));
    if (existing) head.appendChild(h("span", { class: "badge badge-success", text: "已提交" }));
    if (s.anonymous) head.appendChild(h("span", { class: "badge badge-muted", text: "匿名" }));
    card.appendChild(head);

    if (s.desc) card.appendChild(h("p", { class: "muted", text: s.desc }));

    var meta = h("div", { class: "list-meta" });
    meta.appendChild(iconEl("clock", 13));
    meta.appendChild(h("span", { text: "截止 " + fmtSmart(s.deadline) }));
    card.appendChild(meta);

    if (!mid) {
      card.appendChild(h("p", { class: "field-error", text: "未在班级名单中找到你的信息，请联系老师。" }));
      det.appendChild(card);
      return;
    }

    if (existing && !state.reEditing) {
      renderSubmitted(card, s, existing);
    } else if (!st.fillable) {
      card.appendChild(h("p", { class: "muted", text: st.key === "closed" ? "该收集已关闭，无法提交。" : "已过截止时间，无法提交。" }));
      if (existing) card.appendChild(h("p", { class: "muted", text: "你已提交过，以下为你的回答：" }));
      if (existing) renderOwnAnswers(card, s, existing);
    } else {
      renderFillForm(card, s, existing);
    }
    det.appendChild(card);
  }

  function renderSubmitted(card, s, existing) {
    card.appendChild(h("p", { class: "muted", text: "你已于以下时间提交，以下为你的回答：" }));
    renderOwnAnswers(card, s, existing);
    var actions = h("div", { class: "form-actions" });
    var editBtn = h("button", { class: "btn btn-sm", type: "button" }, [iconEl("edit", 14), h("span", { text: "修改提交" })]);
    editBtn.addEventListener("click", function () { state.reEditing = true; refreshDetail(); });
    actions.appendChild(editBtn);
    card.appendChild(actions);
  }

  function renderOwnAnswers(card, s, existing) {
    var map = {};
    (existing.answers || []).forEach(function (a) { map[a.qid] = a.value; });
    (s.questions || []).forEach(function (q) {
      var v = map[q.qid];
      var text;
      if (q.type === "text") text = (v == null || v === "") ? "—" : String(v);
      else if (Array.isArray(v)) text = v.length ? v.join("、") : "—";
      else text = (v == null || v === "") ? "—" : String(v);
      card.appendChild(h("div", { class: "form-field" }, [
        h("div", { class: "label", text: q.title }),
        h("div", { class: "text-item", text: text })
      ]));
    });
  }

  function renderFillForm(card, s, existing) {
    var form = h("form", { class: "form-grid", id: "collect-fill-form" });
    var old = {};
    if (existing) (existing.answers || []).forEach(function (a) { old[a.qid] = a.value; });

    (s.questions || []).forEach(function (q) {
      var field = h("div", { class: "form-field span-2" });
      var label = h("label", { class: "label" }, [h("span", { text: q.title })]);
      if (q.required) label.appendChild(h("span", { class: "req", text: " *" }));
      field.appendChild(label);

      if (q.type === "text") {
        var ta = h("textarea", { name: "ans_" + q.qid, rows: "3", placeholder: "请输入你的回答" });
        if (old[q.qid] != null) ta.value = String(old[q.qid]);
        field.appendChild(ta);
      } else {
        var chosen = old[q.qid];
        var chosenArr = Array.isArray(chosen) ? chosen : (chosen == null || chosen === "" ? [] : [chosen]);
        (q.options || []).forEach(function (opt) {
          var input = h("input", {
            type: q.type === "multi" ? "checkbox" : "radio",
            name: "ans_" + q.qid, value: opt
          });
          if (chosenArr.indexOf(opt) >= 0) input.checked = true;
          field.appendChild(h("label", { class: "opt" }, [input, h("span", { text: opt })]));
        });
      }
      form.appendChild(field);
    });

    var errBox = h("div", { class: "field-error span-2", id: "collect-fill-error", hidden: true });
    form.appendChild(errBox);

    var actions = h("div", { class: "form-actions span-2" });
    var submit = h("button", { class: "btn btn-primary", type: "submit", text: existing ? "保存修改" : "提交" });
    actions.appendChild(submit);
    if (state.reEditing) {
      var cancel = h("button", { class: "btn", type: "button", text: "取消" });
      cancel.addEventListener("click", function () { state.reEditing = false; refreshDetail(); });
      actions.appendChild(cancel);
    }
    form.appendChild(actions);

    form.addEventListener("submit", function (ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      onSubmitFill(s, form, errBox);
    });
    card.appendChild(form);
  }

  function onSubmitFill(s, form, errBox) {
    var answers = {};
    var errors = [];
    (s.questions || []).forEach(function (q) {
      var ins = form.querySelectorAll('[name="ans_' + q.qid + '"]');
      if (q.type === "text") {
        var ta = ins[0];
        var val = ta ? String(ta.value || "").trim() : "";
        if (q.required && !val) errors.push(q.title + " 为必填");
        answers[q.qid] = val;
      } else {
        var checked = [];
        ins.forEach(function (x) { if (x.checked) checked.push(x.value); });
        if (q.required && checked.length === 0) errors.push(q.title + " 为必填");
        answers[q.qid] = (q.type === "multi") ? checked : (checked[0] || "");
      }
    });

    if (errors.length) {
      if (errBox) { errBox.hidden = false; errBox.textContent = errors.join("；"); }
      toast(errors[0], "error");
      return;
    }

    var mid = myMemberId();
    if (!mid) { toast("未在班级名单中找到你的信息", "error"); return; }
    var built = buildResponse(s, answers, mid);
    var existing = findResponse(s.id, mid);
    if (existing) {
      CA.store.update("responses", existing.id, { answers: built.answers });
      toast("已更新你的提交", "success");
    } else {
      CA.store.add("responses", { surveyId: s.id, memberId: mid, answers: built.answers });
      toast("提交成功", "success");
    }
    state.reEditing = false;
    refresh();
  }

  // ============================================================
  // 管理员 · 新建 / 编辑表单
  // ============================================================
  function blankDraft() {
    return {
      id: null, status: "open", title: "", desc: "", deadline: "", anonymous: false,
      questions: [{ qid: "q1", type: "single", title: "", required: true, options: ["", ""] }]
    };
  }

  function draftFromSurvey(s) {
    return {
      id: s.id, status: s.status || "open", title: s.title || "", desc: s.desc || "",
      deadline: s.deadline || "", anonymous: !!s.anonymous,
      questions: (s.questions || []).map(function (q) {
        return {
          qid: q.qid, type: q.type, title: q.title || "", required: !!q.required,
          options: (q.options || []).slice()
        };
      })
    };
  }

  function openForm(survey) {
    state.formOpen = true;
    state.draft = survey ? draftFromSurvey(survey) : blankDraft();
    state.formEl.hidden = false;
    renderForm();
    if (state.formEl.scrollIntoView && typeof state.formEl.scrollIntoView === "function") {
      try { state.formEl.scrollIntoView({ block: "start" }); } catch (e) { /* 忽略 */ }
    }
  }

  function closeForm() {
    state.formOpen = false;
    state.draft = null;
    if (state.formEl) { state.formEl.hidden = true; state.formEl.innerHTML = ""; }
  }

  function renderForm() {
    var form = state.formEl;
    form.innerHTML = "";
    var d = state.draft;

    form.appendChild(field("标题", h("input", { type: "text", name: "title", value: d.title, placeholder: "如：秋季运动会报名", maxlength: "60" }), true));
    form.appendChild(field("说明", h("textarea", { name: "desc", rows: "2", placeholder: "补充说明（选填）" }), false, d.desc));
    form.appendChild(field("截止时间", h("input", { type: "datetime-local", name: "deadline", value: toLocalInput(d.deadline) }), true));

    var anonField = h("div", { class: "form-field" }, [
      h("label", { class: "label" }, [h("span", { text: "匿名收集" })]),
      h("label", { class: "opt" }, [checkboxInput("anonymous", d.anonymous), h("span", { text: "不记录提交者与答案的对应关系" })])
    ]);
    form.appendChild(anonField);

    // 题目区
    var qWrap = h("div", { class: "span-2" });
    qWrap.appendChild(h("div", { class: "row-between" }, [
      h("div", { class: "label", text: "题目" }),
      (function () {
        var add = h("button", { class: "btn btn-sm", type: "button", id: "btn-collect-add-q" }, [iconEl("plus", 14), h("span", { text: "添加题目" })]);
        add.addEventListener("click", function () {
          syncDraftFromForm();
          state.draft.questions.push({ qid: "q" + (state.draft.questions.length + 1), type: "single", title: "", required: true, options: ["", ""] });
          renderForm();
        });
        return add;
      })()
    ]));
    d.questions.forEach(function (q, qi) { qWrap.appendChild(questionItem(q, qi)); });
    form.appendChild(qWrap);

    var errBox = h("div", { class: "field-error span-2", id: "collect-form-error", hidden: true });
    form.appendChild(errBox);

    var actions = h("div", { class: "form-actions span-2" });
    actions.appendChild(h("button", { class: "btn btn-primary", type: "submit", text: d.id ? "保存修改" : "创建收集表" }));
    var cancel = h("button", { class: "btn", type: "button", text: "取消" });
    cancel.addEventListener("click", closeForm);
    actions.appendChild(cancel);
    form.appendChild(actions);
  }

  function checkboxInput(name, checked) {
    var box = h("input", { type: "checkbox", name: name });
    box.checked = !!checked;
    return box;
  }

  function field(labelText, input, required, value) {
    var f = h("div", { class: "form-field" });
    var lab = h("label", { class: "label" }, [h("span", { text: labelText })]);
    if (required) lab.appendChild(h("span", { class: "req", text: " *" }));
    f.appendChild(lab);
    if (input.tagName === "TEXTAREA" && value != null) input.value = String(value);
    f.appendChild(input);
    return f;
  }

  function questionItem(q, qi) {
    var item = h("div", { class: "q-item", "data-qi": qi, "data-qid": q.qid });

    var headRow = h("div", { class: "row-between" });
    var typeSel = h("select", { name: "q_type" }, [
      h("option", { value: "single", text: "单选" }),
      h("option", { value: "multi", text: "多选" }),
      h("option", { value: "text", text: "文本" })
    ]);
    typeSel.value = q.type;
    typeSel.addEventListener("change", function () {
      syncDraftFromForm();
      var cur = state.draft.questions[qi];
      cur.type = typeSel.value;
      if (cur.type === "text") cur.options = [];
      else if (cur.options.length < 2) cur.options = ["", ""];
      renderForm();
    });
    var requiredLabel = h("label", { class: "opt" }, [checkboxInput("q_required", q.required), h("span", { text: "必填" })]);
    var removeBtn = h("button", { class: "btn btn-ghost-danger btn-sm", type: "button", "data-act": "remove-q" }, [iconEl("trash", 13), h("span", { text: "删除题目" })]);
    removeBtn.addEventListener("click", function () {
      syncDraftFromForm();
      state.draft.questions.splice(qi, 1);
      if (!state.draft.questions.length) state.draft.questions.push({ qid: "q1", type: "single", title: "", required: true, options: ["", ""] });
      renderForm();
    });
    headRow.appendChild(h("span", { class: "badge badge-cat", text: "第 " + (qi + 1) + " 题" }));
    headRow.appendChild(typeSel);
    headRow.appendChild(requiredLabel);
    headRow.appendChild(removeBtn);
    item.appendChild(headRow);

    item.appendChild(h("div", { class: "form-field" }, [
      h("label", { class: "label" }, [h("span", { text: "题干" })]),
      h("input", { type: "text", name: "q_title", value: q.title, placeholder: "请输入题目" })
    ]));

    if (q.type !== "text") {
      var optWrap = h("div", { class: "form-field" });
      optWrap.appendChild(h("div", { class: "label", text: "选项（至少 2 个）" }));
      q.options.forEach(function (opt, oi) {
        var row = h("div", { class: "row" });
        row.appendChild(h("input", { type: "text", name: "q_option", "data-oi": oi, value: opt, placeholder: "选项 " + (oi + 1) }));
        var rm = h("button", { class: "btn btn-sm", type: "button", "data-act": "remove-opt" }, [iconEl("close", 13)]);
        rm.addEventListener("click", function () {
          syncDraftFromForm();
          var cur = state.draft.questions[qi];
          if (cur.options.length > 2) cur.options.splice(oi, 1);
          renderForm();
        });
        row.appendChild(rm);
        optWrap.appendChild(row);
      });
      var addOpt = h("button", { class: "btn btn-sm", type: "button", "data-act": "add-opt" }, [iconEl("plus", 13), h("span", { text: "添加选项" })]);
      addOpt.addEventListener("click", function () {
        syncDraftFromForm();
        state.draft.questions[qi].options.push("");
        renderForm();
      });
      optWrap.appendChild(addOpt);
      item.appendChild(optWrap);
    }
    return item;
  }

  // datetime-local 值规范化（去掉秒/毫秒，保留 YYYY-MM-DDTHH:mm）
  function toLocalInput(v) {
    if (!v) return "";
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
    var d = new Date(s);
    if (isNaN(d.getTime())) return "";
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function syncDraftFromForm() {
    var form = state.formEl;
    var d = state.draft;
    var titleEl = form.querySelector('[name="title"]');
    var descEl = form.querySelector('[name="desc"]');
    var dlEl = form.querySelector('[name="deadline"]');
    var anonEl = form.querySelector('[name="anonymous"]');
    if (titleEl) d.title = titleEl.value;
    if (descEl) d.desc = descEl.value;
    if (dlEl) d.deadline = dlEl.value;
    if (anonEl) d.anonymous = !!anonEl.checked;

    var items = form.querySelectorAll(".q-item");
    d.questions = items.map(function (item) {
      var typeEl = item.querySelector('[name="q_type"]');
      var titleIn = item.querySelector('[name="q_title"]');
      var reqEl = item.querySelector('[name="q_required"]');
      var opts = item.querySelectorAll('[name="q_option"]').map(function (inp) { return inp.value; });
      return {
        qid: item.getAttribute("data-qid") || "",
        type: typeEl ? typeEl.value : "single",
        title: titleIn ? titleIn.value : "",
        required: reqEl ? !!reqEl.checked : false,
        options: opts
      };
    });
  }

  function onSubmitForm() {
    syncDraftFromForm();
    var res = validate(state.draft);
    var errBox = state.formEl.querySelector("#collect-form-error");
    if (!res.ok) {
      if (errBox) { errBox.hidden = false; errBox.textContent = res.errors.join("；"); }
      toast(res.errors[0] || "请完善表单", "error");
      return;
    }
    if (errBox) { errBox.hidden = true; errBox.textContent = ""; }

    var d = res.draft;
    var questions = d.questions.map(function (q, i) {
      if (!q.qid) q.qid = "q" + (i + 1);
      return q;
    });
    var payload = {
      title: d.title, desc: d.desc, deadline: d.deadline,
      anonymous: d.anonymous, questions: questions
    };

    if (state.draft.id) {
      payload.status = state.draft.status || "open";
      CA.store.update("surveys", state.draft.id, payload);
      toast("已保存修改", "success");
      state.selectedId = state.draft.id;
    } else {
      payload.id = CA.store.uid("sv");
      payload.status = "open";
      payload.createdBy = currentUser().id || "";
      var created = CA.store.add("surveys", payload);
      toast("收集表已创建", "success");
      state.selectedId = created ? created.id : payload.id;
    }
    closeForm();
    refresh();
  }

  // ============================================================
  // 刷新 / 挂载
  // ============================================================
  function refresh() {
    if (!state || !state.root) return;
    renderList();
    if (state.selectedId && CA.store.find("surveys", state.selectedId)) refreshDetail();
    else clearDetail();
  }

  function mount(rootEl) {
    state = {
      root: rootEl,
      isAdmin: isAdmin(),
      selectedId: null,
      reEditing: false,
      formOpen: false,
      draft: null,
      listEl: null,
      formEl: null,
      detailEl: null
    };
    injectStyles();
    // 幂等：重复 mount 时清空容器（app.js 也会清，但单测/热重载需自我保护）
    rootEl.innerHTML = "";

    var wrap = h("div", { class: "ca-collect" });

    // 顶部标题 + 新建入口
    var top = h("div", { class: "row-between" });
    top.appendChild(h("div", { class: "card-title" }, [iconEl("clipboard", 20), h("span", { text: "信息收集" })]));
    var newBtn = h("button", { class: "btn btn-primary", id: "btn-collect-new", type: "button", hidden: !state.isAdmin }, [iconEl("plus", 16), h("span", { text: "新建收集" })]);
    newBtn.addEventListener("click", function () {
      if (state.formOpen) { closeForm(); return; }
      openForm(null);
    });
    top.appendChild(newBtn);
    wrap.appendChild(top);

    // 新建 / 编辑表单容器（始终存在于 DOM，默认隐藏）
    var form = h("form", { class: "form-grid card", id: "collect-form", hidden: true });
    form.addEventListener("submit", function (ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      onSubmitForm();
    });
    state.formEl = form;
    wrap.appendChild(form);

    // 列表
    var list = h("div", { class: "card-list", id: "collect-list" });
    state.listEl = list;
    wrap.appendChild(list);

    // 详情 / 填写 / 结果容器（始终存在于 DOM，默认隐藏）
    var detail = h("div", { id: "collect-detail", hidden: true });
    // 管理端：保证 #btn-ai-summary / #ai-summary-box 在未选中收集时也存在于 DOM（默认隐藏）
    if (state.isAdmin) {
      detail.appendChild(h("div", { class: "card", hidden: true, id: "collect-ai-placeholder" }, [
        h("button", { class: "btn btn-ai btn-sm", id: "btn-ai-summary", type: "button", text: "生成汇总", hidden: true }),
        h("div", { class: "md", id: "ai-summary-box", hidden: true })
      ]));
    }
    state.detailEl = detail;
    wrap.appendChild(detail);

    rootEl.appendChild(wrap);
    renderList();
  }

  function unmount() {
    state = null;
  }

  // ============================================================
  // 对外
  // ============================================================
  CA.views = CA.views || {};
  CA.views.collect = { mount: mount, unmount: unmount };
  CA.collect = {
    stats: stats,
    computeStats: computeStats,
    validate: validate,
    buildResponse: buildResponse,
    renderMarkdown: renderMarkdown
  };
})();
