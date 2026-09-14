// 关键词 / 术语 / 条目清洗 —— 移植 keywords.py（文内统计版，无外部 IDF 依赖）
window.RH = window.RH || {};

RH.keywords = (function () {
  const { STOP_WORDS } = RH.RULES;

  // 文内高频词（TF 排序，长度与频次加权）——替Python jieba全局IDF：质量略降但零依赖
  function extractKeywords(text, topN = 15) {
    const tokens = RH.tokenizer.cut(text);
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    const scored = Object.entries(freq).map(([w, c]) => ({
      w,
      s: c * (w.length >= 2 ? 1.2 : 0.6) * (1 + Math.log(1 + c) / 4),
    }));
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, topN).map(x => x.w);
  }

  // 术语 = 新词发现（凝固度+边界熵，jieba 词典词豁免过滤）为主，高频 token 组合为辅
  function extractTerms(text, topN = 20) {
    let dictWords = null;
    try { dictWords = RH.tokenizer.cut(text).filter(w => w.length >= 2); } catch (e) {}
    const viaNewword = RH.newword ? RH.newword.discover(text, topN, 3, dictWords) : [];
    if (viaNewword.length >= 5) return viaNewword;
    // 降级：高频 token + 相邻组合
    const tokens = RH.tokenizer.cut(text);
    const counter = {};
    const bump = (w) => { if (w && w.length >= 2 && !STOP_WORDS.has(w)) counter[w] = (counter[w] || 0) + 1; };
    for (const t of tokens) bump(t);
    for (let i = 0; i + 1 < tokens.length; i++) {
      const combo = tokens[i] + tokens[i + 1];
      if (combo.length >= 3 && combo.length <= 12) bump(combo);
    }
    const combos = Object.entries(counter)
      .filter(([w, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([w]) => w);
    // 合并去重（优先新词结果）
    const merged = [];
    for (const w of [...viaNewword, ...combos]) {
      if (merged.length >= topN) break;
      if (!merged.some(m => m.includes(w) || w.includes(m))) merged.push(w);
    }
    return merged;
  }

  function cleanItem(text) {
    let s = (text || "").trim();
    for (const p of RH.RULES.CONNECTIVE_PREFIX) {
      if (s.startsWith(p) && s.length > p.length + 4) { s = s.slice(p.length); break; }
    }
    return s.replace(/^[，。；：,;:\s]+/, "");
  }

  return { extractKeywords, extractTerms, cleanItem };
})();
