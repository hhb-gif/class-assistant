// 相似度 + TextRank + 融合评分 —— 移植 scoring.py
window.RH = window.RH || {};

RH.textrank = (function () {
  const { DAMPING, MAX_ITER, RULE_SIGNS, BOILERPLATE_PREFIX, FUSE_PATTERN_WORDS } = RH.RULES;

  function wordOverlapSim(sets, i, j) {
    let inter = 0;
    for (const w of sets[i]) if (sets[j].has(w)) inter++;
    if (!inter) return 0;
    const denom = Math.max(Math.log(Math.max(sets[i].size, 2)) + Math.log(Math.max(sets[j].size, 2)), 1e-6);
    return inter / denom;
  }

  function textrankScores(sim, n) {
    if (!n) return [];
    const outSums = sim.map(row => row.reduce((a, b) => a + b, 0));
    let scores = new Array(n).fill(1 / n);
    for (let it = 0; it < MAX_ITER; it++) {
      const next = new Array(n).fill((1 - DAMPING) / n);
      for (let i = 0; i < n; i++) {
        const row = sim[i];
        for (let j = 0; j < n; j++) {
          if (i !== j && row[j] > 0 && outSums[j] > 0) next[i] += DAMPING * row[j] / outSums[j] * scores[j];
        }
      }
      let diff = 0;
      for (let k = 0; k < n; k++) diff = Math.max(diff, Math.abs(next[k] - scores[k]));
      scores = next;
      if (diff < 1e-7) break;
    }
    return scores;
  }

  function normalize(values) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-12) return values.map(() => 0.5);
    return values.map(v => (v - lo) / (hi - lo));
  }

  function fuseScores(tr, candidates, keywordSet, tokens) {
    const trNorm = normalize(tr);
    const tdNorm = tokens.map(toks => {
      if (!toks.length) return 0;
      let hits = 0;
      for (const w of toks) if (keywordSet.has(w)) hits++;
      return Math.min(hits / Math.max(toks.length * 0.4, 1), 1);
    });

    return candidates.map((sent, i) => {
      const pos = sent.isSectionFirst ? 1.0 : (sent.isParaFirst ? 0.75 : 0.45);
      let patHits = 0;
      for (const p of FUSE_PATTERN_WORDS) if (sent.text.includes(p)) patHits++;
      const pat = Math.min(patHits / 2, 1);
      let score = 0.45 * trNorm[i] + 0.20 * pos + 0.20 * pat + 0.15 * tdNorm[i];
      let ruleHits = 0;
      for (const k of RULE_SIGNS) if (sent.text.includes(k)) ruleHits++;
      score += Math.min(ruleHits, 3) * 0.05;
      if (BOILERPLATE_PREFIX.some(p => sent.text.startsWith(p))) score -= 0.18;
      return score;
    });
  }

  return { wordOverlapSim, textrankScores, fuseScores };
})();
