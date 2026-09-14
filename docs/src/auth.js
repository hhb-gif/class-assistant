// 认证与权限层：基于 CloudBase Auth 真实登录会话 + users 表角色
// 契约：CONTRACT.md §5（动作名兼容）；ROADMAP §4.3；PLAN-P1 §3 a4；reports/P1-0-SDK验证.md 权威 API 结论。
//
// 变更要点：
//   1) current() / list() 等改为异步（返回 Promise）；isAdmin()/can() 保持同步（读最近一次 load 的角色缓存，未加载→最小权限 deny）。
//   2) 身份不再由 settings.currentUserId 决定，改由 auth.getSession() 的 session.user.id（= uid）。
//   3) 改密必须用 resetPasswordForOld({old_password,new_password})；v3 的 updateUser({password}) 不可用。
//   4) switchTo(userId) 为本地演示遗留，已被真实登录取代：调用会抛错（保留名字以显式暴露调用点）。
// 依赖：CA.cloud（会话/认证）、CA.store（读 users 表 / 成员名缓存）。
window.CA = window.CA || {};

CA.auth = (function () {
  // 权限动作表：action → 允许的角色（沿用 CONTRACT §5）
  var PERMS = {
    "notice.publish": ["admin", "superAdmin"],
    "notice.manageAll": ["superAdmin"],
    "score.edit": ["admin", "superAdmin"],
    "member.manage": ["superAdmin"],
    "settings.ai": ["superAdmin"]
  };

  var _me = null;       // 归一化后的当前用户（含 id/role/memberId/name/studentNo/mustChangePassword）
  var _loaded = false;  // 是否已完成过一次加载（决定 can()/isAdmin() 的默认 deny 行为）

  function errMsg(e) {
    if (!e) return "未知错误";
    return e.message || e.msg || e.code || String(e);
  }

  function toArray(d) {
    if (d == null) return [];
    return Array.isArray(d) ? d : [d];
  }

  function unwrap(res, what) {
    if (res && res.error) throw new Error(what + "：" + errMsg(res.error));
    if (res && typeof res === "object" && Object.prototype.hasOwnProperty.call(res, "data")) return res.data;
    return res;
  }

  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  // ---------- 会话 ----------
  function guard() {
    if (!window.CA.cloud) throw new Error("cloud.js 未加载：无法获取登录会话");
    CA.cloud.ensure();
  }

  // 返回当前会话对象（未登录返回 null）
  function session() {
    return Promise.resolve().then(function () {
      guard();
      return CA.cloud.auth.getSession();
    }).then(function (res) {
      if (res && res.error && !(res.data && res.data.session)) {
        throw new Error("获取登录会话失败：" + errMsg(res.error));
      }
      var s = res && res.data ? res.data.session : null;
      return s || null;
    }).catch(function (e) { throw new Error((e && e.message) || errMsg(e)); });
  }

  // ---------- users 表 → 归一化用户对象 ----------
  // 兼容旧形态：{ id, name, role, title, studentNo }，并补充 memberId / uid / mustChangePassword
  function normalize(row, byId) {
    var memberId = row.member_id || null;
    var m = (memberId && byId && byId[memberId]) ? byId[memberId] : null;
    return {
      id: row.uid,
      uid: row.uid,
      memberId: memberId,
      role: row.role || "",
      name: row.display_name || (m ? (m.name || "") : "") || "",
      studentNo: m ? (m.studentNo || "") : "",
      mustChangePassword: !!row.must_change_password,
      title: ""
    };
  }

  function fetchUserRow(uid) {
    return CA.cloud.db.from("users").select("*").eq("uid", uid).then(function (res) {
      var rows = toArray(unwrap(res, "读取用户资料"));
      return rows.length ? rows[0] : null;
    });
  }

  function memberIndex() {
    if (!(window.CA.store && CA.store.get)) return Promise.resolve({});
    return CA.store.get("members").then(function (members) {
      var byId = {};
      (members || []).forEach(function (m) { if (m && m.id != null) byId[m.id] = m; });
      return byId;
    }).catch(function () { return {}; }); // 名单读取失败不阻断身份判定
  }

  // 加载当前身份（写 _me 缓存）。未登录时 _me=null。
  function load() {
    return session().then(function (s) {
      if (!s || !s.user || !s.user.id) { _me = null; _loaded = true; return null; }
      var uid = s.user.id;
      return fetchUserRow(uid).then(function (row) {
        return memberIndex().then(function (byId) {
          if (!row) {
            // 已登录但 users 表无对应行：角色未知 → 最小权限（deny）
            _me = { id: uid, uid: uid, memberId: null, role: "", name: "", studentNo: "", mustChangePassword: false, title: "", unknown: true };
          } else {
            _me = normalize(row, byId);
          }
          _loaded = true;
          return _me;
        });
      });
    }).catch(function (e) {
      _loaded = true;
      throw new Error((e && e.message) || errMsg(e));
    });
  }

  // ---------- 对外：身份 ----------
  // 当前用户对象（未登录 null）；每次调用重新读取会话，返回深拷贝
  function current() {
    return load().then(function () { return _me ? clone(_me) : null; });
  }

  // 可切换/可见的用户列表：管理员返回全部（需 RLS 放行），普通用户仅返回自己
  function list() {
    return load().then(function (me) {
      if (!me) return [];
      if (!isAdmin()) return [clone(me)];
      return CA.cloud.db.from("users").select("*").then(function (res) {
        var rows = toArray(unwrap(res, "读取用户列表"));
        return memberIndex().then(function (byId) {
          return rows.map(function (r) { return normalize(r, byId); });
        });
      });
    });
  }

  // ---------- 对外：登录 / 登出 / 改密 ----------
  function login(username, password) {
    return Promise.resolve().then(function () {
      guard();
      return CA.cloud.auth.signInWithPassword({
        username: String(username == null ? "" : username),
        password: String(password == null ? "" : password)
      });
    }).then(function (res) {
      if (res && res.error) throw new Error("登录失败：" + errMsg(res.error));
      return load();
    });
  }

  function logout() {
    return Promise.resolve().then(function () {
      if (!window.CA.cloud || !CA.cloud.ready()) { _me = null; _loaded = true; return true; }
      return CA.cloud.auth.signOut().then(function (res) {
        if (res && res.error) throw new Error("退出登录失败：" + errMsg(res.error));
        _me = null; _loaded = true;
        return true;
      });
    });
  }

  function changePassword(oldPwd, newPwd) {
    return Promise.resolve().then(function () {
      guard();
      return CA.cloud.auth.resetPasswordForOld({
        old_password: String(oldPwd == null ? "" : oldPwd),
        new_password: String(newPwd == null ? "" : newPwd)
      });
    }).then(function (res) {
      if (res && res.error) throw new Error("修改密码失败：" + errMsg(res.error));
      // 尽力同步 must_change_password 标志（列级授权允许本人更新该列）；失败不影响改密结果
      if (_me && _me.id && window.CA.store && CA.store.update) {
        CA.store.update("users", _me.id, { mustChangePassword: false }).catch(function () {});
      }
      if (_me) _me.mustChangePassword = false;
      return true;
    });
  }

  // ---------- 对外：权限（同步，读缓存角色） ----------
  function roleOf() { return _me && _me.role ? _me.role : ""; }

  function isAdmin() {
    var r = roleOf();
    return r === "admin" || r === "superAdmin";
  }

  function isSuperAdmin() { return roleOf() === "superAdmin"; }

  // 角色未知（未登录 / 未加载 / users 无行）时按最小权限 deny
  function can(action) {
    var allow = PERMS[action];
    if (!allow) return false;
    var r = roleOf();
    if (!r) return false;
    return allow.indexOf(r) >= 0;
  }

  // ---------- 兼容：switchTo 已被真实登录取代 ----------
  function switchTo() {
    throw new Error("switchTo 已废弃：身份由真实登录会话决定，请改用 CA.auth.login(学号, 密码)");
  }

  return {
    // 身份（异步）
    current: current,
    list: list,
    load: load,
    session: session,
    login: login,
    logout: logout,
    changePassword: changePassword,
    // 权限（同步）
    isAdmin: isAdmin,
    isSuperAdmin: isSuperAdmin,
    can: can,
    // 兼容占位
    switchTo: switchTo
  };
})();
