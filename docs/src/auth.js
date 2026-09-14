// 权限层：本地身份切换模拟（无真实鉴权）
// 契约：CONTRACT.md 第 5 节。依赖 CA.store，不依赖其他业务模块。
window.CA = window.CA || {};

CA.auth = (function () {
  // 权限动作表：action → 允许的角色
  var PERMS = {
    "notice.publish": ["admin", "superAdmin"],
    "notice.manageAll": ["superAdmin"],
    "score.edit": ["admin", "superAdmin"],
    "member.manage": ["superAdmin"],
    "settings.ai": ["superAdmin"]
  };

  function list() {
    return CA.store.get("users");
  }

  // 当前 user：settings.currentUserId 对应；缺失则回退 users[0]
  function current() {
    var users = list();
    if (!users.length) return null;
    var uid = CA.store.settings().currentUserId;
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id === uid) return users[i];
    }
    return users[0];
  }

  function roleOf() {
    var u = current();
    return u && u.role ? u.role : "";
  }

  // 切换身份：仅当 userId 存在于 users 才写入
  function switchTo(userId) {
    var users = list();
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id === userId) {
        CA.store.setSettings({ currentUserId: userId });
        return true;
      }
    }
    return false;
  }

  function isAdmin() {
    var r = roleOf();
    return r === "admin" || r === "superAdmin";
  }

  function isSuperAdmin() {
    return roleOf() === "superAdmin";
  }

  function can(action) {
    var allow = PERMS[action];
    if (!allow) return false;
    return allow.indexOf(roleOf()) >= 0;
  }

  return {
    current: current,
    switchTo: switchTo,
    list: list,
    isAdmin: isAdmin,
    isSuperAdmin: isSuperAdmin,
    can: can
  };
})();
