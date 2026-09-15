// LLM 通道单点配置 · 云函数网关（前端零密钥）
// P3 迁移：原计划 (A) CloudBase 内置 AI —— 因环境为「体验版」，套餐不支持内置 AI（UpdateAIModel 被拒）
//   且无 Token 资源包，故改为方案 (B)：前端经 CloudBase 云函数 `ai-gateway` 转发外部 OpenAI 兼容通道。
//   外部 AI 密钥只存云函数环境变量（AI_BASE_URL / AI_API_KEY / AI_MODEL），前端零密钥。
//
// ⚠️ 提交纪律：本文件入库时 apiKey 必须为空。
//    真实 API Key / SecretKey 绝不写进本文件、绝不写进仓库。
//
// CloudBase 环境接入（PG 模式）：envId + publishableKey 均为「前端公开」配置，可入库。
//   publishableKey 是匿名 / Publishable Key（scope=anonymous），仅供 @cloudbase/js-sdk 初始化；
//   真正的 API Key / SecretKey 绝不写进本文件、绝不写进仓库。
window.CA_CONFIG = {
  envId: "class-d3gnxrv6252ef676c",
  publishableKey: "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyODM1YTY3LWJhNjctNDFjMy05NjZmLWU5ZGNiZTZlYzg2ZiJ9.eyJpc3MiOiJodHRwczovL2NsYXNzLWQzZ254cnY2MjUyZWY2NzZjLmFwLXNoYW5naGFpLnRjYi1hcGkudGVuY2VudGNsb3VkYXBpLmNvbSIsInN1YiI6ImFub24iLCJhdWQiOiJjbGFzcy1kM2dueHJ2NjI1MmVmNjc2YyIsImV4cCI6NDA5MzE2NDYwNiwiaWF0IjoxNzg5NDgxNDA2LCJub25jZSI6IjAzV3RmVWNGUVJ5NFdQdnJ0UWNlWXciLCJhdF9oYXNoIjoiMDNXdGZVY0ZRUnk0V1B2cnRRY2VZdyIsIm5hbWUiOiJBbm9ueW1vdXMiLCJzY29wZSI6ImFub255bW91cyIsInByb2plY3RfaWQiOiJjbGFzcy1kM2dueHJ2NjI1MmVmNjc2YyIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.UaTmx-XNUobOJ-MrcwwrogCBct561RVdvLsOHyE6svYEN-HjH_3fQkj8bus04sJ1IN5nKpYZMkbCbfF4_WUdUxbjwlemFvxbKmpmL9BRwJ7e7hwizk2vc9Ajgju3JDwSfDL4IODsZcYwueRTp1wK8_foyPsV4fDPOwj0RRK_PuUAzA3Yix5QVWly4mGF-zZX4rS7FY1HkqYTM9t2qkRrPPGMJypPJZDZVHzUOForDAJVp0dBUbokjn4mDG_Pd3j33RjXvrQvh2n7LHt8TrNGydd2zFVUXiou3u7tLDTWvWgnkn4KDNGEXvckaJwSKqTAu6U_Jm9DBe-Z1Qq-tezdLg",
  llm: {
    // AI 网关云函数名（前端经 app.callFunction 调用；见 cloudfunctions/ai-gateway/）
    gateway: "ai-gateway",
    // ⚠️ legacy：仅复习模块（RH 移植的 src/review/llm.js）仍在读 baseURL；
    //    CA.llm 已改为调用云函数网关，不再使用 baseURL。
    baseURL: "https://1485216264-f202r5xapr.ap-guangzhou.tencentscf.com/api",
    // 展示用模型名（store 设置项 aiModel / 徽标）。实际调用模型由云函数环境变量 AI_MODEL 决定。
    // 注意：该字段亦被复习模块（RH 通道）使用，故保持 deepseek-v4-flash；如需改展示，请同步确认复习模块。
    model: "deepseek-v4-flash",
    apiKey: "",
  },
};
window.RH_CONFIG = window.CA_CONFIG;
