// LLM 服务层 v3 —— 优先委托 CloudBase 云函数网关（window.CA.llm），缺失/不可用时回退内置 fetch 代理
// 契约：docs/CONTRACT-v2.md 第 2 节；对外 API 与 v2 完全一致
// 背景：静态托管域直连 RH SCF 代理会 403；主文档 CA.llm 已改走 app.callFunction("ai-gateway")，复习模块复用同一通道。
window.RH = window.RH || {};

RH.llm = (function () {

  // ---------- 委托层：优先 window.CA.llm（CloudBase 云函数网关） ----------
  function caLlm() {
    try { return (window.CA && window.CA.llm) || null; } catch (e) { return null; }
  }

  // CA.llm 存在且其 ready() 为真 → 走网关；否则回退内置 fetch 实现（本地/冒烟页仍可用）
  function caReady() {
    var c = caLlm();
    try { return !!(c && typeof c.ready === "function" && c.ready()); } catch (e) { return false; }
  }

  // RH opts → CA.chat opts 参数映射：同名同义字段直传；RH 专有 thinking 网关不支持（丢弃，不影响其余参数）
  function mapOpts(opts) {
    var o = opts || {};
    var out = {};
    if (o.temperature != null) out.temperature = o.temperature;
    if (o.maxTokens != null) out.maxTokens = o.maxTokens;
    if (o.jsonMode != null) out.jsonMode = o.jsonMode;
    if (o.timeoutMs != null) out.timeoutMs = o.timeoutMs;
    return out;
  }

  // ---------- 配置（回退路径：window.RH_CONFIG.llm 的单点 fetch 代理配置） ----------
  function cfg() {
    try {
      const c = window.RH_CONFIG && window.RH_CONFIG.llm;
      // baseURL+model 必填；apiKey 允许为空（代理模式：key 在服务端，前端不带头）
      return c && c.baseURL && c.model ? c : null;
    } catch (e) { return null; }
  }

  // 就绪判定：CA.llm 存在 → 以网关就绪为准；否则本地配置完整即视为 ready
  //（真实可用性仍由调用时的错误处理兜底，失败走管线降级）
  function ready() {
    if (caLlm()) return caReady();
    return !!cfg();
  }

  // 引擎信息（徽标 / backend 标注用）：CA.llm 存在优先转发，否则读本地配置
  function info() {
    var c = caLlm();
    if (c && typeof c.info === "function") {
      try { var i = c.info(); if (i) return i; } catch (e) { /* 回退本地 */ }
    }
    return localInfo();
  }

  function localInfo() {
    const c = cfg();
    if (!c) return { model: "", keyMasked: "" };
    let masked = "";
    if (c.apiKey) masked = c.apiKey.slice(0, 5) + "****" + c.apiKey.slice(-4);
    return { model: c.model, keyMasked: masked };
  }

  // ---------- 网络可达性（会话级快速失败；不持久化，刷新页面/5 分钟后自动恢复重试） ----------
  const NET_RETRY_MS = 5 * 60 * 1000;
  let _netFailedAt = 0;

  function isNetError(e) {
    const m = (e && e.message) || "";
    return m.indexOf("Failed to fetch") >= 0 || m.indexOf("NetworkError") >= 0 ||
      m.indexOf("Load failed") >= 0 || m.indexOf("网络请求失败") >= 0 || m.indexOf("网络不可达") >= 0;
  }

  function unreachableNow() {
    return _netFailedAt > 0 && (Date.now() - _netFailedAt < NET_RETRY_MS);
  }

  function netStatus() {
    return { unreachable: unreachableNow(), retryInMs: unreachableNow() ? NET_RETRY_MS - (Date.now() - _netFailedAt) : 0 };
  }

  // 调试/测试用（下划线约定：非业务接口）
  function _setNetFailed(at) { _netFailedAt = at; }

  // ---------- 回退实现：内置 fetch（OpenAI 兼容 /chat/completions） ----------
  async function localChat(messages, opts) {
    const c = cfg();
    if (!c) throw new Error("未配置 LLM API（缺 src/config.js）");
    if (unreachableNow()) throw new Error("网络不可达（AI 服务暂连不上，本会话改走离线，5 分钟后自动重试）");
    const o = opts || {};
    const body = {
      model: c.model,
      messages,
      temperature: o.temperature != null ? o.temperature : 0.4,
    };
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    if (o.jsonMode) body.response_format = { type: "json_object" };
    // 思考模式开关（DeepSeek V4 默认开启思考且 effort=high；"off" 显式关闭提速省 token）
    if (o.thinking === "off") body.thinking = { type: "disabled" };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 180000);
    try {
      const headers = { "Content-Type": "application/json" };
      // 直连模式：apiKey 非空时带鉴权头；代理模式（Worker）：key 在服务端，前端不带头
      if (c.apiKey) headers["Authorization"] = "Bearer " + c.apiKey;
      const r = await fetch(c.baseURL.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const t = await r.text();
        let msg = t.slice(0, 200);
        try { msg = JSON.parse(t).error && JSON.parse(t).error.message || msg; } catch (e) {}
        if (r.status === 401) throw new Error("API Key 无效或余额不足（401）");
        if (r.status === 404) throw new Error("接口地址 404：baseURL 可能填错（应以 /v1 结尾）");
        if (r.status === 429) throw new Error("请求频率超限或余额不足（429），稍后重试");
        throw new Error("API 返回 " + r.status + ": " + msg);
      }
      const j = await r.json();
      const out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (out == null) throw new Error("API 响应缺少 choices 内容");
      return out;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("请求超时，可重试");
      if (e.message && (e.message.includes("Failed to fetch") || e.message.includes("NetworkError") || e.message.includes("Load failed"))) {
        _netFailedAt = Date.now();   // 记录网络失败时间：本会话内后续请求快速失败，不再干等超时
        throw new Error("网络请求失败：请检查网络连接");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- chat（网关优先 → fetch 回退） ----------
  async function chat(messages, opts) {
    var c = caLlm();
    if (c && typeof c.chat === "function" && caReady()) {
      return c.chat(messages, mapOpts(opts));   // 委托：错误按 CA 语义抛出，不再二次回退
    }
    return localChat(messages, opts);
  }

  // ---------- JSON 提取与稳健生成 ----------
  function extractJson(text) {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = m ? m[1] : text;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("响应中没有 JSON");
    return JSON.parse(raw.slice(start, end + 1));
  }

  // 回退路径：jsonMode 生成 + 解析失败自动重试 1 次（温度 +0.2）
  async function localGenerateJson(messages, opts) {
    const o = opts || {};
    const baseTemp = o.temperature != null ? o.temperature : 0.3;
    try {
      const text = await localChat(messages, { ...o, jsonMode: true, temperature: baseTemp });
      return extractJson(text);
    } catch (e) {
      if (!/JSON|响应|缺少/.test(e.message || "")) throw e;  // 网络/鉴权类错误不重试
      const text = await localChat(messages, { ...o, jsonMode: true, temperature: Math.min(baseTemp + 0.2, 1) });
      return extractJson(text);
    }
  }

  // ---------- generateJson（网关优先 → fetch 回退） ----------
  async function generateJson(messages, opts) {
    var c = caLlm();
    if (c && typeof c.generateJson === "function" && caReady()) {
      return c.generateJson(messages, mapOpts(opts));   // 委托：CA.llm 内置同样的解析失败重试
    }
    return localGenerateJson(messages, opts);
  }

  // ---------- 连接自检 ----------
  async function testConnection() {
    const t0 = Date.now();
    const reply = await chat(
      [{ role: "user", content: "请只回复四个字：连接成功" }],
      { temperature: 0, timeoutMs: 30000, maxTokens: 16 }
    );
    return { ok: true, reply: (reply || "").trim().slice(0, 30), ms: Date.now() - t0 };
  }

  // ---------- 分块工具（A/C 共用） ----------
  // blocks: string[]，按块边界累切成 ≤maxChars 的块组；单块超长再硬切；空块剔除
  function chunkText(blocks, maxChars) {
    const max = maxChars || 6000;
    const clean = (blocks || []).map(b => String(b || "").trim()).filter(Boolean);
    const out = [];
    let cur = [], curLen = 0;
    for (let raw of clean) {
      if (raw.length > max) {
        // 先结算当前批，再对超长块硬切
        if (cur.length) { out.push(cur.join("\n")); cur = []; curLen = 0; }
        for (let i = 0; i < raw.length; i += max) out.push(raw.slice(i, i + max));
        continue;
      }
      if (curLen + raw.length > max && cur.length) {
        out.push(cur.join("\n")); cur = []; curLen = 0;
      }
      cur.push(raw); curLen += raw.length;
    }
    if (cur.length) out.push(cur.join("\n"));
    return out;
  }

  return { chat, ready, info, generateJson, extractJson, testConnection, chunkText, isNetError, netStatus, _setNetFailed };
})();
