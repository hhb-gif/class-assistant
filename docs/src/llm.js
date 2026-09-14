// LLM 服务层 —— 传输层走 CloudBase 云函数网关（app.callFunction），前端零密钥
// 对外契约（CA.llm）保持不变：chat / ready / info / generateJson / extractJson / testConnection / chunkText / isNetError / netStatus / _setNetFailed
// 配置来源：window.CA_CONFIG.llm（兼容 RH_CONFIG）；需要 gateway（云函数名）+ model（展示用）
// 鉴权：复用当前登录会话（与 app.rdb()/app.auth 同一套 CloudBase 凭证）；外部 AI 密钥只存云函数环境变量
window.CA = window.CA || {};

CA.llm = (function () {

  // 云函数网关默认名（config.llm.gateway 可覆盖）
  var DEFAULT_GATEWAY = "ai-gateway";

  // ---------- 配置 ----------
  function cfg() {
    try {
      const src = window.CA_CONFIG || window.RH_CONFIG;
      const c = src && src.llm;
      // 云函数网关模式：需要 gateway（或 model）即可；不再需要 baseURL/apiKey
      return c && (c.gateway || c.model) ? c : null;
    } catch (e) { return null; }
  }

  function gatewayName() {
    const c = cfg();
    return (c && c.gateway) || DEFAULT_GATEWAY;
  }

  // CloudBase 应用实例（触发初始化；SDK 缺失返回 null）
  function app() {
    if (!(window.CA && CA.cloud)) return null;
    return CA.cloud.app;
  }

  // CloudBase 可用（SDK 已加载 + callFunction 可用）即视为 ready（真实可用性由调用时的错误处理兜底）
  function ready() {
    if (!cfg()) return false;
    try {
      if (!(window.CA && CA.cloud && CA.cloud.ready())) return false;
      const a = app();
      return !!(a && typeof a.callFunction === "function");
    } catch (e) { return false; }
  }

  // 引擎信息（徽标 / backend 标注用）
  function info() {
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
    const m = typeof e === "string" ? e : ((e && (e.message || e.msg)) || "");
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

  // ---------- 传输工具 ----------
  function errText(e) {
    if (e == null) return "";
    if (typeof e === "string") return e;
    return e.message || e.msg || (e.code ? String(e.code) : "") || String(e);
  }

  // 超时包装：callFunction 无 AbortSignal，用 Promise.race 复刻原有超时语义
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return; done = true;
        var err = new Error("请求超时，可重试"); err.__timeout = true; reject(err);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return; done = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (done) return; done = true; clearTimeout(timer); reject(e);
      });
    });
  }

  // 网关结构化错误 → 可读中文（code 见 cloudfunctions/ai-gateway/index.js）
  function gatewayError(r) {
    var e;
    switch (r && r.code) {
      case "TIMEOUT": e = new Error("请求超时，可重试"); break;
      case "NETWORK": e = new Error("网络请求失败：请检查网络连接"); e.__net = true; break;
      case "NO_BASE_URL": e = new Error("AI 网关未配置：请在云函数环境变量设置 AI_BASE_URL"); break;
      case "NO_API_KEY": e = new Error("AI 网关未配置密钥：请在云函数环境变量设置 AI_API_KEY"); break;
      case "AUTH": e = new Error(r.message || "AI 通道鉴权失败：密钥无效或余额不足"); break;
      case "RATE_LIMIT": e = new Error(r.message || "AI 请求频率超限，稍后重试"); break;
      case "NOT_FOUND": e = new Error(r.message || "AI 接口地址 404：AI_BASE_URL 可能填错"); break;
      default: e = new Error((r && r.message) || "AI 网关调用失败");
    }
    e.__gateway = true;   // 已是可读中文，避免被 friendlyErr 二次映射
    return e;
  }

  // 其余异常（SDK/权限）映射；非网络、非结构化错误原样抛出
  function friendlyErr(e) {
    const msg = errText(e);
    if (/permission|forbidden|unauthor|401|403|anonymous|denied|未登录|无权限/i.test(msg)) {
      return new Error("AI 调用被拒绝：请确认已登录，且云函数 ai-gateway 允许当前用户调用");
    }
    return (e instanceof Error) ? e : new Error(msg || "AI 调用失败");
  }

  // ---------- chat（CloudBase 云函数网关） ----------
  async function chat(messages, opts) {
    const c = cfg();
    if (!c) throw new Error("未配置 AI 通道（缺 src/config.js 的 llm 配置）");
    if (unreachableNow()) throw new Error("网络不可达（AI 服务暂连不上，本会话改走离线，5 分钟后自动重试）");
    const o = opts || {};
    const a = app();
    if (!a || typeof a.callFunction !== "function") {
      throw new Error("CloudBase 不可用：无法调用 AI 网关（缺 cloud.js 或 SDK 版本过低）");
    }
    const timeoutMs = o.timeoutMs || 180000;

    try {
      const res = await withTimeout(a.callFunction({
        name: gatewayName(),
        data: {
          messages: messages,
          temperature: o.temperature != null ? o.temperature : 0.4,
          maxTokens: o.maxTokens,
          jsonMode: !!o.jsonMode,
          timeoutMs: timeoutMs,
        },
      }), timeoutMs + 8000);   // 前端超时略大于网关超时，让网关先返回结构化 TIMEOUT
      const r = (res && res.result !== undefined) ? res.result : res;
      if (!r || typeof r !== "object") throw new Error("AI 网关无有效返回");
      if (r.ok === false) {
        const ge = gatewayError(r);
        if (ge.__net) { _netFailedAt = Date.now(); }
        throw ge;
      }
      const out = r.text;
      if (out == null) throw new Error("AI 响应缺少文本内容");
      return out;
    } catch (e) {
      if (e && e.__timeout) throw e;
      if (e && e.__net) throw e;
      if (e && e.__gateway) throw e;
      if (isNetError(e)) {
        _netFailedAt = Date.now();   // 记录网络失败时间：本会话内后续请求快速失败，不再干等超时
        throw new Error("网络请求失败：请检查网络连接");
      }
      throw friendlyErr(e);
    }
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

  // jsonMode 生成 + 解析失败自动重试 1 次（温度 +0.2）
  async function generateJson(messages, opts) {
    const o = opts || {};
    const baseTemp = o.temperature != null ? o.temperature : 0.3;
    try {
      const text = await chat(messages, { ...o, jsonMode: true, temperature: baseTemp });
      return extractJson(text);
    } catch (e) {
      if (!/JSON|响应|缺少/.test(e.message || "")) throw e;  // 网络/鉴权类错误不重试
      const text = await chat(messages, { ...o, jsonMode: true, temperature: Math.min(baseTemp + 0.2, 1) });
      return extractJson(text);
    }
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
