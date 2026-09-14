// scores.js —— 成绩中心视图 + 纯统计函数
// 角色：管理员（录入/统计/图表/AI）与学生（只看自己）。
// 对外：CA.views.scores = { mount, unmount }、CA.scores.stats.*、CA.scores.parseImport/applyImport
// UI：遵循 DESIGN.md 第 4 节类名（.card/.stat/.table/.btn-ai/.empty 等），禁止 emoji 图标。
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
    const n = Number(v);
    return isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  function fmtNum(v, digits) {
    const n = Number(v);
    if (!isFinite(n)) return "—";
    const d = digits == null ? 1 : digits;
    return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
  }

  function toast(msg, type) {
    try {
      if (CA.app && typeof CA.app.toast === "function") CA.app.toast(msg, type);
    } catch (e) { /* 测试/异常环境忽略 */ }
  }

  // 时间/日期统一走 CA.util（DESIGN §6.1），无则原样返回
  function fmtDate(v) {
    try { if (CA.util && typeof CA.util.fmtDate === "function") return CA.util.fmtDate(v); } catch (e) { /* 忽略 */ }
    return v == null ? "" : String(v);
  }

  // DOM 构造小助手
  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k === "value") { el.value = v; el.setAttribute("value", v); }
        else if (k === "checked") { el.checked = !!v; if (v) el.setAttribute("checked", ""); }
        else if (k === "hidden") { el.hidden = !!v; if (v) el.setAttribute("hidden", ""); }
        else if (k === "disabled") { el.disabled = !!v; if (v) el.setAttribute("disabled", ""); }
        else el.setAttribute(k, v);
      });
    }
    if (kids != null) {
      [].concat(kids).forEach(function (c) { if (c) el.appendChild(c); });
    }
    return el;
  }

  // ============================================================
  // 图标（禁止 emoji）：优先用全局 CA.icon（icons.js），缺失时回退内置 SVG
  // ============================================================
  const FALLBACK_ICONS = {
    chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="5" width="3" height="13" rx="1"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    sparkles: '<path d="m12 3 1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "trend-up": '<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>',
    "trend-down": '<path d="M22 17 13.5 8.5l-5 5L2 7"/><path d="M16 17h6v-6"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>'
  };

  function icon(name, size) {
    try {
      if (CA.icon && typeof CA.icon === "function") {
        const s = CA.icon(name, size);
        if (s) return s;
      }
    } catch (e) { /* 回退 */ }
    const body = FALLBACK_ICONS[name];
    if (!body) return "";
    const px = size || 18;
    return '<svg class="icon" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + "</svg>";
  }

  function iconSpan(name, size) {
    return h("span", { class: "icon-slot", html: icon(name, size) });
  }

  // 带图标的按钮；标签写入 .btn-label 便于 loading 时替换文案
  function makeBtn(attrs, iconName, label) {
    const b = h("button", attrs);
    b.__labelText = label == null ? "" : String(label);
    if (iconName) b.appendChild(iconSpan(iconName, 18));
    if (label != null) b.appendChild(h("span", { class: "btn-label", text: label }));
    return b;
  }

  // 按钮 loading 态：.is-loading（styles.css 自带 ::before spinner）+ 「生成中…」+ disabled
  function setBtnLoading(btn, on, text) {
    if (!btn) return;
    const lbl = btn.querySelector ? btn.querySelector(".btn-label") : null;
    if (on) {
      btn.disabled = true;
      if (String(btn.className || "").indexOf("is-loading") < 0) {
        btn.className = (btn.className ? btn.className + " " : "") + "is-loading";
      }
      if (lbl) lbl.textContent = text || "生成中…";
    } else {
      btn.disabled = false;
      btn.className = String(btn.className || "").replace(/\s*is-loading/g, "").trim();
      if (lbl) lbl.textContent = btn.__labelText || "";
    }
  }

  // ============================================================
  // 纯统计函数（CA.scores.stats.*，便于单测）
  // ============================================================
  const stats = (function () {
    // 归一化：接受数字数组或 {score} 对象数组，过滤非法项
    function values(scores) {
      return (scores || []).map(function (s) {
        return (s && typeof s === "object") ? Number(s.score) : Number(s);
      }).filter(function (v) { return isFinite(v); });
    }

    function mean(arr) {
      const a = values(arr);
      if (!a.length) return 0;
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i];
      return s / a.length;
    }

    function median(arr) {
      const a = values(arr).slice().sort(function (x, y) { return x - y; });
      if (!a.length) return 0;
      const m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }

    function maxOf(arr) {
      const a = values(arr);
      return a.length ? Math.max.apply(null, a) : 0;
    }

    function minOf(arr) {
      const a = values(arr);
      return a.length ? Math.min.apply(null, a) : 0;
    }

    // 总体标准差（分母 N）
    function stddev(arr) {
      const a = values(arr);
      if (!a.length) return 0;
      const m = mean(a);
      let s = 0;
      for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
      return Math.sqrt(s / a.length);
    }

    // 及格率：得分 >= 60% 满分，返回 0~100
    function passRate(scores, fullScore) {
      const a = values(scores);
      if (!a.length) return 0;
      const line = (Number(fullScore) || 100) * 0.6;
      let c = 0;
      for (let i = 0; i < a.length; i++) if (a[i] >= line) c++;
      return c / a.length * 100;
    }

    // 优秀率：得分 >= 85% 满分，返回 0~100
    function excellentRate(scores, fullScore) {
      const a = values(scores);
      if (!a.length) return 0;
      const line = (Number(fullScore) || 100) * 0.85;
      let c = 0;
      for (let i = 0; i < a.length; i++) if (a[i] >= line) c++;
      return c / a.length * 100;
    }

    // 分数段分布：n 段 -> {labels, counts}，最后一档含上界
    function buckets(scores, fullScore, n) {
      const seg = (n && n > 0) ? n : 5;
      const full = Number(fullScore) || 100;
      const a = values(scores);
      const width = full / seg;
      const labels = [];
      const counts = [];
      for (let i = 0; i < seg; i++) {
        const lo = Math.round(i * width);
        const hi = Math.round((i + 1) * width);
        labels.push(lo + "-" + hi);
        counts.push(0);
      }
      for (let k = 0; k < a.length; k++) {
        let idx = Math.floor(a[k] / width);
        if (idx < 0) idx = 0;
        if (idx >= seg) idx = seg - 1; // 满分归入最后一档
        counts[idx]++;
      }
      return { labels: labels, counts: counts };
    }

    // 名次：1-based，并列取最小名次
    function rankOf(value, allValues) {
      const a = values(allValues);
      let higher = 0;
      for (let i = 0; i < a.length; i++) if (a[i] > value) higher++;
      return higher + 1;
    }

    // 百分位：得分 <= value 的占比，0~100，越高越好
    function percentileOf(value, allValues) {
      const a = values(allValues);
      if (!a.length) return 0;
      let le = 0;
      for (let i = 0; i < a.length; i++) if (a[i] <= value) le++;
      return le / a.length * 100;
    }

    // 某考试各科统计（依赖 CA.store）
    function subjectStats(examId) {
      const subjects = (CA.store.get("subjects") || []).slice().sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
      const scores = CA.store.query("scores", function (s) { return s.examId === examId; });
      return subjects.map(function (sub) {
        const arr = scores.filter(function (s) { return s.subjectId === sub.id; }).map(function (s) { return s.score; });
        return {
          subjectId: sub.id,
          name: sub.name,
          fullScore: sub.fullScore,
          mean: mean(arr),
          max: maxOf(arr),
          min: minOf(arr),
          pass: passRate(arr, sub.fullScore),
          excellent: excellentRate(arr, sub.fullScore),
          count: arr.length,
        };
      });
    }

    return {
      mean: mean,
      median: median,
      maxOf: maxOf,
      minOf: minOf,
      stddev: stddev,
      passRate: passRate,
      excellentRate: excellentRate,
      buckets: buckets,
      rankOf: rankOf,
      percentileOf: percentileOf,
      subjectStats: subjectStats,
    };
  })();

  // ============================================================
  // 批量导入解析（纯函数，便于单测）
  // 每行：学号,科目,分数  或  姓名 科目 分数（分隔符：中英文逗号/空格/制表符）
  // 返回 { rows:[...], okCount, failCount }
  // ============================================================
  function parseImport(text) {
    const lines = String(text == null ? "" : text).split(/\r?\n/);
    const members = CA.store.get("members") || [];
    const subjects = CA.store.get("subjects") || [];
    const seen = {};
    const rows = [];
    let okCount = 0;
    let failCount = 0;

    function fail(lineNo, raw, reason) {
      rows.push({ line: lineNo, raw: raw, ok: false, reason: reason });
      failCount++;
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line) continue; // 空行跳过，不计失败

      let parts;
      if (/[,，\t]/.test(line)) {
        parts = line.split(/[,，\t]+/).map(function (t) { return t.trim(); }).filter(Boolean);
      } else {
        parts = line.split(/\s+/).map(function (t) { return t.trim(); }).filter(Boolean);
      }
      if (parts.length < 3) { fail(i + 1, line, "字段不足（需 3 列）"); continue; }

      const key = parts[0];
      const subjRaw = parts[1];
      const scoreRaw = parts[2];

      // 匹配学生：学号优先，其次姓名
      let member = null;
      for (let m = 0; m < members.length; m++) {
        if (String(members[m].studentNo) === String(key)) { member = members[m]; break; }
      }
      if (!member) {
        for (let m = 0; m < members.length; m++) {
          if (members[m].name === key) { member = members[m]; break; }
        }
      }
      if (!member) { fail(i + 1, line, "未找到学生：" + key); continue; }

      // 匹配科目：名称优先，其次 id
      let subject = null;
      for (let s = 0; s < subjects.length; s++) {
        if (subjects[s].name === subjRaw) { subject = subjects[s]; break; }
      }
      if (!subject) {
        for (let s = 0; s < subjects.length; s++) {
          if (subjects[s].id === subjRaw) { subject = subjects[s]; break; }
        }
      }
      if (!subject) { fail(i + 1, line, "未找到科目：" + subjRaw); continue; }

      if (scoreRaw === "" || !/^-?\d+(\.\d+)?$/.test(scoreRaw)) {
        fail(i + 1, line, "分数非法：" + scoreRaw);
        continue;
      }
      const score = Number(scoreRaw);
      if (!isFinite(score) || score < 0 || score > subject.fullScore) {
        fail(i + 1, line, "分数超出范围（0~" + subject.fullScore + "）：" + scoreRaw);
        continue;
      }

      const dupKey = member.id + "|" + subject.id;
      if (seen[dupKey]) { fail(i + 1, line, "重复行（同一学生同一科目）"); continue; }
      seen[dupKey] = true;

      rows.push({
        line: i + 1,
        raw: line,
        ok: true,
        memberId: member.id,
        name: member.name,
        studentNo: member.studentNo,
        subjectId: subject.id,
        subjectName: subject.name,
        score: score,
      });
      okCount++;
    }

    return { rows: rows, okCount: okCount, failCount: failCount };
  }

  // 写入解析结果：存在则更新，否则新增；返回 {added, updated, failed}
  function applyImport(parsed, examId) {
    let added = 0, updated = 0, failed = 0;
    (parsed && parsed.rows ? parsed.rows : []).forEach(function (r) {
      if (!r.ok) return;
      try {
        const all = CA.store.get("scores") || [];
        let existing = null;
        for (let i = 0; i < all.length; i++) {
          if (all[i].examId === examId && all[i].subjectId === r.subjectId && all[i].memberId === r.memberId) {
            existing = all[i];
            break;
          }
        }
        if (existing) {
          CA.store.update("scores", existing.id, { score: r.score, examId: examId, subjectId: r.subjectId, memberId: r.memberId });
          updated++;
        } else {
          CA.store.add("scores", { examId: examId, subjectId: r.subjectId, memberId: r.memberId, score: r.score });
          added++;
        }
      } catch (e) {
        failed++;
      }
    });
    return { added: added, updated: updated, failed: failed };
  }

  // ============================================================
  // 视图状态
  // ============================================================
  let state = null;
  let styleInjected = false;

  function aiEnabled() {
    try { return !!(CA.ai && typeof CA.ai.enabled === "function" && CA.ai.enabled()); }
    catch (e) { return false; }
  }

  // 仅补齐 styles.css 尚未提供的样式（markdown 排版 / 学生 hero / 窄输入框）
  // 全部使用 CSS 变量，无硬编码颜色；不覆盖设计系统已有类
  function injectScopedStyles() {
    if (styleInjected) return;
    styleInjected = true;
    if (typeof document === "undefined" || !document.head) return;
    const css =
      ".scores-view .table input.num{width:72px;height:30px;text-align:center;padding:4px 6px}" +
      ".scores-view .bar-value{width:auto;min-width:56px;text-align:right}" +
      ".md{font-size:var(--fs-sm);line-height:1.75;color:var(--text-2)}" +
      ".md h3{font-size:var(--fs-base);margin:14px 0 6px;color:var(--text)}" +
      ".md h4{font-size:var(--fs-sm);margin:12px 0 4px;color:var(--text)}" +
      ".md p{margin:8px 0}" +
      ".md ul{margin:8px 0;padding-left:20px}" +
      ".md li{margin:2px 0}" +
      ".md strong{color:var(--text)}" +
      ".student-hero{background:var(--primary-soft);border-color:transparent}" +
      ".student-hero .stat{background:var(--surface)}" +
      ".student-hero .stat-value{color:var(--primary-text)}" +
      ".subject-meta{display:flex;align-items:center;gap:8px;margin:-2px 0 10px 74px}";
    const style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- 数据辅助 ----------
  function sortedExams() {
    return (CA.store.get("exams") || []).slice().sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
  }
  function sortedSubjects() {
    return (CA.store.get("subjects") || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
  }
  function sortedMembers() {
    return (CA.store.get("members") || []).slice().sort(function (a, b) {
      return String(a.studentNo || "").localeCompare(String(b.studentNo || ""));
    });
  }
  function ensureExam() {
    const exams = sortedExams();
    if (!exams.length) { state.examId = null; return; }
    const found = exams.some(function (e) { return e.id === state.examId; });
    if (!found) state.examId = exams[exams.length - 1].id; // 默认最近一次考试
  }
  function ensureSubject() {
    const subjects = sortedSubjects();
    if (state.subjectId !== "all" && !subjects.some(function (s) { return s.id === state.subjectId; })) {
      state.subjectId = "all";
    }
  }
  function examName(id) {
    const exams = sortedExams();
    for (let i = 0; i < exams.length; i++) if (exams[i].id === id) return exams[i].name;
    return "";
  }
  function subjectName(id) {
    const subjects = sortedSubjects();
    for (let i = 0; i < subjects.length; i++) if (subjects[i].id === id) return subjects[i].name;
    return "全部科目";
  }

  // 学生本人对应的名单 id
  function myMemberId() {
    const u = (CA.auth && CA.auth.current && CA.auth.current()) || {};
    const members = CA.store.get("members") || [];
    if (u.studentNo) {
      for (let i = 0; i < members.length; i++) if (String(members[i].studentNo) === String(u.studentNo)) return members[i].id;
    }
    if (u.name) {
      for (let i = 0; i < members.length; i++) if (members[i].name === u.name) return members[i].id;
    }
    return null;
  }

  // 某考试范围内成绩的聚合统计（subjectIds 为 null 表示全部科目）
  function aggregate(examId, subjectIds) {
    const scores = CA.store.query("scores", function (s) {
      return s.examId === examId && (subjectIds == null || subjectIds.indexOf(s.subjectId) >= 0);
    });
    const fullMap = {};
    (CA.store.get("subjects") || []).forEach(function (s) { fullMap[s.id] = s.fullScore; });
    const vals = scores.map(function (s) { return s.score; });
    let pass = 0, exc = 0;
    scores.forEach(function (s) {
      const f = Number(fullMap[s.subjectId]) || 100;
      if (s.score >= f * 0.6) pass++;
      if (s.score >= f * 0.85) exc++;
    });
    const n = scores.length;
    return {
      count: n,
      mean: stats.mean(vals),
      median: stats.median(vals),
      max: stats.maxOf(vals),
      min: stats.minOf(vals),
      stddev: stats.stddev(vals),
      passRate: n ? pass / n * 100 : 0,
      excellentRate: n ? exc / n * 100 : 0,
    };
  }

  // markdown -> 安全 HTML（先转义再解析，防 XSS）
  function renderMarkdown(md) {
    const lines = esc(String(md == null ? "" : md)).split(/\r?\n/);
    const out = [];
    let inList = false;
    function inline(s) {
      return s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    }
    function closeList() { if (inList) { out.push("</ul>"); inList = false; } }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
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

  // ---------- 空态 / 通用片段 ----------
  // 空态插画（几何线条风，~120px）
  const EMPTY_ART = {
    chart:
      '<circle class="ea-soft" cx="26" cy="26" r="11"/>' +
      '<rect class="ea-plate" x="20" y="26" width="80" height="66" rx="12"/>' +
      '<rect class="ea-bar" x="32" y="68" width="10" height="14" rx="3"/>' +
      '<rect class="ea-bar" x="47" y="58" width="10" height="24" rx="3"/>' +
      '<rect class="ea-bar-solid" x="62" y="62" width="10" height="20" rx="3"/>' +
      '<rect class="ea-bar" x="77" y="48" width="10" height="34" rx="3"/>' +
      '<path class="ea-accent" d="M34 52l15-9 13 6 17-15"/>' +
      '<path class="ea-accent" d="M70 33h10v10"/>',
    calendar:
      '<circle class="ea-soft" cx="90" cy="30" r="12"/>' +
      '<rect class="ea-plate" x="24" y="28" width="72" height="64" rx="12"/>' +
      '<path class="ea-line" d="M24 46h72"/>' +
      '<path class="ea-line" d="M42 20v12M78 20v12"/>' +
      '<path class="ea-accent" d="M40 62h10M40 76h10M60 62h10M60 76h10"/>',
    users:
      '<circle class="ea-soft" cx="90" cy="32" r="13"/>' +
      '<circle class="ea-plate" cx="60" cy="50" r="16"/>' +
      '<path class="ea-plate" d="M32 92a28 28 0 0 1 56 0"/>' +
      '<circle class="ea-plate" cx="34" cy="60" r="11"/>' +
      '<path class="ea-plate" d="M16 88a19 19 0 0 1 34-4"/>'
  };
  function emptyArtFor(name) {
    if (name === "calendar") return EMPTY_ART.calendar;
    if (name === "users") return EMPTY_ART.users;
    return EMPTY_ART.chart;
  }
  function emptyHtml(iconName, title, desc) {
    return '<div class="empty">' +
      '<div class="empty-art" aria-hidden="true"><svg viewBox="0 0 120 120" fill="none">' +
      emptyArtFor(iconName) + "</svg></div>" +
      '<div class="empty-title">' + esc(title) + "</div>" +
      (desc ? '<p class="empty-desc">' + esc(desc) + "</p>" : "") +
      "</div>";
  }
  // 加载占位：spinner + 骨架行（AI 生成/异步时）
  function loadingHtml(text) {
    return '<div class="skeleton-card" role="status" aria-live="polite">' +
      '<div class="ai-loading"><span class="spinner"></span><span>' + esc(text) + "</span></div>" +
      '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div>' +
      "</div>";
  }
  function renderEmptyInto(el, title, desc) {
    if (el) el.innerHTML = emptyHtml("chart", title, desc);
  }
  // 入场 stagger：优先复用 app.js 的 enter，缺失时本地降级
  function stagger(el) {
    if (CA.app && typeof CA.app.enter === "function") { CA.app.enter(el); return; }
    if (!el || !el.classList) return;
    el.classList.remove("ca-enter");
    void el.offsetWidth;
    el.classList.add("ca-enter");
    if (el.__enterT) clearTimeout(el.__enterT);
    el.__enterT = setTimeout(function () { if (el.classList) el.classList.remove("ca-enter"); }, 820);
  }
  function statEl(cls, label, value) {
    return h("div", { class: "stat" + (cls ? " " + cls : "") }, [
      h("div", { class: "stat-value", text: value }),
      h("div", { class: "stat-label", text: label }),
    ]);
  }
  // 横向进度条（复用 styles.css 的 .bar-* 设计类）
  function barRow(label, pct, valueText) {
    const row = h("div", { class: "bar-row" });
    row.appendChild(h("span", { class: "bar-label", title: label, text: label }));
    const track = h("span", { class: "bar-track" });
    const fill = h("span", { class: "bar-fill" });
    fill.setAttribute("style", "width:" + Math.max(0, Math.min(100, Number(pct) || 0)).toFixed(1) + "%");
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(h("span", { class: "bar-value", text: valueText }));
    return row;
  }

  // ---------- 下拉框 ----------
  function buildExamSelect() {
    const sel = h("select", { id: "exam-select", class: "input" });
    const exams = sortedExams();
    if (!exams.length) {
      sel.appendChild(h("option", { value: "", text: "（暂无考试）" }));
      return sel;
    }
    exams.forEach(function (e) {
      const op = h("option", { value: e.id, text: e.name + (e.date ? "（" + fmtDate(e.date) + "）" : "") });
      if (e.id === state.examId) op.setAttribute("selected", "");
      sel.appendChild(op);
    });
    sel.value = state.examId || "";
    sel.addEventListener("change", function () {
      state.examId = sel.value;
      state.selectedMemberId = null;
      render();
    });
    return sel;
  }

  function buildSubjectSelect() {
    const sel = h("select", { id: "score-subject-filter", class: "input" });
    const all = h("option", { value: "all", text: "全部科目" });
    if (state.subjectId === "all") all.setAttribute("selected", "");
    sel.appendChild(all);
    sortedSubjects().forEach(function (s) {
      const op = h("option", { value: s.id, text: s.name + "（满分" + s.fullScore + "）" });
      if (s.id === state.subjectId) op.setAttribute("selected", "");
      sel.appendChild(op);
    });
    sel.value = state.subjectId;
    sel.addEventListener("change", function () {
      state.subjectId = sel.value;
      render();
    });
    return sel;
  }

  // ============================================================
  // 管理员视图
  // ============================================================
  function renderAdmin() {
    const root = state.root;
    const box = h("div", { class: "scores-view" });

    // --- 工具栏 ---
    const toolbar = h("div", { class: "card" });
    const importBtn = makeBtn({ class: "btn", id: "btn-score-import", type: "button" }, "upload", "批量录入");
    toolbar.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconSpan("chart", 20), h("span", { text: "成绩中心" })]),
      importBtn,
    ]));
    toolbar.appendChild(h("div", { class: "row" }, [
      h("div", { class: "form-field" }, [h("span", { class: "label", text: "考试" }), buildExamSelect()]),
      h("div", { class: "form-field" }, [h("span", { class: "label", text: "科目" }), buildSubjectSelect()]),
    ]));
    box.appendChild(toolbar);

    // --- 批量导入面板 ---
    const importPanel = h("div", { class: "card", hidden: true });
    importPanel.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconSpan("clipboard", 18), h("span", { text: "批量录入" })]),
    ]));
    const importInput = h("textarea", {
      class: "input", id: "score-import-input", rows: "6",
      placeholder: "每行：学号,科目,分数  或  姓名 科目 分数\n20230301,数学,138\n张天宇 语文 129",
    });
    importPanel.appendChild(h("div", { class: "form-field" }, [
      h("span", { class: "label", text: "粘贴成绩数据" }),
      importInput,
      h("span", { class: "field-hint", text: "支持中英文逗号、空格、制表符分隔；同一学生同一科目重复行会报错。" }),
    ]));
    const parseBtn = makeBtn({ class: "btn", id: "btn-score-parse", type: "button" }, "search", "解析预览");
    const confirmBtn = makeBtn({ class: "btn btn-primary", id: "btn-score-confirm", type: "button", hidden: true }, "check", "确认写入");
    const previewBox = h("div", { class: "text-sm" });
    importPanel.appendChild(h("div", { class: "form-actions" }, [parseBtn, confirmBtn]));
    importPanel.appendChild(previewBox);
    box.appendChild(importPanel);

    // --- 统计卡片 ---
    const statsCard = h("div", { class: "card" });
    const statsSub = h("div", { class: "card-sub", text: "" });
    statsCard.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconSpan("trend-up", 18), h("span", { text: "成绩概览" })]),
      statsSub,
    ]));
    const statsGrid = h("div", { class: "stat-grid" });
    statsCard.appendChild(statsGrid);
    box.appendChild(statsCard);

    // --- 成绩表 ---
    const tableCard = h("div", { class: "card" });
    tableCard.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconSpan("users", 18), h("span", { text: "成绩表" })]),
      h("div", { class: "card-sub", text: "点击分数可编辑 · 点击行选择学生" }),
    ]));
    const tableWrap = h("div", { class: "table-wrap", id: "score-table" });
    tableCard.appendChild(tableWrap);
    box.appendChild(tableCard);

    // --- 图表 ---
    const chartsCard = h("div", { class: "card chart-grid" });
    function chartBox(id, title) {
      const wrap = h("div");
      wrap.appendChild(h("div", { class: "chart-title", text: title }));
      const chart = h("div", { class: "chart", id: id });
      wrap.appendChild(chart);
      return chart;
    }
    const distEl = chartBox("chart-dist", "分数段分布");
    const trendEl = chartBox("chart-trend", "历次考试趋势");
    const subjectEl = chartBox("chart-subject", "科目均分对比");
    chartsCard.appendChild(distEl.parentNode);
    chartsCard.appendChild(trendEl.parentNode);
    chartsCard.appendChild(subjectEl.parentNode);
    box.appendChild(chartsCard);

    // --- AI 班级报告 ---
    const aiOn = aiEnabled();
    const reportBtn = makeBtn({
      class: "btn btn-ai", id: "btn-ai-report", type: "button",
      disabled: !aiOn || !state.examId, hidden: !aiOn,
    }, "sparkles", "生成报告");
    const reportBox = h("div", { class: "md", id: "ai-report-box", html: '<p class="muted">点击「生成报告」，AI 将根据本次考试成绩生成班级分析。</p>' });
    box.appendChild(h("div", { class: "card" }, [
      h("div", { class: "card-head" }, [
        h("div", { class: "card-title" }, [iconSpan("sparkles", 18), h("span", { text: "AI 班级分析报告" }), h("span", { class: "badge badge-ai", text: "AI" })]),
        reportBtn,
      ]),
      reportBox,
    ]));

    // --- AI 个人评语 ---
    const commentBtn = makeBtn({
      class: "btn btn-ai", id: "btn-ai-comment", type: "button",
      disabled: true, hidden: !aiOn,
    }, "sparkles", "生成评语");
    const copyBtn = makeBtn({ class: "btn btn-sm", id: "btn-ai-comment-copy", type: "button", hidden: true }, "download", "复制");
    const selectedHint = h("span", { class: "muted text-sm", id: "score-selected-hint", text: "（点击表格中的学生行选择）" });
    const commentBox = h("div", { class: "md", id: "ai-comment-box", html: '<p class="muted">选择一名学生后生成个性化评语。</p>' });
    box.appendChild(h("div", { class: "card" }, [
      h("div", { class: "card-head" }, [
        h("div", { class: "card-title" }, [iconSpan("user", 18), h("span", { text: "AI 个人评语" })]),
        selectedHint, copyBtn, commentBtn,
      ]),
      commentBox,
    ]));

    state.distEl = distEl;
    state.trendEl = trendEl;
    state.subjectEl = subjectEl;
    state.reportBox = reportBox;
    state.commentBox = commentBox;
    state.copyBtn = copyBtn;
    state.lastComment = "";

    // --- 事件 ---
    importBtn.addEventListener("click", function () {
      importPanel.hidden = !importPanel.hidden;
    });

    parseBtn.addEventListener("click", function () {
      const parsed = parseImport(importInput.value);
      state._parsed = parsed;
      renderPreview(previewBox, parsed);
      confirmBtn.hidden = parsed.okCount === 0;
      if (parsed.okCount === 0 && parsed.failCount === 0) toast("没有可解析的内容", "error");
    });

    confirmBtn.addEventListener("click", function () {
      if (!state._parsed || !state._parsed.okCount) return;
      if (!state.examId) { toast("请先选择考试", "error"); return; }
      const res = applyImport(state._parsed, state.examId);
      toast("导入完成：新增 " + res.added + "，更新 " + res.updated + "，失败 " + res.failed, "success");
      state._parsed = null;
      render();
    });

    reportBtn.addEventListener("click", generateReport);
    commentBtn.addEventListener("click", generateComment);
    copyBtn.addEventListener("click", function () {
      const text = state.lastComment || "";
      if (!text) return;
      if (copyText(text)) flashCopied(copyBtn);
    });

    root.appendChild(box);
    refreshStats(statsGrid, statsSub);
    buildTable(tableWrap);
    refreshCharts();
  }

  // 刷新统计卡片（7 张，带语义色）
  function refreshStats(container, subEl) {
    const scope = state.subjectId === "all"
      ? sortedSubjects()
      : sortedSubjects().filter(function (s) { return s.id === state.subjectId; });
    if (subEl) {
      subEl.textContent = state.examId
        ? (examName(state.examId) + " · " + subjectName(state.subjectId))
        : "暂无考试";
    }
    if (!state.examId) {
      container.innerHTML = emptyHtml("calendar", "暂无考试成绩", "请先在种子数据中创建考试，或导入成绩后再查看统计。");
      return;
    }
    const ids = scope.map(function (s) { return s.id; });
    const agg = aggregate(state.examId, ids);
    const has = agg.count > 0;
    const passCls = !has ? "" : (agg.passRate >= 90 ? "success" : agg.passRate >= 60 ? "warn" : "danger");
    const excCls = !has ? "" : (agg.excellentRate >= 50 ? "success" : agg.excellentRate >= 25 ? "warn" : "danger");
    const cards = [
      { k: "均分", v: has ? fmtNum(agg.mean) : "—", cls: "emphasis" },
      { k: "中位数", v: has ? fmtNum(agg.median) : "—", cls: "" },
      { k: "最高分", v: has ? fmtNum(agg.max) : "—", cls: "" },
      { k: "最低分", v: has ? fmtNum(agg.min) : "—", cls: "danger" },
      { k: "标准差", v: has ? fmtNum(agg.stddev) : "—", cls: "" },
      { k: "及格率", v: has ? fmtNum(agg.passRate) + "%" : "—", cls: passCls },
      { k: "优秀率", v: has ? fmtNum(agg.excellentRate) + "%" : "—", cls: excCls },
    ];
    container.innerHTML = cards.map(function (c) {
      return '<div class="stat ' + c.cls + '">' +
        '<div class="stat-value">' + esc(c.v) + "</div>" +
        '<div class="stat-label">' + esc(c.k) + "</div></div>";
    }).join("");
  }

  // 刷新成绩表
  function buildTable(container) {
    container.innerHTML = "";
    const examId = state.examId;
    if (!examId) {
      container.innerHTML = emptyHtml("calendar", "暂无考试数据", "导入或录入成绩后，这里会显示班级成绩表。");
      return;
    }
    const subjects = sortedSubjects();
    const cols = state.subjectId === "all" ? subjects : subjects.filter(function (s) { return s.id === state.subjectId; });
    const members = sortedMembers();
    const scores = CA.store.query("scores", function (s) { return s.examId === examId; });

    if (!members.length) {
      container.innerHTML = emptyHtml("users", "暂无班级名单", "请先在设置中维护班级名单。");
      return;
    }

    // 索引：memberId -> subjectId -> score record
    const map = {};
    scores.forEach(function (s) {
      if (!map[s.memberId]) map[s.memberId] = {};
      map[s.memberId][s.subjectId] = s;
    });

    // 计算每个学生的展示值与名次
    function totalOf(mid) {
      if (state.subjectId !== "all") {
        const rec = map[mid] && map[mid][state.subjectId];
        return rec ? Number(rec.score) : null;
      }
      let sum = 0, has = false;
      cols.forEach(function (sub) {
        const rec = map[mid] && map[mid][sub.id];
        if (rec) { sum += Number(rec.score); has = true; }
      });
      return has ? sum : null;
    }
    const totalsByMember = {};
    const allTotals = [];
    members.forEach(function (m) {
      const t = totalOf(m.id);
      totalsByMember[m.id] = t;
      if (t != null) allTotals.push(t);
    });

    const table = h("table", { class: "table" });
    // 表头
    const thead = h("thead");
    const hr = h("tr");
    hr.appendChild(h("th", { text: "姓名" }));
    hr.appendChild(h("th", { class: "num", text: "学号" }));
    cols.forEach(function (sub) { hr.appendChild(h("th", { class: "num", text: sub.name + "（" + sub.fullScore + "）" })); });
    if (state.subjectId === "all") hr.appendChild(h("th", { class: "num", text: "总分" }));
    hr.appendChild(h("th", { class: "num", text: "班内名次" }));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = h("tbody");
    members.forEach(function (m) {
      const tr = h("tr");
      if (state.selectedMemberId === m.id) tr.className = "is-selected";
      const nameTd = h("td");
      nameTd.appendChild(h("span", { class: "row" }, [
        h("span", { class: "avatar", text: (m.name || "?").slice(0, 1) }),
        h("span", { text: m.name }),
      ]));
      tr.appendChild(nameTd);
      tr.appendChild(h("td", { class: "num", text: m.studentNo }));
      cols.forEach(function (sub) {
        const rec = map[m.id] && map[m.id][sub.id];
        const inp = h("input", {
          class: "input num", type: "number", min: "0", max: String(sub.fullScore),
          value: rec ? String(rec.score) : "",
          "data-member": m.id, "data-subject": sub.id,
          "aria-label": m.name + sub.name + "分数",
        });
        inp.addEventListener("change", function () {
          handleCellEdit(m, sub, rec, inp.value);
        });
        tr.appendChild(h("td", { class: "num" }, [inp]));
      });
      if (state.subjectId === "all") {
        const t = totalsByMember[m.id];
        tr.appendChild(h("td", { class: "num", text: t == null ? "—" : String(t) }));
      }
      const tv = totalsByMember[m.id];
      if (tv == null) {
        tr.appendChild(h("td", { class: "num" }, [h("span", { class: "badge badge-muted", text: "—" })]));
      } else {
        const r = stats.rankOf(tv, allTotals);
        tr.appendChild(h("td", { class: "num" }, [
          h("span", { class: "badge " + (r <= 5 ? "badge-success" : "badge-muted"), text: String(r) }),
        ]));
      }
      tr.addEventListener("click", function (e) {
        const tag = e && e.target && e.target.tagName;
        if (tag === "INPUT" || tag === "SELECT") return;
        selectMember(m.id);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function handleCellEdit(member, subject, rec, raw) {
    const rawStr = String(raw == null ? "" : raw).trim();
    if (rawStr === "") {
      if (rec) CA.store.remove("scores", rec.id); // 清空 = 删除
      render();
      return;
    }
    const num = Number(rawStr);
    if (!isFinite(num) || num < 0 || num > subject.fullScore) {
      toast("分数非法（0~" + subject.fullScore + "）", "error");
      render();
      return;
    }
    if (rec) CA.store.update("scores", rec.id, { score: num });
    else CA.store.add("scores", { examId: state.examId, subjectId: subject.id, memberId: member.id, score: num });
    selectMember(member.id, true);
    render();
  }

  function selectMember(memberId, keepComment) {
    state.selectedMemberId = memberId;
    const name = CA.store.memberName ? CA.store.memberName(memberId) : "";
    if (state.commentBox && !keepComment) {
      state.commentBox.innerHTML = '<p class="muted">已选择「' + esc(name) + '」，点击「生成评语」。</p>';
      state.lastComment = "";
    }
    if (state.copyBtn) state.copyBtn.hidden = true;
    const hint = state.root && state.root.querySelector ? state.root.querySelector("#score-selected-hint") : null;
    if (hint) hint.textContent = name ? "已选择：" + name : "";
    const btn = state.root && state.root.querySelector ? state.root.querySelector("#btn-ai-comment") : null;
    if (btn && aiEnabled()) btn.disabled = false;
  }

  // 刷新三个图表
  function refreshCharts() {
    const examId = state.examId;
    if (!examId) {
      renderEmptyInto(state.distEl, "暂无图表数据", "录入成绩后即可查看分布、趋势与科目对比。");
      renderEmptyInto(state.trendEl, "暂无图表数据", "录入成绩后即可查看历次趋势。");
      renderEmptyInto(state.subjectEl, "暂无图表数据", "录入成绩后即可查看科目均分对比。");
      return;
    }
    const subjects = sortedSubjects();
    const scores = CA.store.query("scores", function (s) { return s.examId === examId; });
    const scope = state.subjectId === "all" ? subjects : subjects.filter(function (s) { return s.id === state.subjectId; });
    const scopeIds = scope.map(function (s) { return s.id; });
    let maxFull = 100;
    scope.forEach(function (s) { maxFull = Math.max(maxFull, Number(s.fullScore) || 0); });

    // 分数段分布
    const vals = scores.filter(function (s) { return scopeIds.indexOf(s.subjectId) >= 0; }).map(function (s) { return s.score; });
    if (!vals.length) {
      renderEmptyInto(state.distEl, "暂无图表数据", "本次考试尚未录入成绩。");
      renderEmptyInto(state.trendEl, "暂无图表数据", "本次考试尚未录入成绩。");
      renderEmptyInto(state.subjectEl, "暂无图表数据", "本次考试尚未录入成绩。");
      return;
    }
    const b = stats.buckets(vals, maxFull, 5);
    if (state.distEl && CA.charts) CA.charts.distribution(state.distEl, { title: "分数段分布", labels: b.labels, counts: b.counts });

    // 历次趋势
    const exams = sortedExams();
    const categories = exams.map(function (e) { return e.name; });
    let series;
    if (state.subjectId === "all") {
      series = [{ name: "班级均分", data: exams.map(function (e) { return round1(stats.mean(allScoresOf(e.id))); }) }];
    } else {
      const sub = scope[0];
      series = [{
        name: sub ? sub.name : "均分",
        data: exams.map(function (e) { return round1(stats.mean(subjScoresOf(e.id, state.subjectId))); }),
      }];
    }
    if (state.trendEl && CA.charts) CA.charts.trend(state.trendEl, { title: "历次考试趋势", categories: categories, series: series });

    // 科目均分对比
    if (state.subjectEl && CA.charts) {
      CA.charts.subjectCompare(state.subjectEl, {
        title: "科目均分对比",
        subjects: subjects.map(function (s) { return s.name; }),
        averages: subjects.map(function (s) { return round1(stats.mean(subjScoresOf(examId, s.id))); }),
        fullScores: subjects.map(function (s) { return s.fullScore; }),
      });
    }
  }

  function allScoresOf(examId) {
    return CA.store.query("scores", function (s) { return s.examId === examId; }).map(function (s) { return s.score; });
  }
  function subjScoresOf(examId, subjectId) {
    return CA.store.query("scores", function (s) { return s.examId === examId && s.subjectId === subjectId; }).map(function (s) { return s.score; });
  }

  // 导入预览
  function renderPreview(container, parsed) {
    let html = '<div class="row"><span class="badge badge-success">可导入 ' + parsed.okCount + "</span>" +
      '<span class="badge badge-muted">失败 ' + parsed.failCount + "</span></div>";
    const oks = parsed.rows.filter(function (r) { return r.ok; });
    const bads = parsed.rows.filter(function (r) { return !r.ok; });
    if (oks.length) {
      html += '<div class="card-list">' + oks.slice(0, 8).map(function (r) {
        return '<div class="list-row"><span class="list-main">' + esc(r.name + " · " + r.subjectName + " " + r.score) + "</span>" +
          '<span class="badge badge-success">' + icon("check", 14) + "可导入</span></div>";
      }).join("") + (oks.length > 8 ? '<div class="list-row"><span class="list-main muted">…另有 ' + (oks.length - 8) + " 条</span></div>" : "") + "</div>";
    }
    if (bads.length) {
      html += '<div class="card-list">' + bads.slice(0, 8).map(function (r) {
        return '<div class="list-row"><span class="list-main field-error">第 ' + r.line + " 行：" + esc(r.reason) + "</span></div>";
      }).join("") + (bads.length > 8 ? '<div class="list-row"><span class="list-main muted">…另有 ' + (bads.length - 8) + " 条失败</span></div>" : "") + "</div>";
    }
    container.innerHTML = html;
  }

  function copyText(text) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        toast("已复制到剪贴板", "success");
        return true;
      }
    } catch (e) { /* 继续降级 */ }
    toast("复制失败，请手动选择文本", "error");
    return false;
  }

  // 复制成功：按钮短暂变「已复制」并高亮（微交互）
  function flashCopied(btn) {
    if (!btn || !btn.querySelector) return;
    const lbl = btn.querySelector(".btn-label");
    if (!lbl) return;
    if (lbl.__origText == null) lbl.__origText = lbl.textContent;
    lbl.textContent = "已复制";
    if (btn.classList) btn.classList.add("is-copied");
    if (btn.__copiedT) clearTimeout(btn.__copiedT);
    btn.__copiedT = setTimeout(function () {
      lbl.textContent = lbl.__origText;
      if (btn.classList) btn.classList.remove("is-copied");
    }, 1400);
  }

  // ---------- AI 生成 ----------
  function generateReport() {
    if (!aiEnabled()) return;
    const btn = state.root.querySelector("#btn-ai-report");
    const boxEl = state.reportBox;
    setBtnLoading(btn, true, "生成中…");
    boxEl.innerHTML = loadingHtml("AI 正在分析本次考试成绩…");
    Promise.resolve()
      .then(function () { return CA.ai.analyzeExam(state.examId); })
      .then(function (res) {
        const md = res && res.markdown != null ? res.markdown : (typeof res === "string" ? res : "");
        boxEl.innerHTML = renderMarkdown(md);
      })
      .catch(function (e) {
        boxEl.innerHTML = '<p class="field-error">生成失败：' + esc((e && e.message) || "未知错误") + "</p>";
        toast("AI 分析失败：" + ((e && e.message) || ""), "error");
      })
      .then(function () {
        setBtnLoading(btn, false);
      });
  }

  function generateComment() {
    if (!aiEnabled() || !state.selectedMemberId) return;
    const btn = state.root.querySelector("#btn-ai-comment");
    const boxEl = state.commentBox;
    setBtnLoading(btn, true, "生成中…");
    boxEl.innerHTML = loadingHtml("AI 正在生成评语…");
    Promise.resolve()
      .then(function () { return CA.ai.studentComment(state.selectedMemberId, state.examId); })
      .then(function (text) {
        const md = typeof text === "string" ? text : (text && text.markdown) || "";
        state.lastComment = md;
        boxEl.innerHTML = renderMarkdown(md);
        if (state.copyBtn) state.copyBtn.hidden = false;
      })
      .catch(function (e) {
        boxEl.innerHTML = '<p class="field-error">生成失败：' + esc((e && e.message) || "未知错误") + "</p>";
        toast("AI 评语失败：" + ((e && e.message) || "未知错误"), "error");
      })
      .then(function () {
        setBtnLoading(btn, false);
      });
  }

  // ============================================================
  // 学生视图（只看自己，鼓励性文案）
  // ============================================================
  function renderStudent() {
    const root = state.root;
    const box = h("div", { class: "scores-view" });
    const panel = h("div", { id: "student-score-panel" });
    box.appendChild(panel);
    root.appendChild(box);

    state.memberId = myMemberId();
    buildStudentPanel(panel);
  }

  function buildStudentPanel(panel) {
    const examId = state.examId;
    const mid = state.memberId;
    panel.innerHTML = "";

    if (!examId) {
      panel.innerHTML = emptyHtml("calendar", "暂无考试成绩", "考试安排发布后，这里会展示你的成绩单。");
      return;
    }
    if (!mid) {
      panel.innerHTML = emptyHtml("user", "未找到你的信息", "你不在班级名单中，请联系老师核对学号与姓名。");
      return;
    }

    const subjects = sortedSubjects();
    const scores = CA.store.query("scores", function (s) { return s.examId === examId; });
    const myScores = {};
    scores.forEach(function (s) { if (s.memberId === mid) myScores[s.subjectId] = Number(s.score); });

    // 总分与名次、百分位（不暴露他人姓名）
    const totals = {};
    scores.forEach(function (s) { totals[s.memberId] = (totals[s.memberId] || 0) + Number(s.score); });
    const allTotals = Object.keys(totals).map(function (k) { return totals[k]; });
    const myTotal = totals[mid] != null ? totals[mid] : 0;
    const rank = allTotals.length ? stats.rankOf(myTotal, allTotals) : 0;
    const percentile = allTotals.length ? stats.percentileOf(myTotal, allTotals) : 0;
    const classMeanTotal = allTotals.length ? stats.mean(allTotals) : 0;
    const myName = (CA.store.memberName ? CA.store.memberName(mid) : "") || "同学";

    // 考试选择
    panel.appendChild(h("div", { class: "card" }, [
      h("div", { class: "row" }, [
        h("div", { class: "form-field" }, [h("span", { class: "label", text: "考试" }), buildExamSelect()]),
      ]),
    ]));

    if (!scores.length) {
      panel.innerHTML = emptyHtml("chart", "本次考试暂无成绩", "成绩录入后，这里会展示你的成绩单与班级对比。");
      return;
    }

    // --- 成绩单概览（温暖主色 hero） ---
    const hero = h("div", { class: "card student-hero" });
    hero.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconSpan("star", 18), h("span", { text: "我的成绩单" })]),
      h("div", { class: "card-sub", text: examName(examId) }),
    ]));
    hero.appendChild(h("p", { class: "muted", text: myName + "，你好！以下是本次考试的表现，每一次认真都值得肯定。" }));
    const heroGrid = h("div", { class: "stat-grid" });
    heroGrid.appendChild(statEl("emphasis", "我的总分", String(Math.round(myTotal))));
    heroGrid.appendChild(statEl("", "班级名次", rank ? "第 " + rank + " / " + allTotals.length : "—"));
    heroGrid.appendChild(statEl(allTotals.length && percentile >= 70 ? "success" : "", "班级位置", allTotals.length ? "前 " + Math.max(1, Math.round(100 - percentile)) + "%" : "—"));
    heroGrid.appendChild(statEl("", "班级总分均分", fmtNum(classMeanTotal)));
    hero.appendChild(heroGrid);

    // --- 排名定位 ---
    const rankCard = h("div", { class: "card" });
    rankCard.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconSpan("award", 18), h("span", { text: "我的位置" })]),
    ]));
    const bars = h("div", { class: "bar-chart" });
    bars.appendChild(barRow("班级位置", percentile, "超过 " + Math.round(percentile) + "%"));
    rankCard.appendChild(bars);
    rankCard.appendChild(h("p", { class: "muted", text: encourage(percentile) }));
    panel.appendChild(rankCard);

    // --- 各科成绩与班级均分对比（横向进度条） ---
    const subjCard = h("div", { class: "card" });
    subjCard.appendChild(h("div", { class: "card-head" }, [
      h("div", { class: "card-title" }, [iconSpan("book", 18), h("span", { text: "各科成绩与班级均分" })]),
      h("div", { class: "card-sub", text: "进度条为得分率" }),
    ]));
    const subjBars = h("div", { class: "bar-chart" });
    subjects.forEach(function (sub) {
      const my = myScores[sub.id];
      const avg = stats.mean(subjScoresOf(examId, sub.id));
      const full = Number(sub.fullScore) || 100;
      if (my == null) {
        subjBars.appendChild(barRow(sub.name, 0, "—"));
        subjBars.appendChild(h("div", { class: "subject-meta" }, [h("span", { class: "badge badge-muted", text: "暂无成绩" })]));
        return;
      }
      const rate = my / full * 100;
      subjBars.appendChild(barRow(sub.name, rate, my + " / " + full));
      const diff = my - avg;
      const above = diff >= 0;
      subjBars.appendChild(h("div", { class: "subject-meta" }, [
        h("span", { class: "muted text-sm", text: "班级均分 " + fmtNum(avg) }),
        h("span", { class: "badge " + (above ? "badge-success" : "badge-muted"), text: above ? "高于均分 " + fmtNum(Math.abs(diff)) : "距均分 " + fmtNum(Math.abs(diff)) }),
      ]));
    });
    subjCard.appendChild(subjBars);
    panel.appendChild(subjCard);

    // --- 个人历次趋势 ---
    const trendCard = h("div", { class: "card" });
    trendCard.appendChild(h("div", { class: "card-title", text: "我的历次趋势" }));
    const trendEl = h("div", { class: "chart", id: "chart-trend" });
    trendCard.appendChild(trendEl);
    panel.appendChild(trendCard);

    if (CA.charts) {
      const exams = sortedExams();
      const myTotals = exams.map(function (e) {
        let sum = 0, has = false;
        CA.store.query("scores", function (s) { return s.examId === e.id; }).forEach(function (s) {
          if (s.memberId === mid) { sum += Number(s.score); has = true; }
        });
        return has ? sum : null;
      });
      const classTotals = exams.map(function (e) {
        const m = {};
        CA.store.query("scores", function (s) { return s.examId === e.id; }).forEach(function (s) {
          m[s.memberId] = (m[s.memberId] || 0) + Number(s.score);
        });
        const arr = Object.keys(m).map(function (k) { return m[k]; });
        return arr.length ? round1(stats.mean(arr)) : null;
      });
      CA.charts.trend(trendEl, {
        title: "我的历次总分",
        categories: exams.map(function (e) { return e.name; }),
        series: [
          { name: "我的总分", data: myTotals },
          { name: "班级均分", data: classTotals },
        ],
      });
    }
  }

  function encourage(percentile) {
    if (percentile >= 90) return "太棒了！你位于班级前列，继续保持这份专注。";
    if (percentile >= 70) return "表现不错，稳居班级中上游，再接再厉。";
    if (percentile >= 50) return "你在班级中处于中上水平，把错题弄懂会更好。";
    if (percentile >= 30) return "还有不小的进步空间，找对方法，一点点来。";
    return "每一次努力都算数，从复盘错题开始，你会看到进步的。";
  }

  // ============================================================
  // 入口
  // ============================================================
  function render() {
    if (!state || !state.root) return;
    state.root.innerHTML = "";
    ensureExam();
    ensureSubject();
    if (state.role === "student") renderStudent();
    else renderAdmin();
    stagger(state.root);
  }

  function mount(rootEl) {
    const user = (CA.auth && CA.auth.current && CA.auth.current()) || {};
    state = {
      root: rootEl,
      role: user.role === "student" ? "student" : "admin",
      examId: null,
      subjectId: "all",
      selectedMemberId: null,
      memberId: null,
      _parsed: null,
      lastComment: "",
    };
    injectScopedStyles();
    render();
  }

  function unmount() {
    try {
      if (CA.charts && typeof CA.charts.disposeAll === "function") CA.charts.disposeAll();
    } catch (e) { /* 忽略 */ }
    state = null;
  }

  CA.views = CA.views || {};
  CA.views.scores = { mount: mount, unmount: unmount };
  CA.scores = {
    stats: stats,
    parseImport: parseImport,
    applyImport: applyImport,
  };
})();
