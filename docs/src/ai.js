// AI 增强层 —— 统一网关（复用 CA.llm 的 OpenAI 兼容通道）
// 契约：CONTRACT.md 第 8 节。所有 LLM 输出走「严格 JSON 校验 + 字段白名单 + warnings」；
// AI 整体可选：enabled() 为 false 时调用方须隐藏入口，基础功能零依赖。
// 输出 markdown 子集（scores.js renderMarkdown 兼容）：## 标题 / **粗体** / - 列表 / 段落
window.CA = window.CA || {};

CA.ai = (function () {
  // 与 notices 模块的分类/时间类型枚举保持一致
  var CATEGORIES = ["考试安排", "作业信息", "活动信息", "班级通知", "其他"];
  var TIME_LABELS = ["考试时间", "截止时间", "报名截止", "活动时间", "相关时间"];

  // ---------- 可用性 ----------
  function enabled() {
    try {
      var s = (CA.store && CA.store.settings) ? CA.store.settings() : {};
      if (s && s.aiEnabled === false) return false;
      return !!(CA.llm && CA.llm.ready && CA.llm.ready());
    } catch (e) { return false; }
  }

  function info() {
    try { return (CA.llm && CA.llm.info && CA.llm.info()) || { model: "", keyMasked: "" }; }
    catch (e) { return { model: "", keyMasked: "" }; }
  }

  // ---------- 小工具 ----------
  function p2(n) { return n < 10 ? "0" + n : "" + n; }
  function f1(n) { return Math.round(Number(n || 0) * 10) / 10; }
  function trimTo(v, n) { var s = (v == null ? "" : String(v)).trim(); return s.length > n ? s.slice(0, n) : s; }
  function isDateLike(v) { return /^(\d{4})-(\d{2})-(\d{2})( \d{2}:\d{2})?$/.test(String(v || "").trim()); }
  function nowCn() {
    var d = new Date();
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " +
      p2(d.getHours()) + ":" + p2(d.getMinutes()) + " 星期" + "日一二三四五六".charAt(d.getDay());
  }
  function warn(arr, msg) { if (msg && arr.length < 5) arr.push(trimTo(msg, 80)); }

  // ========== 1) 通知一句话草稿 ==========
  function noticeSystemPrompt() {
    return [
      "你是班级事项发布草稿解析助手。当前基准时间：" + nowCn() + "。",
      "你只能把管理员输入的一句话转换为 JSON 草稿，不能发布事项。",
      "只返回 JSON。不要返回 Markdown，不要使用代码块，不要解释。字段必须严格符合示例。",
      "没有识别出的信息留空。不确定的信息不要编造，写入 warnings。",
      "第一版不支持附件、图片、链接；发布人来自当前操作人，都不要生成相关字段。",
      "category 只能是：" + CATEGORIES.join("、") + "。",
      "timeLabel 只能是：" + TIME_LABELS.join("、") + "。",
      "deadline 是完整开始/截止/相关时间，例如 2026-07-03 17:30；只有日期时可只返回 2026-07-03。",
      "endTime 是完整结束时间；区间时间必须同时给出完整 deadline 和 endTime。",
      "如果只识别到结束时间、没有单独识别到结束日期，默认结束日期使用 deadline 的日期。",
      "日期不确定则相关时间字段留空并写入 warnings。",
      '返回示例：{"title":"","category":"","timeLabel":"","course":"","deadline":"","endTime":"","location":"","content":"","important":false,"warnings":[]}'
    ].join("\n");
  }

  // 字段白名单 + 枚举校验 + 日期格式校验；非法值置空并写入 warnings
  function sanitizeDraft(raw) {
    var warnings = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var draft = {
      title: trimTo(raw.title, 30),
      category: trimTo(raw.category, 20),
      timeLabel: trimTo(raw.timeLabel, 20),
      course: trimTo(raw.course, 50),
      deadline: trimTo(raw.deadline, 16),
      endTime: trimTo(raw.endTime, 16),
      location: trimTo(raw.location, 80),
      content: trimTo(raw.content, 500),
      important: raw.important === true,
      warnings: warnings
    };
    if (draft.category && CATEGORIES.indexOf(draft.category) < 0) { draft.category = ""; warn(warnings, "AI 返回的分类不在允许范围内，已置空"); }
    if (draft.timeLabel && TIME_LABELS.indexOf(draft.timeLabel) < 0) { draft.timeLabel = ""; warn(warnings, "AI 返回的时间类型不在允许范围内，已置空"); }
    if (draft.deadline && !isDateLike(draft.deadline)) { draft.deadline = ""; warn(warnings, "AI 返回的开始/截止时间格式不正确，已置空"); }
    if (draft.endTime && !isDateLike(draft.endTime)) { draft.endTime = ""; warn(warnings, "AI 返回的结束时间格式不正确，已置空"); }
    if (Array.isArray(raw.warnings)) raw.warnings.slice(0, 5).forEach(function (w) { warn(warnings, w); });
    if (!draft.title) warn(warnings, "未识别出标题，请手动填写");
    return draft;
  }

  async function parseNotice(text) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var input = String(text == null ? "" : text).trim();
    if (!input) throw new Error("请先输入一句话描述");
    if (input.length > 500) throw new Error("输入内容不能超过 500 字");
    var obj = await CA.llm.generateJson([
      { role: "system", content: noticeSystemPrompt() },
      { role: "user", content: input }
    ], { temperature: 0.2, timeoutMs: 60000 });
    var draft = sanitizeDraft(obj);
    if (!draft) throw new Error("AI 返回格式异常，请重试");
    return draft;
  }

  // ========== 2) 成绩统计（自足实现，不依赖 scores.js） ==========
  function statOf(name, fullScore, vals) {
    var n = vals.length;
    if (!n) return { name: name, fullScore: fullScore, count: 0, mean: 0, max: 0, min: 0, stddev: 0, passRate: 0, excellentRate: 0 };
    var sum = 0;
    for (var i = 0; i < n; i++) sum += vals[i];
    var mean = sum / n;
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var full = fullScore || 100;
    var pass = 0, exc = 0;
    for (var j = 0; j < n; j++) {
      if (vals[j] >= full * 0.6) pass++;
      if (vals[j] >= full * 0.85) exc++;
    }
    var variance = 0;
    for (var k = 0; k < n; k++) variance += (vals[k] - mean) * (vals[k] - mean);
    variance /= n;
    return {
      name: name, fullScore: full, count: n,
      mean: f1(mean), max: sorted[n - 1], min: sorted[0],
      stddev: f1(Math.sqrt(variance)),
      passRate: f1(pass / n * 100), excellentRate: f1(exc / n * 100)
    };
  }

  function totalsOf(examId) {
    var byMember = {};
    CA.store.get("scores").forEach(function (s) {
      if (s.examId !== examId) return;
      byMember[s.memberId] = (byMember[s.memberId] || 0) + (s.score || 0);
    });
    return byMember; // { memberId: 总分 }
  }

  function examStats(examId) {
    var exam = CA.store.find("exams", examId);
    if (!exam) return null;
    var subjects = CA.store.get("subjects").sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var all = CA.store.get("scores").filter(function (s) { return s.examId === examId; });
    var fullTotal = subjects.reduce(function (t, s) { return t + (s.fullScore || 0); }, 0);

    var subStats = subjects.map(function (sub) {
      var vals = all.filter(function (s) { return s.subjectId === sub.id; }).map(function (s) { return s.score; });
      return statOf(sub.name, sub.fullScore, vals);
    });

    var byMember = totalsOf(examId);
    var totals = Object.keys(byMember).map(function (mid) {
      return { memberId: mid, name: CA.store.memberName(mid), total: f1(byMember[mid]) };
    }).sort(function (a, b) { return b.total - a.total; });

    var totalVals = totals.map(function (t) { return t.total; });
    return {
      exam: { id: exam.id, name: exam.name, date: exam.date },
      count: CA.store.get("members").length,
      fullTotal: fullTotal,
      subjects: subStats,
      totals: totals,
      total: statOf("总分", fullTotal, totalVals)
    };
  }

  function sortedExams() {
    return CA.store.get("exams").slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  }

  // 与上一场考试的总分变化（用于进步/退步判断）
  function improvementList(examId) {
    var exams = sortedExams();
    var idx = -1;
    for (var i = 0; i < exams.length; i++) if (exams[i].id === examId) idx = i;
    if (idx <= 0) return [];
    var cur = totalsOf(examId), prev = totalsOf(exams[idx - 1].id);
    var out = [];
    Object.keys(cur).forEach(function (mid) {
      if (prev[mid] == null) return;
      out.push({ name: CA.store.memberName(mid), delta: f1(cur[mid] - prev[mid]) });
    });
    out.sort(function (x, y) { return y.delta - x.delta; });
    return out;
  }

  // ========== 3) AI 班级分析报告 ==========
  function reportSystemPrompt() {
    return [
      "你是资深中学班主任的学情分析师。基于给定的统计数据写一份简明的班级成绩分析，供老师在班会上讲评。",
      "只使用给定数据，不要编造分数或学生姓名。语言客观、具体、可执行。",
      "只返回 JSON，不要 markdown，不要代码块，不要解释。",
      '返回示例：{"overview":"总体情况 80~150 字","subject_analysis":[{"subject":"数学","comment":"40~120 字"}],"patterns":["主要特征，20~60 字"],"suggestions":["可执行建议，20~80 字"],"top_improved":[{"name":"学生姓名","reason":"20~50 字"}],"need_attention":[{"name":"学生姓名","reason":"20~50 字"}]}',
      "subject_analysis 覆盖每个科目。patterns 2~4 条，suggestions 3~5 条。",
      "top_improved / need_attention 各最多 5 人，姓名必须来自给定名单；数据不足时给空数组。",
      "若数据不足以判断，宁可少写也不要编造。"
    ].join("\n");
  }

  function statsToPrompt(stats, imp) {
    var lines = [];
    lines.push("考试：" + stats.exam.name + "（" + stats.exam.date + "）");
    lines.push("班级人数：" + stats.count + "；总分满分：" + stats.fullTotal);
    lines.push("总分：均分 " + stats.total.mean + "，最高 " + stats.total.max + "，最低 " + stats.total.min + "，标准差 " + stats.total.stddev);
    lines.push("各科：");
    stats.subjects.forEach(function (s) {
      lines.push("- " + s.name + "（满分 " + s.fullScore + "）：均分 " + s.mean + "，最高 " + s.max + "，最低 " + s.min + "，及格率 " + s.passRate + "%，优秀率 " + s.excellentRate + "%");
    });
    if (imp.length) {
      lines.push("与上一次考试相比（总分变化，正数为进步）：");
      imp.slice(0, 8).forEach(function (it) { lines.push("- " + it.name + "：" + (it.delta >= 0 ? "+" : "") + it.delta); });
      var tail = imp.slice(-8).reverse();
      lines.push("退步名单：");
      tail.forEach(function (it) { if (it.delta < 0) lines.push("- " + it.name + "：" + it.delta); });
    }
    return lines.join("\n");
  }

  function reportToMarkdown(obj, stats) {
    var md = [];
    md.push("## " + stats.exam.name + " · 班级成绩分析");
    if (obj && obj.overview) md.push(String(obj.overview).trim());
    if (obj && Array.isArray(obj.subject_analysis) && obj.subject_analysis.length) {
      md.push("## 分科表现");
      obj.subject_analysis.forEach(function (it) { if (it && it.subject) md.push("- **" + it.subject + "**：" + (it.comment || "")); });
    }
    if (obj && Array.isArray(obj.patterns) && obj.patterns.length) {
      md.push("## 主要特征");
      obj.patterns.forEach(function (p) { if (p) md.push("- " + p); });
    }
    if (obj && Array.isArray(obj.suggestions) && obj.suggestions.length) {
      md.push("## 教学建议");
      obj.suggestions.forEach(function (s) { if (s) md.push("- " + s); });
    }
    if (obj && Array.isArray(obj.top_improved) && obj.top_improved.length) {
      md.push("## 进步明显");
      obj.top_improved.forEach(function (it) { if (it && it.name) md.push("- **" + it.name + "**：" + (it.reason || "")); });
    }
    if (obj && Array.isArray(obj.need_attention) && obj.need_attention.length) {
      md.push("## 需关注");
      obj.need_attention.forEach(function (it) { if (it && it.name) md.push("- **" + it.name + "**：" + (it.reason || "")); });
    }
    // 统计摘要兜底：即使 AI 结构缺失，报告仍含可用信息
    md.push("## 统计摘要");
    md.push("- 总分（满分 " + stats.fullTotal + "）：均分 " + stats.total.mean + "，最高 " + stats.total.max + "，最低 " + stats.total.min + "，标准差 " + stats.total.stddev);
    stats.subjects.forEach(function (s) {
      md.push("- " + s.name + "（满分 " + s.fullScore + "）：均分 " + s.mean + "，最高 " + s.max + "，最低 " + s.min + "，及格率 " + s.passRate + "%");
    });
    return md.join("\n");
  }

  async function analyzeExam(examId) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var stats = examStats(examId);
    if (!stats) throw new Error("考试不存在");
    var obj = await CA.llm.generateJson([
      { role: "system", content: reportSystemPrompt() },
      { role: "user", content: statsToPrompt(stats, improvementList(examId)) }
    ], { temperature: 0.4, timeoutMs: 120000 });
    return { markdown: reportToMarkdown(obj, stats), stats: stats };
  }

  // ========== 4) AI 个人评语 ==========
  async function studentComment(memberId, examId) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var stats = examStats(examId);
    if (!stats) throw new Error("考试不存在");
    var member = CA.store.find("members", memberId);
    if (!member) throw new Error("学生不存在");

    var subjects = CA.store.get("subjects").sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var mine = CA.store.get("scores").filter(function (s) { return s.examId === examId && s.memberId === memberId; });
    var subStats = {};
    stats.subjects.forEach(function (s) { subStats[s.name] = s; });

    var lines = ["考试：" + stats.exam.name + "（" + stats.exam.date + "）", "学生：" + member.name];
    var total = 0;
    subjects.forEach(function (sub) {
      var rec = mine.filter(function (s) { return s.subjectId === sub.id; })[0];
      if (!rec) return;
      total += rec.score || 0;
      var st = subStats[sub.name] || {};
      lines.push("- " + sub.name + "：" + rec.score + "/" + sub.fullScore + "（班级均分 " + (st.mean != null ? st.mean : "-") + "，最高 " + (st.max != null ? st.max : "-") + "）");
    });
    var allTotals = stats.totals.map(function (t) { return t.total; });
    var rank = 1;
    for (var i = 0; i < allTotals.length; i++) if (allTotals[i] > total) rank++;
    lines.push("总分：" + f1(total) + "/" + stats.fullTotal + "；班级总分均分 " + stats.total.mean + "，最高 " + stats.total.max);
    lines.push("总分名次：第 " + rank + " 名 / 共 " + allTotals.length + " 人");

    var text = await CA.llm.chat([
      { role: "system", content: "你是中学班主任。基于给定数据写一段 80~150 字的个性化学生评语：先肯定亮点，再指出 1~2 条可操作的改进方向。语气温和、具体、不空泛。只输出评语正文，不要标题、不要 markdown、不要引号。" },
      { role: "user", content: lines.join("\n") }
    ], { temperature: 0.6, timeoutMs: 60000 });

    var out = String(text == null ? "" : text).trim();
    if (!out) throw new Error("AI 返回内容为空，请重试");
    return out.length > 300 ? out.slice(0, 300) : out;
  }

  // ========== 5) 收集结果统计与 AI 归类汇总（M3） ==========
  function surveyStats(surveyId) {
    var survey = CA.store.find("surveys", surveyId);
    if (!survey) return null;
    var responses = CA.store.get("responses").filter(function (r) { return r.surveyId === surveyId; });
    var answered = {};
    responses.forEach(function (r) { answered[r.memberId] = true; });
    var members = CA.store.get("members");

    var questions = (survey.questions || []).map(function (q) {
      var counts = {}, texts = [];
      responses.forEach(function (r) {
        var a = (r.answers || []).filter(function (x) { return x.qid === q.qid; })[0];
        if (!a) return;
        if (q.type === "text") { if (a.value) texts.push(String(a.value)); return; }
        var vals = Array.isArray(a.value) ? a.value : [a.value];
        vals.forEach(function (v) { if (v != null && v !== "") counts[v] = (counts[v] || 0) + 1; });
      });
      return { qid: q.qid, type: q.type, title: q.title, options: q.options || [], counts: counts, texts: texts };
    });

    return {
      survey: survey,
      total: members.length,
      submitted: responses.length,
      missing: members.filter(function (m) { return !answered[m.id]; }).map(function (m) { return m.name; }),
      questions: questions
    };
  }

  function surveyToMarkdown(obj, stats) {
    var md = ["## " + stats.survey.title + " · 提交汇总"];
    md.push("- 提交：" + stats.submitted + " / " + stats.total + " 人");
    if (stats.missing.length) {
      md.push("- 未提交：" + stats.missing.slice(0, 10).join("、") + (stats.missing.length > 10 ? " 等共 " + stats.missing.length + " 人" : ""));
    }
    if (obj && obj.conclusion) { md.push("## 结论"); md.push(String(obj.conclusion)); }
    if (obj && Array.isArray(obj.highlights) && obj.highlights.length) {
      md.push("## 要点");
      obj.highlights.forEach(function (h) { if (h) md.push("- " + h); });
    }
    if (obj && Array.isArray(obj.suggestions) && obj.suggestions.length) {
      md.push("## 建议");
      obj.suggestions.forEach(function (s) { if (s) md.push("- " + s); });
    }
    md.push("## 选项统计");
    stats.questions.forEach(function (q) {
      if (q.type === "text") return;
      var total = 0;
      Object.keys(q.counts).forEach(function (k) { total += q.counts[k]; });
      md.push("- **" + q.title + "**");
      (q.options || Object.keys(q.counts)).forEach(function (opt) {
        var c = q.counts[opt] || 0;
        md.push("- " + opt + "：" + c + " 票（" + f1(total ? c / total * 100 : 0) + "%）");
      });
    });
    return md.join("\n");
  }

  async function summarizeResponses(surveyId) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var stats = surveyStats(surveyId);
    if (!stats) throw new Error("收集表不存在");
    if (!stats.submitted) throw new Error("暂无提交，无法汇总");

    var lines = ["收集表：" + stats.survey.title, "提交：" + stats.submitted + " / " + stats.total + " 人"];
    stats.questions.forEach(function (q) {
      lines.push("【" + q.title + "】" + (q.type === "text" ? "文本回答：" : "选项统计："));
      if (q.type === "text") {
        q.texts.slice(0, 40).forEach(function (t) { lines.push("- " + t); });
        if (!q.texts.length) lines.push("- （无）");
      } else {
        var total = 0;
        Object.keys(q.counts).forEach(function (k) { total += q.counts[k]; });
        Object.keys(q.counts).sort(function (a, b) { return q.counts[b] - q.counts[a]; }).forEach(function (k) {
          lines.push("- " + k + "：" + q.counts[k] + " 票（" + f1(total ? q.counts[k] / total * 100 : 0) + "%）");
        });
      }
    });

    var obj = await CA.llm.generateJson([
      { role: "system", content: [
        "你是班级事务助理。基于给定的收集结果写一份简明汇总，供班委/老师快速掌握情况。",
        "只使用给定数据，不要编造。只返回 JSON，不要 markdown，不要代码块。",
        '返回示例：{"conclusion":"结论 60~150 字","highlights":["要点 15~50 字"],"suggestions":["建议 15~50 字"]}',
        "有文本回答时，要归纳共性意见与值得注意的个别诉求。highlights 2~5 条，suggestions 1~3 条。"
      ].join("\n") },
      { role: "user", content: lines.join("\n") }
    ], { temperature: 0.4, timeoutMs: 90000 });

    return { markdown: surveyToMarkdown(obj, stats), stats: stats };
  }

  return {
    enabled: enabled,
    info: info,
    parseNotice: parseNotice,
    analyzeExam: analyzeExam,
    studentComment: studentComment,
    examStats: examStats,
    surveyStats: surveyStats,
    summarizeResponses: summarizeResponses
  };
})();
