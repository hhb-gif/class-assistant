// 云端客户端单例：封装 @cloudbase/js-sdk v3（CDN 全量包，全局 window.cloudbase）
// 契约：ROADMAP §4、PLAN-P1 §3 a2、reports/P1-0-SDK验证.md（权威结论）。
//
// ⚠️ PG 模式方法名（禁用 NoSQL 的 app.database() 体系）：
//   数据入口 = app.rdb()，查询 = .from(t).select("*")；
//   条件 = .eq()/.match()，排序 = .order()，分页 = .range()；
//   禁用： .where() / .orderBy() / .count() / .offset()（这些是文档型/NoSQL 习惯，PG 下不存在）。
//
// 依赖：① CDN 先加载 cloudbase.full.js（window.cloudbase）；② config.js 提供 window.CA_CONFIG。
// 初始化字段是 accessKey（= 控制台 Publishable Key，前端公开）；真实 API Key 绝不进前端。
window.CA = window.CA || {};

CA.cloud = (function () {
  var _app = null;
  var _db = null;
  var _auth = null;
  var _ready = false;
  var _err = null;

  // 初始化单例。幂等：已初始化直接返回。
  // SDK 缺失 / 配置缺失 / 初始化异常时：不抛异常，置 _ready=false 并记录 _err。
  function init() {
    if (_app) return _app;
    try {
      if (typeof window.cloudbase === "undefined" || !window.cloudbase ||
          typeof window.cloudbase.init !== "function") {
        _err = new Error("CloudBase SDK 未加载：请先引入 cloudbase.full.js（CDN 失败或被拦截）");
        _ready = false;
        return null;
      }
      var cfg = window.CA_CONFIG || {};
      if (!cfg.envId) {
        _err = new Error("缺少 CA_CONFIG.envId，无法初始化云端（请检查 config.js）");
        _ready = false;
        return null;
      }
      _app = window.cloudbase.init({
        env: cfg.envId,
        accessKey: cfg.publishableKey,
        auth: { detectSessionInUrl: true }
      });
      _db = _app.rdb();     // PostgreSQL 链式 API（不是 app.database()）
      _auth = _app.auth;    // 认证入口
      _ready = true;
      _err = null;
      return _app;
    } catch (e) {
      _err = new Error("云端初始化失败：" + ((e && e.message) || e));
      _ready = false;
      _app = null; _db = null; _auth = null;
      return null;
    }
  }

  // 是否就绪（首次调用会尝试初始化）
  function ready() {
    if (!_ready) init();
    return !!_ready;
  }

  // 最近一次初始化错误（无错返回 null）
  function lastError() { return _err; }

  // 调用守卫：未就绪时抛出可读中文错误（供上层 toast，不会静默失败）
  function ensure() {
    if (!ready()) {
      throw new Error("云端未就绪：" + ((_err && _err.message) || "未知原因"));
    }
  }

  var api = { init: init, ready: ready, ensure: ensure, lastError: lastError };

  // app / db / auth 以 getter 暴露：首次访问自动尝试初始化；SDK 缺失时返回 null（不抛未捕获异常）。
  Object.defineProperty(api, "app", { enumerable: true, get: function () { init(); return _app; } });
  Object.defineProperty(api, "db", { enumerable: true, get: function () { init(); return _db; } });
  Object.defineProperty(api, "auth", { enumerable: true, get: function () { init(); return _auth; } });

  return api;
})();
