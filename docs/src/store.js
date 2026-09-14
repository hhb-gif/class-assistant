// 数据层（CloudBase PG 版）：表 CRUD + 驼峰↔下划线映射 + 成员名同步缓存
// 契约：CONTRACT.md §3/§4（保持方法名与调用形态兼容），ROADMAP §4.2/§4.3，PLAN-P1 §3 a3。
// 列名唯一真相：cloudbase/migrations/*.sql（务必按列名映射）。
//
// ⚠️ PG 模式禁用的 NoSQL 方法名（务必不要用）：
//   禁用 app.database() / .where() / .orderBy() / .count() / .offset()；
//   只用 app.rdb().from(t).select() / .eq() / .match() / .order() / .range() / .insert() / .update() / .delete()。
//
// 异步约定：除 memberName() / settings() / uid() 保持同步外，其余方法均返回 Promise。
// 集合↔表（列名唯一真相：cloudbase/migrations/*.sql）：
//   P1a：members / users / notices / favorites / subscribers
//   P1b：subjects / exams / scores / surveys / responses（→ survey_responses）
//   留言：messages（→ messages）
// 嵌套字段：surveys.questions、responses.answers 以 jsonb 原样透传（无 mapping）。
window.CA = window.CA || {};

CA.store = (function () {
  // 集合白名单 → 表名 + id 前缀（前缀沿用 CONTRACT §4 的 uid 习惯）
  var COLLS = {
    members:     { table: "members",         prefix: "m",  idCol: "id"  },
    users:       { table: "users",           prefix: "u",  idCol: "uid" },  // users 主键是 uid（= auth.uid()），无 id 列
    notices:     { table: "notices",         prefix: "n",  idCol: "id"  },
    favorites:   { table: "favorites",       prefix: "f",  idCol: "id"  },
    subscribers: { table: "subscribers",     prefix: "sb", idCol: "id"  },
    // ---- P1b：成绩 ----
    subjects:    { table: "subjects",        prefix: "s",  idCol: "id"  },
    exams:       { table: "exams",           prefix: "e",  idCol: "id"  },
    scores:      { table: "scores",          prefix: "sc", idCol: "id"  },
    // ---- P1b：信息收集 ----
    surveys:     { table: "surveys",         prefix: "sv", idCol: "id"  },
    responses:   { table: "survey_responses", prefix: "rs", idCol: "id"  },
    // ---- 留言（迁移 20260914210000_add_messages.sql）----
    messages:    { table: "messages",         prefix: "msg", idCol: "id"  }
  };

  // 驼峰 → 下划线（列名以迁移文件为准）；未列出的字段原样透传
  //   注意：subjects.order → sort_order（ORDER 是 SQL 保留字）；
  //         exams.date → exam_date；surveys.desc → description（DESC 是保留字）。
  var MAPS = {
    members:     { studentNo: "student_no", createdAt: "created_at" },
    users:       { memberId: "member_id", mustChangePassword: "must_change_password", displayName: "display_name", createdAt: "created_at" },
    notices:     { timeLabel: "time_label", endTime: "end_time", publisherId: "publisher_id", createdAt: "created_at", updatedAt: "updated_at" },
    favorites:   { userId: "user_id", noticeId: "notice_id", createdAt: "created_at" },
    subscribers: { userId: "user_id", createdAt: "created_at" },
    subjects:    { fullScore: "full_score", order: "sort_order" },
    exams:       { date: "exam_date", createdAt: "created_at" },
    scores:      { examId: "exam_id", subjectId: "subject_id", memberId: "member_id" },
    surveys:     { desc: "description", createdBy: "created_by", createdAt: "created_at", updatedAt: "updated_at" },
    responses:   { surveyId: "survey_id", memberId: "member_id", createdAt: "created_at" },
    messages:    { fromUid: "from_uid", fromMemberId: "from_member_id", createdAt: "created_at", readAt: "read_at", replyContent: "reply_content", replyAt: "reply_at" }
  };

  // 反向映射：下划线 → 驼峰（模块加载时构建一次）
  var REVS = {};
  (function buildRevs() {
    for (var coll in MAPS) {
      if (!has(MAPS, coll)) continue;
      REVS[coll] = {};
      var m = MAPS[coll];
      for (var camel in m) { if (has(m, camel)) REVS[coll][m[camel]] = camel; }
    }
  })();

  // 本地偏好键（设备级，非云端）；已移除 currentUserId（身份改由登录会话决定）
  var SETTINGS_KEY = "ca_settings";

  // ---------- 基础工具 ----------
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function nowIso() { return new Date().toISOString(); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function toArray(d) {
    if (d == null) return [];
    return Array.isArray(d) ? d : [d];
  }

  function errMsg(e) {
    if (!e) return "未知错误";
    return e.message || e.msg || e.code || String(e);
  }

  // 解包 postgREST 风格返回值 { data, error }；兼容直接返回数组的实现
  function unwrap(res, what) {
    if (res && res.error) throw new Error(what + "：" + errMsg(res.error));
    if (res && typeof res === "object" && has(res, "data")) return res.data;
    return res;
  }

  // 统一错误包装：保证上层拿到的是可读中文 Error
  function wrapErr(what, e) {
    if (e && e.__ca) return e;
    var err = new Error(what + "失败：" + errMsg(e));
    err.__ca = true;
    return err;
  }

  function run(what, fn) {
    var p;
    try { p = Promise.resolve(fn()); }
    catch (e) { return Promise.reject(wrapErr(what, e)); }
    return p.catch(function (e) { throw wrapErr(what, e); });
  }

  // ---------- 字段映射 ----------
  function toRow(coll, obj) {
    var out = {};
    var map = MAPS[coll] || {};
    for (var k in obj) {
      if (!has(obj, k)) continue;
      var v = obj[k];
      if (v === undefined) continue;
      out[map[k] || k] = v;
    }
    return out;
  }

  function fromRow(coll, row) {
    var out = {};
    var rev = REVS[coll] || {};
    for (var k in row) {
      if (!has(row, k)) continue;
      out[rev[k] || k] = row[k];
    }
    return out;
  }

  // ---------- 云端连接守卫 ----------
  function tableOf(coll) {
    var c = COLLS[coll];
    if (!c) {
      throw new Error("未支持的数据集合：" + coll +
        "（支持 members/users/notices/favorites/subscribers/subjects/exams/scores/surveys/responses/messages）");
    }
    return c.table;
  }

  // 主键列名：users 用 uid，其余用 id（迁移文件为准）
  function idColOf(coll) { return (COLLS[coll] && COLLS[coll].idCol) || "id"; }

  function dbClient() {
    if (!window.CA.cloud) throw new Error("cloud.js 未加载：无法访问云端数据");
    CA.cloud.ensure(); // 未就绪时抛出可读错误
    return CA.cloud.db;
  }

  // ---------- 成员名同步缓存（供 memberName 同步调用） ----------
  var _memberCache = null;     // members 数组（camel 形态）
  var _memberById = {};        // id → member

  function loadMembers() {
    return dbClient().from("members").select("*").then(function (res) {
      var rows = toArray(unwrap(res, "读取 members")).map(function (r) { return fromRow("members", r); });
      rows.sort(function (a, b) { return String(a.studentNo || "").localeCompare(String(b.studentNo || "")); });
      _memberCache = rows;
      _memberById = {};
      rows.forEach(function (m) { if (m && m.id != null) _memberById[m.id] = m; });
      return rows;
    });
  }

  function ensureMembers() {
    if (_memberCache) return Promise.resolve(_memberCache);
    return loadMembers();
  }

  // ---------- 生命周期 ----------
  var _lastErr = null;
  function lastError() { return _lastErr; }

  // 预加载 members 进内存缓存（memberName 需同步可用）。
  // 容错：cloud.js/SDK 未就绪时返回 false（不抛），数据类方法仍会抛出可读错误。
  function init() {
    return run("初始化", function () {
      if (!window.CA.cloud || !CA.cloud.ready()) return false;
      return loadMembers().then(function () { return true; });
    }).catch(function (e) { _lastErr = e; return false; });
  }

  // 清本地偏好 + 刷新成员缓存。注意：云端业务数据不在前端重置（RLS 限制，需服务端/云函数）。
  function reset() {
    return run("重置", function () {
      try { window.localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* 忽略存储异常 */ }
      _memberCache = null; _memberById = {};
      if (!window.CA.cloud || !CA.cloud.ready()) return false;
      return loadMembers().then(function () { return true; });
    });
  }

  // ---------- 集合读 ----------
  function get(coll) {
    return run("读取 " + coll, function () {
      if (coll === "members") {
        return ensureMembers().then(function () { return clone(_memberCache || []); });
      }
      return dbClient().from(tableOf(coll)).select("*").then(function (res) {
        return toArray(unwrap(res, "读取 " + coll)).map(function (r) { return fromRow(coll, r); });
      });
    });
  }

  function find(coll, id) {
    return run("查询 " + coll, function () {
      if (coll === "members") {
        return ensureMembers().then(function () { return clone(_memberById[id] || null); });
      }
      return dbClient().from(tableOf(coll)).select("*").eq(idColOf(coll), id).then(function (res) {
        var rows = toArray(unwrap(res, "查询 " + coll));
        return rows.length ? fromRow(coll, rows[0]) : null;
      });
    });
  }

  function query(coll, fn) {
    return run("筛选 " + coll, function () {
      return get(coll).then(function (arr) {
        return arr.filter(typeof fn === "function" ? fn : function () { return true; });
      });
    });
  }

  // ---------- 集合写 ----------
  // favorites 有唯一约束 (user_id, notice_id)：冲突时幂等返回既有记录
  function isDuplicate(e) {
    if (!e) return false;
    if (e.code === "23505") return true;
    return /duplicate key|unique constraint|already exists/i.test(e.message || "");
  }

  function findFavoriteByRow(row) {
    var q = dbClient().from("favorites").select("*").eq("notice_id", row.notice_id);
    if (row.user_id) q = q.eq("user_id", row.user_id);
    return q.then(function (res) {
      var rows = toArray(unwrap(res, "读取 favorites"));
      return rows.length ? fromRow("favorites", rows[0]) : null;
    });
  }

  function add(coll, obj) {
    return run("新增 " + coll, function () {
      tableOf(coll);
      var item = clone(obj || {});
      if (coll !== "users" && !item.id) item.id = uid(COLLS[coll].prefix);
      var row = toRow(coll, item);
      if ((coll === "notices" || coll === "surveys") && !row.updated_at) row.updated_at = nowIso();

      if (coll === "favorites") {
        return dbClient().from("favorites").insert(row).then(function (res) {
          if (res && res.error) {
            if (isDuplicate(res.error)) return findFavoriteByRow(row);
            throw new Error("新增 favorites：" + errMsg(res.error));
          }
          return find(coll, item.id);
        });
      }

      return dbClient().from(tableOf(coll)).insert(row).then(function (res) {
        unwrap(res, "新增 " + coll);
        if (coll === "members") { _memberCache = null; _memberById = {}; }
        return find(coll, item.id);
      });
    });
  }

  function update(coll, id, patch) {
    return run("更新 " + coll, function () {
      tableOf(coll);
      var row = toRow(coll, clone(patch || {}));
      if (coll === "notices" || coll === "surveys") row.updated_at = nowIso();
      return dbClient().from(tableOf(coll)).update(row).eq(idColOf(coll), id).then(function (res) {
        unwrap(res, "更新 " + coll);
        if (coll === "members") {
          _memberCache = null;
          return ensureMembers().then(function () { return clone(_memberById[id] || null); });
        }
        return find(coll, id);
      });
    });
  }

  function remove(coll, id) {
    return run("删除 " + coll, function () {
      tableOf(coll);
      return dbClient().from(tableOf(coll)).delete().eq(idColOf(coll), id).then(function (res) {
        unwrap(res, "删除 " + coll);
        if (coll === "members") { _memberCache = null; _memberById = {}; }
        return true;
      });
    });
  }

  // ---------- 本地设置（设备级偏好，仍用 localStorage） ----------
  function settings() {
    var def = { aiEnabled: true, aiModel: (window.CA_CONFIG && CA_CONFIG.llm && CA_CONFIG.llm.model) || "" };
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return def;
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object") return def;
      return { aiEnabled: s.aiEnabled !== false, aiModel: s.aiModel || def.aiModel };
    } catch (e) { return def; }
  }

  function setSettings(patch) {
    try {
      var cur = settings();
      var p = clone(patch || {});
      for (var k in p) { if (has(p, k)) cur[k] = p[k]; }
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(cur));
      return clone(cur);
    } catch (e) { throw new Error("保存本地偏好失败：" + errMsg(e)); }
  }

  // ---------- 标识 ----------
  // "prefix_" + 时间戳36进制 + 随机4位（base36），与旧实现保持一致
  function uid(prefix) {
    var rand = Math.floor(Math.random() * 1679616).toString(36);
    while (rand.length < 4) rand = "0" + rand;
    return (prefix || "id") + "_" + Date.now().toString(36) + rand;
  }

  // 同步查成员姓名（依赖 init()/get("members") 预加载的缓存；未命中返回 ""）
  function memberName(memberId) {
    if (memberId == null) return "";
    var m = _memberById[memberId];
    return m ? (m.name || "") : "";
  }

  // ---------- 共享小工具（CA.util，保持原样） ----------
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
    // 智能时间：今天/明天/昨天 + HH:mm；今年内 MM-DD HH:mm；跨年 YYYY-MM-DD
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
    memberName: memberName,
    lastError: lastError
  };
})();
