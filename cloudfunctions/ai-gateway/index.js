// ai-gateway —— 班级管家统一 AI 网关（OpenAI 兼容 /chat/completions 转发）
//
// 前端通过 CloudBase `app.callFunction({ name:"ai-gateway", data:{...} })` 调用。
// 密钥只存云函数环境变量，前端零密钥；走外部 OpenAI 兼容通道，与云开发套餐解耦。
//
// 环境变量（云函数「环境变量」配置，绝不进仓库）：
//   AI_BASE_URL  OpenAI 兼容端点，以 /v1 或 /v4 结尾（如 https://open.bigmodel.cn/api/paas/v4）
//   AI_API_KEY   服务端密钥
//   AI_MODEL     模型名，默认 glm-4-flash
//   AI_JSON_MODE 可选，=1 时对 jsonMode 请求下发 response_format:{type:"json_object"}（需上游支持）
//
// 入参：{ messages:[{role,content}], temperature?, maxTokens?, jsonMode?, timeoutMs? }
// 出参：成功 { ok:true, text, model, usage }；失败 { ok:false, code, message }
//
// 说明：模型由服务端环境变量决定（不接受前端指定），避免被滥用切换昂贵模型。
"use strict";

var DEFAULTS = { model: "glm-4-flash", timeoutMs: 120000 };

function env() {
  return {
    baseUrl: (process.env.AI_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || DEFAULTS.model,
    jsonMode: process.env.AI_JSON_MODE === "1",
  };
}

function fail(code, message) { return { ok: false, code: code, message: message }; }

exports.main = async function (event, context) {
  var e = env();
  if (!e.baseUrl) return fail("NO_BASE_URL", "AI 网关未配置：请在云函数环境变量设置 AI_BASE_URL");
  if (!e.apiKey) return fail("NO_API_KEY", "AI 网关未配置密钥：请在云函数环境变量设置 AI_API_KEY");

  var ev = event || {};
  var messages = Array.isArray(ev.messages) ? ev.messages : null;
  if (!messages || !messages.length) return fail("BAD_INPUT", "缺少 messages");
  if (messages.length > 40) return fail("BAD_INPUT", "messages 条数过多");
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i] || {};
    if (typeof m.content !== "string" || m.content.length > 20000) return fail("BAD_INPUT", "消息内容超长或格式非法");
  }

  var body = {
    model: e.model,                       // 服务端模型，忽略前端传入的 model
    messages: messages,
    stream: false,
    temperature: typeof ev.temperature === "number" ? ev.temperature : 0.4,
  };
  if (ev.maxTokens) body.max_tokens = ev.maxTokens;
  if (ev.jsonMode && e.jsonMode) body.response_format = { type: "json_object" };

  var timeoutMs = (typeof ev.timeoutMs === "number" && ev.timeoutMs > 0) ? Math.min(ev.timeoutMs, 180000) : DEFAULTS.timeoutMs;
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);

  try {
    var r = await fetch(e.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + e.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    var raw = await r.text();
    if (!r.ok) {
      var msg = raw.slice(0, 300);
      try { var j = JSON.parse(raw); msg = (j.error && j.error.message) || j.message || msg; } catch (x) {}
      if (r.status === 401 || r.status === 403) return fail("AUTH", "AI 通道鉴权失败（" + r.status + "）：密钥无效或余额不足");
      if (r.status === 404) return fail("NOT_FOUND", "AI 接口 404：AI_BASE_URL 可能填错（应以 /v1 或 /v4 结尾）");
      if (r.status === 429) return fail("RATE_LIMIT", "AI 请求频率超限或余额不足（429）");
      return fail("UPSTREAM", "AI 上游返回 " + r.status + "：" + msg);
    }
    try {
      var parsed = JSON.parse(raw);
      var out = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
      if (out != null) return { ok: true, text: out, model: body.model, usage: parsed.usage || null };
    } catch (x2) {}
    return fail("BAD_RESPONSE", "AI 响应缺少 choices 内容");
  } catch (err) {
    if (err && err.name === "AbortError") return fail("TIMEOUT", "请求超时，可重试");
    return fail("NETWORK", "网络请求失败：" + ((err && err.message) || err));
  } finally {
    clearTimeout(timer);
  }
};
