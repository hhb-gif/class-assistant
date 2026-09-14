# P1-0 SDK 兼容性验证报告

> 日期：2026-09-14 ｜ 验证人：SDK 兼容性验证工程师（Agent）
> 对应计划：`PLAN-P1.md` §2 **P1-0.1**（确认 CDN 版 `@cloudbase/js-sdk` 支持 `app.rdb()`）
> 环境：`class-assistant-d6fw1gdce84d261e`（ap-shanghai，PG 模式）
> 结论一句话：**CDN 全量包可用，`app.rdb()` 与 `app.auth` 均在包内，零构建约束成立；但官方文档示例的 `3.0.1` CDN 地址已 404，必须改用 3.4.0+。另有 2 处 API 与任务描述不符（改密不能用 `updateUser`）。**

---

## 0. 结论速览

| # | 问题 | 结论 | 证据强度 |
|---|------|------|----------|
| 1 | CDN 全量包地址与可用版本 | `https://static.cloudbase.net/cloudbase-js-sdk/<ver>/cloudbase.full.js`；**3.9.3（当前 latest）/ 3.4.0 ~ 3.9.3 可下载**；`3.0.1/3.1.0/3.2.0/3.3.0` 均 **404**（官方文档示例地址已失效） | **已验证**（HTTP 200 + 文件内容） |
| 2 | 全量包是否暴露 `app.rdb()` | **是**。包内注册组件 `{name:"rdb", entity:{rdb:...}}`，给 app 赋 `e.rdb=xh(...)` | **已验证**（下载 3.9.3/3.8.2/3.4.0 源码检索） |
| 3 | 是否暴露 `app.auth` | **是**。包内注册 `{name:"auth", namespace:..., entity:...}` 并挂 `.auth` | **已验证**（源码检索） |
| 4 | 认证 API 可用性 | `auth.signInWithPassword` / `auth.getSession` **可用**；`auth.updateUser({password})` **不可用**（v3 明确不支持改密），改密须用 `auth.resetPasswordForOld({old_password,new_password})` | **已验证**（官方文档 + 包内符号） |
| 5 | `publishableKey` vs `accessKey` | 初始化参数名**只有 `accessKey`**。`publishableKey` 在 SDK 包内出现 **0 次**；"Publishable Key" 只是控制台概念，塞进 `accessKey` 字段 | **已验证**（源码检索 0 次 + 官方文档） |
| 6 | 零构建约束 | **满足**。单个 `<script src=...cloudbase.full.js>` 即可，无需 npm/esbuild | **已验证**（CDN 200 + 包自注册） |
| 7 | Web 安全域名（CORS） | **必须加白名单**，且为「协议精确匹配（含端口）」。当前环境白名单**只有**自身静态托管域名，**无任何 localhost 条目** → 本地 8899 必须新增 | **已验证**（`queryEnv(action=domains)` 实读） |
| 8 | 浏览器渲染/真实请求 | **未实测**（无 publishableKey、无 PG 表、无法在浏览器跑）。仅静态与文档层面验证 | **未实测** |

---

## 1. 产出文件路径

- 本报告：`reports/P1-0-SDK验证.md`
- **未改动任何业务文件**（仅新建 `reports/` 目录与本报告）。

---

## 2. CDN 地址 · 版本 · `app.rdb()` 结论

### 2.1 地址格式

```
https://static.cloudbase.net/cloudbase-js-sdk/<version>/cloudbase.full.js
```

### 2.2 实测结果（GET，TLS1.2）

| 版本 | HTTP | 大小 | 含 `rdb` |
|------|------|------|----------|
| `latest` | **200** | 863,568 B | 是（=3.9.3 内容） |
| `3.9.3` | **200** | 863,568 B | **是** |
| `3.9.0` | 200 | 856,413 B | — |
| `3.8.0` / `3.8.2` | 200 | ~844 KB | 是 |
| `3.7.0` / `3.6.0` / `3.5.0` | 200 | 839~903 KB | — |
| `3.4.0` | **200** | 713,633 B | **是**（已下载检索，最小可用版本） |
| `3.0.1` `3.1.0` `3.2.0` `3.3.0` | **404** | — | — |

> ⚠️ 官方文档示例写的是 `.../3.0.1/cloudbase.full.js`，**该地址已 404**。不要照抄文档示例版本号。

### 2.3 `app.rdb()` 证据（3.9.3 全量包原文片段）

```js
// 初始化链路：给 app 实例挂 rdb / mysql / models
return e.models = E(r,e),
       e.mysql  = Uh(e,{envId: ...}),
       e.rdb    = xh(e,{envId: ...}),   // ← PostgreSQL 链式 API
       e
```

```js
// 组件自注册（包加载即执行）
var f = { name:"rdb", entity:{ rdb:function(e){ return l(this,e,!0)(e) } } };
cloudbase.registerComponent(h); // mysql
cloudbase.registerComponent(f); // rdb（PG）
```

结论：**`cloudbase.full.js` 直接暴露 `app.rdb()`**，无需额外模块文件。

### 2.4 CDN「按需引入」补充（备选）

- `cloudbase.rdb.js` / `cloudbase.pg.js` → **404（不存在该命名）**。
- `cloudbase.mysql.js`（71,830 B）内部 **也含 `rdb`**（8 处，与全量包同结构）——即「内核 + mysql 模块」可能同样拿到 `app.rdb()`。**此为推断，未在浏览器实测**，不建议作为主路径。
- 结论：**PG 场景用 `cloudbase.full.js` 最稳**。

---

## 3. 最小初始化片段（可直接粘贴）

> `config.js` 只放 **envId + publishableKey（公开）**；**API Key / service_role 绝不进前端**。

```html
<!-- 1) 引 CDN：放在业务脚本之前（与现有 bootcdn/cdnjs 引法一致，零构建） -->
<script src="https://static.cloudbase.net/cloudbase-js-sdk/3.9.3/cloudbase.full.js"></script>
```

```js
// 2) 初始化（Publishable Key 放在 accessKey 字段，不是 publishableKey）
const app = cloudbase.init({
  env: "class-assistant-d6fw1gdce84d261e",
  region: "ap-shanghai",            // 环境为上海，建议显式写
  accessKey: "<PUBLISHABLE_KEY>",   // 前端公开，可入库
  auth: { detectSessionInUrl: true }, // 可选：仅为 OAuth 场景需要，账号密码登录非必需
});

// 3) 两个入口
const auth = app.auth;   // 认证
const db   = app.rdb();  // PostgreSQL 链式 API（注意：不是 app.database()）
```

```js
// 4) 查询形态（postgREST 风格，非 NoSQL 的 .where()/.orderBy()/.count()）
const { data, error } = await db.from("notices").select("*");
// 带条件：          .select("*").eq("status", "published").order("created_at", { ascending:false })
// 计数：            .select("*", { count:"exact", head:true })  → { count }
// 分页：            .range(0, 19)   // 两端闭区间
// 插入：            .insert({ title, status:"draft" })（owner_id 由 DEFAULT auth.uid() 生成，前端不传）
// 更新：            .update({ status }).eq("id", id)
// 删除：            .delete().eq("id", id)
// RPC：             .rpc("fn_name", { p: 1 })
```

> 关键 API 差异（务必写进 `docs/src/cloud.js` 注释，避免误用）：
> **PG 模式是 `app.rdb().from(t).select()`**，**不是**传统模式的 `app.database().collection(t).get()`。
> 方法名：`.match()/.eq()/.order()/.range()`，**没有** `.where()/.orderBy()/.count()/.offset()`。

---

## 4. 认证 API 可用性与安全域名要求

### 4.1 可用性（对照任务假设逐条核实）

| 任务假设 | 实测/文档结论 |
|----------|----------------|
| `auth.signInWithPassword({username,password})` | ✅ **可用**。文档明确支持 username/email/phone 三选一 + password |
| `auth.getSession()` | ✅ **可用**。返回 `{ data:{ session }, error }`，判空用 `data.session` |
| `auth.updateUser({password})` | ❌ **不可用**。v3 文档原文：「**不支持更新密码**，更新密码请使用 `resetPasswordForEmail` / `resetPasswordForOld` / `reauthenticate`」 |
| 首登强制改密（旧密码=学号） | ✅ 用 **`auth.resetPasswordForOld({ old_password, new_password })`**（需已登录，校验旧密码后设新密码）。这是 P1a 首登改密的正确 API |

补充：
- `auth.getUser()` **不要用来判登录**；用 `data.session`（PG skill 明确要求）。
- `updateUser` 仅用于改昵称/头像/邮箱/手机号等资料。
- 登录态监听可用 `auth.onAuthStateChange((event, session) => ...)`。
- 用户名规则（影响「学号即账号」）：**5–24 位**，仅英文大小写/数字/`-_.:+@`，**须以字母或数字开头**，不支持中文。→ 学号须为 **≥5 位数字**；短学号（<5 位）或含非法字符会在预置账号/登录时失败。

### 4.2 Web 安全域名（CORS 白名单）——必做项

- 文档错误表：`permission_denied → cors permission denied, please check if {url} in your client {env} domains`，指引到 **环境配置 / 安全来源 / 安全域名**，**配置后约 10 分钟生效**。
- 匹配规则：**域名需完全匹配，包含协议与端口**；支持通配符（如 `*.example.com`）。
- **当前环境实读白名单**（`queryEnv(action=domains)`，只读）：

  | Domain | Type | 是否放行本地 |
  |--------|------|--------------|
  | `class-assistant-d6fw1gdce84d261e-1485216264.tcloudbaseapp.com` | USER | 否（仅线上静态托管自身） |
  | `weda/tcb.cloud.tencent.com(.cn/.com.cn)` 等 8 条 | SYSTEM | 否 |
  | `*.preview.cloudbase.net` / `*.webapps.tcloudbase.com` / `docs.cloudbase.net` / `tcb.tencentcloud.com` | SYSTEM | 否 |

  → **`hasAnyConfiguredLocalEntry: false`**：**本地 8899 未被覆盖**。

- **结论**：本地调试**仅 `localhost:8899` 不够**，需要显式添加，且建议同时加 `127.0.0.1:8899`（因为 `localhost` 与 `127.0.0.1` 是不同 origin，匹配要求全等）。线上用静态托管默认域名时**已自动在白名单内**，无需额外配置。
- 对应 `PLAN-P1.md` §2 **P1-0.3**：`manageEnv(action="addSecurityDomain", domains=["localhost:8899","127.0.0.1:8899"])`，添加后轮询 `queryEnv(action=domains)` 确认收敛。**注意：本报告未执行该写操作。**

---

## 5. 风险与建议

### 5.1 风险

| # | 风险 | 等级 | 对策 |
|---|------|------|------|
| R1 | 照抄文档示例用 `3.0.1` → **404，SDK 不加载**，后续 `cloudbase is not defined` | 高 | **锁定 `3.9.3`**（或 `3.4.0`~`3.9.3`）。生产建议固定版本，不用 `latest` |
| R2 | 误写 `app.database()` / `.where()`（传统模式习惯）→ 运行期报错或行为错 | 高 | 统一封装 `docs/src/cloud.js`，只导出 `app/auth/db(app.rdb())`；注释标注 postgREST 方法名 |
| R3 | 误用 `auth.updateUser({password})` → 改密静默失败 | 高 | 首登改密改用 `resetPasswordForOld({old_password,new_password})` |
| R4 | 本地 8899 未加安全域名 → 所有 SDK 请求 CORS 被拒 | 高 | P1-0.3 添加 `localhost:8899` + `127.0.0.1:8899`，等约 10 分钟 |
| R5 | 学号 <5 位或含非法字符 → 用户名不符合规则 | 中 | 预置账号（P1a a7）前先校验学号长度/字符集 |
| R6 | 把 API Key（service_role）当前端 `accessKey` → 越权泄露 | 高 | `config.js` 只放 **Publishable Key**；API Key 仅服务端/云函数 |
| R7 | 依赖 CDN 单点，国内 CDN 抖动 | 中 | 保持「加载失败不阻塞」的既有降级思路（像现有 ECharts/pdf.js 那样）；P4 可考虑自托管该 js |
| R8 | `cloudbase.full.js` 体积约 **843 KB**（未 gzip） | 低 | 可接受；若在意，用「内核+按需模块」方案（见 5.2 需实测） |

### 5.2 若 CDN 不可行时的后备方案（本报告结论：**暂不需要**）

| 后备 | 代价 |
|------|------|
| CDN 按需引入：`cloudbase.js` + `cloudbase.auth.js` + `cloudbase.storage.js` + `cloudbase.mysql.js` | 略省体积；但「mysql 模块是否稳定注册 rdb」**未实测**，风险高于全量包 |
| npm + esbuild/vite 打包成单文件，再静态托管 | **牺牲「零构建」**：引入 node_modules、构建步骤、CI；对纯静态项目是较大负担 | 

> 建议：**先用全量包**；只有在体积实成为问题时，才验证「按需引入」或考虑打包。

---

## 6. 证据链接

**官方文档（以文档为准，非记忆）**
- PG 模式初始化（含 CDN 全量/按需示例、初始化参数表）： https://docs.cloudbase.net/api-reference/webv3-pg/initialization.md
- PG 查询 `app.rdb()` / `.from().select()`： https://docs.cloudbase.net/api-reference/webv3-pg/postgresql/fetch.md
- 身份认证（`signInWithPassword` / `getSession` / `updateUser` 不支持改密 / `resetPasswordForOld` / 错误码表含 CORS 提示）： https://docs.cloudbase.net/api-reference/webv3-pg/authentication.md
- API Key 配置（Publishable Key ↔ `accessKey` 命名）： https://docs.cloudbase.net/api-reference/webv3-pg/api-key.md
- 跨域失败排查（域名含协议+端口精确匹配）： https://docs.cloudbase.net/service/cors
- 环境配置 · 安全来源： https://docs.cloudbase.net/envconfig/intro

**实测证据**
- npm registry：`@cloudbase/js-sdk` 最新版 = **3.9.3**（`https://registry.npmjs.org/@cloudbase/js-sdk`）
- CDN 探测（GET）：3.4.0/3.5.0/3.6.0/3.7.0/3.8.0/3.8.2/3.9.0/3.9.3/`latest` → 200；3.0.1/3.1.0/3.2.0/3.3.0 → 404
- 下载并检索包源码：`3.9.3` / `3.8.2` / `3.4.0` 均含 `rdb` 组件注册与 `e.rdb=xh(...)`；`name:"auth"` 组件注册存在；`publishableKey` 出现 0 次、`accessKey` 22 次
- 环境安全域名实读：`queryEnv(action="domains", envId="class-assistant-d6fw1gdce84d261e")` → 仅自身托管域名 + 系统条目，**无 localhost**

---

## 7. 未验证 / 不确定项

1. **浏览器端真实渲染与真实请求未跑**：无 publishableKey（P1-0.2 未做）、无 PG 表，无法执行登录/查询。所有结论为「静态 + 文档」级。
2. **`cloudbase.mysql.js` 是否独立注册 `rdb`**：源码含 `rdb` 字样，但未在浏览器验证 `app.rdb` 可用（仅作备选，主路径用全量包规避）。
3. **CORS 白名单生效时延**：文档称约 10 分钟，未实测。
4. **`region` 省略时的默认上海**：环境确为 ap-shanghai，但未实跑验证跨地域告警，建议显式传 `region:"ap-shanghai"`。
5. **`auth: { detectSessionInUrl: true }` 对账号密码登录是否必需**：文档归于 OAuth 场景；对 `signInWithPassword` 应无副作用但非必需，未实跑确认可省略。
6. **PG 写入时 `owner_id DEFAULT auth.uid()` 与前端 `.insert()` 的实际配合**：属 P1a 验证范围，本报告不覆盖。

---

## 8. 给主 Agent 的决策建议

1. **P1-0.1 判定：通过**。采用 `cloudbase.full.js` + **固定版本 `3.9.3`**（回退线 `3.4.0`）；**不要用文档示例的 `3.0.1`**（404）。零构建约束成立，无需 npm/esbuild。
2. **`docs/src/cloud.js`（P1a a2）**：按 §3 片段实现单例，导出 `app / auth / db(app.rdb())`；在文件头注释中写明「PG 用 `rdb().from().select()`，禁用 `.where()/.orderBy()/.count()`」。
3. **改密路径修正**：`PLAN-P1.md` / `ROADMAP.md` 中若隐含「`updateUser({password})`」，**请改为 `auth.resetPasswordForOld({old_password,new_password})`**；`updateUser` 只用于资料。
4. **P1-0.3 立即补做**：`manageEnv(addSecurityDomain, ["localhost:8899","127.0.0.1:8899"])`（本报告未执行写操作）；线上托管域名已自动放行。
5. **P1a 前置校验**：预置 30 个账号前，确认学号满足 **5–24 位、字母/数字开头、无中文**；否则登录链路会失败。
6. **安全红线**：`config.js` 只放 `envId + Publishable Key`；API Key 严禁进前端。

### 报告格式汇总

1. **产出文件路径**：`reports/P1-0-SDK验证.md`（未改业务文件）
2. **关键结论**：
   - CDN 全量包可用且含 `app.rdb()` 与 `app.auth`；**固定用 3.9.3**（3.0.1 示例已 404，最小可用 3.4.0）
   - 零构建满足；PG 用 `app.rdb().from(t).select("*")`，非 `app.database()`
   - `signInWithPassword`/`getSession` 可用；**改密不能用 `updateUser`**，用 `resetPasswordForOld`
   - 初始化字段是 **`accessKey`**（= Publishable Key），`publishableKey` 不是有效参数
   - 本地 8899 **必须**加入安全域名，当前白名单无 localhost
3. **未验证/不确定项**：见 §7（浏览器实跑、按需模块、CORS 时延、detectSessionInUrl 必需性等）
4. **决策建议**：见 §8（P1-0.1 通过 → 锁定 3.9.3 → 封装 cloud.js → 修正改密 API → 补做安全域名 → 校验学号规则）
