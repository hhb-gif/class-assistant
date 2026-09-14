// LLM 要点总结层 v2 —— 输出固定 schema（契约第 3 节 + 计划书第四节格式规范）
// Summary = { overview, keywords[], sections: [{ title, points: [{ point, source, importance }] }] }
window.RH = window.RH || {};

RH.summarize = (function () {

  const MAX_CHUNK = 6000;      // 单批原文字符上限
  const CONCURRENCY = 2;       // 批间并发
  const MAX_POINTS = 120;      // 全文要点总上限

  // ---------- 文本归一化与模糊匹配 ----------
  // 归一化：仅保留中文/字母/数字（去掉空白与全部标点），用于容忍 LLM 摘录时的标点/空白差异
  function normalizeText(s) {
    return String(s || "").replace(/[^\u4e00-\u9fa5A-Za-z0-9%]/g, "");
  }

  // needle 是否在 haystack 中「模糊存在」：先全量包含，再分段依序命中（命中字符占比 ≥0.8）
  function fuzzyMatch(needle, haystack) {
    const nN = normalizeText(needle);
    const nH = normalizeText(haystack);
    if (!nN || !nH) return false;
    if (nH.indexOf(nN) >= 0) return true;
    // 分段：长 needle 分 3 段、中分 2 段、短整段
    const segCount = nN.length >= 12 ? 3 : nN.length >= 6 ? 2 : 1;
    const segLen = Math.floor(nN.length / segCount);
    const segs = [];
    for (let i = 0; i < segCount; i++) {
      const start = i * segLen;
      const end = i === segCount - 1 ? nN.length : start + segLen;
      if (end - start >= 3) segs.push(nN.slice(start, end));
    }
    if (!segs.length) return false;
    let hit = 0, pos = 0;
    for (const seg of segs) {
      const idx = nH.indexOf(seg, pos);
      if (idx >= 0) { hit += seg.length; pos = idx + seg.length; }
    }
    return hit / nN.length >= 0.8;
  }

  // ---------- Prompt ----------
  const SYS = "你是严谨的中文学习资料整理引擎。总结要服务复习：保留内容的完整性优先于形式上的统一，宁可保留完整长要点也不为格式好看而切碎知识。只使用材料中的事实，不得编造材料外内容；只输出合法 JSON，不要任何其他文字。";

  function buildUserPrompt(chunks, withHeader) {
    const schemaDemo = withHeader
      ? `{"overview":"全文一句话总览，30~60字","keywords":["关键词","..."],"sections":[{"title":"章节标题","points":[{"point":"要点正文，8~200字","source":"原文摘录，不超过100字，一字不改","importance":"high|medium|low","kind":"point|example"}]}]}`
      : `{"sections":[{"title":"章节标题","points":[{"point":"要点正文，8~200字","source":"原文摘录，不超过100字，一字不改","importance":"high|medium|low","kind":"point|example"}]}]}`;
    let req = `任务：把下面的学习材料按章节提炼成复习要点。
要求：
1. sections 保持材料给出的章节划分（沿用章节标题，仅允许修正明显错字）；每章提炼 2~10 条要点：内容少的章可以只留 2 条，含长概念或完整条款的章可以少而精，不必凑数
2. point：陈述式要点，8~200 字。两种写法按内容选择：
   - 短要点：一句话陈述，8~60 字；
   - 完整概念：遇到不可拆分的整体内容（长定义、完整条款、连贯的推导过程）时，允许作为一条较长要点整体保留（最长 200 字），不要为凑「一句话要点」而把它切成碎片
3. 以下内容一律不产出要点：过渡句、连接语、客套话、重复铺垫（如「下面我们来看」「接下来介绍」「综上所述」类的行文性文字），以及与知识点无关的版式噪声
4. 例题：若材料中含例题（带题干与解答的完整题目、典型例句、完整案例），优先挑选 1~2 道最有代表性的保留，输出为 kind:"example" 的条目：point 填「例题题干+核心解答思路」（≤200 字），source 填原文中对应的题干/解答摘录；材料没有例题则不要编造
5. source：该要点依据的原文连续片段（一字不改地摘录，10~100 字），用于在原文中定位；必须是原文里真实存在的文字
6. importance：考试高频/核心概念/规章条款/数字门槛等核心内容标 high；一般要点标 medium；铺垫性、次要内容标 low
7. kind：仅例题条目填 "example"，普通要点填 "point" 或直接省略该字段
8. 输出 JSON 格式：
${schemaDemo}`;
    if (withHeader) req += "\n9. 另需给出全文 overview（30~60 字总览）与 keywords（5~10 个关键词）";
    req += "\n\n学习材料（按章节分块）：\n" + chunks;
    return req;
  }

  // ---------- 批级校验（对单批 LLM 输出做 schema 校验 + source 模糊匹配过滤） ----------
  function validateBatch(obj, allText) {
    const out = [];
    const sections = obj && Array.isArray(obj.sections) ? obj.sections : [];
    for (const s of sections) {
      if (!s || typeof s.title !== "string" || !s.title.trim()) continue;
      const pts = Array.isArray(s.points) ? s.points : [];
      const points = [];
      for (const p of pts) {
        const point = String(p && p.point || "").trim();
        const source = String(p && p.source || "").trim();
        if (point.length < 8 || point.length > 200) continue;     // 契约 8~200
        let imp = String(p && p.importance || "medium").toLowerCase();
        if (imp !== "high" && imp !== "medium" && imp !== "low") imp = "medium";
        // kind：仅接受 "example"（例题），其他值一律视为普通要点
        const kind = p && p.kind === "example" ? "example" : undefined;
        // source 必须真实存在于原文（模糊匹配），否则丢弃该条
        if (!source || !fuzzyMatch(source, allText)) continue;
        const item = { point: point.slice(0, 200), source: source.slice(0, 120), importance: imp };
        if (kind) item.kind = kind;
        points.push(item);
      }
      if (points.length) out.push({ title: s.title.trim().slice(0, 60), points });
    }
    return out;
  }

  function validOverview(v) {
    const s = String(v || "").trim();
    return s.length >= 15 && s.length <= 150 ? s : "";
  }

  function validKeywords(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const k of list) {
      const s = String(k || "").trim();
      if (s.length < 2 || s.length > 10 || seen.has(s)) continue;
      seen.add(s); out.push(s);
      if (out.length >= 10) break;
    }
    return out;
  }

  // overview 兜底：从全文开头截取（不编造）
  function fallbackOverview(allText) {
    const s = normalizeText(String(allText || "")).slice(0, 60);
    return s.length >= 15 ? s + "……" : "";
  }

  // ---------- 批切分（按章节边界，每批 ≤MAX_CHUNK 字符；单章超长章内再切） ----------
  function splitBatches(originalSections) {
    const batches = [];   // [{chunks: "标题:块\n标题:块...", hasHeader:bool}]
    let cur = [], curLen = 0;
    for (const sec of originalSections || []) {
      const blocks = (sec.blocks || []).map(b => String(b || "").trim()).filter(Boolean);
      if (!blocks.length) continue;
      // 章节序列化：带标题前缀，帮助模型对齐
      const lines = blocks.map(b => b);
      const head = "【" + sec.title + "】\n";
      const body = lines.join("\n");
      const cost = head.length + body.length + 1;
      if (cost > MAX_CHUNK) {
        // 单章超长：章内按块累切
        if (cur.length) { batches.push(cur); cur = []; curLen = 0; }
        const pieces = [];
        let pc = [], pl = 0;
        for (const b of blocks) {
          if (pl + b.length + head.length > MAX_CHUNK && pc.length) { pieces.push(pc); pc = []; pl = 0; }
          pc.push(b); pl += b.length;
        }
        if (pc.length) pieces.push(pc);
        pieces.forEach((p, i) => {
          batches.push([{ title: sec.title + (pieces.length > 1 ? "（续" + (i + 1) + "）" : ""), blocks: p }]);
        });
        continue;
      }
      if (curLen + cost > MAX_CHUNK && cur.length) { batches.push(cur); cur = []; curLen = 0; }
      cur.push({ title: sec.title, blocks: blocks });
      curLen += cost;
    }
    if (cur.length) batches.push(cur);
    // 转为文本 chunk
    return batches.map(b => b.map(sec => "【" + sec.title + "】\n" + sec.blocks.join("\n")).join("\n\n"));
  }

  // ---------- 主入口 ----------
  async function summarize(originalSections, onProgress) {
    const report = (msg, ratio) => { if (onProgress) onProgress(msg, ratio); };
    const allText = (originalSections || []).map(s => (s.blocks || []).join("\n")).join("\n");
    const chunkGroups = splitBatches(originalSections);
    if (!chunkGroups.length) throw new Error("没有可总结的正文内容");

    report("准备批次（共 " + chunkGroups.length + " 批）", 0.02);

    // 并发 2 执行：按对分组
    const results = new Array(chunkGroups.length).fill(null);
    let done = 0;
    for (let i = 0; i < chunkGroups.length; i += CONCURRENCY) {
      const pair = chunkGroups.slice(i, i + CONCURRENCY).map((chunks, k) => {
        const gi = i + k;
        const withHeader = gi === 0;
        // 批级执行+校验：抛错或「校验后为空」都视为批失败 → 重试 1 次（自愈模型输出波动）
        const runBatch = async () => {
          const r = await RH.llm.generateJson(
            [{ role: "system", content: SYS }, { role: "user", content: buildUserPrompt(chunks, withHeader) }],
            { temperature: 0.3 }
          );
          const secs = validateBatch(r, allText);
          return secs.length ? { secs, overview: validOverview(r.overview), keywords: validKeywords(r.keywords) } : null;
        };
        return runBatch().catch(e => {
          if (RH.llm.isNetError(e)) throw e;   // 网络类错误不重试（重试也是白等）
          return runBatch().catch(() => null);
        });
      });
      const settled = await Promise.all(pair);
      settled.forEach((r, k) => {
        const gi = i + k;
        results[gi] = r;
        done++;
        report("AI 提炼要点中（第 " + done + "/" + chunkGroups.length + " 批）", 0.05 + 0.9 * (done / chunkGroups.length));
      });
    }

    // 合并：按批顺序；同名章节合并 points；跨批重复要点去重
    const merged = [];
    const pointSeen = new Set();
    for (const r of results) {
      if (!r) continue;
      for (const sec of r.secs) {
        const prev = merged.length ? merged[merged.length - 1] : null;
        if (prev && prev.title === sec.title) {
          for (const p of sec.points) addPoint(prev.points, p, pointSeen);
        } else {
          const points = [];
          for (const p of sec.points) addPoint(points, p, pointSeen);
          if (points.length) merged.push({ title: sec.title, points });
          else merged.push({ title: sec.title, points });
        }
      }
    }

    // 总条数裁剪（≤120，low 优先出局，每章保底 1 条）
    trimPoints(merged);

    // 头部信息取第一个成功批（含 overview/keywords），缺失走兜底
    let overview = "", keywords = [];
    for (const r of results) {
      if (r && r.overview) { overview = r.overview; break; }
    }
    for (const r of results) {
      if (r && r.keywords && r.keywords.length) { keywords = r.keywords; break; }
    }
    if (!overview) overview = fallbackOverview(allText);
    if (!keywords.length) {
      // 从要点高频词兜底（仅去重取前 6，避免空数组）
      const words = merged.flatMap(s => s.points.map(p => p.point));
      keywords = [...new Set(words.join("").match(/[\u4e00-\u9fa5]{2,6}/g) || [])].slice(0, 6);
    }

    if (!merged.length || !merged.some(s => s.points.length)) throw new Error("总结失败：模型未返回有效要点");
    return { overview, keywords, sections: merged };
  }

  function addPoint(arr, p, seen) {
    const key = RH.summarize.normalizeText(p.point).slice(0, 30);
    if (seen.has(key)) return;
    seen.add(key);
    arr.push(p);
  }

  function trimPoints(sections) {
    const total = () => sections.reduce((a, s) => a + s.points.length, 0);
    while (total() > MAX_POINTS) {
      // 裁剪优先级：low → example（例题是用户点名要保留的，仅在最挤时丢）→ medium → high
      const pick = (order) => {
        for (let i = sections.length - 1; i >= 0; i--) {
          const s = sections[i];
          if (s.points.length <= 1) continue;
          const idx = s.points.findIndex(p => {
            const imp = p.importance || "medium";
            if (order === "low") return imp === "low";
            if (order === "example") return p.kind === "example" && imp !== "low";
            if (order === "medium") return imp === "medium" && p.kind !== "example";
            return imp === order;   // high
          });
          if (idx >= 0) { s.points.splice(idx, 1); return true; }
        }
        return false;
      };
      let removed = false;
      for (const order of ["low", "example", "medium", "high"]) {
        if (pick(order)) { removed = true; break; }
      }
      if (!removed) break;
    }
  }

  return { summarize, fuzzyMatch, normalizeText, validateBatch, trimPoints };
})();

// validateSummary（契约第 3 节）：对完整 Summary 对象做校验，不合格返回 null
RH.summarize.validateSummary = function (obj, allText) {
  if (!obj || typeof obj !== "object") return null;
  const sections = Array.isArray(obj.sections) ? obj.sections : [];
  if (!sections.length) return null;
  const norm = [];
  for (const s of sections) {
    if (!s || !s.title) continue;
    const points = (Array.isArray(s.points) ? s.points : []).filter(p =>
      p && typeof p.point === "string" && p.point.length >= 8 && p.point.length <= 200 &&
      (!p.source || RH.summarize.fuzzyMatch(p.source, allText))
    );
    norm.push({ title: String(s.title), points });
  }
  if (!norm.some(s => s.points.length)) return null;
  return { overview: obj.overview || "", keywords: obj.keywords || [], sections: norm };
};
