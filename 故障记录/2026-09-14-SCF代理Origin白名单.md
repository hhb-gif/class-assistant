# 2026-09-14 · AI 调用 403「origin not allowed」

## 病状

本地原型（`http://127.0.0.1:8898/docs/`）调用 AI 通知草稿失败：

```
ERR|22ms|API 返回 403: origin not allowed
```

22ms 快速失败，说明请求根本没到 DeepSeek，是代理层直接拒绝。

## 排查

1. `config.js` 复用 review-helper 的腾讯云 SCF 代理（`...tencentscf.com/api`），通道本身可用（RH 线上正常）
2. 读代理源码 `review-helper/worker/scf_app.js:60-63`：浏览器请求必须带 `Origin` 且命中 `ALLOWED_ORIGINS` 环境变量白名单，否则 403
3. 逐 origin 探测线上白名单（服务端直连探测，无 CORS 干扰）：

| Origin | 结果 |
|--------|------|
| `http://127.0.0.1:8899` | 200 ✅ |
| `http://localhost:8899` | 200 ✅ |
| `https://hhb-gif.github.io` | 200 ✅ |
| `http://127.0.0.1:8898` | 403 ❌ |
| `http://localhost:8898` | 403 ❌ |
| `http://127.0.0.1:5500` | 403 ❌ |

## 修复

班级管家本地端口从 **8898 改为 8899**（RH 本地开发端口，已在白名单内）。改后 AI 端到端验证通过：

```
OK|14ms|{"title":"家长会通知","category":"活动信息","timeLabel":"活动时间",
"deadline":"2026-09-23 15:00","location":"教学楼报告厅",...}
```

「下周三下午3点」被正确解析为 `2026-09-23 15:00`（当天 2026-09-14 周一）。

## 启示（正式部署必读）

SCF 代理白名单是**按 Origin 硬校验**的。班级管家正式部署时：

1. 把部署域名（如 GitHub Pages / Cloudflare Pages 域名）加入 SCF 的 `ALLOWED_ORIGINS` 环境变量，或在腾讯云控制台重新部署代理；
2. 或为班级管家单独部署一个代理（架构更独立，但要自行配置 `DEEPSEEK_API_KEY`）；
3. 本地开发**只能用 8899 端口**，换端口需同步加白名单。

已同步到 `CONTRACT.md` 第 0 节技术约束表。
