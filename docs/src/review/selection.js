// 候选粗筛 + 配额 + MMR —— 移植 candidates.py / selection.py
window.RH = window.RH || {};

RH.selection = (function () {
  const { CANDIDATE_LIMIT, RULE_SIGNS, PATTERN_WORDS, BOILERPLATE_PREFIX, LAMBDA, EXEMPT_FACTOR } = RH.RULES;

  function isKeySentence(text) {
    return text.length >= 10 && RULE_SIGNS.some(k => text.includes(k));
  }

  function ruleScore(sent) {
    let score = 0.5;
    if (sent.isSectionFirst) score += 0.25;
    else if (sent.isParaFirst) score += 0.12;
    let hits = 0;
    for (const p of PATTERN_WORDS) if (sent.text.includes(p)) hits++;
    score += Math.min(hits, 3) * 0.07;
    const n = sent.text.length;
    if (n < 8) score -= 0.2;
    else if (n > 120) score -= 0.08;
    if (/[0-9]/.test(sent.text)) score += 0.05;
    let ruleSigns = 0;
    for (const k of RULE_SIGNS) if (sent.text.includes(k)) ruleSigns++;
    score += Math.min(ruleSigns, 3) * 0.06;
    if (BOILERPLATE_PREFIX.some(p => sent.text.startsWith(p))) score -= 0.3;
    return score;
  }

  function buildCandidates(sentences) {
    if (sentences.length <= CANDIDATE_LIMIT) return sentences.slice();
    const scored = sentences.map(s => ({ s, v: ruleScore(s) })).sort((a, b) => b.v - a.v);
    const keep = new Set(scored.slice(0, CANDIDATE_LIMIT).map(x => x.s.globalIdx));
    for (const s of sentences) if (isKeySentence(s.text)) keep.add(s.globalIdx);
    return sentences.filter(s => keep.has(s.globalIdx));
  }

  function totalQuota(nSentences) {
    return Math.max(5, Math.min(Math.round(nSentences * 0.3), 80));
  }

  function sectionQuotas(secCounts, k) {
    const total = secCounts.reduce((a, b) => a + b, 0);
    if (!total) return secCounts.map(() => 0);
    const quotas = secCounts.map(c => (c > 0 ? Math.min(Math.round(k * c / total), c) : 0));
    const active = secCounts.map((c, i) => ({ c, i })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
    let used = quotas.reduce((a, b) => a + b, 0);
    let rest = k - used;
    while (rest > 0) {
      let progressed = false;
      for (const { c, i } of active) {
        if (rest <= 0) break;
        if (quotas[i] < c) { quotas[i]++; rest--; progressed = true; }
      }
      if (!progressed) break;
    }
    while (used > k) {
      let reduced = false;
      for (const { i } of active.slice().reverse()) {
        if (used <= k) break;
        if (quotas[i] > 1) { quotas[i]--; used--; reduced = true; }
      }
      if (!reduced) break;
    }
    return quotas;
  }

  function mmrSelect(scores, sim, k, exempt) {
    const n = scores.length;
    if (!n || k <= 0) return [];
    const selected = [];
    const cand = new Set(Array.from({ length: n }, (_, i) => i));
    exempt = exempt || new Set();
    while (selected.length < k && cand.size) {
      let bestIdx = -1, bestVal = -1e9;
      for (const i of cand) {
        let maxSim = 0;
        for (const j of selected) {
          const s = sim[i][j];
          if (s > maxSim) maxSim = s;
        }
        if (exempt.has(i)) maxSim *= EXEMPT_FACTOR;
        const val = LAMBDA * scores[i] - (1 - LAMBDA) * maxSim;
        if (val > bestVal) { bestVal = val; bestIdx = i; }
      }
      selected.push(bestIdx);
      cand.delete(bestIdx);
    }
    return selected;
  }

  return { isKeySentence, ruleScore, buildCandidates, totalQuota, sectionQuotas, mmrSelect };
})();
