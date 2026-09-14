// 规则常量与数据结构 —— 从 Python 版 keywords.py/candidates.py 1:1 移植
window.RH = window.RH || {};

RH.RULES = (function () {
  const STOP_WORDS = new Set(("的了是在我有和人这中大为上个不也时要就出会可你对生能子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原地量状态问题方面工作系统数据方法过程结果内容基本通过进行可以这样以及或者如果虽然但是因此因为所以就是以下以上我们你们他们它们自己什么怎么这些那些这个那个一个一些每个如下同时另外此外例如比如首先其次然后最后表示说明包括如下所述如图所示其中之间对于关于根据通过由于按照等等").split(""));
  // 数字字不是停用字（大量术语含数字字：二叉树、三维、十年……）
  for (const d of "一二三四五六七八九十百千万亿零〇两双") STOP_WORDS.delete(d);

  // PPT/课件版式标记：这些前缀的行是"任务/导航/标签"，不是知识点
  const LAYOUT_MARKERS = [
    "课堂讨论", "课堂练习", "例题", "例", "思考", "讨论", "练习", "提问", "作业",
    "本章小结", "小结", "复习", "预习", "篇序", "章内容结构", "课程简介", "教学内容",
    "教学目标", "学习目标", "重点", "难点", "课后作业", "习题课", "自测", "测试",
  ];
  const META_LINE_RE = new RegExp(
    "^[(（]?\\s*(?:" + LAYOUT_MARKERS.join("|") + ")\\s*[：:、)）]\\s*"
  );

  // 行是否为版式元信息（不出题、不进要点，仅保留原文）
  function isMetaLine(text) {
    const t = (text || "").trim();
    if (!t) return true;
    if (/QQ群|QQ ?群|微信群号/.test(t)) return true;
    if (META_LINE_RE.test(t)) return true;
    if (LAYOUT_MARKERS.some(m => t === m)) return true;          // 版式词独立成行
    if (/^\d+(\.\d+)+\s?\S/.test(t) && t.length < 35) return true; // 目录导航行："10.3 真空中的静电场"
    return false;
  }

  // ===== 文本净化：坏字符清除 + 上标/下标还原 =====
  const SUP_MAP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "(": "⁽", ")": "⁾", ".": "‧" };
  const SUB_MAP = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "(": "₍", ")": "₎" };

  function toScript(str, map) {
    return String(str).split("").map(ch => map[ch] !== undefined ? map[ch] : ch).join("");
  }

  // 清理解析产物中的坏字符：Symbol 字体私用区希腊字母还原，其余清除
  const SYMBOL_GREEK = {
    "\uF061": "α", "\uF062": "β", "\uF067": "γ", "\uF064": "δ", "\uF065": "ε", "\uF07A": "ζ",
    "\uF068": "η", "\uF071": "θ", "\uF069": "ι", "\uF06B": "κ", "\uF06C": "λ", "\uF06D": "μ",
    "\uF06E": "ν", "\uF078": "ξ", "\uF06F": "ο", "\uF070": "π", "\uF072": "ρ", "\uF073": "σ",
    "\uF074": "τ", "\uF075": "υ", "\uF066": "φ", "\uF063": "χ", "\uF079": "ψ", "\uF077": "ω",
    "\uF041": "Α", "\uF042": "Β", "\uF047": "Γ", "\uF044": "Δ", "\uF045": "Ε", "\uF05A": "Ζ",
    "\uF048": "Η", "\uF051": "Θ", "\uF049": "Ι", "\uF04B": "Κ", "\uF04C": "Λ", "\uF04D": "Μ",
    "\uF04E": "Ν", "\uF058": "Ξ", "\uF04F": "Ο", "\uF050": "Π", "\uF052": "Ρ", "\uF053": "Σ",
    "\uF054": "Τ", "\uF055": "Υ", "\uF046": "Φ", "\uF043": "Χ", "\uF059": "Ψ", "\uF057": "Ω",
    "\uF0D5": "∑", "\uF0E5": "∞", "\uF0B4": "×", "\uF0B8": "÷", "\uF0B9": "≠", "\uF0A3": "≤",
    "\uF0B3": "≥", "\uF0C6": "√", "\uF0D2": "∫", "\uF0E6": "≠", "\uF0CE": "∈",
  };

  // 清理解析产物：Symbol 私用区希腊字母还原 → 其余坏字符清除
  function sanitizeText(t) {
    let s = String(t);
    let out = "";
    for (const ch of s) {
      const code = ch.codePointAt(0);
      if (code >= 0xF020 && code <= 0xF0FF) {
        const mapped = SYMBOL_GREEK[ch];
        if (mapped) out += mapped;
        continue;
      }
      out += ch;
    }
    return out
      .replace(/[\uFFFD\uE000-\uF8FF\u200B-\u200F\u2028\u2029\uFEFF]/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/ {2,}/g, " ")
      .trim();
  }

  const PATTERN_WORDS = ["定义","是指","指的是","称为","简称","公式","定理","定律","原理","性质","特点","特征","原则","要素","方法","步骤","流程","机制","包括","分为","组成","属于","区别","联系","作用","影响","意义","注意","重点","核心","关键","本质","目的","功能","优点","缺点","总结","综上","因此","所以","表明","说明","意味着","原因是","主要","基本","首先","其次","最后","必须","需要","应当","不能"];

  const CONNECTIVE_PREFIX = ["因此","所以","首先","其次","然后","最后","另外","此外","例如","比如","同时","并且","而且","但是","然而","总之","综上","也就是说","换言之","即","而","且","并","于是","接着","随后"];

  const BOILERPLATE_PREFIX = ["为全面","为了","为深入","为贯彻","为落实","为进一步","根据","依据","按照","遵照","结合实际","现将","特制定","为规范","为加强","为做好","为保障","为维护","坚持以","坚持","高举","深入贯彻","全面贯彻"];

  const RULE_SIGNS = ["%","比例","加分","扣分","分值","满分","权重","记分","标准","记为","记入","零分","不合格","上限","下限"];

  const FUSE_PATTERN_WORDS = ["定义","是指","称为","定理","公式","特点","原则","核心","关键","包括","分为","总结"];

  const CANDIDATE_LIMIT = 400;
  const DAMPING = 0.85;
  const MAX_ITER = 25;
  const LAMBDA = 0.80;
  const EXEMPT_FACTOR = 0.25;

  return {
    STOP_WORDS, PATTERN_WORDS, CONNECTIVE_PREFIX, BOILERPLATE_PREFIX,
    RULE_SIGNS, FUSE_PATTERN_WORDS, LAYOUT_MARKERS, isMetaLine,
    sanitizeText, toScript, SUP_MAP, SUB_MAP,
    CANDIDATE_LIMIT, DAMPING, MAX_ITER, LAMBDA, EXEMPT_FACTOR,
  };
})();

// ---- 数据结构 ----
RH.Sentence = function (text, sectionIdx, paraIdx, sentIdx, globalIdx, isSectionFirst, isParaFirst) {
  return { text, sectionIdx, paraIdx, sentIdx, globalIdx, isSectionFirst, isParaFirst };
};

RH.Section = function (title, level, blocks) {
  return { title: title || "", level: level || 1, blocks: blocks || [], sentences: [] };
};

RH.ParsedDocument = function (title, sections) {
  return { title, sections: sections || [] };
};

RH.fillSentences = function (doc, minLen = 6) {
  let gid = 0;
  for (let si = 0; si < doc.sections.length; si++) {
    const sec = doc.sections[si];
    sec.sentences = [];
    for (let pi = 0; pi < sec.blocks.length; pi++) {
      const block = sec.blocks[pi].replace(/\s+/g, " ").trim();
      if (!block) continue;
      const parts = block.split(/([。！？；!?;])/);
      const raw = [];
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const s = (parts[i] + parts[i + 1]).trim();
        if (s) raw.push(s);
      }
      if (parts.length % 2 === 1 && parts[parts.length - 1].trim()) raw.push(parts[parts.length - 1].trim());

      // 碎片合并：短片段拼回相邻长句
      const merged = [];
      let buf = "";
      for (const piece of raw) {
        buf += piece;
        if (buf.length >= minLen) { merged.push(buf); buf = ""; }
      }
      if (buf) {
        if (merged.length && buf.length <= 20) merged[merged.length - 1] += buf;
        else merged.push(buf);
      }

      for (let j = 0; j < merged.length; j++) {
        sec.sentences.push(RH.Sentence(
          merged[j], si, pi, j, gid,
          sec.sentences.length === 0, j === 0
        ));
        gid++;
      }
    }
  }
};

RH.allSentences = function (doc) {
  const out = [];
  for (const sec of doc.sections) out.push(...sec.sentences);
  return out;
};
