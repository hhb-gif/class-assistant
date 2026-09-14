# P3 · AI 网关迁移报告（CA.llm → CloudBase 云函数 `ai-gateway`）

> 日期：2026-09-14 ｜ 执行：AI 网关迁移工程师（Agent）
> 环境：`class-assistant-d6fw1gdce84d261e`（ap-shanghai，PG 模式，**体验版 baas_trial**）
> 对应：ROADMAP §D6 / P3；故障记录 `2026-09-14-SCF代理Origin白名单.md`

---

## 0. 一句话结论

**迁移已落地：`CA.llm` 传输层从 review-helper 的腾讯云 SCF 代理切到自建云函数 `ai-gateway`（外部 OpenAI 兼容通道），对外契约零变化、前端零密钥、无端口/Origin 白名单折腾。**
**云函数已部署成功（Active）；前端与网关代码均已本地验证通过。**
**唯一未闭环项：因当前 MCP 为「环境级凭证」（无 SCF Invoke 权限），无法由 Agent 触发真实调用冒烟；且尚缺 DeepSeek Key。Key 到位后即可端到端验证。**

---

## 1. 选型：先评估 (A)，最终采纳 **(B)**（经用户决策）

### 第一轮评估 → 倾向 (A)，但被环境阻塞

| 判据 | 结论 |
|------|------|
| js-sdk 3.9.3 是否支持 AI | **支持**（`cloudbase.full.js@3.9.3` 含 `name:"ai",entity:{ai:fn}`、`createModel`、`generateText`、`streamText`） |
| 零密钥 | 支持（托管模型池，鉴权复用登录会话） |
| 两步预检 | ❌ **① 无 Token 资源包**（`DescribeEnvPostpayPackage` 空）；**② `cloudbase` 组 `Models: []`**；`UpdateAIModel` 被拒：**「当前环境的套餐不支持，请升级到标准版及以上套餐」** |
| 结论 | (A) 代码可行，但**当前体验版环境物理不可用**（套餐限制，非 SDK 限制） |

### 用户决策 → 改走 (B)

> 用户明确选择「云函数 + 外部 Key」。外部通道定为 **DeepSeek 官方 API**。

**最终方案 (B)**：新建云函数 `ai-gateway`（Node 18，Event 型），前端 `CA.llm` 经 `app.callFunction` 调用；外部 Key 只存云函数环境变量，**前端零密钥、不受云开发套餐限制**。

| 维度 | (B) 表现 |
|------|----------|
| 免 Origin 白名单 | ✅ 不再经过 RH 代理 |
| 去 RH 耦合（CA 侧） | ✅ `CA.llm` 不再读 `baseURL` |
| 密钥安全 | ✅ 服务端环境变量，前端不出现 Key |
| 运维成本 | ⚠️ 多一个云函数（已部署、无依赖、无冷启动依赖） |
| 端用户提供 Key | ✅ 不需要（Key 仅由开发者配置在服务端） |

---

## 2. 改动文件 + 行数

| 文件 | 行数 | 说明 |
|------|------|------|
| `docs/src/llm.js` | 161 → **225** | 传输层重写为 `app.callFunction("ai-gateway", {messages,temperature,maxTokens,jsonMode,timeoutMs})`；`cfg()` 改读 `gateway`；`ready()` 改判「CloudBase 可用且 callFunction 存在」；新增 `withTimeout`/`gatewayError`/`friendlyErr`；`extractJson`/`generateJson`/`testConnection`/`chunkText`/`netStatus`/`_setNetFailed` 逐字保留 |
| `docs/src/config.js` | 20 → **27** | 头部注释改为方案 B 说明；新增 `llm.gateway:"ai-gateway"`；`baseURL` 保留并注释为「仅复习模块 legacy」；`model` 保持 `deepseek-v4-flash`（该字段亦被复习模块使用，避免连带破坏） |
| `cloudfunctions/ai-gateway/index.js` | **86**（新建） | OpenAI 兼容转发：读 `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`/`AI_JSON_MODE`；入参护栏（条数/长度）；结构化错误码 `NO_BASE_URL/NO_API_KEY/BAD_INPUT/AUTH/NOT_FOUND/RATE_LIMIT/UPSTREAM/BAD_RESPONSE/TIMEOUT/NETWORK`；模型由服务端决定（忽略前端 model） |
| `cloudfunctions/ai-gateway/package.json` | **7**（新建） | 无依赖（Node 18 原生 `fetch`/`AbortController`） |

**未改动**：`index.html`、`ai.js`、各模块视图、`styles.css`。**未写入任何密钥到仓库**。

---

## 3. `CA.llm` 对外契约：**不变**

`chat / ready / info / generateJson / extractJson / testConnection / chunkText / isNetError / netStatus / _setNetFailed` 全部保留，签名与语义一致：

- `chat(messages, opts) -> Promise<string>`（传输改为 callFunction，返回仍是模型文本）
- `ready() -> boolean`（CloudBase 可用 + 网关可调即 true）
- `info() -> { model, keyMasked }`（keyMasked 恒为 `""`，零密钥）
- `generateJson` / `extractJson` / `testConnection` / `chunkText`：**逐字未改**

`CA.ai`（`ai.js`）与调用方（`app.js`、notices/scores/collect/review-view）**无需改动**。

**残留（明确告知，非本次授权范围）**：复习模块 `docs/src/review/llm.js` 为 RH 原样移植，仍读 `RH_CONFIG.llm.baseURL`，仍走 RH 代理（线上会 403，按既有设计降级为「离线模式」）。如需一并迁移，需另行授权修改该文件。

---

## 4. 验证方式与真实结果

| 验证项 | 方式 | 结果 |
|--------|------|------|
| 语法 | `node --check`（llm.js / config.js / ai-gateway/index.js） | **全通过 ✅** |
| 前端传输层冒烟 | Node 沙箱：加载真实 `llm.js`，mock `app.callFunction` | **28/28 断言通过 ✅**（契约存在性、ready/info、`callFunction` 名与入参透传、`extractJson`、网关结构化错误码→中文、网络→会话级快速失败、callFunction/配置缺失→`ready()===false`） |
| 网关函数冒烟 | Node 沙箱：加载真实 `cloudfunctions/ai-gateway/index.js`，桩 `fetch` | **20/20 断言通过 ✅**（成功解析、URL/Bearer/body 拼接、忽略前端 model、401/429/404/500/非 JSON/网络/超时的错误码映射、`AI_JSON_MODE` 开关） |
| 云函数部署 | MCP `createFunction` | **成功 ✅**（`ai-gateway`，Nodejs18.15，Active，env `AI_BASE_URL=https://api.deepseek.com/v1`、`AI_MODEL=deepseek-chat`，CodeSize 2621） |
| 云函数 **Invoke 冒烟** | MCP `invokeFunction` / `scf:Invoke` | **未完成 ❌** —— 均返回 `[Invoke] Cam authentication failed`；当前 MCP 为**环境级凭证**（`credential_scope=single_env`），无 SCF Invoke 权限（可部署、不可调用，属凭据边界） |
| 线上真实 AI 调用 | 浏览器 | **未验证 ❌**（尚缺 DeepSeek Key，且需用户侧触发） |
| 既有 node 回归 | `store/scores/collect/notices_test.mjs` | **88 / 87 / 80 / 64 全通过 ✅** |
| `review_test.mjs` | 同上 | **失败（与本次改动无关）**：`docs/src/review-view.js` 于本次会话期间（19:59）被**并发改写**为 103 行桩文件、不再导出 `CA.review.formatVm`；该测试只加载 `review-view.js`、不加载 `llm.js`/`config.js`。见 §6 |

> 冒烟脚本为临时文件，已清理。未伪造任何联调结果。

---

## 5. 待办：Key 到位后的收尾（由用户发 Key 给 Agent）

1. `manageFunctions(action="updateFunctionConfig", functionName="ai-gateway", envVariables={ AI_API_KEY:"sk-***" })` —— **Key 只进云函数环境变量，绝不入库/入报告**。
2. 冒烟方式（因 MCP 环境级凭证无法 Invoke，需择一）：
   - 用户在**控制台 → 云函数 → ai-gateway → 测试**，粘贴 `{"messages":[{"role":"user","content":"请只回复：连接成功"}]}`；
   - 或用户登录页面后，在浏览器控制台执行 `CA.llm.testConnection().then(console.log)`；
   - 或改用**账号级凭证**（`auth(login)` 账号级登录）后由 Agent 直接 `invokeFunction`。
3. 确认 `AI_MODEL` 与账号可用模型一致（DeepSeek 官方常用 `deepseek-chat`；如账号另有 `deepseek-v4-flash` 可改）。

### 前端是否可见 AI 入口的前置条件

`CA.llm.ready()` 现在只判「SDK + 配置 + callFunction 存在」，**不探测 Key 是否配置**。故：
- Key 未配时：入口会显示，但点下去收到中文错误「AI 网关未配置密钥：请在云函数环境变量设置 AI_API_KEY」；
- Key 配好后：即可正常调用。
（这是「配置完整即 ready、真实可用性由调用兜底」的既有设计，与迁移前一致。）

---

## 6. 未验证 / 不确定项

1. **部署后真实调用**（受 CAM Invoke 权限 + 缺 Key 双重阻塞）——最高优先级待办。
2. DeepSeek 官方模型 id 与 `AI_MODEL` 的一致性（`deepseek-chat` 为默认，未用真 Key 验证）。
3. 云函数出网：`PublicNetStatus=ENABLE`（可访问公网），但未实测到 `api.deepseek.com` 的连通性。
4. 云函数被前端 `callFunction` 调用的**权限**：Event 函数默认策略是否放通已登录用户，未在浏览器验证；若被拒，需 `managePermissions(resourceType="function", resourceId="ai-gateway", ...)`（PG 环境会走 OPA rego，影响面较大，暂未动）。
5. `review_test.mjs` 失败系 `review-view.js` 并发改写所致（非本任务），未处理。
6. 复习模块（RH 移植）是否纳入 P3 收尾（需改 `review/llm.js`，本次未授权）。

---

## 7. 给前端模块 agent 的说明

1. **调用方式不变**：继续调 `CA.ai.parseNotice / analyzeExam / studentComment / summarizeResponses`；内部已自动走云函数网关。
2. **可用性判断不变**：`CA.ai.enabled()`（= `settings.aiEnabled && CA.llm.ready()`）。
3. **触发时机**：用户需**已登录**（`callFunction` 走登录会话）；登录后各页 AI 入口正常。未登录不会渲染入口。
4. **降级不变**：`ready()===false` 隐藏入口；调用失败 `try/catch` + `CA.app.toast(msg)`，基础功能不受影响。
5. **错误文案**（可直接 toast）：网络类「网络请求失败：请检查网络连接」；超时「请求超时，可重试」；未配 Key「AI 网关未配置密钥：请在云函数环境变量设置 AI_API_KEY」；鉴权「AI 通道鉴权失败（401）：密钥无效或余额不足」。
6. **上线前必做**：等 §5 的 Key 配置 + 一次真实端到端点击验证通过后，再对外宣布「AI 可用」。
