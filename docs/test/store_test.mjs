// Agent A 自测：契约第 10 节
// 运行：node docs/test/store_test.mjs
import { createRequire } from "node:module";

// ---------- 浏览器替身：window + 内存版 localStorage ----------
global.window = global;

const _ls = Object.create(null);
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem: function (k, v) { _ls[k] = String(v); },
  removeItem: function (k) { delete _ls[k]; },
  clear: function () { for (const k in _ls) delete _ls[k]; },
  key: function (i) { return Object.keys(_ls)[i] || null; },
  get length() { return Object.keys(_ls).length; }
};

const require = createRequire(import.meta.url);
require("../src/store.js");
require("../src/seed.js");
require("../src/auth.js");

// ---------- 断言小工具 ----------
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  \u2713 " + msg); }
  else { fail++; console.log("  \u2717 " + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + "（期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a) + "）");
}
function section(t) { console.log("\n[" + t + "]"); }

const CA = global.CA;

// ---------- 1. seed 确定性 ----------
section("seed 确定性");
const s1 = CA.seed.build();
const s2 = CA.seed.build();
eq(JSON.stringify(s1) === JSON.stringify(s2), true, "两次 build JSON 序列化完全一致");
eq(s1.version, 1, "version = 1");
eq(s1.members.length, 30, "members 恰好 30 人");
eq(s1.scores.length, 450, "scores 恰好 450 条");
eq(s1.users.length, 5, "users 5 个");
eq(s1.notices.length, 8, "notices 8 条");

// ---------- 2. init 幂等 ----------
section("init 幂等");
CA.store.init();
const snap1 = localStorage.getItem("ca_db");
CA.store.init();
const snap2 = localStorage.getItem("ca_db");
ok(snap1 === snap2 && !!snap1, "连续两次 init 数据不变");
ok(snap1 && snap1.length > 0, "ca_db 已写入 localStorage");

// ---------- 3. 数据规格 ----------
section("数据规格");
eq(CA.store.get("members").length, 30, "store members 30 人");
eq(CA.store.get("scores").length, 450, "store scores 450 条");
eq(CA.store.get("subjects").length, 5, "subjects 5 科");
eq(CA.store.get("exams").length, 3, "exams 3 次");
eq(CA.store.get("favorites").length, 2, "favorites 2 条");

const users = CA.store.get("users");
const byRole = {};
users.forEach(function (u) { byRole[u.role] = (byRole[u.role] || 0) + 1; });
eq(byRole.superAdmin, 1, "superAdmin 1 个（王老师）");
eq(byRole.admin, 1, "admin 1 个（李思远）");
eq(byRole.student, 3, "student 3 个");
eq(CA.store.find("users", "u_teacher").role, "superAdmin", "王老师角色正确");

const mNos = CA.store.get("members").map(function (m) { return m.studentNo; });
eq(mNos[0], "20230301", "学号起始 20230301");
eq(mNos[29], "20230330", "学号结束 20230330");
const mNames = CA.store.get("members").map(function (m) { return m.name; });
["李思远", "张天宇", "陈嘉怡", "刘一鸣"].forEach(function (n) {
  ok(mNames.indexOf(n) >= 0, "名单含 user 姓名：" + n);
});
ok(mNames.indexOf("王老师") < 0, "教师身份不出现在学生名单中");

const surveys = CA.store.get("surveys");
eq(surveys.length, 2, "surveys 2 个");
const responses = CA.store.get("responses");
eq(responses.filter(function (r) { return r.surveyId === "sv_sports"; }).length, 24, "运动会报名 24 条");
eq(responses.filter(function (r) { return r.surveyId === "sv_meeting"; }).length, 18, "班会投票 18 条");

const notices = CA.store.get("notices");
eq(notices.filter(function (n) { return n.pinned; }).length, 2, "pinned 2 条");
eq(notices.filter(function (n) { return n.important; }).length, 1, "important 1 条");
eq(notices.filter(function (n) { return n.attachments && n.attachments.length > 0; }).length, 2, "含附件 2 条");
eq(notices.filter(function (n) { return n.links && n.links.length > 0; }).length, 1, "含链接 1 条");
const cats = {};
notices.forEach(function (n) { cats[n.category] = 1; });
eq(Object.keys(cats).length, 5, "覆盖 5 个通知分类");

// 成绩特征
const subjFull = {};
CA.store.get("subjects").forEach(function (s) { subjFull[s.id] = s.fullScore; });
function avgPct(memberId, examId) {
  const rows = CA.store.query("scores", function (s) { return s.memberId === memberId && s.examId === examId; });
  if (!rows.length) return 0;
  let sum = 0;
  rows.forEach(function (r) { sum += r.score / subjFull[r.subjectId]; });
  return sum / rows.length;
}
eq(avgPct("m_20230304", "e_month2") > avgPct("m_20230304", "e_month1") + 0.08, true, "刘一鸣第三次考试明显进步");
eq(avgPct("m_20230302", "e_month1") > 0.80, true, "张天宇稳定高分（第一次 > 0.80）");

// ---------- 4. 深拷贝隔离 ----------
section("深拷贝隔离");
const got = CA.store.get("members");
got[0].name = "被篡改";
eq(CA.store.get("members")[0].name !== "被篡改", true, "外部改动不污染存储");
const found = CA.store.find("users", "u_teacher");
found.name = "被篡改";
eq(CA.store.find("users", "u_teacher").name, "王老师", "find 返回值亦为深拷贝");
CA.store.settings().aiEnabled = "污染";
eq(CA.store.settings().aiEnabled, true, "settings 返回深拷贝");

// ---------- 5. CRUD ----------
section("CRUD");
const added = CA.store.add("notices", {
  title: "测试通知", category: "其他", content: "x", timeLabel: "相关时间",
  deadline: "", endTime: "", location: "", course: "",
  attachments: [], links: [], pinned: false, important: false, publisherId: "u_teacher"
});
ok(!!added.id && !!added.createdAt && !!added.updatedAt, "add 生成 id/createdAt/updatedAt");
eq(CA.store.find("notices", added.id) !== null, true, "find 命中新增项");
eq(CA.store.query("notices", function (n) { return n.id === added.id; }).length, 1, "query 命中 1 条");
const upd = CA.store.update("notices", added.id, { title: "测试通知2" });
eq(upd.title, "测试通知2", "update 合并 patch 并返回新对象");
eq(CA.store.find("notices", added.id).title, "测试通知2", "update 已落库");
eq(CA.store.remove("notices", added.id), true, "remove 返回 true");
eq(CA.store.find("notices", added.id), null, "remove 后 find 为 null");
eq(CA.store.remove("notices", added.id), false, "重复 remove 返回 false");
eq(CA.store.get("notices").length, 8, "CRUD 后 notices 恢复 8 条");

// ---------- 6. settings ----------
section("settings");
eq(CA.store.settings().currentUserId, "u_teacher", "默认身份 currentUserId");
eq(CA.store.settings().aiEnabled, true, "默认 aiEnabled = true");
CA.store.setSettings({ aiEnabled: false, aiModel: "test-model" });
eq(CA.store.settings().aiEnabled, false, "setSettings 写 aiEnabled");
eq(CA.store.settings().aiModel, "test-model", "setSettings 写 aiModel");
eq(CA.store.settings().currentUserId, "u_teacher", "setSettings 保留未改字段");

// ---------- 7. uid / memberName ----------
section("uid / memberName");
ok(/^t_[0-9a-z]{5,}$/.test(CA.store.uid("t")), "uid 形如 prefix_时间戳36+随机4位");
ok(CA.store.uid("t") !== CA.store.uid("t"), "uid 不重复");
eq(CA.store.memberName("m_20230302"), "张天宇", "memberName 映射正确");
eq(CA.store.memberName("m_not_exist"), "", "memberName 未知返回空串");

// ---------- 8. auth ----------
section("auth");
eq(CA.auth.current().id, "u_teacher", "auth.current 默认王老师");
eq(CA.auth.list().length, 5, "auth.list 5 人");
eq(CA.auth.isSuperAdmin(), true, "王老师 isSuperAdmin");
eq(CA.auth.isAdmin(), true, "王老师 isAdmin");
eq(CA.auth.can("notice.manageAll"), true, "superAdmin 可 notice.manageAll");
eq(CA.auth.can("member.manage"), true, "superAdmin 可 member.manage");
eq(CA.auth.can("settings.ai"), true, "superAdmin 可 settings.ai");

eq(CA.auth.switchTo("u_studyleader"), true, "switchTo 学习委员成功");
eq(CA.auth.current().id, "u_studyleader", "current 已切换");
eq(CA.auth.isAdmin(), true, "admin isAdmin");
eq(CA.auth.can("notice.publish"), true, "admin 可 notice.publish");
eq(CA.auth.can("notice.manageAll"), false, "admin 不可 notice.manageAll");
eq(CA.auth.can("member.manage"), false, "admin 不可 member.manage");
eq(CA.auth.can("settings.ai"), false, "admin 不可 settings.ai");

eq(CA.auth.switchTo("u_zhang"), true, "switchTo 学生成功");
eq(CA.auth.isAdmin(), false, "学生非 admin");
eq(CA.auth.can("notice.publish"), false, "学生不可 publish");
eq(CA.auth.can("score.edit"), false, "学生不可 score.edit");
eq(CA.auth.switchTo("u_not_exist"), false, "switchTo 非法用户返回 false");

// ---------- 9. reset ----------
section("reset");
CA.store.add("members", { name: "临时同学", studentNo: "99999999" });
eq(CA.store.get("members").length, 31, "临时新增后 members 31");
CA.store.reset();
eq(CA.store.get("members").length, 30, "reset 后 members 回到 30");
ok(JSON.stringify(CA.store.get("notices")) === JSON.stringify(CA.seed.build().notices), "reset 恢复种子 notices");
eq(CA.store.settings().currentUserId, "u_teacher", "reset 恢复默认身份");
eq(CA.store.settings().aiEnabled, true, "reset 恢复 aiEnabled");
ok(JSON.stringify(CA.store.get("scores")) === JSON.stringify(CA.seed.build().scores), "reset 恢复种子 scores");
ok(JSON.stringify(CA.store.get("users")) === JSON.stringify(CA.seed.build().users), "reset 恢复种子 users");

// ---------- 汇总 ----------
console.log("\n================================");
console.log("通过 " + pass + " / 失败 " + fail);
console.log("================================");
process.exit(fail === 0 ? 0 : 1);
