// LLM 通道单点配置模板（所有模块的唯一密钥/模型来源）
// 用法：复制本文件为 config.js 后按需修改。config.js 已 gitignore，不会入库。
//
// 【模式一 · 代理模式（推荐）】key 藏服务端，前端零密钥
//   baseURL 填代理地址（以 /api 结尾），apiKey 留空。
window.CA_CONFIG = {
  llm: {
    baseURL: "https://你的代理地址/api",
    model: "deepseek-v4-flash",
    apiKey: "",
  },
};

// 【模式二 · 直连模式（仅本地调试）】浏览器直连 DeepSeek，key 会暴露在前端 JS
// window.CA_CONFIG = {
//   llm: {
//     baseURL: "https://api.deepseek.com/v1",
//     model: "deepseek-v4-flash",
//     apiKey: "sk-你的key",
//   },
// };
