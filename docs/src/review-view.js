// review-view.js —— 复习视图（Agent R2）
// 职责：把 review-helper（RH）的复习能力包装成班级管家的「复习」Tab。
// 契约：REVIEW.md §2（DOM id）/ §3（功能与交互）/ §4（存储策略）；UI 规范见 DESIGN.md。
// 对外：CA.views.review = { mount(rootEl), unmount() }
//       CA.review = { formatVm, answerState, mergeDocs, escapeHtml, importanceClass, importanceLabel, difficultyLabel }（纯函数，便于单测）
// 依赖：window.RH（parsers/pipeline/storage/sm2/exporter）、CA.icon / CA.util / CA.app / CA.ai
// 说明：所有 RH 调用都做「缺失/失败」优雅降级，绝不让视图因引擎未就绪而抛错。
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

  function toArray(list) {
    if (!list) return [];
    if (Array.isArray(list)) return list.slice();
    var out = [];
    if (typeof list.length === "number") {
      for (var i = 0; i < list.length; i++) out.push(list[i]);
    }
    return out;
  }

  function toast(msg, type) {
    try {
      if (CA.app && typeof CA.app.toast === "function") CA.app.toast(msg, type);
    } catch (e) { /* 忽略提示失败 */ }
  }

  function fmtSmart(v) {
    try {
      if (CA.util && typeof CA.util.fmtSmart === "function") return CA.util.fmtSmart(v) || "—";
    } catch (e) { /* 落到兜底 */ }
    return v == null || v === "" ? "—" : String(v);
  }

  function aiEnabled() {
    try { return !!(CA.ai && typeof CA.ai.enabled === "function" && CA.ai.enabled()); }
    catch (e) { return false; }
  }

  function rhRef() {
    try { return (typeof window !== "undefined" && window.RH) || null; } catch (e) { return null; }
  }

  function rhReady() {
    var rh = rhRef();
    return !!(rh && rh.parsers && rh.pipeline && rh.storage);
  }

  // 极简 DOM 构造（与 collect.js/scores.js 同款，保证 node 桩可测）
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
      [].concat(kids).forEach(function (c) {
        if (c != null && c !== false) el.appendChild(c);
      });
    }
    return el;
  }

  // 图标兜底（icons.js 未就位时用内置 SVG，绝不使用 emoji）
  var FALLBACK_ICONS = {
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    sparkles: '<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.3 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.3a2 2 0 0 0-3.4 0Z"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
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
  // 纯函数（导出便于单测）
  // ============================================================

  // 归一化管线产物为视图模型（VM）：补默认值、清洗字段、容错旧结构
  function formatVm(vm) {
    vm = vm || {};
    var engine = vm.engine === "llm" ? "llm" : "rule";
    var backend = vm.backend == null ? "" : String(vm.backend);

    var sections = toArray(vm.sections).map(function (s) {
      s = s || {};
      var points = toArray(s.points).map(function (p) {
        if (typeof p === "string") p = { point: p };
        p = p || {};
        var importance = ["high", "medium", "low"].indexOf(p.importance) >= 0 ? p.importance : "";
        return {
          point: p.point == null ? "" : String(p.point),
          source: p.source == null ? "" : String(p.source),
          importance: importance,
          kind: p.kind == null ? "" : String(p.kind)
        };
      }).filter(function (p) { return !!p.point; });
      return { title: s.title == null ? "未命名章节" : String(s.title), points: points };
    }).filter(function (s) { return s.points.length; });

    var quiz = toArray(vm.quiz).map(function (q, i) {
      if (!q || typeof q !== "object") return null;
      var options = toArray(q.options).map(function (o) { return o == null ? "" : String(o); });
      var ai = q.answerIndex != null ? Number(q.answerIndex) : -1;
      if (!(ai >= 0 && ai < options.length) && q.answer != null) {
        ai = options.indexOf(String(q.answer));
      }
      return {
        qid: q.qid == null ? "q" + (i + 1) : String(q.qid),
        type: q.type == null ? "choice" : String(q.type),
        question: q.question == null ? "" : String(q.question),
        options: options,
        answerIndex: ai,
        answer: q.answer == null ? (options[ai] != null ? options[ai] : "") : String(q.answer),
        explanation: q.explanation == null ? "" : String(q.explanation),
        source: q.source == null ? "" : String(q.source),
        difficulty: q.difficulty == null ? 1 : Number(q.difficulty),
        importance: q.importance == null ? "" : String(q.importance),
        origin: q.origin == null ? "" : String(q.origin)
      };
    }).filter(function (q) { return q && q.question; });

    return {
      title: vm.title == null ? "未命名资料" : String(vm.title),
      engine: engine,
      backend: backend,
      engineLabel: engine === "llm" ? ("AI · " + (backend || "LLM")) : "离线模式",
      overview: vm.overview == null ? "" : String(vm.overview),
      keywords: toArray(vm.keywords).map(function (k) { return String(k); }).filter(function (k) { return k; }),
      terms: toArray(vm.terms).map(function (t) { return String(t); }).filter(function (t) { return t; }),
      sections: sections,
      quiz: quiz,
      original_sections: vm.original_sections || []
    };
  }

  // 答题判定：返回 { answered, correct, correctIndex, selected }
  function answerState(q, selectedIndex) {
    q = q || {};
    var options = toArray(q.options);
    var idx = q.answerIndex != null ? Number(q.answerIndex) : -1;
    if (!(idx >= 0 && idx < options.length) && q.answer != null) {
      idx = options.map(function (o) { return String(o); }).indexOf(String(q.answer));
    }
    var sel = selectedIndex == null ? -1 : Number(selectedIndex);
    return {
      answered: sel >= 0,
      selected: sel,
      correctIndex: idx,
      correct: sel >= 0 && idx >= 0 && sel === idx
    };
  }

  // 合并多份解析结果（多文件上传）
  function mergeDocs(docs) {
    docs = toArray(docs);
    if (!docs.length) return { title: "未命名", sections: [] };
    if (docs.length === 1) return docs[0];
    var sections = [];
    var ocr = false;
    docs.forEach(function (d) {
      if (!d) return;
      sections = sections.concat(toArray(d.sections));
      if (d.ocr) ocr = true;
    });
    var base = docs[0].title || "未命名";
    return { title: base + " 等 " + docs.length + " 份", sections: sections, ocr: ocr };
  }

  function importanceClass(imp) {
    if (imp === "high") return "badge-important";
    if (imp === "medium") return "badge-warn";
    if (imp === "low") return "badge-muted";
    return "badge-muted";
  }
  function importanceLabel(imp) {
    if (imp === "high") return "高";
    if (imp === "medium") return "中";
    if (imp === "low") return "低";
    return "";
  }
  function difficultyLabel(d) {
    var n = Number(d);
    if (n <= 1) return "简单";
    if (n === 2) return "中等";
    return "较难";
  }
  function stageLabel(stage) {
    if (stage === "summarize") return "AI 提炼要点";
    if (stage === "quiz") return "AI 出题";
    if (stage === "fallback") return "离线模式";
    return "处理";
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
      ".ca-review{display:flex;flex-direction:column;gap:16px}" +
      ".ca-review .ca-review-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".ca-review .icon-wrap{display:inline-flex;color:var(--text-3)}" +
      // 上传区
      ".ca-review .ca-review-upload{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 20px;" +
      "border:2px dashed var(--border-strong);border-radius:var(--r);background:var(--surface);cursor:pointer;transition:border-color var(--t-fast),background var(--t-fast)}" +
      ".ca-review .ca-review-upload:hover,.ca-review .ca-review-upload.is-over{border-color:var(--primary);background:var(--primary-soft)}" +
      ".ca-review .ca-review-upload.is-loading{pointer-events:none;opacity:.6}" +
      ".ca-review .ca-review-upload .empty-icon{color:var(--primary)}" +
      ".ca-review .ca-review-upload-formats{font-size:var(--fs-xs);color:var(--text-3)}" +
      // 进度
      ".ca-review .ca-review-progress-track{height:8px;border-radius:var(--r-full);background:var(--surface-2);overflow:hidden}" +
      ".ca-review .ca-review-progress-track>i{display:block;height:100%;width:0;border-radius:var(--r-full);background:var(--primary);transition:width var(--t)}" +
      ".ca-review #review-progress-text{font-size:var(--fs-sm);color:var(--text-2);margin-top:6px}" +
      // 要点
      ".ca-review .ca-review-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}" +
      ".ca-review .ca-review-chips .ca-review-chips-label{font-size:var(--fs-sm);color:var(--text-3);margin-right:2px}" +
      ".ca-review .ca-review-point{cursor:pointer;display:block}" +
      ".ca-review .ca-review-point-title{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}" +
      ".ca-review .ca-review-point-text{font-size:var(--fs-base);color:var(--text);line-height:1.6;flex:1;min-width:0}" +
      ".ca-review .ca-review-source{margin-top:8px;padding:8px 10px;border-left:3px solid var(--primary);" +
      "background:var(--surface-2);border-radius:var(--r-sm);font-size:var(--fs-sm);color:var(--text-2);line-height:1.6}" +
      // 练习 / 到期卡片
      ".ca-review .ca-review-q{margin-bottom:0}" +
      ".ca-review .ca-review-opts{display:flex;flex-direction:column;gap:8px;margin-top:4px}" +
      ".ca-review .ca-review-opt{display:flex;align-items:center;gap:10px;text-align:left;width:100%;justify-content:flex-start}" +
      ".ca-review .ca-review-opt-key{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;" +
      "border-radius:var(--r-full);background:var(--surface-2);font-size:var(--fs-xs);font-weight:600;color:var(--text-2);flex:none}" +
      ".ca-review .ca-review-opt.is-selected{border-color:var(--primary);background:var(--primary-soft);color:var(--primary-text)}" +
      ".ca-review .ca-review-opt.is-correct{border-color:var(--success);background:var(--success-soft);color:var(--success-text)}" +
      ".ca-review .ca-review-opt.is-wrong{border-color:var(--danger);background:var(--danger-soft);color:var(--danger-text)}" +
      ".ca-review .ca-review-feedback{margin-top:10px;padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2)}" +
      ".ca-review .ca-review-verdict{display:flex;align-items:center;gap:6px;font-weight:600;font-size:var(--fs-sm)}" +
      ".ca-review .ca-review-verdict.ok{color:var(--success-text)}" +
      ".ca-review .ca-review-verdict.bad{color:var(--danger-text)}" +
      ".ca-review .ca-review-explain{margin:6px 0 0;font-size:var(--fs-sm);color:var(--text-2);line-height:1.6}" +
      ".ca-review .ca-review-source-line{margin:4px 0 0;font-size:var(--fs-xs);color:var(--text-3);line-height:1.6}" +
      // 资料库
      ".ca-review .ca-review-lib-main{flex:1;min-width:0}" +
      ".ca-review .ca-review-lib-actions{display:flex;gap:8px;flex:none}" +
      "@media(max-width:768px){.ca-review .ca-review-lib-actions{flex-direction:column}}" +
      "@media(prefers-reduced-motion:reduce){.ca-review *{transition:none!important}}";
    var style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.textContent = css;
    host.appendChild(style);
  }

  function setBtnLoading(btn, on) {
    if (!btn) return;
    if (on) {
      btn.className = (btn.className || "").replace(/\s*is-loading/g, "") + " is-loading";
      btn.disabled = true;
    } else {
      btn.className = (btn.className || "").replace(/\s*is-loading/g, "");
      btn.disabled = false;
    }
  }

  function showProgress(ratio, text) {
    if (!state || !state.progressEl) return;
    state.progressEl.hidden = false;
    var r = typeof ratio === "number" && isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    if (state.progressBarEl) state.progressBarEl.style.width = Math.round(r * 100) + "%";
    if (state.progressTextEl) state.progressTextEl.textContent = text || "处理中…";
  }

  function hideProgress(delay) {
    if (!state || !state.progressEl) return;
    var doHide = function () {
      if (!state || !state.progressEl) return;
      state.progressEl.hidden = true;
      if (state.progressBarEl) state.progressBarEl.style.width = "0%";
    };
    if (delay && typeof setTimeout === "function") setTimeout(doHide, delay);
    else doHide();
  }

  // ============================================================
  // 子 Tab 切换
  // ============================================================
  function setTab(tab) {
    if (!state) return;
    state.activeTab = tab;
    toArray(state.tabEls).forEach(function (b) {
      var t = b.getAttribute("data-tab");
      b.className = "seg-item" + (t === tab ? " active" : "");
    });
    toArray(state.paneEls).forEach(function (p) {
      p.hidden = p.getAttribute("data-pane") !== tab;
    });
  }

  // ============================================================
  // 结果头 / 引擎徽标
  // ============================================================
  function renderResult() {
    if (!state) return;
    var vm = state.vm;
    if (!vm) {
      state.resultEl.hidden = true;
      state.docTitleEl.textContent = "—";
      setEngineBadge(rhReady() ? "待上传资料" : "复习引擎未就绪", "badge-muted");
      return;
    }
    state.resultEl.hidden = false;
    state.docTitleEl.textContent = vm.title;
    if (vm.engine === "llm") setEngineBadge(vm.engineLabel, "badge-ai");
    else setEngineBadge("离线模式", "badge-muted");
    if (state.exportDocxEl) state.exportDocxEl.disabled = false;
    if (state.exportQuizEl) state.exportQuizEl.disabled = !vm.quiz.length;
  }

  function setEngineBadge(text, cls) {
    if (!state || !state.engineBadgeEl) return;
    state.engineBadgeEl.className = "badge " + cls;
    state.engineBadgeEl.textContent = text || "";
  }

  // ============================================================
  // 要点
  // ============================================================
  function renderPoints() {
    if (!state) return;
    var vm = state.vm;
    renderOverview(vm);
    renderKeywords(vm);
    renderSections(vm);
  }

  function renderOverview(vm) {
    var box = state.overviewEl;
    if (!box) return;
    box.innerHTML = "";
    var card = h("div", { class: "card" });
    card.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconEl("info", 16), h("span", { text: "全文速览" })])
    ]));
    if (vm && vm.overview) card.appendChild(h("p", { class: "muted", text: vm.overview }));
    else card.appendChild(h("p", { class: "muted", text: vm ? "本次资料暂无概述。" : "上传资料后，这里会显示 AI 提炼的全文速览。" }));
    box.appendChild(card);
  }

  function renderKeywords(vm) {
    var box = state.keywordsEl;
    if (!box) return;
    box.innerHTML = "";
    var card = h("div", { class: "card" });
    card.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconEl("sparkles", 16), h("span", { text: "关键词与术语" })])
    ]));
    if (!vm || (!vm.keywords.length && !vm.terms.length)) {
      card.appendChild(h("p", { class: "muted", text: "暂无关键词。" }));
      box.appendChild(card);
      return;
    }
    if (vm.keywords.length) {
      var row1 = h("div", { class: "ca-review-chips" });
      vm.keywords.forEach(function (k) { row1.appendChild(h("span", { class: "chip", text: k })); });
      card.appendChild(row1);
    }
    if (vm.terms.length) {
      var row2 = h("div", { class: "ca-review-chips" });
      row2.appendChild(h("span", { class: "ca-review-chips-label", text: "术语" }));
      vm.terms.forEach(function (t) { row2.appendChild(h("span", { class: "chip", title: "术语", text: t })); });
      card.appendChild(row2);
    }
    box.appendChild(card);
  }

  function renderSections(vm) {
    var box = state.sectionsEl;
    if (!box) return;
    box.innerHTML = "";
    if (!vm || !vm.sections.length) {
      box.appendChild(emptyState("暂无要点", vm ? "本次资料未能提炼出章节要点。" : "上传资料后，这里会按章节列出复习要点。", "file"));
      return;
    }
    vm.sections.forEach(function (sec) {
      var card = h("div", { class: "card" });
      card.appendChild(h("div", { class: "card-head" }, [
        h("div", { class: "card-title", text: sec.title }),
        h("span", { class: "card-sub", text: sec.points.length + " 条" })
      ]));
      var list = h("div", { class: "card-list" });
      sec.points.forEach(function (p) {
        list.appendChild(pointRow(p));
      });
      card.appendChild(list);
      box.appendChild(card);
    });
  }

  function pointRow(p) {
    var row = h("div", { class: "list-row ca-review-point", role: "button", tabindex: "0" });
    var main = h("div", { class: "list-main" });
    var titleRow = h("div", { class: "ca-review-point-title" });
    if (p.importance) {
      titleRow.appendChild(h("span", {
        class: "badge " + importanceClass(p.importance),
        "data-importance": p.importance,
        text: importanceLabel(p.importance)
      }));
    }
    if (p.kind === "example") titleRow.appendChild(h("span", { class: "badge badge-cat", text: "例" }));
    titleRow.appendChild(h("span", { class: "ca-review-point-text", text: p.point }));
    main.appendChild(titleRow);

    if (p.source) {
      var src = h("div", { class: "ca-review-source", hidden: true, text: "原文：" + p.source });
      main.appendChild(src);
      row.addEventListener("click", function () { src.hidden = !src.hidden; });
    }
    row.appendChild(main);
    return row;
  }

  // ============================================================
  // 练习
  // ============================================================
  function renderQuiz() {
    if (!state) return;
    var list = state.quizListEl;
    if (!list) return;
    list.innerHTML = "";
    state.quizStats = {};

    if (!rhReady()) {
      updateQuizStats();
      list.appendChild(emptyState("复习引擎未就绪", "复习模块尚未加载完成，请稍后重试。", "alert"));
      return;
    }
    if (!state.vm) {
      updateQuizStats();
      list.appendChild(emptyState("暂无练习", "先在上方上传资料，系统会按要点自动出题。", "file"));
      return;
    }
    if (!state.vm.quiz.length) {
      updateQuizStats();
      list.appendChild(emptyState("未生成题目", "本次资料没有生成选择题，可重新上传或导出要点复习。", "file"));
      return;
    }
    state.vm.quiz.forEach(function (q, i) {
      list.appendChild(quizQuestion(q, i));
    });
    updateQuizStats();
  }

  function updateQuizStats() {
    if (!state || !state.quizStatsEl) return;
    var total = state.vm ? state.vm.quiz.length : 0;
    var answered = 0, correct = 0;
    Object.keys(state.quizStats || {}).forEach(function (k) {
      var s = state.quizStats[k];
      if (s) { answered++; if (s.ok) correct++; }
    });
    var rate = answered ? Math.round(correct / answered * 100) : 0;
    state.quizStatsEl.textContent = "已答 " + answered + " / " + total + " · 正确率 " + rate + "%";
  }

  // 通用选择题卡片：选项选中 → 提交 → 对错反馈 + 解析 + 出处
  function quizQuestion(q, index) {
    var card = h("div", { class: "card ca-review-q", "data-qid": q.qid });

    var head = h("div", { class: "card-head" });
    head.appendChild(h("div", { class: "card-title", text: (index + 1) + ". " + q.question }));
    var badges = h("div", { class: "row" });
    if (q.importance) badges.appendChild(h("span", { class: "badge " + importanceClass(q.importance), text: importanceLabel(q.importance) }));
    badges.appendChild(h("span", { class: "badge badge-muted", text: difficultyLabel(q.difficulty) }));
    head.appendChild(badges);
    card.appendChild(head);

    card.appendChild(optionArea(q, {
      onSubmit: function (ok, selectedText) {
        state.quizStats[q.qid] = { ok: ok };
        updateQuizStats();
        recordAnswerSafe(state.vm.title, q, ok, selectedText);
      }
    }));
    return card;
  }

  // 选项区（选中/提交/反馈），返回容器元素
  function optionArea(q, cfg) {
    var wrap = h("div", { class: "ca-review-options" });
    var opts = h("div", { class: "ca-review-opts" });
    var buttons = [];
    var selected = -1;
    var submitted = false;

    toArray(q.options).forEach(function (opt, oi) {
      var b = h("button", { class: "ca-review-opt btn", type: "button" });
      b.appendChild(h("span", { class: "ca-review-opt-key", text: String.fromCharCode(65 + oi) }));
      b.appendChild(h("span", { class: "ca-review-opt-text", text: opt }));
      b.addEventListener("click", function () {
        if (submitted) return;
        selected = oi;
        buttons.forEach(function (x, j) {
          x.className = "ca-review-opt btn" + (j === oi ? " is-selected" : "");
        });
      });
      buttons.push(b);
      opts.appendChild(b);
    });
    wrap.appendChild(opts);

    var actions = h("div", { class: "form-actions" });
    var submit = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "提交答案" });
    actions.appendChild(submit);
    wrap.appendChild(actions);

    var feedback = h("div", { class: "ca-review-feedback", hidden: true });
    wrap.appendChild(feedback);

    submit.addEventListener("click", function () {
      if (submitted) return;
      if (selected < 0) { toast("请先选择一个选项", "warn"); return; }
      submitted = true;
      var st = answerState(q, selected);
      buttons.forEach(function (x, j) {
        var cls = "ca-review-opt btn";
        if (j === st.correctIndex) cls += " is-correct";
        else if (j === selected) cls += " is-wrong";
        x.className = cls;
        x.disabled = true;
      });
      submit.disabled = true;
      submit.textContent = "已提交";

      feedback.hidden = false;
      var verdict = h("div", { class: "ca-review-verdict " + (st.correct ? "ok" : "bad") }, [
        iconEl(st.correct ? "check" : "close", 14),
        h("span", { text: st.correct ? "回答正确" : "回答错误" })
      ]);
      feedback.appendChild(verdict);
      if (!st.correct && st.correctIndex >= 0 && q.options[st.correctIndex] != null) {
        feedback.appendChild(h("p", { class: "ca-review-explain", text: "正确答案：" + String.fromCharCode(65 + st.correctIndex) + ". " + q.options[st.correctIndex] }));
      }
      if (q.explanation) feedback.appendChild(h("p", { class: "ca-review-explain", text: "解析：" + q.explanation }));
      if (q.source) feedback.appendChild(h("p", { class: "ca-review-source-line", text: "原文出处：" + q.source }));

      if (cfg && typeof cfg.onSubmit === "function") cfg.onSubmit(st.correct, q.options[selected]);
    });

    return wrap;
  }

  function recordAnswerSafe(docTitle, q, ok, userAnswer) {
    if (!rhReady() || !rhRef().storage || typeof rhRef().storage.recordAnswer !== "function") return;
    try {
      var p = rhRef().storage.recordAnswer(docTitle, q, ok, userAnswer);
      if (p && typeof p.catch === "function") {
        p.catch(function (e) { toast("记录答题失败：" + ((e && e.message) || e), "error"); });
      }
    } catch (e) {
      toast("记录答题失败：" + ((e && e.message) || e), "error");
    }
  }

  // ============================================================
  // 复习（SM-2）
  // ============================================================
  function renderStudyStats(stats) {
    if (!state || !state.studyStatsEl) return;
    var s = stats || {};
    state.studyStatsEl.innerHTML = "";
    var items = [
      { label: "全部卡片", value: s.total || 0, cls: "emphasis" },
      { label: "今日到期", value: s.due || 0, cls: "warn" },
      { label: "已掌握", value: s.mastered || 0, cls: "success" },
      { label: "薄弱", value: s.weak || 0, cls: "danger" }
    ];
    items.forEach(function (it) {
      state.studyStatsEl.appendChild(h("div", { class: "stat " + it.cls }, [
        h("div", { class: "stat-value", text: String(it.value) }),
        h("div", { class: "stat-label", text: it.label })
      ]));
    });
  }

  function renderDocFilter() {
    if (!state || !state.docFilterEl) return;
    var sel = state.docFilterEl;
    var prev = state.docFilter || "";
    sel.innerHTML = "";
    sel.appendChild(h("option", { value: "", text: "全部资料" }));
    var seen = {};
    (state.dueCards || []).forEach(function (c) {
      var t = c.docTitle || "未命名";
      if (!seen[t]) { seen[t] = 1; sel.appendChild(h("option", { value: t, text: t })); }
    });
    sel.value = seen[prev] ? prev : "";
    state.docFilter = sel.value || "";
  }

  function renderDueList() {
    if (!state || !state.dueListEl) return;
    var list = state.dueListEl;
    list.innerHTML = "";
    if (!rhReady()) {
      list.appendChild(emptyState("复习引擎未就绪", "复习模块尚未加载完成，请稍后重试。", "alert"));
      return;
    }
    var cards = (state.dueCards || []).filter(function (c) {
      return !state.docFilter || (c.docTitle || "未命名") === state.docFilter;
    });
    if (!cards.length) {
      list.appendChild(emptyState("今日没有到期卡片", "上传资料并练习后，系统会按 SM-2 间隔安排复习。", "book"));
      return;
    }
    cards.forEach(function (c, i) {
      list.appendChild(dueCard(c, i));
    });
  }

  function dueCard(card, index) {
    var q = {
      qid: card.qid != null ? card.qid : ("d" + index),
      type: card.type || "choice",
      question: card.question || "",
      options: toArray(card.options),
      answerIndex: card.answerIndex != null ? card.answerIndex : -1,
      answer: card.answer != null ? card.answer : "",
      explanation: card.explanation || "",
      source: card.source || "",
      difficulty: card.difficulty || 1
    };
    var wrap = h("div", { class: "ca-review-due" });
    var cardTitle = h("div", { class: "card-head" }, [
      h("div", { class: "card-title", text: (index + 1) + ". " + q.question }),
      h("span", { class: "badge badge-cat", text: card.docTitle || "未命名" })
    ]);
    var box = h("div", { class: "card ca-review-q" });
    box.appendChild(cardTitle);

    if (q.options.length >= 2) {
      box.appendChild(optionArea(q, {
        onSubmit: function (ok, selectedText) {
          recordAnswerSafe(card.docTitle || "未命名", q, ok, selectedText);
          refreshStudySoon();
        }
      }));
    } else {
      // 非选择题兜底：显示答案 + 自评两张卡
      box.appendChild(fallbackSelfCheck(card, q, function (ok) {
        recordAnswerSafe(card.docTitle || "未命名", q, ok, "");
        refreshStudySoon();
      }));
    }
    wrap.appendChild(box);
    return wrap;
  }

  function fallbackSelfCheck(card, q, onGrade) {
    var wrap = h("div", { class: "ca-review-options" });
    var ans = h("p", { class: "ca-review-source-line", hidden: true, text: "答案：" + (q.answer || "—") });
    var actions = h("div", { class: "form-actions" });
    var show = h("button", { class: "btn btn-sm", type: "button", text: "显示答案" });
    show.addEventListener("click", function () { ans.hidden = false; });
    var right = h("button", { class: "btn btn-success btn-sm", type: "button", text: "记住了" });
    var wrong = h("button", { class: "btn btn-danger btn-sm", type: "button", text: "没记住" });
    right.addEventListener("click", function () { right.disabled = wrong.disabled = true; onGrade(true); });
    wrong.addEventListener("click", function () { right.disabled = wrong.disabled = true; onGrade(false); });
    actions.appendChild(show);
    actions.appendChild(right);
    actions.appendChild(wrong);
    wrap.appendChild(ans);
    wrap.appendChild(actions);
    return wrap;
  }

  function refreshStudySoon() {
    if (typeof setTimeout === "function") setTimeout(function () { loadStudy(); }, 0);
  }

  function loadStudy() {
    if (!state) return Promise.resolve();
    if (!rhReady()) {
      renderStudyStats({});
      renderDueList();
      return Promise.resolve();
    }
    var storage = rhRef().storage;
    return Promise.resolve()
      .then(function () { return typeof storage.getStats === "function" ? storage.getStats() : {}; })
      .then(function (stats) { renderStudyStats(stats); })
      .catch(function (e) {
        renderStudyStats({});
        toast("读取复习统计失败：" + ((e && e.message) || e), "error");
      })
      .then(function () { return typeof storage.getDueCards === "function" ? storage.getDueCards() : []; })
      .then(function (cards) { state.dueCards = toArray(cards); renderDocFilter(); renderDueList(); })
      .catch(function (e) {
        state.dueCards = [];
        renderDocFilter();
        renderDueList();
        toast("读取到期卡片失败：" + ((e && e.message) || e), "error");
      });
  }

  // ============================================================
  // 资料库
  // ============================================================
  function loadLibrary() {
    if (!state || !state.libraryListEl) return Promise.resolve();
    if (!rhReady()) { renderLibraryList([]); return Promise.resolve(); }
    var storage = rhRef().storage;
    return Promise.resolve()
      .then(function () { return typeof storage.listDocs === "function" ? storage.listDocs() : []; })
      .then(function (docs) { state.docs = toArray(docs); renderLibraryList(state.docs); })
      .catch(function (e) {
        state.docs = [];
        renderLibraryList([]);
        toast("读取资料库失败：" + ((e && e.message) || e), "error");
      });
  }

  function docCounts(rec) {
    var points = 0;
    toArray(rec && rec.sections).forEach(function (s) { points += toArray(s && s.points).length; });
    return { points: points, quiz: toArray(rec && rec.quiz).length };
  }

  function renderLibraryList(docs) {
    var list = state.libraryListEl;
    if (!list) return;
    list.innerHTML = "";
    if (!rhReady()) {
      list.appendChild(emptyState("复习引擎未就绪", "复习模块尚未加载完成，请稍后重试。", "alert"));
      return;
    }
    docs = toArray(docs);
    if (!docs.length) {
      list.appendChild(emptyState("资料库为空", "上传资料后，会自动存档在这里，可随时打开或删除。", "book"));
      return;
    }
    docs.forEach(function (rec) { list.appendChild(libraryRow(rec)); });
  }

  function libraryRow(rec) {
    var counts = docCounts(rec);
    var row = h("div", { class: "list-row", "data-doc-title": rec.title || "" });
    var main = h("div", { class: "ca-review-lib-main" });
    main.appendChild(h("div", { class: "list-title" }, [
      h("span", { class: "list-title-text", text: rec.title || "未命名" })
    ]));
    var meta = h("div", { class: "list-meta" });
    meta.appendChild(iconEl("clock", 13));
    meta.appendChild(h("span", { text: fmtSmart(new Date(rec.time || Date.now())) }));
    meta.appendChild(h("span", { text: "·" }));
    meta.appendChild(h("span", { text: "要点 " + counts.points + " 条" }));
    meta.appendChild(h("span", { text: "·" }));
    meta.appendChild(h("span", { text: "题目 " + counts.quiz + " 道" }));
    main.appendChild(meta);
    row.appendChild(main);

    var actions = h("div", { class: "ca-review-lib-actions" });
    var open = h("button", { class: "btn btn-sm", type: "button", "data-act": "open" }, [iconEl("book", 13), h("span", { text: "打开" })]);
    open.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      openLibraryDoc(rec.title);
    });
    var del = h("button", { class: "btn btn-danger btn-sm", type: "button", "data-act": "delete" }, [iconEl("trash", 13), h("span", { text: "删除" })]);
    del.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      removeLibraryDoc(rec.title);
    });
    actions.appendChild(open);
    actions.appendChild(del);
    row.appendChild(actions);
    return row;
  }

  function openLibraryDoc(title) {
    if (!rhReady()) { toast("复习引擎未就绪", "error"); return; }
    var storage = rhRef().storage;
    Promise.resolve()
      .then(function () { return typeof storage.getDoc === "function" ? storage.getDoc(title) : null; })
      .then(function (rec) {
        if (!rec) { toast("未找到该资料", "error"); return; }
        state.vm = formatVm({
          title: rec.title, engine: rec.engine, backend: rec.backend,
          overview: rec.overview, keywords: rec.keywords, terms: rec.terms,
          sections: rec.sections, quiz: rec.quiz, original_sections: rec.original_sections
        });
        state.sourceBlob = rec.sourceBlob || null;
        state.sourceName = rec.sourceName || "";
        renderResult();
        renderPoints();
        renderQuiz();
        setTab("points");
      })
      .catch(function (e) { toast("打开失败：" + ((e && e.message) || e), "error"); });
  }

  function removeLibraryDoc(title) {
    var okConfirm = true;
    try {
      if (typeof window.confirm === "function") okConfirm = window.confirm("确定删除资料「" + title + "」吗？其学习记录不会被删除。");
    } catch (e) { okConfirm = true; }
    if (!okConfirm) return;
    if (!rhReady() || typeof rhRef().storage.deleteDoc !== "function") { toast("复习引擎未就绪", "error"); return; }
    Promise.resolve()
      .then(function () { return rhRef().storage.deleteDoc(title); })
      .then(function () {
        if (state.vm && state.vm.title === title) {
          state.vm = null;
          renderResult();
          renderPoints();
          renderQuiz();
        }
        toast("已删除资料", "success");
        return loadLibrary();
      })
      .catch(function (e) { toast("删除失败：" + ((e && e.message) || e), "error"); });
  }

  // ============================================================
  // 上传 / 解析 / 出题
  // ============================================================
  function parseProgressHandler() {
    return function (a, b) {
      var text = "解析中…";
      var r = 0.05;
      if (typeof b === "number") { text = (a == null ? "解析中…" : String(a)); r = b; }
      else if (typeof a === "number") { r = a; }
      else if (a != null) { text = String(a); }
      showProgress(r, text);
    };
  }

  // AI 关闭联动：临时让 RH 管线走规则降级（不修改 R1 文件，运行期安全回滚）
  function runPipeline(doc, report) {
    var rh = rhRef();
    if (!rh || !rh.pipeline || typeof rh.pipeline.run !== "function") {
      return Promise.reject(new Error("复习引擎未就绪"));
    }
    var llm = rh.llm;
    if (!aiEnabled() && llm && typeof llm.ready === "function") {
      var orig = llm.ready;
      llm.ready = function () { return false; };
      return Promise.resolve()
        .then(function () { return rh.pipeline.run(doc, report); })
        .then(function (vm) { llm.ready = orig; return vm; },
          function (e) { llm.ready = orig; throw e; });
    }
    return Promise.resolve().then(function () { return rh.pipeline.run(doc, report); });
  }

  function onFiles(fileList) {
    var files = toArray(fileList);
    if (!files.length) return;
    if (!rhReady()) { toast("复习引擎未就绪，暂时无法解析", "error"); return; }
    processFiles(files);
  }

  function processFiles(files) {
    var rh = rhRef();
    setUploadBusy(true);
    showProgress(0.02, "准备解析…");
    state.sourceBlob = files[0];
    state.sourceName = files[0] && files[0].name ? files[0].name : "";
    state.sourceNames = files.map(function (f) { return f && f.name ? f.name : ""; });

    var docs = [];
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        showProgress(0.08, "解析中：" + (file && file.name ? file.name : ""));
        return rh.parsers.parseFile(file, parseProgressHandler());
      }).then(function (doc) { docs.push(doc); });
    });

    chain
      .then(function () {
        var merged = mergeDocs(docs);
        showProgress(0.2, "AI 提炼要点中…");
        return runPipeline(merged, function (stage, msg, ratio) {
          showProgress(ratio, stageLabel(stage) + "：" + (msg || "处理中…"));
        });
      })
      .then(function (raw) {
        showProgress(0.95, "整理结果…");
        state.vm = formatVm(raw);
        renderResult();
        renderPoints();
        renderQuiz();
        return saveCurrentDoc();
      })
      .then(function () { return loadLibrary(); })
      .then(function () {
        showProgress(1, "完成");
        setTab("points");
        toast("已生成复习要点与练习", "success");
      })
      .catch(function (e) {
        toast("解析失败：" + ((e && e.message) || e), "error");
      })
      .then(function () {
        setUploadBusy(false);
        hideProgress(600);
      });
  }

  function saveCurrentDoc() {
    if (!rhReady() || !state.vm || typeof rhRef().storage.saveDoc !== "function") return Promise.resolve(false);
    var vm = state.vm;
    var payload = {
      overview: vm.overview, engine: vm.engine, backend: vm.backend,
      sections: vm.sections, quiz: vm.quiz, keywords: vm.keywords, terms: vm.terms,
      original_sections: vm.original_sections,
      sourceBlob: state.sourceBlob || null,
      sourceName: state.sourceName || "",
      sourceNames: state.sourceNames || []
    };
    return Promise.resolve()
      .then(function () { return rhRef().storage.saveDoc(vm.title, payload); })
      .catch(function () { return false; });
  }

  function setUploadBusy(on) {
    if (!state) return;
    state.uploadBusy = !!on;
    if (state.uploadEl) state.uploadEl.className = "ca-review-upload" + (on ? " is-loading" : "");
    if (state.fileInputEl) state.fileInputEl.disabled = !!on;
  }

  // ============================================================
  // 导出
  // ============================================================
  function onExport(kind) {
    if (!state || !state.vm) { toast("请先上传资料或打开文档", "warn"); return; }
    var rh = rhRef();
    if (!rhReady() || !rh.exporter) { toast("复习引擎未就绪", "error"); return; }
    var btn = kind === "quiz" ? state.exportQuizEl : state.exportDocxEl;
    setBtnLoading(btn, true);
    Promise.resolve()
      .then(function () {
        if (kind === "quiz") {
          return Promise.all([
            rh.exporter.quizDocxBlob(state.vm),
            Promise.resolve(rh.exporter.filenameQuizDocx ? rh.exporter.filenameQuizDocx(state.vm) : state.vm.title + "_自测卷.docx")
          ]);
        }
        return Promise.all([
          rh.exporter.docxBlob(state.vm),
          Promise.resolve(rh.exporter.filenameDocx ? rh.exporter.filenameDocx(state.vm) : state.vm.title + "_复习要点.docx")
        ]);
      })
      .then(function (res) {
        downloadBlob(res[0], res[1]);
        toast("已导出 Word 文档", "success");
      })
      .catch(function (e) { toast("导出失败：" + ((e && e.message) || e), "error"); })
      .then(function () { setBtnLoading(btn, false); });
  }

  function downloadBlob(blob, filename) {
    if (!blob) { toast("导出失败：内容为空", "error"); return; }
    try {
      if (typeof URL === "undefined" || !URL.createObjectURL) { toast("当前环境不支持下载", "error"); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename || "export.docx";
      document.body.appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
      if (typeof setTimeout === "function") setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 1000);
    } catch (e) { toast("导出失败：" + ((e && e.message) || e), "error"); }
  }

  // ============================================================
  // 题库 JSON 导入
  // ============================================================
  function importToVm(data, filename) {
    var title = String(filename || "").replace(/\.[^.]+$/, "") || "导入题库";
    var quiz = null;
    if (Array.isArray(data)) quiz = data;
    else if (data && Array.isArray(data.quiz)) { quiz = data.quiz; if (data.title != null) title = String(data.title); }
    else if (data && Array.isArray(data.questions)) { quiz = data.questions; if (data.title != null) title = String(data.title); }
    if (!quiz || !quiz.length) return null;
    return formatVm({ title: title, engine: "rule", sections: [], keywords: [], terms: [], quiz: quiz });
  }

  function readFileText(file) {
    if (file && typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      if (typeof FileReader === "undefined") { reject(new Error("当前环境不支持读取文件")); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || "")); };
      fr.onerror = function () { reject(fr.error || new Error("读取失败")); };
      fr.readAsText(file);
    });
  }

  function onImportQuiz(ev) {
    var input = ev && ev.target ? ev.target : null;
    var file = input && input.files && input.files[0];
    if (!file) return;
    readFileText(file).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); }
      catch (e) { toast("JSON 解析失败：" + ((e && e.message) || e), "error"); return; }
      var vm = importToVm(data, file.name);
      if (!vm) { toast("题库格式不正确：缺少题目数组", "error"); return; }
      state.vm = vm;
      renderResult();
      renderPoints();
      renderQuiz();
      setTab("quiz");
      toast("已导入题库，共 " + vm.quiz.length + " 题", "success");
    }).catch(function (e) { toast("读取失败：" + ((e && e.message) || e), "error"); });
    try { if (input) input.value = ""; } catch (e) { /* 忽略 */ }
  }

  // ============================================================
  // 空态
  // ============================================================
  function emptyState(title, desc, iconName) {
    var box = h("div", { class: "empty" });
    box.appendChild(h("div", { class: "empty-icon", html: icon(iconName || "book", 46) }));
    box.appendChild(h("div", { class: "empty-title", text: title }));
    box.appendChild(h("p", { class: "empty-desc", text: desc }));
    return box;
  }

  // ============================================================
  // 挂载 / 卸载
  // ============================================================
  function mount(rootEl) {
    injectStyles();
    state = {
      root: rootEl,
      vm: null,
      activeTab: "points",
      quizStats: {},
      dueCards: [],
      docs: [],
      docFilter: "",
      uploadBusy: false,
      sourceBlob: null,
      sourceName: "",
      sourceNames: [],
      tabEls: [],
      paneEls: []
    };
    rootEl.innerHTML = "";

    var wrap = h("div", { class: "ca-review" });

    // --- 标题行 ---
    var top = h("div", { class: "ca-review-top" });
    top.appendChild(h("div", { class: "card-title" }, [iconEl("book", 20), h("span", { text: "学习复习" })]));
    top.appendChild(h("p", { class: "muted", text: "上传资料 → AI 提炼要点并出题 → 练习 → SM-2 间隔复习 → Word 导出。" }));
    wrap.appendChild(top);

    // --- 上传区 ---
    var upload = h("div", { class: "ca-review-upload", id: "review-upload", role: "button", tabindex: "0" });
    state.uploadEl = upload;
    upload.appendChild(h("div", { class: "empty-icon", html: icon("upload", 40) }));
    upload.appendChild(h("div", { class: "empty-title", text: "上传资料，自动生成要点与练习" }));
    upload.appendChild(h("p", { class: "empty-desc", text: "拖拽文件到此处，或点击选择。支持 PDF / Word / PPT / TXT / Markdown / 图片（OCR）。" }));
    upload.appendChild(h("span", { class: "ca-review-upload-formats", text: "可一次选择多份资料" }));

    var fileInput = h("input", {
      type: "file", id: "review-file-input", multiple: true, accept: ".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.bmp", hidden: true
    });
    state.fileInputEl = fileInput;
    upload.appendChild(fileInput);

    upload.addEventListener("click", function () {
      if (state.uploadBusy) return;
      if (fileInput.click) fileInput.click();
    });
    upload.addEventListener("keydown", function (ev) {
      if (ev && (ev.key === "Enter" || ev.key === " ")) {
        if (ev.preventDefault) ev.preventDefault();
        if (fileInput.click) fileInput.click();
      }
    });
    upload.addEventListener("dragover", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      upload.className = "ca-review-upload is-over";
    });
    upload.addEventListener("dragleave", function () {
      upload.className = "ca-review-upload" + (state.uploadBusy ? " is-loading" : "");
    });
    upload.addEventListener("drop", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      upload.className = "ca-review-upload" + (state.uploadBusy ? " is-loading" : "");
      var files = ev && ev.dataTransfer ? ev.dataTransfer.files : null;
      onFiles(files);
    });
    fileInput.addEventListener("change", function (ev) {
      var files = (ev && ev.target ? ev.target.files : null);
      onFiles(files);
      try { if (ev && ev.target) ev.target.value = ""; } catch (e) { /* 忽略 */ }
    });

    // 未就绪时禁用上传
    if (!rhReady()) {
      fileInput.disabled = true;
      upload.appendChild(h("p", { class: "field-error", text: "复习引擎未就绪：请确认 RH 模块已加载。" }));
    }
    wrap.appendChild(upload);

    // --- 进度 ---
    var progress = h("div", { class: "card", id: "review-progress", hidden: true });
    var bar = h("i", { id: "review-progress-bar" });
    progress.appendChild(h("div", { class: "ca-review-progress-track" }, [bar]));
    var ptext = h("div", { id: "review-progress-text", text: "准备中…" });
    progress.appendChild(ptext);
    state.progressEl = progress;
    state.progressBarEl = bar;
    state.progressTextEl = ptext;
    wrap.appendChild(progress);

    // --- 结果头（文档标题 + 引擎徽标 + 导出） ---
    var result = h("div", { class: "card", id: "review-result", hidden: true });
    var rHead = h("div", { class: "card-head" });
    var badge = h("span", { class: "badge badge-muted", id: "review-engine-badge", text: rhReady() ? "待上传资料" : "复习引擎未就绪" });
    state.engineBadgeEl = badge;
    rHead.appendChild(h("div", { class: "card-title" }, [
      iconEl("file", 18),
      h("span", { id: "review-doc-title", text: "—" }),
      badge
    ]));
    var rActions = h("div", { class: "row" });
    var exDocx = h("button", { class: "btn btn-sm", id: "review-export-docx", type: "button", disabled: true }, [iconEl("download", 14), h("span", { text: "导出要点卷" })]);
    exDocx.addEventListener("click", function () { onExport("docx"); });
    var exQuiz = h("button", { class: "btn btn-sm", id: "review-export-quiz", type: "button", disabled: true }, [iconEl("download", 14), h("span", { text: "导出自测卷" })]);
    exQuiz.addEventListener("click", function () { onExport("quiz"); });
    rActions.appendChild(exDocx);
    rActions.appendChild(exQuiz);
    rHead.appendChild(rActions);
    result.appendChild(rHead);
    state.resultEl = result;
    state.docTitleEl = rHead.querySelector("#review-doc-title");
    state.exportDocxEl = exDocx;
    state.exportQuizEl = exQuiz;
    wrap.appendChild(result);

    // --- 子 Tab ---
    var tabs = h("div", { class: "segmented", id: "review-tabs" });
    var tabDefs = [
      { key: "points", label: "要点" },
      { key: "quiz", label: "练习" },
      { key: "study", label: "复习" },
      { key: "library", label: "资料库" }
    ];
    tabDefs.forEach(function (t) {
      var item = h("button", { class: "seg-item" + (t.key === "points" ? " active" : ""), type: "button", "data-tab": t.key, text: t.label });
      item.addEventListener("click", function () { setTab(t.key); });
      tabs.appendChild(item);
      state.tabEls.push(item);
    });
    wrap.appendChild(tabs);

    // --- 要点 pane ---
    var panePoints = h("div", { class: "stack", id: "review-pane-points", "data-pane": "points" });
    state.overviewEl = h("div", { id: "review-overview" });
    state.keywordsEl = h("div", { id: "review-keywords" });
    state.sectionsEl = h("div", { class: "stack", id: "review-sections" });
    panePoints.appendChild(state.overviewEl);
    panePoints.appendChild(state.keywordsEl);
    panePoints.appendChild(state.sectionsEl);
    state.paneEls.push(panePoints);
    wrap.appendChild(panePoints);

    // --- 练习 pane ---
    var paneQuiz = h("div", { class: "stack", id: "review-pane-quiz", "data-pane": "quiz", hidden: true });
    var quizHead = h("div", { class: "card" });
    quizHead.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconEl("check", 16), h("span", { text: "练习进度" })]),
      h("span", { class: "card-sub", id: "review-quiz-stats", text: "已答 0 / 0 · 正确率 0%" })
    ]));
    state.quizStatsEl = quizHead.querySelector("#review-quiz-stats");
    paneQuiz.appendChild(quizHead);
    state.quizListEl = h("div", { class: "card-list", id: "review-quiz-list" });
    paneQuiz.appendChild(state.quizListEl);
    state.paneEls.push(paneQuiz);
    wrap.appendChild(paneQuiz);

    // --- 复习 pane ---
    var paneStudy = h("div", { class: "stack", id: "review-pane-study", "data-pane": "study", hidden: true });
    state.studyStatsEl = h("div", { class: "stat-grid", id: "review-study-stats" });
    paneStudy.appendChild(state.studyStatsEl);
    var studyBar = h("div", { class: "card-head" });
    studyBar.appendChild(h("div", { class: "card-title" }, [iconEl("refresh", 16), h("span", { text: "今日复习" })]));
    var studyActions = h("div", { class: "row" });
    var startBtn = h("button", { class: "btn btn-primary btn-sm", id: "btn-review-start", type: "button" }, [iconEl("refresh", 14), h("span", { text: "开始今日复习" })]);
    startBtn.addEventListener("click", function () { loadStudy(); toast("已刷新今日到期卡片", "info"); });
    studyActions.appendChild(startBtn);
    var docFilter = h("select", { class: "input", id: "review-doc-filter" });
    docFilter.addEventListener("change", function () {
      state.docFilter = docFilter.value || "";
      renderDueList();
    });
    state.docFilterEl = docFilter;
    studyActions.appendChild(docFilter);
    studyBar.appendChild(studyActions);
    paneStudy.appendChild(studyBar);
    state.dueListEl = h("div", { class: "card-list", id: "review-due-list" });
    paneStudy.appendChild(state.dueListEl);
    state.paneEls.push(paneStudy);
    wrap.appendChild(paneStudy);

    // --- 资料库 pane ---
    var paneLibrary = h("div", { class: "stack", id: "review-pane-library", "data-pane": "library", hidden: true });
    var libHead = h("div", { class: "card-head" });
    libHead.appendChild(h("div", { class: "card-title" }, [iconEl("book", 16), h("span", { text: "历史资料" })]));
    var importWrap = h("label", { class: "btn btn-sm", title: "导入题库 JSON" }, [iconEl("upload", 14), h("span", { text: "导入题库" })]);
    var importInput = h("input", { type: "file", id: "review-quiz-import", accept: ".json,application/json", hidden: true });
    state.importInputEl = importInput;
    importInput.addEventListener("change", onImportQuiz);
    importWrap.appendChild(importInput);
    libHead.appendChild(importWrap);
    paneLibrary.appendChild(libHead);
    state.libraryListEl = h("div", { class: "card-list", id: "review-library-list" });
    paneLibrary.appendChild(state.libraryListEl);
    state.paneEls.push(paneLibrary);
    wrap.appendChild(paneLibrary);

    rootEl.appendChild(wrap);

    // 初始渲染 + 异步加载
    setTab("points");
    renderResult();
    renderPoints();
    renderQuiz();
    renderStudyStats({});
    renderDueList();
    renderLibraryList([]);
    loadStudy();
    loadLibrary();
  }

  function unmount() {
    state = null;
  }

  // ============================================================
  // 对外
  // ============================================================
  CA.views = CA.views || {};
  CA.views.review = { mount: mount, unmount: unmount };
  CA.review = {
    formatVm: formatVm,
    answerState: answerState,
    mergeDocs: mergeDocs,
    escapeHtml: esc,
    importanceClass: importanceClass,
    importanceLabel: importanceLabel,
    difficultyLabel: difficultyLabel
  };
})();
