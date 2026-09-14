// 自动出题引擎（规则版）：填空 / 判断 / 选择，题目带原文溯源
window.RH = window.RH || {};

RH.quiz = (function () {
  const { RULE_SIGNS } = RH.RULES;

  const NUM_RE = /(\d+(?:\.\d+)?)(\s*(?:%|％|分|倍|年|个月|月|日|天|人|次|级|项|字|小时|小时|分钟|元|页|章|条|点))/g;
  const RANGE_SWAP = {
    "不低于": "不高于", "不高于": "不低于",
    "以上": "以下", "以下": "以上",
    "至少": "至多", "至多": "至少",
    "不得超过": "不得少于", "不得少于": "不得超过",
    "不少于": "不多于", "不多于": "不少于",
    "高于": "低于", "低于": "高于",
  };

  const FUNCTION_WORDS = new Set(["包括","进行","通过","具有","属于","以及","或者","采用","用于","根据","按照","可以","应当","需要","其中","对于","关于","分为","组成","表示","说明","情况","方面","问题","内容","基本","主要","系统","一种","每种","各种","以下","如下","以上","分别","相应","其他","其他","相关","有关","上述","对应"]);

  function isBadKeyword(k) {
    if (!k || k.length < 2) return true;
    if (FUNCTION_WORDS.has(k)) return true;
    return false;
  }

  // 答案候选评分（借鉴 KristiyanVachev/Question-Generation 的 answerability 思路）
  function answerScore(target, text) {
    let s = 0.3;
    if (target.type === "num") s = 0.85 + (text.length < 60 ? 0.05 : 0); // 客观、句短加分
    else {
      s = 0.45 + Math.min(target.value.length, 6) * 0.06; // 越长越具体
      if (target.start <= 6) s += 0.06;                    // 句首主语位置
    }
    return Math.min(s, 1);
  }

  // 置信度（借鉴 Q-GEN）：数字题高置信；术语题看干扰项质量
  function confidenceOf(target, ds, q) {
    if (target.type === "num") return 0.88;
    let c = 0.55;
    if (ds.length >= 3 && ds.every(d => Math.abs(d.length - target.value.length) <= 2)) c += 0.15;
    if (q && q.length >= 20) c += 0.08;
    return Math.min(c, 0.9);
  }

  // 难度（借鉴 Q-GEN 的 Easy/Medium/Hard）：句长 + 干扰项混淆度
  function difficultyOf(text, target) {
    if (target.type === "num") return 2;
    if (text.length > 60) return 3;
    if (text.length < 30) return 1;
    return 2;
  }

  function pickRng(seed) {
    let s = seed || 42;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  // ---------- 挖空点 ----------
  const GENERIC_ANSWERS = new Set(["定理", "性质", "方法", "公式", "原则", "规律", "概念", "定义", "过程", "结果", "课堂讨论", "例题", "思考"]);

  function findClozeTargets(text, keywordPool, allText) {
    const targets = [];
    // 数字+单位优先
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(text)) !== null) {
      targets.push({ type: "num", value: m[1] + (m[2] || "").trim(), num: parseFloat(m[1]), unit: (m[2] || "").trim(), start: m.index });
    }
    // 术语挖空：跳过虚词；目标须为原文连续子串（防 bigram 伪词）
    const pool = keywordPool.slice().sort((a, b) => b.length - a.length);
    for (const kw of pool) {
      if (kw.length < 2 || FUNCTION_WORDS.has(kw) || GENERIC_ANSWERS.has(kw)) continue;
      if (allText && !allText.includes(kw)) continue;
      const idx = text.indexOf(kw);
      if (idx >= 0 && !targets.some(t => idx >= t.start && idx < t.start + t.value.length)) {
        targets.push({ type: "term", value: kw, start: idx });
        break;
      }
    }
    return targets;
  }

  function distractorsFor(target, keywordPool, rng, existing, allText, secBag) {
    if (target.type === "num") {
      const base = target.num;
      const fmt = (v) => (Number.isInteger(base) ? String(Math.round(v)) : v.toFixed(1)) + (target.unit || "");
      const cands = [base * 1.25, base * 0.7, base + (base > 10 ? 15 : 3)];
      const uniq = [];
      for (const c of cands) {
        const s = fmt(c);
        if (s !== target.value && !uniq.includes(s) && c > 0) uniq.push(s);
      }
      return uniq.slice(0, 3);
    }
    // 术语干扰项：同章节优先 → 全局；去重 + 排除答案互为子串 + 必须为原文真实词
    const used = new Set(existing || []);
    const secFirst = secBag ? Object.keys(secBag).sort((a, b) => secBag[b] - secBag[a]) : [];
    const pool = [...secFirst, ...keywordPool].filter(k =>
      !isBadKeyword(k) &&
      k !== target.value && k.length >= 2 && !used.has(k) &&
      (!allText || allText.includes(k)) &&
      !target.value.includes(k) && !k.includes(target.value)
    );
    const shuffled = pool.slice().sort(() => rng() - 0.5);
    const out = [];
    for (const k of shuffled) {
      if (out.length >= 3) break;
      if (!out.includes(k) && Math.abs(k.length - target.value.length) <= Math.max(2, target.value.length)) out.push(k);
    }
    return out;
  }

  // ---------- 判断题变换 ----------
  function transformForJudge(text) {
    // 1) 范围词替换（高置信）
    for (const [from, to] of Object.entries(RANGE_SWAP)) {
      if (text.includes(from)) {
        return { q: text.replace(from, to), changed: from + " → " + to, kind: "range" };
      }
    }
    // 2) 数字篡改
    NUM_RE.lastIndex = 0;
    const m = NUM_RE.exec(text);
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0) {
        const delta = n > 20 ? Math.max(3, Math.round(n * 0.25)) : (n > 5 ? 3 : 1);
        const nv = n + (Math.random() < 0.5 ? delta : -delta);
        if (nv > 0 && nv !== n) {
          const fmt = (Number.isInteger(n) ? Math.round(nv) : nv.toFixed(1)) + (m[2] || "").trim();
          return { q: text.replace(m[0], fmt), changed: `${m[1]}${(m[2] || "").trim()} → ${fmt}`, kind: "num" };
        }
      }
    }
    return null;
  }

  // ---------- 列举题（规章类文档杀手锏：包括/分为 + 顿号列举） ----------
  function findEnumerations(item) {
    const t = item.text;
    if (!/(包括|分为|以下|如下)/.test(t) || (t.match(/、/g) || []).length < 2) return null;
    const keyIdx = Math.max(t.indexOf("包括"), t.indexOf("分为"), t.indexOf("以下"), t.indexOf("如下"));
    if (keyIdx < 0) return null;
    const tail = t.slice(keyIdx + 2).replace(/[。；：，,].*$/, "");
    const parts = tail.split("、").map(s => s.replace(/^(和|与|及)/, "").replace(/(等|以及|和|与|及).*$/, "").trim())
      .filter(s => s.length >= 2 && s.length <= 10 && !/[（）()。；，]/.test(s));
    if (parts.length < 3) return null;
    return parts.slice(0, 6);
  }

  // ---------- 主入口 ----------
  function generateQuiz(result, opts) {
    const rng = pickRng((opts && opts.seed) || 7919);
    const items = [];
    (result.sections || []).forEach((sec, si) => {
      (sec.items || []).forEach((it, ii) => {
        if (it.length >= 14 && it.length <= 200 && !RH.RULES.isMetaLine(it)) {
          items.push({ text: it, si, ii, blockIdx: (sec.sources && sec.sources[ii] != null) ? sec.sources[ii] : null, secTitle: sec.title });
        }
      });
    });
    const allText = items.map(i => i.text).join("\n");
    const keywordPool = [...new Set([...(result.keywords || []), ...(result.terms || [])])].filter(k => allText.includes(k) && !isBadKeyword(k));

    // 章节级词频（干扰项同章节优先的素材）
    const secWords = {};
    for (const it of items) {
      const bag = secWords[it.si] = secWords[it.si] || {};
      for (const k of keywordPool) if (it.text.includes(k)) bag[k] = (bag[k] || 0) + 1;
    }

    const quiz = [];
    let qid = 1;
    const answerUseCount = {};
    const MAX_ANSWER_REUSE = 2;

    const usedSent = new Set();
    const take = () => {
      for (const it of items) {
        if (!usedSent.has(it.text)) { usedSent.add(it.text); return it; }
      }
      return null;
    };

    let made = 0;
    const nItems = items.length;
    const nCloze = Math.max(2, Math.min(6, Math.round(nItems * 0.25)));
    const nChoice = Math.max(3, Math.min(12, Math.round(nItems * 0.3)));
    const nJudge = Math.max(2, Math.min(5, Math.round(nItems * 0.15)));

    // ---- 选择题（主力题型：普通挖空选择 + 列举题优先）----
    made = 0;
    const usedForChoice = new Set();
    // 第一轮：列举题
    for (const it of items) {
      if (made >= Math.min(4, nChoice)) break;
      if (usedForChoice.has(it.text)) continue;
      const parts = findEnumerations(it);
      if (!parts) continue;
      // 正确答案：在 keywordPool 里命中的项优先，否则取中间项
      let answer = parts.find(p => keywordPool.some(k => k === p || (k.includes(p) && p.length >= 2))) || parts[1] || parts[0];
      // 干扰项：其他列举句的项优先，再补同章节词
      const pool = [];
      for (const o of items) {
        if (o.text === it.text) continue;
        const op = findEnumerations(o);
        if (op) pool.push(...op.filter(p => !parts.includes(p)));
      }
      for (const k of (secWords[it.si] ? Object.keys(secWords[it.si]) : [])) pool.push(k);
      pool.push(...keywordPool);
      const ds = [];
      for (const p of pool) {
        if (ds.length >= 3) break;
        if (p === answer || ds.includes(p) || p.includes(answer) || answer.includes(p)) continue;
        if (FUNCTION_WORDS.has(p)) continue;
        if (Math.abs(p.length - answer.length) > Math.max(3, answer.length)) continue;
        ds.push(p);
      }
      if (ds.length < 3) continue;
      const options = [answer, ...ds];
      for (let s = options.length - 1; s > 0; s--) {
        const j = Math.floor(rng() * (s + 1));
        [options[s], options[j]] = [options[j], options[s]];
      }
      usedForChoice.add(it.text);
      quiz.push({
        qid: "q" + (qid++), type: "choice", style: "enum",
        question: it.text.replace(answer, "______"),
        options, answer,
        answerIndex: options.indexOf(answer),
        explanation: "原文：" + it.text + "（列举项：" + parts.join("、") + "）",
        source: { section: it.si, block: it.blockIdx, secTitle: it.secTitle },
        difficulty: 3, confidence: 0.75,
      });
      answerUseCount[answer] = (answerUseCount[answer] || 0) + 1;
      made++;
    }
    // 第二轮：普通挖空选择（答案按 answerScore 择优）
    for (let i = 0; i < nItems && made < nChoice; i++) {
      const it = take();
      if (!it) break;
      if (usedForChoice.has(it.text)) continue;
      const targets = findClozeTargets(it.text, keywordPool, allText);
      if (!targets.length) continue;
      // 答案候选评分制：选每句最优挖空点
      targets.sort((a, b) => answerScore(b, it.text) - answerScore(a, it.text));
      const target = targets.find(t => (answerUseCount[t.value] || 0) < MAX_ANSWER_REUSE);
      if (!target) continue;
      const ds = distractorsFor(target, keywordPool, rng, [target.value], allText, secWords[it.si]);
      if (ds.length < 3) continue;
      const options = [target.value, ...ds];
      for (let s = options.length - 1; s > 0; s--) {
        const j = Math.floor(rng() * (s + 1));
        [options[s], options[j]] = [options[j], options[s]];
      }
      usedForChoice.add(it.text);
      answerUseCount[target.value] = (answerUseCount[target.value] || 0) + 1;
      quiz.push({
        qid: "q" + (qid++), type: "choice",
        question: it.text.replace(target.value, "______"),
        options, answer: target.value,
        answerIndex: options.indexOf(target.value),
        explanation: "原文：" + it.text,
        source: { section: it.si, block: it.blockIdx, secTitle: it.secTitle },
        difficulty: difficultyOf(it.text, target),
        confidence: confidenceOf(target, ds, it.text),
      });
      made++;
    }

    // ---- 填空题 ----
    made = 0;
    for (let i = 0; i < nItems && made < nCloze; i++) {
      const it = take();
      if (!it) break;
      const targets = findClozeTargets(it.text, keywordPool, allText);
      if (!targets.length) continue;
      const target = targets.find(t => (answerUseCount[t.value] || 0) < MAX_ANSWER_REUSE) || targets[0];
      if ((answerUseCount[target.value] || 0) >= MAX_ANSWER_REUSE) continue;
      const q = it.text.replace(target.value, "______");
      if (q === it.text) continue;
      answerUseCount[target.value] = (answerUseCount[target.value] || 0) + 1;
      quiz.push({
        qid: "q" + (qid++), type: "cloze",
        question: q, answer: target.value,
        explanation: "原文：" + it.text,
        source: { section: it.si, block: it.blockIdx, secTitle: it.secTitle },
        difficulty: target.type === "num" ? 2 : 1,
      });
      made++;
    }

    // ---- 判断题 ----
    made = 0;
    let trueCount = 0;
    for (let i = 0; i < nItems && made < nJudge; i++) {
      const it = take();
      if (!it) break;
      const hasRuleSign = RULE_SIGNS.some(k => it.text.includes(k));
      if (!hasRuleSign) continue;
      const tf = transformForJudge(it.text);
      if (tf) {
        quiz.push({
          qid: "q" + (qid++), type: "judge",
          question: tf.q, answer: "错误",
          explanation: `原文表述：${it.text}（变换点：${tf.changed}）`,
          source: { section: it.si, block: it.blockIdx, secTitle: it.secTitle },
          difficulty: 3,
        });
        made++;
      } else if (trueCount < Math.ceil(nJudge / 3)) {
        quiz.push({
          qid: "q" + (qid++), type: "judge",
          question: it.text, answer: "正确",
          explanation: "原文表述，无改动。",
          source: { section: it.si, block: it.blockIdx, secTitle: it.secTitle },
          difficulty: 1,
        });
        trueCount++; made++;
      }
    }

    return quiz;
  }

  function quizToMarkdown(quiz) {
    if (!quiz || !quiz.length) return "";
    const typeName = { cloze: "填空", judge: "判断", choice: "选择" };
    const lines = [];
    lines.push("---\n");
    lines.push("## 自测题\n");
    quiz.forEach((q, i) => {
      if (q.type === "choice") {
        lines.push(`${i + 1}. [${typeName[q.type]}] ${q.question}`);
        q.options.forEach((o, oi) => lines.push(`   - ${String.fromCharCode(65 + oi)}. ${o}`));
      } else if (q.type === "judge") {
        lines.push(`${i + 1}. [${typeName[q.type]}] ${q.question}（对/错）`);
      } else {
        lines.push(`${i + 1}. [${typeName[q.type]}] ${q.question}`);
      }
    });
    lines.push("\n<details>\n<summary>参考答案与解析</summary>\n");
    quiz.forEach((q, i) => {
      const ans = q.type === "choice" ? `${String.fromCharCode(65 + q.answerIndex)}. ${q.answer}` : q.answer;
      lines.push(`${i + 1}. **${ans}** —— ${q.explanation}`);
    });
    lines.push("\n</details>\n");
    return lines.join("\n");
  }

  return { generateQuiz, quizToMarkdown };
})();
