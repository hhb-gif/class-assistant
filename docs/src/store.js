// 数据层：localStorage 单键（ca_db）存储 + 集合 CRUD
// 契约：CONTRACT.md 第 3、4 节。所有读操作返回深拷贝，外部改动不影响内存/存储。
window.CA = window.CA || {};

CA.store = (function () {
  var KEY = "ca_db";
  var VERSION = 1;
  // 允许操作的集合白名单（与契约第 3 节数据模型一致）
  var COLLS = ["users", "members", "notices", "favorites", "subjects", "exams", "scores", "surveys", "responses"];
  // 集合 → id 前缀
  var PREFIX = { users: "u", members: "m", notices: "n", favorites: "f", subjects: "s", exams: "e", scores: "sc", surveys: "sv", responses: "rs" };

  // ---------- 基础工具 ----------
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function nowIso() { return new Date().toISOString(); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function ls() { return window.localStorage; }

  // 读取原始 DB（损坏/不存在返回 null）
  function readDb() {
    try {
      var raw = ls().getItem(KEY);
      if (!raw) return null;
      var db = JSON.parse(raw);
      if (!db || typeof db !== "object") return null;
      return db;
    } catch (e) { return null; }
  }

  function writeDb(db) {
    try { ls().setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; }
  }

  // 取集合数组；非法集合返回 null（同时兜底补齐缺失集合）
  function collOf(db, coll) {
    if (!db || COLLS.indexOf(coll) < 0) return null;
    if (!Array.isArray(db[coll])) db[coll] = [];
    return db[coll];
  }

  // ---------- 生命周期 ----------
  // 无 ca_db 时写种子；已有且 version 相符则不动；版本不符/损坏则重置。幂等。
  function init() {
    var db = readDb();
    if (db && db.version === VERSION) return clone(db);
    // 需要（重新）播种：seed.js 未就绪时先安全跳过，待其加载后再次调用 init
    if (!(window.CA && CA.seed && typeof CA.seed.build === "function")) return null;
    var fresh = CA.seed.build();
    writeDb(fresh);
    return clone(fresh);
  }

  // 确保拿到可用 DB；若缺失/版本不符则尝试初始化
  function requireDb() {
    var db = readDb();
    if (!db || db.version !== VERSION) {
      init();
      db = readDb();
    }
    return db;
  }

  function reset() {
    try { ls().removeItem(KEY); } catch (e) { /* 忽略存储异常 */ }
    return init();
  }

  // ---------- 集合读 ----------
  function get(coll) {
    var db = requireDb();
    if (!db) return [];
    var arr = collOf(db, coll);
    return arr ? clone(arr) : [];
  }

  function find(coll, id) {
    var arr = get(coll);
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) return arr[i];
    }
    return null;
  }

  function query(coll, fn) {
    var arr = get(coll);
    try {
      return arr.filter(typeof fn === "function" ? fn : function () { return true; });
    } catch (e) { return []; }
  }

  // ---------- 集合写 ----------
  function add(coll, obj) {
    var db = requireDb();
    var arr = collOf(db, coll);
    if (!arr) throw new Error("未知集合: " + coll);
    var item = clone(obj || {});
    var ts = nowIso();
    if (!item.id) item.id = uid(PREFIX[coll] || "x");
    if (!item.createdAt) item.createdAt = ts;
    item.updatedAt = ts;
    arr.push(item);
    writeDb(db);
    return clone(item);
  }

  function update(coll, id, patch) {
    var db = requireDb();
    var arr = collOf(db, coll);
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) {
        var p = clone(patch || {});
        for (var k in p) { if (has(p, k)) arr[i][k] = p[k]; }
        arr[i].updatedAt = nowIso();
        writeDb(db);
        return clone(arr[i]);
      }
    }
    return null;
  }

  function remove(coll, id) {
    var db = requireDb();
    var arr = collOf(db, coll);
    if (!arr) return false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) {
        arr.splice(i, 1);
        writeDb(db);
        return true;
      }
    }
    return false;
  }

  // ---------- 设置 ----------
  function settings() {
    var db = requireDb();
    return clone((db && db.settings) || {});
  }

  function setSettings(patch) {
    var db = requireDb();
    if (!db) return null;
    if (!db.settings || typeof db.settings !== "object") db.settings = {};
    var p = clone(patch || {});
    for (var k in p) { if (has(p, k)) db.settings[k] = p[k]; }
    writeDb(db);
    return clone(db.settings);
  }

  // ---------- 标识 ----------
  // "prefix_" + 时间戳36进制 + 随机4位（base36）
  function uid(prefix) {
    var rand = Math.floor(Math.random() * 1679616).toString(36);
    while (rand.length < 4) rand = "0" + rand;
    return (prefix || "id") + "_" + Date.now().toString(36) + rand;
  }

  function memberName(memberId) {
    var m = find("members", memberId);
    return m ? (m.name || "") : "";
  }

  // ---------- 共享小工具（CA.util） ----------
  var util = (function () {
    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    function toDate(v) {
      if (v == null || v === "") return null;
      var d = (v instanceof Date) ? v : new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    function fmtDate(v) {
      var d = toDate(v);
      return d ? d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) : "";
    }
    function fmtTime(v) {
      var d = toDate(v);
      return d ? pad2(d.getHours()) + ":" + pad2(d.getMinutes()) : "";
    }
    function fmtDateTime(v) {
      var d = toDate(v);
      return d ? fmtDate(d) + " " + fmtTime(d) : "";
    }
    // 相对时间：刚刚 / N分钟前 / N小时前 / N天前（未来用「后」）
    function relTime(v, now) {
      var d = toDate(v);
      if (!d) return "";
      var n = now == null ? Date.now() : (now instanceof Date ? now.getTime() : now);
      var diff = n - d.getTime();
      var future = diff < 0;
      var sec = Math.floor(Math.abs(diff) / 1000);
      if (sec < 60) return "刚刚";
      var min = Math.floor(sec / 60);
      if (min < 60) return min + "分钟" + (future ? "后" : "前");
      var hour = Math.floor(min / 60);
      if (hour < 24) return hour + "小时" + (future ? "后" : "前");
      var day = Math.floor(hour / 24);
      if (day < 30) return day + "天" + (future ? "后" : "前");
      return fmtDate(d);
    }
    // 智能时间（默认时间展示）：今天/明天/昨天 + HH:mm；今年内 MM-DD HH:mm；跨年 YYYY-MM-DD
    function fmtSmart(v, now) {
      var d = toDate(v);
      if (!d) return "";
      var n = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
      if (isNaN(n.getTime())) n = new Date();
      var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      var n0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
      var diffDays = Math.round((d0 - n0) / 86400000);
      var hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
      if (diffDays === 0) return "今天 " + hm;
      if (diffDays === 1) return "明天 " + hm;
      if (diffDays === -1) return "昨天 " + hm;
      if (d.getFullYear() === n.getFullYear()) return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + hm;
      return fmtDate(d);
    }
    // 区间时间：同一天省略重复日期（06-24 19:00 ~ 20:30）
    function fmtRange(a, b) {
      var da = toDate(a), db = toDate(b);
      if (!da) return "";
      if (!db) return fmtSmart(a);
      var sameDay = da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
      return fmtSmart(a) + " ~ " + (sameDay ? fmtTime(db) : fmtSmart(db));
    }
    return { pad2: pad2, fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, fmtSmart: fmtSmart, fmtRange: fmtRange, relTime: relTime, clone: clone };
  })();

  CA.util = util;

  return {
    init: init,
    get: get,
    find: find,
    query: query,
    add: add,
    update: update,
    remove: remove,
    settings: settings,
    setSettings: setSettings,
    reset: reset,
    uid: uid,
    memberName: memberName
  };
})();

// 文件加载末尾自动初始化。若 seed.js 尚未加载，init 会安全跳过；
// seed.js 加载末尾会再次触发 init，从而完成首次播种。
try { CA.store.init(); } catch (e) { /* 存储不可用时静默 */ }
