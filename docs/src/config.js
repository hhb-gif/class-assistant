// LLM 通道单点配置 · 代理模式（前端零密钥，key 藏在服务端）
// 复用 review-helper 已部署的腾讯云 SCF 代理（OpenAI 兼容协议，国内直连）
// 部署/维护说明见 E:\OpenCode\review-helper\worker\部署指引.md
//
// ⚠️ 提交纪律：本文件入库时 apiKey 必须为空（代理模式）。
//    直连模式（含真实 key）仅限本地临时调试，绝不 commit。
window.CA_CONFIG = {
  llm: {
    baseURL: "https://1485216264-f202r5xapr.ap-guangzhou.tencentscf.com/api",
    model: "deepseek-v4-flash",
    apiKey: "",
  },
};
window.RH_CONFIG = window.CA_CONFIG;
