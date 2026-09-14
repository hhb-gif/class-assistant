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

  // 按成员汇总总分（纯函数：显式传入 scores，避免重复读库）
  function totalsOf(scores, examId) {
    var byMember = {};
    (scores || []).forEach(function (s) {
      if (s.examId !== examId) return;
      byMember[s.memberId] = (byMember[s.memberId] || 0) + (s.score || 0);
    });
    return byMember; // { memberId: 总分 }
  }

  // 异步：先读 exams/subjects/scores/members（CA.store 返回 Promise），再本地计算
  async function examStats(examId) {
    var exam = await CA.store.find("exams", examId);
    if (!exam) return null;
    var subjects = (await CA.store.get("subjects")).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var all = (await CA.store.get("scores")).filter(function (s) { return s.examId === examId; });
    var members = await CA.store.get("members"); // 预载成员缓存，供下方 memberName 同步读取
    var fullTotal = subjects.reduce(function (t, s) { return t + (s.fullScore || 0); }, 0);

    var subStats = subjects.map(function (sub) {
      var vals = all.filter(function (s) { return s.subjectId === sub.id; }).map(function (s) { return s.score; });
      return statOf(sub.name, sub.fullScore, vals);
    });

    var byMember = totalsOf(all, examId);
    var totals = Object.keys(byMember).map(function (mid) {
      return { memberId: mid, name: CA.store.memberName(mid), total: f1(byMember[mid]) };
    }).sort(function (a, b) { return b.total - a.total; });

    var totalVals = totals.map(function (t) { return t.total; });
    return {
      exam: { id: exam.id, name: exam.name, date: exam.date },
      count: members.length,
      fullTotal: fullTotal,
      subjects: subStats,
      totals: totals,
      total: statOf("总分", fullTotal, totalVals)
    };
  }

  // 纯函数：按日期升序排列考试（显式传入 exams）
  function sortedExams(exams) {
    return (exams || []).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  }

  // 与上一场考试的总分变化（用于进步/退步判断）；异步读库
  async function improvementList(examId) {
    var exams = sortedExams(await CA.store.get("exams"));
    var idx = -1;
    for (var i = 0; i < exams.length; i++) if (exams[i].id === examId) idx = i;
    if (idx <= 0) return [];
    var scores = await CA.store.get("scores");
    var cur = totalsOf(scores, examId), prev = totalsOf(scores, exams[idx - 1].id);
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
    var stats = await examStats(examId);
    if (!stats) throw new Error("考试不存在");
    var imp = await improvementList(examId);
    var obj = await CA.llm.generateJson([
      { role: "system", content: reportSystemPrompt() },
      { role: "user", content: statsToPrompt(stats, imp) }
    ], { temperature: 0.4, timeoutMs: 120000 });
    return { markdown: reportToMarkdown(obj, stats), stats: stats };
  }

  // ========== 4) AI 个人评语 ==========
  async function studentComment(memberId, examId) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var stats = await examStats(examId);
    if (!stats) throw new Error("考试不存在");
    var member = await CA.store.find("members", memberId);
    if (!member) throw new Error("学生不存在");

    var subjects = (await CA.store.get("subjects")).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var mine = (await CA.store.get("scores")).filter(function (s) { return s.examId === examId && s.memberId === memberId; });
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
  // 异步：先读 surveys/responses/members（CA.store 返回 Promise），再本地统计
  async function surveyStats(surveyId) {
    var survey = await CA.store.find("surveys", surveyId);
    if (!survey) return null;
    var responses = (await CA.store.get("responses")).filter(function (r) { return r.surveyId === surveyId; });
    var answered = {};
    responses.forEach(function (r) { answered[r.memberId] = true; });
    var members = await CA.store.get("members");

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
    var stats = await surveyStats(surveyId);
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

  // ========== 6) 学生端：通知/资料要点提炼 ==========
  // 字段白名单清洗：字符串数组去空、去重、限长、限条数
  function cleanList(raw, maxItems, maxLen) {
    var out = [];
    var arr = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
    for (var i = 0; i < arr.length && out.length < maxItems; i++) {
      var s = trimTo(arr[i], maxLen);
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }

  // 通知正文 → 给 LLM 的纯文本（限制总长，控制 token）
  function noticeTextOf(n) {
    var parts = ["标题：" + (n.title || "")];
    if (n.category) parts.push("分类：" + n.category);
    if (n.timeLabel && n.deadline) parts.push(n.timeLabel + "：" + n.deadline + (n.endTime ? " ~ " + n.endTime : ""));
    if (n.location) parts.push("地点：" + n.location);
    if (n.course) parts.push("科目：" + n.course);
    if (n.content) parts.push("正文：\n" + n.content);
    return trimTo(parts.join("\n"), 1500);
  }

  // 严格结构校验：points 必须有，keywords 可空（空则记 warning）
  function sanitizeSummary(raw) {
    var warnings = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var points = cleanList(raw.points, 6, 80);
    var keywords = cleanList(raw.keywords, 6, 12);
    if (!points.length) return null;                       // 无要点视为无效输出，交由上层抛错
    if (points.length < 3) warn(warnings, "AI 返回的要点不足 3 条");
    if (!keywords.length) warn(warnings, "AI 未返回关键词");
    if (Array.isArray(raw.warnings)) raw.warnings.slice(0, 5).forEach(function (w) { warn(warnings, w); });
    return { points: points, keywords: keywords, warnings: warnings };
  }

  async function summarizeNotice(noticeId) {
    if (!enabled()) throw new Error("AI 助手未开启");
    if (!noticeId) throw new Error("缺少通知 id");
    var n = await CA.store.find("notices", noticeId);
    if (!n) throw new Error("通知不存在");
    var obj = await CA.llm.generateJson([
      { role: "system", content: [
        "你是班级资料提炼助手，帮学生快速抓住通知/资料的重点。",
        "只依据给定内容提炼，不要编造未出现的时间、地点或要求。",
        "只返回 JSON，不要 markdown，不要代码块，不要解释。",
        '返回示例：{"points":["要点 10~60 字"],"keywords":["关键词 2~8 字"]}',
        "points 提炼 3~6 条并按重要性排序；keywords 2~6 个，是便于检索的名词。"
      ].join("\n") },
      { role: "user", content: noticeTextOf(n) }
    ], { temperature: 0.2, timeoutMs: 60000 });
    var out = sanitizeSummary(obj);
    if (!out) throw new Error("AI 返回格式异常，请重试");
    return out;
  }

  // ========== 7) 学生端：学习问答（基于给定上下文） ==========
  // history 仅保留最近 4 条 user/assistant 消息，单条 ≤ 500 字
  function sanitizeHistory(history) {
    var out = [];
    if (!Array.isArray(history)) return out;
    history.slice(-6).forEach(function (m) {
      if (!m || typeof m !== "object") return;
      var role = m.role === "assistant" ? "assistant" : (m.role === "user" ? "user" : null);
      var content = trimTo(m.content, 500);
      if (role && content) out.push({ role: role, content: content });
    });
    return out.slice(-4);
  }

  async function askAbout(input) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var o = input || {};
    var context = trimTo(o.context, 2000);
    var question = trimTo(o.question, 200);
    if (!context) throw new Error("缺少参考资料（通知正文/资料片段）");
    if (!question) throw new Error("请先输入你的问题");
    var messages = [{ role: "system", content: [
      "你是班级学习助理。只依据【参考资料】回答学生的问题，做答疑与讲解。",
      "资料里没有的信息不要编造；确实无法回答时，建议学生查看原文或请教老师。",
      "用口语化、鼓励的语气，回答不超过 200 字，不要 markdown 标题和代码块。"
    ].join("\n") }]
      .concat(sanitizeHistory(o.history))
      .concat([{ role: "user", content: "【参考资料】\n" + context + "\n\n【学生问题】\n" + question }]);
    var text = await CA.llm.chat(messages, { temperature: 0.4, timeoutMs: 60000 });
    var out = String(text == null ? "" : text).trim();
    if (!out) throw new Error("AI 返回内容为空，请重试");
    return out.length > 400 ? out.slice(0, 400) : out;
  }

  // ========== 8) 学生端：个人成绩诊断 ==========
  // 解析当前学生对应的名单 id：优先 auth 归一化的 memberId，退化按学号/姓名匹配
  // （与 scores.js/collect.js 口径一致；不写客户端权限过滤）
  async function resolveMyMemberId() {
    var me = null;
    try {
      if (window.CA && CA.auth && typeof CA.auth.current === "function") me = await CA.auth.current();
    } catch (e) { me = null; }
    if (!me) throw new Error("请先登录后再使用该功能");
    if (me.memberId) return { memberId: me.memberId, name: me.name || "" };
    var members = await CA.store.get("members");
    var i;
    if (me.studentNo) {
      for (i = 0; i < members.length; i++) {
        if (String(members[i].studentNo) === String(me.studentNo)) return { memberId: members[i].id, name: members[i].name || me.name || "" };
      }
    }
    if (me.name) {
      for (i = 0; i < members.length; i++) {
        if (members[i].name === me.name) return { memberId: members[i].id, name: members[i].name };
      }
    }
    throw new Error("当前账号未绑定学生名单，无法生成个人成绩报告");
  }

  // 当前学生本次考试的个人成绩统计。
  // 说明：学生角色下 scores 查询受服务端 RLS 限制、只返回本人记录；此处仅按 examId 圈定考试，
  //       不再按 memberId 过滤——客户端过滤不能充当权限边界。
  async function myExamStats(examId) {
    var who = await resolveMyMemberId();
    var exam = await CA.store.find("exams", examId);
    if (!exam) throw new Error("考试不存在");
    var subjects = (await CA.store.get("subjects")).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var rows = await CA.store.get("scores");
    var bySubject = {};
    (rows || []).forEach(function (s) {
      if (s.examId === examId && bySubject[s.subjectId] == null) bySubject[s.subjectId] = s.score;
    });
    var items = subjects.map(function (sub) {
      var score = bySubject[sub.id] != null ? Number(bySubject[sub.id]) : null;
      var full = Number(sub.fullScore) || 100;
      return { name: sub.name, score: score, fullScore: full, rate: score == null ? null : f1(score / full * 100) };
    });
    var scored = items.filter(function (it) { return it.score != null; });
    var got = scored.reduce(function (t, it) { return t + it.score; }, 0);
    var full = scored.reduce(function (t, it) { return t + it.fullScore; }, 0);
    var ranked = scored.slice().sort(function (a, b) { return a.rate - b.rate; });
    var weak = ranked.slice(0, 3).map(function (it) { return it.name; });
    var strong = ranked.slice().reverse().filter(function (it) { return it.rate >= 85; }).slice(0, 2).map(function (it) { return it.name; });
    return {
      exam: { id: exam.id, name: exam.name, date: exam.date },
      student: who,
      subjects: items,
      weak: weak,
      strong: strong,
      total: { score: f1(got), fullScore: full, rate: f1(full ? got / full * 100 : 0) }
    };
  }

  function myStatsToPrompt(stats) {
    var lines = ["考试：" + stats.exam.name + "（" + stats.exam.date + "）", "学生：" + (stats.student.name || "本人")];
    lines.push("各科得分（得分率）：");
    stats.subjects.forEach(function (it) {
      lines.push("- " + it.name + "：" + (it.score == null ? "缺考/未录入" : it.score + "/" + it.fullScore + "（" + it.rate + "%）"));
    });
    lines.push("总得分：" + stats.total.score + "/" + stats.total.fullScore + "（" + stats.total.rate + "%）");
    if (stats.weak.length) lines.push("相对薄弱：" + stats.weak.join("、"));
    if (stats.strong.length) lines.push("相对优势：" + stats.strong.join("、"));
    return lines.join("\n");
  }

  // markdown 软截断：优先在行边界断开，保证 ≤ max 字
  function clipMarkdown(md, max) {
    var s = String(md == null ? "" : md).trim();
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var nl = cut.lastIndexOf("\n");
    if (nl > max * 0.6) cut = cut.slice(0, nl);
    return cut + "\n- …（内容较长，已截断）";
  }

  function diagnoseToMarkdown(obj, stats, warnings) {
    var md = ["## " + stats.exam.name + " · 个人成绩诊断"];
    if (obj && obj.overview) md.push(String(obj.overview).trim());
    if (obj && obj.strengths && obj.strengths.length) { md.push("## 优势"); obj.strengths.forEach(function (s) { md.push("- " + s); }); }
    if (obj && obj.weaknesses && obj.weaknesses.length) { md.push("## 薄弱环节"); obj.weaknesses.forEach(function (s) { md.push("- " + s); }); }
    if (obj && obj.suggestions && obj.suggestions.length) { md.push("## 提分建议"); obj.suggestions.forEach(function (s) { md.push("- " + s); }); }
    md.push("## 得分明细");
    stats.subjects.forEach(function (it) {
      md.push("- " + it.name + "：" + (it.score == null ? "缺考/未录入" : it.score + "/" + it.fullScore + "（" + it.rate + "%）"));
    });
    md.push("- 总得分：" + stats.total.score + "/" + stats.total.fullScore + "（" + stats.total.rate + "%）");
    if (warnings && warnings.length) md.push("> 提示：" + warnings.join("；"));
    return clipMarkdown(md.join("\n"), 600);
  }

  async function diagnoseScores(examId) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var stats = await myExamStats(examId);
    if (!stats.total.fullScore) throw new Error("本次考试暂无你的成绩");
    var obj = await CA.llm.generateJson([
      { role: "system", content: [
        "你是中学学科辅导老师，为学生本人写一份成绩诊断。",
        "只使用给定的本人成绩数据；不得编造分数、名次，也不要引用他人的成绩或排名。",
        "先肯定优势，再指出薄弱，建议要具体可执行；语气鼓励。",
        "只返回 JSON，不要 markdown，不要代码块，不要解释。",
        '返回示例：{"overview":"总评 60~120 字","strengths":["优势 15~40 字"],"weaknesses":["薄弱点 15~40 字"],"suggestions":["提分建议 15~50 字"]}',
        "strengths 1~3 条，weaknesses 1~3 条，suggestions 2~4 条。"
      ].join("\n") },
      { role: "user", content: myStatsToPrompt(stats) }
    ], { temperature: 0.4, timeoutMs: 90000 });

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("AI 返回格式异常，请重试");
    var clean = {
      overview: trimTo(obj.overview, 300),
      strengths: cleanList(obj.strengths, 3, 80),
      weaknesses: cleanList(obj.weaknesses, 3, 80),
      suggestions: cleanList(obj.suggestions, 4, 100)
    };
    if (!clean.overview && !clean.suggestions.length) throw new Error("AI 返回格式异常，请重试");
    var warnings = [];
    if (!clean.strengths.length) warn(warnings, "AI 未给出优势项");
    if (Array.isArray(obj.warnings)) obj.warnings.slice(0, 5).forEach(function (w) { warn(warnings, w); });
    return { markdown: diagnoseToMarkdown(clean, stats, warnings), stats: stats, warnings: warnings };
  }

  // ========== 9) 学生端：个人复习计划 ==========
  function sanitizePlan(raw) {
    var warnings = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var plan = [];
    if (Array.isArray(raw.plan)) {
      raw.plan.slice(0, 3).forEach(function (p) {
        if (!p || typeof p !== "object") return;
        var subject = trimTo(p.subject, 20);
        var tasks = cleanList(p.tasks, 3, 80);
        if (subject && tasks.length) plan.push({ subject: subject, tasks: tasks });
      });
    }
    if (!plan.length) return null;                          // 无分科安排即无效，交由上层抛错
    var out = { goal: trimTo(raw.goal, 150), plan: plan, tips: cleanList(raw.tips, 3, 60) };
    if (!out.goal) warn(warnings, "AI 未给出目标");
    if (Array.isArray(raw.warnings)) raw.warnings.slice(0, 5).forEach(function (w) { warn(warnings, w); });
    out.warnings = warnings;
    return out;
  }

  function planToMarkdown(obj, stats, warnings) {
    var md = ["## 我的复习计划"];
    if (obj && obj.goal) md.push(String(obj.goal).trim());
    if (obj && obj.plan && obj.plan.length) {
      md.push("## 分科安排");
      obj.plan.forEach(function (p) {
        md.push("- **" + p.subject + "**");
        (p.tasks || []).forEach(function (t) { md.push("- " + t); });
      });
    }
    if (obj && obj.tips && obj.tips.length) { md.push("## 执行提醒"); obj.tips.forEach(function (t) { md.push("- " + t); }); }
    if (warnings && warnings.length) md.push("> 提示：" + warnings.join("；"));
    return clipMarkdown(md.join("\n"), 600);
  }

  async function studyPlan(examId) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var stats = await myExamStats(examId);
    if (!stats.total.fullScore) throw new Error("本次考试暂无你的成绩");
    var obj = await CA.llm.generateJson([
      { role: "system", content: [
        "你是中学学习规划师，为一名学生制定 1~2 周内可执行的复习计划。",
        "只针对给定数据里的薄弱科目；不要编造分数或他人情况。",
        "只返回 JSON，不要 markdown，不要代码块，不要解释。",
        '返回示例：{"goal":"目标 30~60 字","plan":[{"subject":"数学","tasks":["具体任务 15~40 字"]}],"tips":["提醒 10~30 字"]}',
        "plan 覆盖 1~3 个薄弱科目，每科 2~3 条任务；tips 1~3 条。"
      ].join("\n") },
      { role: "user", content: myStatsToPrompt(stats) }
    ], { temperature: 0.5, timeoutMs: 90000 });

    var clean = sanitizePlan(obj);
    if (!clean) throw new Error("AI 返回格式异常，请重试");
    var warnings = clean.warnings.slice();
    return { markdown: planToMarkdown(clean, stats, warnings), warnings: warnings };
  }

  // ========== 10) 学生端：开放题回答草稿 / 润色 ==========
  async function composeAnswer(input) {
    if (!enabled()) throw new Error("AI 助手未开启");
    var o = input || {};
    var question = trimTo(o.question, 200);
    if (!question) throw new Error("缺少题目内容");
    var hints = "";
    if (Array.isArray(o.hints)) {
      hints = trimTo(o.hints.map(function (h) { return trimTo(h, 100); }).filter(Boolean).join("；"), 500);
    } else {
      hints = trimTo(o.hints, 500);
    }
    var user = "【题目】\n" + question + (hints ? "\n\n【可用提示】\n" + hints : "") + "\n\n请直接给出回答草稿。";
    var text = await CA.llm.chat([
      { role: "system", content: "你是学生的写作帮手。根据【题目】和【可用提示】帮学生起草一段回答草稿：用第一人称、真诚自然、贴合学生口吻；不得编造提示之外的事实；控制在 200 字以内；只输出回答正文，不要标题、不要引号、不要 markdown。" },
      { role: "user", content: user }
    ], { temperature: 0.7, timeoutMs: 60000 });
    var out = String(text == null ? "" : text).trim();
    if (!out) throw new Error("AI 返回内容为空，请重试");
    return out.length > 300 ? out.slice(0, 300) : out;
  }

  return {
    enabled: enabled,
    info: info,
    parseNotice: parseNotice,
    analyzeExam: analyzeExam,
    studentComment: studentComment,
    examStats: examStats,
    surveyStats: surveyStats,
    summarizeResponses: summarizeResponses,
    // 学生端新增（Wave 2b-2）
    summarizeNotice: summarizeNotice,
    askAbout: askAbout,
    diagnoseScores: diagnoseScores,
    studyPlan: studyPlan,
    composeAnswer: composeAnswer
  };
})();
