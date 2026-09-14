// 语义相似度：transformers.js + bge-small-zh（ONNX），失败降级词重叠
window.RH = window.RH || {};

RH.semantic = (function () {
  let pipe = null;
  let tried = false;
  let name = "word_overlap";

  const IS_NODE = typeof process !== "undefined" && !!process.versions && !!process.versions.node;

  async function tryInit() {
    if (tried) return pipe;
    tried = true;
    try {
      let lib;
      if (IS_NODE) {
        lib = await import("@huggingface/transformers");
      } else {
        lib = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5");
      }
      const { pipeline, env } = lib;
      if (env) {
        // 国内网络走 hf-mirror（Node 与浏览器均生效）
        try { env.remoteHost = "https://hf-mirror.com"; } catch (e) {}
        try { env.allowLocalModels = false; } catch (e) {}
      }
      pipe = await pipeline("feature-extraction", "Xenova/bge-small-zh-v1.5", {
        dtype: "q8",
        progress_callback: null,
      });
      name = "bge-small-zh-v1.5(q8)";
      // 预热
      await pipe(["预热"], { pooling: "cls", normalize: true });
    } catch (e) {
      console.warn("[semantic] 模型加载失败，降级词重叠模式:", e && e.message);
      pipe = null;
    }
    return pipe;
  }

  function cosineMatrix(embs) {
    const n = embs.length;
    const dim = embs[0].length;
    // 打平成单个 Float32Array，减少内存开销并让 JIT 友好
    const flat = new Float32Array(n * dim);
    for (let i = 0; i < n; i++) flat.set(embs[i], i * dim);
    const sim = new Array(n);
    for (let i = 0; i < n; i++) sim[i] = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ai = i * dim;
      const row = sim[i];
      for (let j = i + 1; j < n; j++) {
        const bj = j * dim;
        let dot = 0;
        for (let k = 0; k < dim; k++) dot += flat[ai + k] * flat[bj + k];
        row[j] = dot;
        sim[j][i] = dot;
      }
    }
    return sim;
  }

  async function similarityMatrix(texts, tokenSets, wordOverlapFn, opts) {
    const { threshold = 0.35, overlapMix = 0.5 } = opts || {};
    if (pipe) {
      try {
        const out = await pipe(texts, { pooling: "cls", normalize: true });
        const data = out.tolist ? out.tolist() : out.data;
        // tolist(): [n][dim]
        const embs = Array.isArray(data[0]) ? data : chunkToList(data, out.dims);
        const sim = cosineMatrix(embs);
        const n = texts.length;
        for (let i = 0; i < n; i++) {
          sim[i][i] = 0;
          for (let j = i + 1; j < n; j++) {
            if (sim[i][j] < threshold) {
              sim[i][j] = sim[j][i] = wordOverlapFn(tokenSets, i, j) * overlapMix;
            }
          }
        }
        return sim;
      } catch (e) {
        console.warn("[semantic] 推理失败，降级词重叠:", e && e.message);
      }
    }
    const n = texts.length;
    const sim = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        sim[i][j] = sim[j][i] = wordOverlapFn(tokenSets, i, j);
    return sim;
  }

  function chunkToList(flat, dims) {
    const [n, dim] = dims;
    const out = [];
    for (let i = 0; i < n; i++) out.push(Array.from(flat.slice(i * dim, (i + 1) * dim)));
    return out;
  }

  function engineName() { return name; }
  function available() { return !!pipe; }

  return { tryInit, similarityMatrix, engineName, available };
})();
