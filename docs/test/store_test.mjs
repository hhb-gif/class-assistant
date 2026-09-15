// 数据层自测（P1b 版）：内存 PG mock + 异步 store + 驼峰↔下划线映射 + 新集合覆盖
// 运行：node docs/test/store_test.mjs
//
// 设计：mock 一张 postgREST 风格的内存 PG（tables 用 snake_case 列名），
//       用 seed.build() 灌入 fixtures，从而在真实数据规模上验证 store 的读写与映射。
import { createRequire } from "node:module";

// ---------- 浏览器替身：window + 内存版 localStorage ----------
global.window = global;
global.window.CA_CONFIG = { envId: "env-test", publishableKey: "pk-test", llm: { model: "deepseek-v4-flash" } };

const _ls = Object.create(null);
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem: function (k, v) { _ls[k] = String(v); },
  removeItem: function (k) { delete _ls[k]; },
  clear: function () { for (const k in _ls) delete _ls[k]; },
  key: function (i) { return Object.keys(_ls)[i] || null; },
  get length() { return Object.keys(_ls).length; }
};

// ---------- 内存 PG mock（{data,error} 包装，仅实现 store 用到的链式方法）----------
const tables = {
  members: [], users: [], notices: [], favorites: [], subscribers: [],
  subjects: [], exams: [], scores: [], surveys: [], survey_responses: []
};

// 模拟 RLS 静默过滤：置位后该表 delete 返回「0 行受影响、无 error」，但数据不删。
const silentDelete = Object.create(null);

function exec(table, op, payload, filters) {
  const arr = tables[table] || [];
  const match = function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); };
  if (op === "select") return { data: arr.filter(match).map(function (r) { return Object.assign({}, r); }) };
  if (op === "insert") {
    if (table === "favorites" && arr.some(function (r) {
      return r.notice_id === payload.notice_id && r.user_id === payload.user_id;
    })) {
      return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    if (table === "survey_responses" && arr.some(function (r) {
      return r.survey_id === payload.survey_id && r.member_id === payload.member_id;
    })) {
      return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    arr.push(Object.assign({}, payload));
    return { data: [Object.assign({}, payload)] };
  }
  if (op === "update") {
    arr.forEach(function (r) { if (match(r)) Object.assign(r, payload); });
    return { data: arr.filter(match).map(function (r) { return Object.assign({}, r); }) };
  }
  if (op === "delete") {
    if (silentDelete[table]) return { data: null };   // 模拟 RLS 过滤：不删、也不报 error
    for (let i = arr.length - 1; i >= 0; i--) { if (match(arr[i])) arr.splice(i, 1); }
    return { data: null };
  }
  return { data: null };
}

function builder(table) {
  let op = null, payload = null;
  const filters = [];
  const b = {};
  b.select = function () { op = "select"; return b; };
  b.insert = function (row) { op = "insert"; payload = row; return b; };
  b.update = function (row) { op = "update"; payload = row; return b; };
  b.delete = function () { op = "delete"; return b; };
  b.eq = function (col, val) { filters.push([col, val]); return b; };
  b.then = function (res, rej) {
    return Promise.resolve().then(function () { return exec(table, op, payload, filters); }).then(res, rej);
  };
  b.catch = function (rej) { return b.then(function (v) { return v; }, rej); };
  return b;
}

let loggedIn = true;
global.CA = {
  cloud: {
    ready: function () { return true; },
    ensure: function () {},
    lastError: function () { return null; },
    db: { from: function (t) { return builder(t); } },
    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: loggedIn ? { user: { id: "uid-teacher" } } : null }, error: null });
      },
      signInWithPassword: function () { loggedIn = true; return Promise.resolve({ data: { session: { user: { id: "uid-teacher" } } }, error: null }); },
      signOut: function () { loggedIn = false; return Promise.resolve({ error: null }); },
      resetPasswordForOld: function (c) { global.__resetArgs = c; return Promise.resolve({ error: null }); }
    }
  }
};

const require = createRequire(import.meta.url);
require("../src/seed.js");   // 先加载 seed（此时 CA.store 未定义 → 跳过其内部 init）
require("../src/store.js");
require("../src/auth.js");

const CA = global.CA;

// ---------- 断言小工具 ----------
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  \u2713 " + msg); }
  else { fail++; console.log("  \u2717 " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + "（期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a) + "）"); }
function section(t) { console.log("\n[" + t + "]"); }
const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

// ---------- 用 seed 灌入 PG fixtures（camel → snake，模拟云端行）----------
const db = CA.seed.build();

function camelToSnakeColl(coll) {
  const maps = {
    members: { studentNo: "student_no", createdAt: "created_at" },
    users: { memberId: "member_id", mustChangePassword: "must_change_password", displayName: "display_name", createdAt: "created_at" },
    notices: { timeLabel: "time_label", endTime: "end_time", publisherId: "publisher_id", createdAt: "created_at", updatedAt: "updated_at" },
    favorites: { userId: "user_id", noticeId: "notice_id", createdAt: "created_at" },
    subjects: { fullScore: "full_score", order: "sort_order" },
    exams: { date: "exam_date", createdAt: "created_at" },
    scores: { examId: "exam_id", subjectId: "subject_id", memberId: "member_id" },
    surveys: { desc: "description", createdBy: "created_by", createdAt: "created_at", updatedAt: "updated_at" },
    responses: { surveyId: "survey_id", memberId: "member_id", createdAt: "created_at" }
  };
  const table = coll === "responses" ? "survey_responses" : coll;
  return (db[coll] || []).map(function (o) {
    const m = maps[coll] || {};
    const row = {};
    Object.keys(o).forEach(function (k) { row[m[k] || k] = o[k]; });
    return row;
  });
}
["members", "subjects", "exams", "scores", "surveys", "responses"].forEach(function (c) {
  tables[c === "responses" ? "survey_responses" : c] = camelToSnakeColl(c);
});
// auth 用到的 users 行（真实环境 uid 为 19 位串，这里用可读替身）
tables.users = [
  { uid: "uid-teacher", member_id: null, role: "superAdmin", must_change_password: false, display_name: "王老师", created_at: "2026-01-01T00:00:00Z" },
  { uid: "uid-leader", member_id: "m_20230301", role: "admin", must_change_password: true, display_name: null, created_at: "2026-01-01T00:00:00Z" }
];

// ============================================================
// 1. seed 确定性（种子生成与 store 无关）
// ============================================================
section("seed 确定性");
const s1 = CA.seed.build();
const s2 = CA.seed.build();
eq(JSON.stringify(s1) === JSON.stringify(s2), true, "两次 build JSON 序列化完全一致");
eq(s1.version, 1, "version = 1");
eq(s1.members.length, 30, "members 恰好 30 人");
eq(s1.scores.length, 450, "scores 恰好 450 条");
eq(s1.subjects.length, 5, "subjects 恰好 5 科");
eq(s1.exams.length, 3, "exams 恰好 3 次");
eq(s1.surveys.length, 2, "surveys 恰好 2 个");
eq(s1.responses.length, 42, "responses 恰好 42 条");

// ============================================================
// 2. init / members 缓存
// ============================================================
section("init / members 缓存");
const inited = await CA.store.init();
eq(inited, true, "init 返回 true");
eq(CA.store.memberName("m_20230302"), "张天宇", "memberName 同步命中缓存");
eq(CA.store.memberName("m_not_exist"), "", "memberName 未命中返回空串");
const m0 = await CA.store.get("members");
eq(m0.length, 30, "get members 30 人");
m0[0].name = "被篡改";
eq((await CA.store.get("members"))[0].name !== "被篡改", true, "get 返回深拷贝，外部改动不污染缓存");

// ============================================================
// 3. 成绩集合：读取 + 驼峰映射
// ============================================================
section("成绩集合（subjects / exams / scores）");
const subjects = await CA.store.get("subjects");
eq(subjects.length, 5, "subjects 5 科");
const chinese = subjects.filter(function (s) { return s.id === "s_chinese"; })[0];
eq(chinese.fullScore, 150, "subjects.fullScore ↔ full_score");
eq(chinese.order, 1, "subjects.order ↔ sort_order");
ok(!has(chinese, "full_score") && !has(chinese, "sort_order"), "subject 对象无下划线残留字段");

const exams = await CA.store.get("exams");
eq(exams.length, 3, "exams 3 次");
const month1 = exams.filter(function (e) { return e.id === "e_month1"; })[0];
eq(month1.date, "2026-03-15", "exams.date ↔ exam_date");
ok(!!month1.createdAt, "exams.createdAt ↔ created_at");

const scores = await CA.store.get("scores");
eq(scores.length, 450, "scores 450 条");
const one = scores[0];
ok(!!one.examId && !!one.subjectId && !!one.memberId, "scores 驼峰字段完整（examId/subjectId/memberId）");
ok(!has(one, "exam_id") && !has(one, "subject_id") && !has(one, "member_id"), "scores 对象无下划线残留字段");
const byMemberExam = await CA.store.query("scores", function (s) { return s.memberId === "m_20230302" && s.examId === "e_month1"; });
eq(byMemberExam.length, 5, "query 过滤命中 5 科");
const foundScore = await CA.store.find("scores", one.id);
eq(foundScore.id, one.id, "find scores 命中");
eq(await CA.store.find("scores", "no_such_id"), null, "find 未命返 null");

// ============================================================
// 4. 信息收集集合：嵌套 jsonb 透传
// ============================================================
section("信息收集集合（surveys / responses）");
const surveys = await CA.store.get("surveys");
eq(surveys.length, 2, "surveys 2 个");
const sv = surveys.filter(function (s) { return s.id === "sv_sports"; })[0];
eq(sv.desc, "请选择你参加的项目，报名截止后由班委统一提交。", "surveys.desc ↔ description");
eq(sv.createdBy, "u_studyleader", "surveys.createdBy ↔ created_by");
ok(Array.isArray(sv.questions) && sv.questions.length === 2, "surveys.questions jsonb 数组透传");
eq(sv.questions[0].qid, "q1", "questions[0].qid 保留");
eq(sv.questions[0].options.length, 4, "questions options 保留");
ok(!has(sv, "description") && !has(sv, "created_by"), "survey 对象无下划线残留字段");

const responses = await CA.store.get("responses");
eq(responses.length, 42, "responses 42 条");
eq(responses.filter(function (r) { return r.surveyId === "sv_sports"; }).length, 24, "运动会报名 24 条");
eq(responses.filter(function (r) { return r.surveyId === "sv_meeting"; }).length, 18, "班会投票 18 条");
const r0 = responses[0];
ok(!!r0.surveyId && !!r0.memberId, "responses surveyId/memberId 驼峰");
ok(Array.isArray(r0.answers), "responses.answers jsonb 数组透传");
ok(!has(r0, "survey_id") && !has(r0, "member_id"), "response 对象无下划线残留字段");

// ============================================================
// 5. 写：scores add / update / remove
// ============================================================
section("CRUD · scores");
const added = await CA.store.add("scores", { examId: "e_mid", subjectId: "s_math", memberId: "m_20230330", score: 88 });
ok(/^sc_/.test(added.id), "add scores 生成 sc_ 前缀 id");
eq(added.score, 88, "add 返回 score");
const rawScoreRow = tables.scores.filter(function (r) { return r.id === added.id; })[0];
ok(!!rawScoreRow, "add scores 已落库");
eq(rawScoreRow.exam_id, "e_mid", "落库列名 exam_id");
eq(rawScoreRow.subject_id, "s_math", "落库列名 subject_id");
eq(rawScoreRow.member_id, "m_20230330", "落库列名 member_id");
const updScore = await CA.store.update("scores", added.id, { score: 91 });
eq(updScore.score, 91, "update scores 生效");
eq(tables.scores.filter(function (r) { return r.id === added.id; })[0].score, 91, "update 已落库");
eq(await CA.store.remove("scores", added.id), true, "remove scores 返回 true");
eq(await CA.store.find("scores", added.id), null, "remove 后 find 为 null");
eq((await CA.store.get("scores")).length, 450, "CRUD 后 scores 恢复 450 条");

// ============================================================
// 5b. remove 回读校验（RLS 静默过滤不再被当成功）
// ============================================================
section("remove 回读校验（RLS 静默过滤）");
tables.notices = [{ id: "n_rls", title: "删不掉的通知" }];
silentDelete.notices = true;   // 模拟 DELETE 被策略过滤：0 行受影响、无 error
let delErr = null;
try { await CA.store.remove("notices", "n_rls"); } catch (e) { delErr = e; }
ok(!!delErr, "删除被 RLS 静默过滤时抛错（不再当成功）");
ok(delErr && /操作未生效/.test(delErr.message), "错误文案可读：" + (delErr && delErr.message));
eq(delErr ? (delErr.message.match(/删除 notices 失败/g) || []).length : -1, 1, "错误未被 run()/wrapErr 二次包裹");
eq((await CA.store.find("notices", "n_rls")) !== null, true, "回读确认记录仍在");
silentDelete.notices = false;   // 策略放行
eq(await CA.store.remove("notices", "n_rls"), true, "策略放行后 remove 返回 true");
eq(await CA.store.find("notices", "n_rls"), null, "删除成功后 find 为 null");

// ============================================================
// 6. 写：surveys add / update（updated_at）/ toggle
// ============================================================
section("CRUD · surveys");
const svAdded = await CA.store.add("surveys", {
  title: "测试收集", desc: "说明", status: "open", anonymous: false,
  deadline: "2026-12-01T18:00:00", createdBy: "uid-teacher",
  questions: [{ qid: "q1", type: "single", title: "选一个", required: true, options: ["A", "B"] }]
});
ok(/^sv_/.test(svAdded.id), "add surveys 生成 sv_ 前缀 id");
eq(svAdded.desc, "说明", "add 返回 desc（驼峰）");
ok(!!svAdded.updatedAt, "add surveys 自动写 updatedAt");
const rawSv = tables.surveys.filter(function (r) { return r.id === svAdded.id; })[0];
eq(rawSv.description, "说明", "落库列名 description");
eq(rawSv.created_by, "uid-teacher", "落库列名 created_by");
ok(Array.isArray(rawSv.questions), "落库 questions 为数组（jsonb）");
const beforeUpdate = rawSv.updated_at;
await new Promise(function (r) { setTimeout(r, 5); });
const svUpd = await CA.store.update("surveys", svAdded.id, { status: "closed" });
eq(svUpd.status, "closed", "update surveys status 生效");
ok(rawSv.updated_at !== beforeUpdate, "update surveys 刷新 updated_at");
eq(await CA.store.remove("surveys", svAdded.id), true, "remove surveys 返回 true");
eq((await CA.store.get("surveys")).length, 2, "CRUD 后 surveys 恢复 2 个");

// ============================================================
// 7. 写：responses（唯一约束幂等语义）
// ============================================================
section("CRUD · responses");
// 选一个 seed 中未提交 sv_meeting 的成员（避开唯一约束 survey_id+member_id）
const respAdded = await CA.store.add("responses", {
  surveyId: "sv_meeting", memberId: "m_20230301", answers: [{ qid: "q1", value: "周一早读" }]
});
ok(/^rs_/.test(respAdded.id), "add responses 生成 rs_ 前缀 id");
eq(respAdded.surveyId, "sv_meeting", "add 返回 surveyId");
ok(Array.isArray(respAdded.answers), "add 返回 answers 数组");
const rawResp = tables.survey_responses.filter(function (r) { return r.id === respAdded.id; })[0];
eq(rawResp.survey_id, "sv_meeting", "落库列名 survey_id");
eq(rawResp.member_id, "m_20230301", "落库列名 member_id");
eq(await CA.store.remove("responses", respAdded.id), true, "remove responses 返回 true");

// ============================================================
// 8. favorites 唯一约束幂等（P1a 回归）
// ============================================================
section("favorites 唯一约束幂等");
const f1 = await CA.store.add("favorites", { userId: "uid-teacher", noticeId: "n_exam_final" });
const f2 = await CA.store.add("favorites", { userId: "uid-teacher", noticeId: "n_exam_final" });
ok(!!f1 && !!f1.id, "首次 favorites 返回记录");
eq(f2.id, f1.id, "重复 favorites 幂等返回既有记录");
eq(tables.favorites.length, 1, "favorites 仅入库一条");

// ============================================================
// 9. 未支持集合仍抛可读错误
// ============================================================
section("未支持集合");
let err = null;
try { await CA.store.get("settings"); } catch (e) { err = e; }
ok(!!err && /未支持的数据集合/.test(err.message), "未知集合抛可读错误");

// ============================================================
// 10. settings（本地偏好）
// ============================================================
section("settings");
eq(CA.store.settings().aiEnabled, true, "默认 aiEnabled = true");
ok(!("currentUserId" in CA.store.settings()), "settings 不再含 currentUserId");
CA.store.setSettings({ aiEnabled: false, aiModel: "test-model" });
eq(CA.store.settings().aiEnabled, false, "setSettings 写 aiEnabled");
eq(CA.store.settings().aiModel, "test-model", "setSettings 写 aiModel");
CA.store.setSettings({ aiModel: "deepseek-v4-flash" });

// ============================================================
// 11. auth（异步会话 + 角色）
// ============================================================
section("auth");
const me = await CA.auth.current();
eq(me && me.id, "uid-teacher", "current 读取会话用户");
eq(me && me.role, "superAdmin", "current role = superAdmin");
eq(me && me.name, "王老师", "current name 取 display_name");
eq(CA.auth.isAdmin(), true, "isAdmin 同步 true");
eq(CA.auth.isSuperAdmin(), true, "isSuperAdmin 同步 true");
eq(CA.auth.can("notice.publish"), true, "can notice.publish");
eq(CA.auth.can("member.manage"), true, "can member.manage");
eq(CA.auth.can("nope"), false, "未知 action 拒绝");
const users = await CA.auth.list();
eq(users.length, 2, "admin list 返回全部 users");

const loggedInMe = await CA.auth.login("20230301", "pw");
eq(loggedInMe && loggedInMe.id, "uid-teacher", "login 返回身份");
eq(await CA.auth.logout(), true, "logout 返回 true");
eq(await CA.auth.current(), null, "logout 后 current 为 null");
eq(CA.auth.can("notice.publish"), false, "logout 后 can 最小权限拒绝");
let threw = false;
try { CA.auth.switchTo("x"); } catch (e) { threw = true; }
ok(threw, "switchTo 已废弃，显式抛错");

// ---------- 汇总 ----------
console.log("\n================================");
console.log("通过 " + pass + " / 失败 " + fail);
console.log("================================");
process.exit(fail === 0 ? 0 : 1);
