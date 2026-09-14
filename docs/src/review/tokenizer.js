// 中文分词：保底自写 bigram 分词器；若 jieba-wasm 可用则自动升级
window.RH = window.RH || {};

RH.tokenizer = (function () {
  const { STOP_WORDS } = RH.RULES;
  let jiebaImpl = null;   // function(text) -> [words]
  let tried = false;

  // 尝试加载 jieba-wasm（可选增强，失败静默降级）
  // Node 端: import("jieba-wasm")；浏览器端: pkg/web 路径 + 先调用默认导出的 init()
  async function tryLoadJieba() {
    if (tried) return jiebaImpl;
    tried = true;
    try {
      if (typeof process !== "undefined" && process.versions && process.versions.node && typeof document === "undefined") {
        const m = await import("jieba-wasm");
        const cut = m.cut || (m.default && m.default.cut);
        if (cut) jiebaImpl = (text) => cut(text, true);
      } else {
        const mod = await import("https://cdn.jsdelivr.net/npm/jieba-wasm@2.2.0/pkg/web/jieba_rs_wasm.js");
        if (typeof mod.default === "function") await mod.default();
        const cut = mod.cut;
        if (cut) jiebaImpl = (text) => cut(text, true);
      }
    } catch (e) {
      jiebaImpl = null;
    }
    return jiebaImpl;
  }

  // 保底：双字滑窗 + 停用词/单字过滤（流程保通用，质量略低于 jieba）
  function fallbackCut(text) {
    const tokens = [];
    const n = text.length;
    for (let i = 0; i < n - 1; i++) {
      const bg = text.slice(i, i + 2);
      if (/[\u4e00-\u9fa5A-Za-z0-9]{2}/.test(bg)) tokens.push(bg);
    }
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (/[\u4e00-\u9fa5A-Za-z]{1}/.test(ch) && !STOP_WORDS.has(ch)) tokens.push(ch);
    }
    // 连续英文/数字串整体作为一个 token
    const asciiRuns = text.match(/[A-Za-z0-9]+(?:[.%][0-9]+)*/g) || [];
    return tokens.filter(t => !STOP_WORDS.has(t)).concat(asciiRuns);
  }

  async function init() {
    await tryLoadJieba();
    return !!jiebaImpl;
  }

  function cut(text) {
    if (jiebaImpl) {
      try {
        return jiebaImpl(text).filter(w => w.trim() && !STOP_WORDS.has(w) && w.length > 1);
      } catch (e) { /* fall through */ }
    }
    return fallbackCut(text).filter(w => w.length > 1);
  }

  function tokenize(texts) {
    return texts.map(cut);
  }

  function engineName() {
    return jiebaImpl ? "jieba-wasm" : "bigram-fallback";
  }

  return { init, cut, tokenize, engineName };
})();
