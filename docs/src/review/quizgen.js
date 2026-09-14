// LLM 选择题出题层 v2 —— 只出选择题（契约第 4 节 + 计划书第五节规范）
window.RH = window.RH || {};

RH.quizgen = (function () {

  const SYS = [
    "你是严谨的中文出题引擎，基于给定的复习要点与原文摘录出选择题。",
    "硬性要求：",
    "1. 只输出单选题（type 固定为 choice），每题 4 个选项",
    "2. 选项互斥且长度相近；干扰项与正确项同类型（数字用近似值、术语用同章节其他术语、范围词做篡改），必须明确错误、不能与正确项语义等价",
    "3. 答案唯一；禁止「以上都对」「以上都不对」类选项；题干不得暗示答案",
    "4. 只使用材料中的事实，不得编造；每题 explanation 说明正确项依据、并点出主要干扰项为何错",
    "5. 每题 source 字段填写该题依据的原文连续摘录（一字不改，10~100 字）",
    "6. 优先覆盖 importance=high 的要点；章节多时每章至少 1 题；难度 difficulty 1~3（1简单/2中等/3较难）",
    "7. 只输出合法 JSON，不要任何其他文字。",
  ].join("\n");

  // ---------- 题量公式（计划书 5.2） ----------
  function planCount(fullTextLen, summary) {
    let base;
    if (fullTextLen < 2000) base = 4;
    else if (fullTextLen < 6000) base = 6;
    else if (fullTextLen < 15000) base = 9;
    else if (fullTextLen < 30000) base = 12;
    else base = 15;
    let nHigh = 0;
    ((summary && summary.sections) || []).forEach(s => (s.points || []).forEach(p => {
      if (p && p.importance === "high") nHigh++;
    }));
    const n = Math.max(base, Math.round(nHigh * 0.7));
    return Math.min(Math.max(n, 4), 20);
  }

  // ---------- 素材构建（总结产物为主，不足以撑题量时用原文补充） ----------
  function buildMaterial(summary, originalSections, needSupplement) {
    const parts = [];
    ((summary && summary.sections) || []).forEach((s, i) => {
      const pts = (s.points || []).map((p, j) =>
        (j + 1) + ". " + p.point + (p.source ? "（原文：" + p.source + "）" : "") + "［重要度:" + (p.importance || "medium") + "］"
      ).join("\n");
      parts.push("【" + s.title + "】\n" + pts);
    });
    let material = parts.join("\n\n");
    if (needSupplement) {
      const sup = [];
      let budget = 8000;
      for (const sec of originalSections || []) {
        for (const b of (sec.blocks || [])) {
          const t = String(b || "").trim();
          if (t.length < 8) continue;
          const piece = t.slice(0, Math.min(t.length, 500));
          if (budget - piece.length < 0) break;
          budget -= piece.length;
          sup.push("【" + sec.title + "】" + piece);
        }
        if (budget <= 0) break;
      }
      if (sup.length) material += "\n\n补充原文（可从中挖掘题目）：\n" + sup.join("\n");
    }
    return material;
  }

  function userPrompt(material, n, avoidStems) {
    let p = `基于下面的复习材料出 ${n} 道单选题。
输出 JSON 格式：
{"questions":[{"type":"choice","question":"题干","options":["A选项","B选项","C选项","D选项"],"answerIndex":0,"explanation":"解析","source":"原文摘录","difficulty":2,"importance":"high|medium|low"}]}`;
    if (avoidStems && avoidStems.length) {
      p += "\n\n已出过的题干（不要重复出类似题）：\n" + avoidStems.map(s => "- " + s).join("\n");
    }
    p += "\n\n复习材料：\n" + material;
    return p;
  }

  // ---------- 校验 ----------
  function validateQuestions(list, allText) {
    const out = [];
    for (const q of list || []) {
      if (!q || q.type !== "choice") continue;                       // 只接受选择题
      const question = String(q.question || "").trim();
      if (question.length < 8) continue;
      if (!Array.isArray(q.options)) continue;
      const options = q.options.map(o => String(o || "").trim()).filter(Boolean);
      const uniq = new Set(options);
      if (options.length !== 4 || uniq.size !== 4) continue;         // 4 选项且去重后仍 4 个
      let idx = parseInt(q.answerIndex);
      if (!(idx >= 0 && idx < 4)) {
        idx = options.indexOf(String(q.answer || "").trim());
        if (idx < 0) continue;
      }
      const explanation = String(q.explanation || "").trim();
      if (!explanation) continue;                                    // 解析必填
      let source = String(q.source || "").trim().slice(0, 120);
      if (source && allText && !RH.summarize.fuzzyMatch(source, allText)) source = "";
      let difficulty = parseInt(q.difficulty);
      if (!(difficulty >= 1 && difficulty <= 3)) difficulty = 2;
      let importance = String(q.importance || "medium").toLowerCase();
      if (importance !== "high" && importance !== "medium" && importance !== "low") importance = "medium";
      // 题干不得包含答案明示（完整选项原文出现在题干中视为坏题）
      if (question.includes(options[idx])) continue;
      out.push({
        type: "choice", question, options, answerIndex: idx,
        answer: options[idx], explanation, source,
        difficulty, importance, origin: "ai",
      });
    }
    return out;
  }

  // 题干重复判定（归一化前 12 字符）
  function stemKey(q) {
    return RH.summarize.normalizeText(q.question).slice(0, 12);
  }

  // ---------- 主入口 ----------
  async function generate(summary, originalSections, onProgress) {
    const report = (msg, ratio) => { if (onProgress) onProgress(msg, ratio); };
    const fullText = (originalSections || []).map(s => (s.blocks || []).join("\n")).join("\n");
    const fullTextLen = RH.summarize.normalizeText(fullText).length;
    const N = planCount(fullTextLen, summary);

    // 素材充足性判断：要点总字数不足以撑题量 → 用原文补充
    const pointChars = ((summary && summary.sections) || []).reduce((a, s) =>
      a + (s.points || []).reduce((x, p) => x + p.point.length + (p.source || "").length, 0), 0);
    const pointCount = ((summary && summary.sections) || []).reduce((a, s) => a + (s.points || []).length, 0);
    const needSupplement = pointChars < 1200 || pointCount < N;

    report("规划题量（目标 " + N + " 题）", 0.05);

    // 分批：N≤10 单批；>10 分 2 批（按章切半；单章时同一素材出两段）
    const secs = (summary && summary.sections) || [];
    let batches;   // [{n, material}]
    if (N <= 10 || secs.length < 2) {
      batches = [{ n: N, material: buildMaterial(summary, originalSections, needSupplement) }];
    } else {
      const half = Math.ceil(N / 2);
      const mid = Math.ceil(secs.length / 2);
      const s1 = { overview: summary.overview, keywords: summary.keywords, sections: secs.slice(0, mid) };
      const s2 = { overview: "", keywords: [], sections: secs.slice(mid) };
      batches = [
        { n: half, material: buildMaterial(s1, originalSections, needSupplement) },
        { n: N - half, material: buildMaterial(s2, originalSections, false) },
      ];
    }

    // 顺序执行（第二批要参考第一批题干防重）
    const all = [];
    let stems = [];
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      report("AI 出题中（第 " + (i + 1) + "/" + batches.length + " 批，目标 " + b.n + " 题）", 0.1 + 0.85 * (i / batches.length));
      let obj = null;
      const runOnce = () => RH.llm.generateJson(
        [{ role: "system", content: SYS }, { role: "user", content: userPrompt(b.material, b.n, stems) }],
        // 出题为结构化生成任务：关闭思考模式（实测提速 ~1.6x 且质量无差）
        { temperature: 0.4, thinking: "off" }
      );
      try { obj = await runOnce(); }
      catch (e1) {
        if (RH.llm.isNetError(e1)) obj = null;   // 网络类错误不重试
        else { try { obj = await runOnce(); } catch (e2) { obj = null; } }
      }
      const valid = validateQuestions(obj && obj.questions, fullText);
      valid.forEach(q => stems.push(RH.summarize.normalizeText(q.question).slice(0, 20)));
      all.push(...valid);
      report("AI 出题中（第 " + (i + 1) + "/" + batches.length + " 批，合格 " + valid.length + " 题）", 0.1 + 0.85 * ((i + 1) / batches.length));
    }

    // 去重（题干前 12 归一化字符相同 → 丢后到者）+ qid 重编
    const seen = new Set();
    const final = [];
    for (const q of all) {
      const k = stemKey(q);
      if (seen.has(k)) continue;
      seen.add(k);
      final.push(q);
    }
    final.forEach((q, i) => { q.qid = "ai" + (i + 1); });

    if (!final.length) throw new Error("模型没有返回合格的选择题");
    report("出题完成（共 " + final.length + " 题）", 1);
    return final;
  }

  return { generate, planCount, validateQuestions };
})();
