// 新词发现：字符级 n-gram 凝固度 + 边界自由度（纯统计，无词典依赖）
window.RH = window.RH || {};

RH.newword = (function () {
  const { STOP_WORDS } = RH.RULES;

  function isGoodChar(ch) {
    return /[\u4e00-\u9fa5A-Za-z0-9]/.test(ch);
  }

  // 主入口：返回候选术语数组（按分数降序）；dictWords = jieba 已识别词（豁免统计过滤）
  function discover(text, topN = 20, minFreq = 3, dictWords) {
    if (!text || text.length < 100) return [];
    const dictSet = dictWords ? new Set(dictWords) : null;
    const src = text.replace(/\s+/g, "");
    const chars = Array.from(src);
    const n = chars.length;
    if (n < 200) return [];

    const MAX_LEN = 4;
    const GOOD_RE = /^[\u4e00-\u9fa5A-Za-z0-9]+$/;
    // 1) n-gram 频次（gram 必须全为有效字符——表格"|"和标点天然断开跨界串）
    const freq = new Map();
    for (let len = 2; len <= MAX_LEN; len++) {
      for (let i = 0; i + len <= n; i++) {
        const g = chars.slice(i, i + len).join("");
        if (!GOOD_RE.test(g)) continue;
        freq.set(g, (freq.get(g) || 0) + 1);
      }
    }
    // 2) 单字频次（用于凝固度）与邻字统计（用于边界熵）
    const charFreq = new Map();
    const leftNb = new Map(); // gram -> Map(leftChar -> count)
    const rightNb = new Map();
    for (const [g, f] of freq) {
      if (f < minFreq) continue;
      leftNb.set(g, new Map());
      rightNb.set(g, new Map());
    }
    for (let len = 2; len <= MAX_LEN; len++) {
      for (let i = 0; i + len <= n; i++) {
        const g = chars.slice(i, i + len).join("");
        if (!leftNb.has(g)) continue;
        if (i > 0 && isGoodChar(chars[i - 1])) {
          const m = leftNb.get(g);
          m.set(chars[i - 1], (m.get(chars[i - 1]) || 0) + 1);
        }
        if (i + len < n && isGoodChar(chars[i + len])) {
          const m = rightNb.get(g);
          m.set(chars[i + len], (m.get(chars[i + len]) || 0) + 1);
        }
      }
    }
    for (const ch of chars) {
      if (isGoodChar(ch)) charFreq.set(ch, (charFreq.get(ch) || 0) + 1);
    }

    // 3) 打分：频次 × 凝固度(min PMI over切分点) × 边界熵
    const entropy = (m) => {
      let total = 0, h = 0;
      for (const v of m.values()) total += v;
      if (!total) return 0;
      for (const v of m.values()) {
        const p = v / total;
        h -= p * Math.log(p);
      }
      return h;
    };
    const sideEntropy = (m) => {
      let total = 0, h = 0;
      for (const v of m.values()) total += v;
      if (!total) return { h: 9, total: 0 };
      for (const v of m.values()) { const p = v / total; h -= p * Math.log(p); }
      return { h, total };
    };
    const cands = [];
    for (const [g, f] of freq) {
      if (f < minFreq || g.length < 2) continue;
      // 过滤：含明显停用单字为主的串、纯数字串
      const cnChars = (g.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (cnChars < 2 && !/[A-Za-z0-9]/.test(g)) continue;
      if (/^[0-9.]+$/.test(g)) continue; // 纯数字/小数不是术语
      if (cnChars < 1 && g.length < 3) continue; // 过短的纯字母数字串
      // 凝固度：所有切分点中最弱的一环（单字频次取 charFreq）
      let solid = Infinity;
      const N = n;
      for (let cut = 1; cut < g.length; cut++) {
        const left = g.slice(0, cut), right = g.slice(cut);
        const fl = left.length === 1 ? (charFreq.get(left) || 0) : (freq.get(left) || 0);
        const fr = right.length === 1 ? (charFreq.get(right) || 0) : (freq.get(right) || 0);
        if (!fl || !fr) { solid = 0; break; }
        const pmi = (f * N) / (fl * fr);
        if (pmi < solid) solid = pmi;
      }
      // 排除含高频停用字主导的串；首尾停用字直接排除（"排序的/存储和"类伪串）
      let stopCount = 0;
      for (const ch of g) if (STOP_WORDS.has(ch)) stopCount++;
      if (stopCount >= 2) continue;
      if (STOP_WORDS.has(g[0]) || STOP_WORDS.has(g[g.length - 1])) continue;
      // jieba 词典已识别的词：豁免全部统计过滤，按频次+长度直接打分
      const inDict = dictSet && dictSet.has(g);
      let solidScore, bScore;
      if (inDict) {
        solidScore = 2.5; bScore = 2.0;
      } else {
        if (!isFinite(solid) || solid < 1.2) continue;
        const bE = entropy(leftNb.get(g)) + entropy(rightNb.get(g));
        if (bE < 0.5) continue; // 边界太固定（可能是更长词的一部分）
        const L = sideEntropy(leftNb.get(g)), R = sideEntropy(rightNb.get(g));
        if (L.total >= f * 0.8 && L.h < 0.3) continue;
        if (R.total >= f * 0.8 && R.h < 0.3) continue;
        solidScore = solid; bScore = bE;
      }
      const score = Math.log(1 + f) * Math.log(1 + solidScore) * (0.5 + bScore) * Math.pow(1.6, g.length - 2);
      cands.push({ g, f, score });
    }
    cands.sort((a, b) => b.score - a.score);
    // 分层配额：3-4 字术语优先（占 60%+），2 字词补足——长术语区分度更高
    const long = cands.filter(c => c.g.length >= 3);
    const short = cands.filter(c => c.g.length === 2);
    const nLong = Math.max(Math.ceil(topN * 0.6), Math.min(long.length, topN - 2));
    const picked = [];
    const tryPush = (c) => {
      if (picked.length >= topN) return;
      if (picked.some(r => r.g.includes(c.g) || c.g.includes(r.g))) return;
      picked.push(c);
    };
    for (const c of long) { if (picked.length >= nLong) break; tryPush(c); }
    for (const c of short) { if (picked.length >= topN) break; tryPush(c); }
    for (const c of cands) { if (picked.length >= topN) break; tryPush(c); }
    return picked.map(c => c.g);
  }

  return { discover };
})();
