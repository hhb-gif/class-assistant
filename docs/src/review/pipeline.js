// 管线编排 v2 —— LLM 主路径（阶段①总结 → 阶段②出题）+ 旧五层规则管线降级（粗筛→相似度→TextRank→融合评分→MMR→章节化）
window.RH = window.RH || {};

RH.pipeline = (function () {
  let _ready = null;
  function ensureReady() {
    if (!_ready) _ready = RH.tokenizer.init();
    return _ready;
  }

  // LLM 服务是否可用（RH.llm 未加载 / config 缺失时均视为不可用，走规则兜底）
  function llmReady() {
    try {
      return !!(RH.llm && typeof RH.llm.ready === "function" && RH.llm.ready() &&
        RH.summarize && typeof RH.summarize.summarize === "function" &&
        RH.quizgen && typeof RH.quizgen.generate === "function");
    } catch (e) { return false; }
  }

  // 当前模型名（引擎徽标与 backend 标注用）
  function llmModelName() {
    try {
      if (RH.llm && typeof RH.llm.info === "function") return (RH.llm.info() || {}).model || "";
    } catch (e) {}
    return "";
  }

  // 从解析结果摊平原文结构（LLM/规则两路共用；rich 用于原文面板排版）
  function flattenOriginal(doc) {
    return (doc.sections || [])
      .filter(s => s.blocks.length || (s.rich && s.rich.length))
      .map(s => ({ title: s.title, blocks: s.blocks, rich: s.rich || null }));
  }

  // 旧 quiz.generateQuiz 输出对齐 Question 契约：只留 choice 题、qid 重编 "r"+序号、补 origin/importance
  function normalizeRuleQuiz(list) {
    const out = [];
    let n = 1;
    for (const q of list || []) {
      if (!q || q.type !== "choice") continue;
      out.push({ ...q, qid: "r" + (n++), importance: "", origin: "rule" });
    }
    return out;
  }

  // 规则结果（旧结构 items/sources）包装为 v2 视图模型（points 形态，source/importance 置空走默认样式）
  function ruleVm(doc, result) {
    return {
      title: doc.title,
      engine: "rule",
      overview: "",
      keywords: result.keywords || [],
      terms: result.terms || [],
      sections: (result.sections || []).map(s => ({
        title: s.title,
        points: (s.items || []).map(it => ({ point: it, source: "", importance: "" })),
      })),
      quiz: normalizeRuleQuiz(result.quiz || []),
      original_sections: flattenOriginal(doc),
      backend: "rule/" + (result.backend && result.backend.similarity || "word_overlap") + "/" + (result.backend && result.backend.tokenizer || ""),
      summary: null,
    };
  }

  // ===== OCR 文本 AI 纠错（仅 doc.ocr=true 且 LLM 可用时） =====
  // 逐章分块 → chat（temperature 0，仅订正不改写）→ 长度偏差 ≤15% 才采纳；全部失败静默用原文
  const OCR_SYS = "你是文字校对引擎。只订正 OCR 错别字、错误断词和明显漏识别的标点；禁止改写句式、禁止增删内容、禁止总结。逐行输出，保持原有换行结构。";

  function normLen(s) { return String(s || "").replace(/\s+/g, "").length; }

  async function ocrCorrect(originalSections, report) {
    // 每章 blocks 独立分块，保证纠错结果可按章重构（section 结构不变，仅换 blocks 文本）
    const jobs = [];   // [{secIdx, chunkIdx, idx, text}]
    originalSections.forEach((sec, si) => {
      const chunks = RH.llm.chunkText(sec.blocks, 6000);
      chunks.forEach((t, ci) => jobs.push({ secIdx: si, chunkIdx: ci, idx: jobs.length, text: t }));
    });
    if (!jobs.length) return originalSections;
    const total = jobs.length;
    report("summarize", "AI 纠错中（第 0/" + total + " 块）", 0.01);

    // 结果槽：纠错失败/偏差超限 → 保留原块（null = 未采纳）
    const corrected = new Array(jobs.length).fill(null);
    let done = 0;
    const CONCURRENCY = 2;
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const pair = jobs.slice(i, i + CONCURRENCY).map((job, k) => (async () => {
        try {
          const out = await RH.llm.chat(
            [{ role: "system", content: OCR_SYS }, { role: "user", content: job.text }],
            { temperature: 0, thinking: "off" }
          );
          const text = String(out || "").replace(/\r/g, "").trim();
          // 校验：去空白后长度偏差 ≤15% 才采纳，否则弃用原块
          if (text && normLen(job.text) > 0 && Math.abs(normLen(text) - normLen(job.text)) / normLen(job.text) <= 0.15) {
            corrected[i + k] = text;
          }
        } catch (e) { /* 单块失败：保留原块 */ }
      })());
      await Promise.all(pair);
      done += pair.length;
      report("summarize", "AI 纠错中（第 " + done + "/" + total + " 块）", 0.01 + 0.03 * (done / total));
    }

    // 重构 blocks：纠错文本按换行拆回数组；无任何采纳则整体静默跳过
    if (!corrected.some(Boolean)) return originalSections;
    return originalSections.map((sec, si) => {
      const secJobs = jobs.filter(j => j.secIdx === si).sort((a, b) => a.chunkIdx - b.chunkIdx);
      const blocks = [];
      for (const j of secJobs) {
        const out = corrected[j.idx];
        if (out) blocks.push(...out.split("\n").map(l => l.trim()).filter(Boolean));
        else blocks.push(...sec.blocks);   // 该块未采纳 → 保留原块组
      }
      return { ...sec, blocks };
    });
  }

  // ===== LLM 主路径：阶段①总结 → 阶段②出题 =====
  async function runLlm(doc, report) {
    let originalSections = flattenOriginal(doc);
    // 阶段⓪：OCR 文档 AI 纠错（仅 LLM 路径；离线/失败静默走原文本）
    if (doc.ocr === true && llmReady()) {
      try {
        originalSections = await ocrCorrect(originalSections, report);
      } catch (e) {
        console.warn("[pipeline] OCR 纠错失败，使用原文本:", e && e.message);
      }
    }
    // 阶段①：LLM 分块总结（summarize 内部做 schema 校验 + source 模糊匹配过滤）
    const summary = await RH.summarize.summarize(
      originalSections.map(s => ({ title: s.title, blocks: s.blocks })),
      (msg, ratio) => report("summarize", msg, ratio)
    );
    if (!summary || !Array.isArray(summary.sections)) throw new Error("总结结果无效");
    // 阶段②：LLM 出题（素材=总结产物；失败不整体降级，quiz 置空由练习页重试按钮兜底）
    let quiz = [];
    try {
      quiz = await RH.quizgen.generate(
        summary,
        originalSections.map(s => ({ title: s.title, blocks: s.blocks })),
        (msg, ratio) => report("quiz", msg, ratio)
      );
    } catch (e) {
      console.warn("[pipeline] 出题失败，要点照常展示:", e && e.message);
      report("quiz", "出题失败：" + (e && e.message || e) + "，稍后可在练习页重试", 1);
    }
    return {
      title: doc.title,
      engine: "llm",
      overview: summary.overview || "",
      keywords: summary.keywords || [],
      terms: [],
      sections: (summary.sections || []).map(s => ({
        title: s.title,
        points: (s.points || []).map(p => ({ point: p.point, source: p.source || "", importance: p.importance || "" })),
      })),
      quiz: quiz || [],
      original_sections: originalSections,
      backend: llmModelName(),
      summary,
    };
  }

  // ===== 旧五层规则管线（离线兜底，内部复用；保持语义模型预热） =====
  async function runRule(doc) {
    await ensureReady();

    // 语义模型异步预热（不阻塞主流程，首次成功后自动启用）
    if (!RH.semantic._warmStarted) {
      RH.semantic._warmStarted = true;
      RH.semantic.tryInit().catch(() => {});
    }
    RH.fillSentences(doc);
    const sentences = RH.allSentences(doc);

    const fullText = sentences.map(s => s.text).join("\n") || doc.title;
    let keywords = RH.keywords.extractKeywords(fullText, 15);
    let terms = RH.keywords.extractTerms(fullText, 20);
    const keywordSet = new Set([...keywords, ...terms]);

    const sectionsResult = [];
    const backend = { similarity: "word_overlap", tokenizer: RH.tokenizer.engineName() };

    if (!sentences.length) {
      return { keywords, terms, sections: sectionsResult, backend, quiz: [] };
    }

    // ===== 要点式文档判断（PPT/讲义大纲：行即要点，无需句子抽取）=====
    function isOutlineDoc() {
      let lines = 0, punctEnd = 0, lenSum = 0;
      for (const sec of doc.sections) {
        for (const raw of sec.blocks) {
          const b = raw.trim();
          if (!b) continue;
          lines++; lenSum += b.length;
          if (/[。！？；!?;]\s*$/.test(b)) punctEnd++;
        }
      }
      if (lines < 6) return false;
      const avg = lenSum / lines;
      return avg < 30 && punctEnd / lines < 0.4;
    }

    function rateOutlineLine(text, kwSet) {
      let v = 0.4;
      if (/[=Σ∑∫√×≥≤±%/]/.test(text)) v += 0.15;           // 公式/数据行
      if (/是指|称为|定义为|包括|分为|属于|叫做/.test(text)) v += 0.15; // 定义句式
      if (/\d/.test(text)) v += 0.06;
      const toks = RH.tokenizer.cut(text);
      const longs = toks.filter(t => t.length >= 3).length;
      v += Math.min(longs * 0.05, 0.15);
      for (const k of kwSet) if (text.includes(k)) { v += 0.08; break; }
      if (text.length >= 8 && text.length <= 45) v += 0.1;
      else if (text.length > 60) v -= 0.1;
      if (text.length < 8) v -= 0.15;                        // 过短的步骤/碎片行
      if (/^(解|求|证明|分析)[：:]/.test(text)) v -= 0.12;   // 解题过程行（结论通常无前缀）
      if (RH.RULES.isMetaLine(text)) v = -1;
      return v;
    }

    if (isOutlineDoc()) {
      // 关键词/术语基于非 meta 行计算
      const contentLines = doc.sections.flatMap(s => s.blocks.map(b => b.replace(/\s+/g, " ").trim()))
        .filter(b => b.length >= 4 && !RH.RULES.isMetaLine(b));
      const outlineText = contentLines.join("\n");
      keywords = RH.keywords.extractKeywords(outlineText, 15);
      terms = RH.keywords.extractTerms(outlineText, 20);
      const kwSet = new Set([...keywords, ...terms]);
      const seenGlobal = new Set();  // 跨页重复行去重（课件常见重复句）

      for (const sec of doc.sections) {
        const rows = [];
        sec.blocks.forEach((raw, bi) => {
          const b = raw.replace(/\s+/g, " ").trim();
          if (b.length < 4 || RH.RULES.isMetaLine(b)) return;
          if (seenGlobal.has(b)) return;   // 重复行只保留一次
          seenGlobal.add(b);
          rows.push({ text: b, bi, v: rateOutlineLine(b, kwSet) });
        });
        if (!rows.length) continue;
        rows.sort((a, b) => b.v - a.v);
        // 每页配额自适应：内容少少取，内容多多取
        const n = rows.length <= 2 ? rows.length : Math.min(rows.length, rows.length >= 6 ? 4 : 3);
        // 按评分降序输出（重要的排前面），稳定同分按行序
        const picked = rows.slice(0, n);
        const items = [], sources = [];
        for (const x of picked) {
          const item = RH.keywords.cleanItem(x.text);
          if (item.length >= 4) { items.push(item); sources.push(x.bi); }
        }
        if (items.length) sectionsResult.push({ title: sec.title, items, sources });
      }
      // 合并连续同名章节（PPT 多页同章节导航名）
      const merged = [];
      for (const sec of sectionsResult) {
        const prev = merged[merged.length - 1];
        if (prev && prev.title === sec.title) {
          prev.items.push(...sec.items);
          prev.sources.push(...sec.sources);
        } else merged.push(sec);
      }
      return { keywords, terms, sections: merged, backend, quiz: RH.quiz.generateQuiz({ sections: merged, keywords, terms }) };
    }

    // 小文本路径：全量条目化（不照搬原文）
    if (sentences.length <= 12) {
      for (const sec of doc.sections) {
        if (!sec.sentences.length) continue;
        sectionsResult.push({
          title: sec.title,
          items: sec.sentences.map(s => RH.keywords.cleanItem(s.text)),
          sources: sec.sentences.map(s => s.paraIdx),
        });
      }
      return { keywords, terms, sections: sectionsResult, backend, quiz: RH.quiz.generateQuiz({ sections: sectionsResult, keywords, terms }) };
    }

    // 语义模型就绪等待（最多 5 秒，超时降级词重叠，后台继续加载）
    if (!RH.semantic.available()) {
      await Promise.race([
        RH.semantic.tryInit(),
        new Promise(r => setTimeout(r, 5000)),
      ]);
    }

    const candidates = RH.selection.buildCandidates(sentences);
    const candTexts = candidates.map(s => s.text);
    const tokens = RH.tokenizer.tokenize(candTexts);
    const tokenSets = tokens.map(t => new Set(t));

    const n = candTexts.length;
    let sim = null;
    if (RH.semantic.available()) {
      try {
        sim = await RH.semantic.similarityMatrix(candTexts, tokenSets, RH.textrank.wordOverlapSim);
        backend.similarity = RH.semantic.engineName();
      } catch (e) { sim = null; }
    }
    if (!sim) {
      sim = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const v = RH.textrank.wordOverlapSim(tokenSets, i, j);
          sim[i][j] = sim[j][i] = v;
        }
      }
    }

    const tr = RH.textrank.textrankScores(sim, n);
    const scores = RH.textrank.fuseScores(tr, candidates, keywordSet, tokens);

    const secCounts = doc.sections.map(sec => sec.sentences.length);
    const k = RH.selection.totalQuota(candidates.length);
    const quotas = RH.selection.sectionQuotas(secCounts, k);

    const idxBySec = {};
    candidates.forEach((s, i) => {
      (idxBySec[s.sectionIdx] = idxBySec[s.sectionIdx] || []).push(i);
    });

    const selectedBySec = {};
    quotas.forEach((quota, sid) => {
      if (quota <= 0) return;
      const local = idxBySec[sid] || [];
      if (!local.length) return;
      let picked;
      if (local.length <= quota) {
        picked = local.slice();
      } else {
        const localScores = local.map(i => scores[i]);
        const subSim = local.map(i => local.map(j => sim[i][j]));
        const localExempt = new Set(
          local.map((gi, li) => (RH.selection.isKeySentence(candTexts[gi]) ? li : -1)).filter(x => x >= 0)
        );
        picked = RH.selection.mmrSelect(localScores, subSim, quota, localExempt).map(li => local[li]);
        picked.sort((a, b) => scores[b] - scores[a]);
      }
      selectedBySec[sid] = picked;
    });

    doc.sections.forEach((sec, sid) => {
      if (!sec.sentences.length) return;
      let picked = (selectedBySec[sid] || []).filter(i => candTexts[i].length >= 8);
      let items = picked.map(i => RH.keywords.cleanItem(candTexts[i]));
      let sources = picked.map(i => candidates[i].paraIdx);
      if (!items.length) {
        const local = idxBySec[sid] || [];
        if (!local.length) return;
        let top1 = local[0];
        for (const i of local) if (scores[i] > scores[top1]) top1 = i;
        items = [RH.keywords.cleanItem(candTexts[top1])];
        sources = [candidates[top1].paraIdx];
      }
      if (items.length) sectionsResult.push({ title: sec.title, items, sources });
    });

    return { keywords, terms, sections: sectionsResult, backend, quiz: RH.quiz.generateQuiz({ sections: sectionsResult, keywords, terms }) };
  }

  // ===== 编排入口：LLM ready → 主路径；否则 / LLM 整体失败 → 规则兜底 =====
  async function run(doc, onProgress) {
    const report = (stage, msg, ratio) => { if (onProgress) onProgress(stage, msg, ratio); };

    if (llmReady()) {
      try {
        return await runLlm(doc, report);
      } catch (e) {
        console.warn("[pipeline] LLM 流水失败，降级规则管线:", e && e.message);
        report("fallback", "AI 暂不可用（" + (e && e.message || e) + "），已切换离线模式", 0);
      }
    }
    report("fallback", "离线规则引擎处理中", 0);
    const result = await runRule(doc);
    return ruleVm(doc, result);
  }

  return { run };
})();
