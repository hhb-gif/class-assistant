// scores_test.mjs —— 成绩模块自测（契约 §10）
// 模式：global.window = global + 内存 localStorage + 极简 DOM 替身，require 被测模块
// 覆盖：统计纯函数边界、charts（echarts 可用 & 降级）、粘贴解析（正常/异常/重复）、mock 环境下 mount 不抛错
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------- 极简 DOM 替身 ----------------
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.className = "";
    this.id = "";
    this.type = "";
    this.placeholder = "";
    this._html = "";
    this._listeners = {};
  }
  set innerHTML(v) {
    this._html = String(v == null ? "" : v);
    this.children = [];
  }
  get innerHTML() { return this._html; }
  appendChild(c) {
    if (!c) return c;
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === "id") this.id = String(v);
    if (k === "class") this.className = String(v);
  }
  getAttribute(k) {
    if (Object.prototype.hasOwnProperty.call(this.attributes, k)) return this.attributes[k];
    return this[k] != null ? String(this[k]) : null;
  }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    const a = this._listeners[t];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  dispatch(t, ev) { (this._listeners[t] || []).forEach((fn) => fn(ev || { target: this })); }
  querySelector(sel) { return sel ? this._find(sel) : null; }
  _match(el, sel) {
    if (sel[0] === "#") return el.id === sel.slice(1);
    if (sel[0] === ".") return (" " + el.className + " ").indexOf(" " + sel.slice(1) + " ") >= 0;
    return el.tagName === sel.toUpperCase();
  }
  _find(sel) {
    for (let i = 0; i < this.children.length; i++) {
      const c = this.children[i];
      if (this._match(c, sel)) return c;
      const r = c._find ? c._find(sel) : null;
      if (r) return r;
    }
    return null;
  }
}

// ---------------- 全局浏览器 API 替身 ----------------
globalThis.window = globalThis;
const docHead = new FakeEl("head");
globalThis.document = {
  head: docHead,
  createElement: (t) => new FakeEl(t),
  getElementById: (id) => docHead._find("#" + id),
};
const _ls = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
  clear: () => { Object.keys(_ls).forEach((k) => delete _ls[k]); },
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
// Node 22 自带只读 navigator，无需赋值（copyText 仅在点击时访问）

// ---------------- 加载被测模块 ----------------
const srcDir = path.join(__dirname, "..", "src");
require(path.join(srcDir, "charts.js"));
require(path.join(srcDir, "scores.js"));
const CA = globalThis.CA;
const S = CA.scores.stats;

// ---------------- 断言工具 ----------------
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 " + name + (extra != null ? "  -> " + extra : "")); }
}
function close(a, b, eps) { return Math.abs(a - b) < (eps == null ? 1e-9 : eps); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms == null ? 10 : ms));

// ---------------- mock 数据层（异步：方法返回 Promise） ----------------
let uid = 0;
let role = "admin";                 // admin | student（驱动 RLS 模拟：学生只读本人成绩）
const STUDENT_MEMBER_ID = "m1";     // 张天宇在名单中的 id
const db = {
  users: [],
  subjects: [
    { id: "sub_cn", name: "语文", fullScore: 150, order: 1 },
    { id: "sub_ma", name: "数学", fullScore: 150, order: 2 },
    { id: "sub_en", name: "英语", fullScore: 150, order: 3 },
    { id: "sub_ph", name: "物理", fullScore: 100, order: 4 },
    { id: "sub_ch", name: "化学", fullScore: 100, order: 5 },
  ],
  members: [
    { id: "m1", name: "张天宇", studentNo: "20230301" },
    { id: "m2", name: "陈嘉怡", studentNo: "20230302" },
    { id: "m3", name: "刘一鸣", studentNo: "20230303" },
  ],
  exams: [
    { id: "e1", name: "第一次月考", date: "2026-03-15" },
    { id: "e2", name: "期中考试", date: "2026-04-25" },
    { id: "e3", name: "第二次月考", date: "2026-05-20" },
  ],
  scores: [],
};
function resetScores() {
  db.scores = [];
  // e1（基线）
  [["m1", "sub_cn", 130], ["m2", "sub_cn", 105], ["m3", "sub_cn", 90],
   ["m1", "sub_ma", 110], ["m2", "sub_ma", 88], ["m3", "sub_ma", 70]].forEach((d, i) => {
    db.scores.push({ id: "e1_" + i, examId: "e1", memberId: d[0], subjectId: d[1], score: d[2] });
  });
  // e2
  [["m1", "sub_cn", 135], ["m2", "sub_cn", 108], ["m3", "sub_cn", 92],
   ["m1", "sub_ma", 115], ["m2", "sub_ma", 92], ["m3", "sub_ma", 80]].forEach((d, i) => {
    db.scores.push({ id: "e2_" + i, examId: "e2", memberId: d[0], subjectId: d[1], score: d[2] });
  });
  // e3（完整 3 人 × 5 科）
  [["m1", "sub_cn", 140], ["m1", "sub_ma", 120], ["m1", "sub_en", 135], ["m1", "sub_ph", 85], ["m1", "sub_ch", 90],
   ["m2", "sub_cn", 110], ["m2", "sub_ma", 95], ["m2", "sub_en", 105], ["m2", "sub_ph", 70], ["m2", "sub_ch", 72],
   ["m3", "sub_cn", 95], ["m3", "sub_ma", 88], ["m3", "sub_en", 90], ["m3", "sub_ph", 60], ["m3", "sub_ch", 65]].forEach((d, i) => {
    db.scores.push({ id: "e3_" + i, examId: "e3", memberId: d[0], subjectId: d[1], score: d[2] });
  });
}
resetScores();

function copyArr(a) { return (a || []).map((x) => Object.assign({}, x)); }
// RLS 模拟：学生只能读到本人成绩；管理员读到全部
function visibleScores() {
  return role === "student"
    ? (db.scores || []).filter((s) => s.memberId === STUDENT_MEMBER_ID)
    : (db.scores || []);
}
CA.store = {
  get(coll) {
    if (coll === "scores") return Promise.resolve(copyArr(visibleScores()));
    return Promise.resolve(copyArr(db[coll] || []));
  },
  query(coll, fn) {
    if (coll === "scores") return Promise.resolve(visibleScores().filter(fn).map((x) => Object.assign({}, x)));
    return Promise.resolve((db[coll] || []).filter(fn).map((x) => Object.assign({}, x)));
  },
  find(coll, id) { const x = (db[coll] || []).find((i) => i.id === id); return Promise.resolve(x ? Object.assign({}, x) : null); },
  add(coll, obj) { const o = Object.assign({ id: "gen_" + (++uid), createdAt: "t" }, obj); (db[coll] = db[coll] || []).push(o); return Promise.resolve(Object.assign({}, o)); },
  update(coll, id, patch) { const x = (db[coll] || []).find((i) => i.id === id); if (!x) return Promise.resolve(null); Object.assign(x, patch); return Promise.resolve(Object.assign({}, x)); },
  remove(coll, id) { const i = (db[coll] || []).findIndex((x) => x.id === id); if (i < 0) return Promise.resolve(false); db[coll].splice(i, 1); return Promise.resolve(true); },
  uid(prefix) { return (prefix || "id") + "_" + (++uid).toString(36); },
  memberName(id) { const m = (db.members || []).find((x) => x.id === id); return m ? m.name : ""; },
  settings() { return { aiEnabled: true }; },
  setSettings() {},
  init() { return Promise.resolve(true); },
};

CA.auth = {
  current() {
    return Promise.resolve(role === "student"
      ? { id: "u_stu", uid: "u_stu", name: "张天宇", role: "student", studentNo: "20230301", memberId: STUDENT_MEMBER_ID }
      : { id: "u_t", uid: "u_t", name: "王老师", role: "admin", title: "班主任", memberId: null });
  },
  isAdmin() { return role !== "student"; },
  isSuperAdmin() { return false; },
  can() { return role !== "student"; },
  list() { return Promise.resolve([]); },
  switchTo() {},
};

let aiOn = true;
const aiCalls = [];
CA.ai = {
  enabled() { return aiOn; },
  analyzeExam(examId) { aiCalls.push(["report", examId]); return Promise.resolve({ markdown: "## 班级分析\n**总体**表现稳定\n- 数学整体偏难\n- 英语优秀率较高", stats: {} }); },
  studentComment(memberId, examId) { aiCalls.push(["comment", memberId, examId]); return Promise.resolve("该生学习态度端正，成绩稳步提升，建议保持错题复盘。"); },
  diagnoseScores(examId) { aiCalls.push(["diagnose", examId]); return Promise.resolve({ markdown: "## 个人成绩诊断\n**优势**：语文稳定\n- 数学是薄弱环节，需加强错题复盘", stats: {}, warnings: [] }); },
  studyPlan(examId) { aiCalls.push(["plan", examId]); return Promise.resolve({ markdown: "## 我的复习计划\n**目标**：两周内补齐数学短板\n- **数学**：每天整理 3 道错题\n- **物理**：回归课本例题", warnings: [] }); },
};

const toasts = [];
CA.app = { toast(msg, type) { toasts.push({ msg, type }); } };

// ============================================================
console.log("\n[1] 统计纯函数");
// ============================================================
ok("CA.scores.stats 存在", !!S && typeof S.mean === "function");
ok("mean 空数组=0", S.mean([]) === 0);
ok("mean 常规", S.mean([1, 2, 3, 4]) === 2.5);
ok("median 空=0", S.median([]) === 0);
ok("median 奇数", S.median([3, 1, 2]) === 2);
ok("median 偶数", S.median([1, 2, 3, 4]) === 2.5);
ok("maxOf 空=0", S.maxOf([]) === 0);
ok("maxOf", S.maxOf([5, 2, 9]) === 9);
ok("minOf 空=0", S.minOf([]) === 0);
ok("minOf", S.minOf([5, 2, 9]) === 2);
ok("stddev 空=0", S.stddev([]) === 0);
ok("stddev 总体标准差", close(S.stddev([2, 4, 4, 4, 5, 5, 7, 9]), 2));
ok("passRate 全及格=100", S.passRate([60, 100], 100) === 100);
ok("passRate 全不及格=0", S.passRate([0, 59], 100) === 0);
ok("passRate 混合=50", close(S.passRate([60, 59, 100, 0], 100), 50));
ok("passRate 空=0", S.passRate([], 100) === 0);
ok("passRate 支持对象数组", close(S.passRate([{ score: 60 }, { score: 0 }], 100), 50));
ok("excellentRate 混合=50", close(S.excellentRate([85, 84, 100, 0], 100), 50));
const bk = S.buckets([0, 10, 20, 30, 100], 100, 5);
ok("buckets labels", JSON.stringify(bk.labels) === JSON.stringify(["0-20", "20-40", "40-60", "60-80", "80-100"]), JSON.stringify(bk.labels));
ok("buckets counts", JSON.stringify(bk.counts) === JSON.stringify([2, 2, 0, 0, 1]), JSON.stringify(bk.counts));
ok("buckets 满分归末档", S.buckets([100], 100, 5).counts[4] === 1);
ok("buckets 0 分归首档", S.buckets([0], 100, 5).counts[0] === 1);
ok("buckets 空=全 0", JSON.stringify(S.buckets([], 100, 5).counts) === JSON.stringify([0, 0, 0, 0, 0]));
ok("rankOf 并列取最小名次", S.rankOf(90, [90, 80, 90, 70]) === 1);
ok("rankOf 次位", S.rankOf(80, [90, 80, 90, 70]) === 3);
ok("rankOf 末位", S.rankOf(70, [90, 80, 90, 70]) === 4);
ok("rankOf 空数组=1", S.rankOf(50, []) === 1);
ok("percentileOf 50", S.percentileOf(80, [70, 80, 90, 100]) === 50);
ok("percentileOf 最高=100", S.percentileOf(100, [70, 80, 90, 100]) === 100);
ok("percentileOf 空=0", S.percentileOf(1, []) === 0);

// ============================================================
console.log("\n[2] subjectStats（依赖 mock store）");
// ============================================================
const ss = await S.subjectStats("e3");
ok("subjectStats 返回 5 科", ss.length === 5);
const cn = ss.find((x) => x.subjectId === "sub_cn");
ok("subjectStats 语文均分", close(cn.mean, (140 + 110 + 95) / 3), cn.mean);
ok("subjectStats 语文最高/最低", cn.max === 140 && cn.min === 95, cn.max + "/" + cn.min);
ok("subjectStats count", cn.count === 3);
ok("subjectStats 含 pass/excellent 字段", typeof cn.pass === "number" && typeof cn.excellent === "number");

// ============================================================
console.log("\n[3] charts（echarts 可用 + 降级）");
// ============================================================
let disposed = 0;
let initCount = 0;
globalThis.echarts = {
  init() {
    initCount++;
    return { setOption() {}, resize() {}, dispose() { disposed++; } };
  },
};
ok("charts.available true", CA.charts.available() === true);
let cErr = null;
const cel = new FakeEl("div");
try { CA.charts.distribution(cel, { title: "d", labels: ["0-20", "20-40"], counts: [1, 2] }); } catch (e) { cErr = e; }
ok("distribution 不抛错", !cErr, cErr && cErr.message);
ok("distribution 调用 echarts.init", initCount === 1);
cErr = null;
try { CA.charts.trend(cel, { title: "t", categories: ["a", "b"], series: [{ name: "s", data: [1, 2] }] }); } catch (e) { cErr = e; }
ok("trend 重复调用不抛错", !cErr, cErr && cErr.message);
ok("重复调用先 dispose 旧实例", disposed >= 1);
cErr = null;
try { CA.charts.subjectCompare(new FakeEl("div"), { title: "c", subjects: ["语文"], averages: [120], fullScores: [150] }); } catch (e) { cErr = e; }
ok("subjectCompare 不抛错", !cErr, cErr && cErr.message);
CA.charts.disposeAll();
ok("disposeAll 释放实例", disposed >= 3);

// --- 降级路径：删除 echarts ---
delete globalThis.echarts;
ok("charts.available false（无 echarts）", CA.charts.available() === false);
let fErr = null;
const fel = new FakeEl("div");
try { CA.charts.distribution(fel, { labels: ["a", "b"], counts: [3, 5] }); } catch (e) { fErr = e; }
ok("降级 distribution 不抛错", !fErr, fErr && fErr.message);
ok("降级 distribution 渲染 CSS 条形图（.bar-chart）", fel.innerHTML.indexOf("bar-chart") >= 0);
const felEmpty = new FakeEl("div");
try { CA.charts.distribution(felEmpty, { labels: [], counts: [] }); } catch (e) { fErr = e; }
ok("降级 distribution 空数据渲染 .empty", felEmpty.innerHTML.indexOf("empty") >= 0);
const fel2 = new FakeEl("div");
fErr = null;
try { CA.charts.trend(fel2, { categories: ["x"], series: [{ name: "s", data: [9] }] }); } catch (e) { fErr = e; }
ok("降级 trend 不抛错", !fErr, fErr && fErr.message);
ok("降级 trend 渲染表格（.table-wrap）", fel2.innerHTML.indexOf("table-wrap") >= 0);
const fel3 = new FakeEl("div");
fErr = null;
try { CA.charts.subjectCompare(fel3, { subjects: ["语文", "数学"], averages: [120, 100], fullScores: [150, 150] }); } catch (e) { fErr = e; }
ok("降级 subjectCompare 不抛错", !fErr, fErr && fErr.message);
ok("降级 subjectCompare 渲染（.bar-chart）", fel3.innerHTML.indexOf("bar-chart") >= 0);

// ============================================================
console.log("\n[4] parseImport / applyImport（正常/异常/重复，异步）");
// ============================================================
const parsedText = [
  "20230301,数学,138",        // ok 学号
  "陈嘉怡 语文 129",            // ok 姓名 + 空格
  "20230303，英语，90",         // ok 全角逗号
  "20230399,数学,100",          // fail 无此人
  "20230301,体育,88",           // fail 无此科目
  "20230301,数学,abc",          // fail 分数非法
  "20230302,化学,999",          // fail 超范围
  "20230301 数学",              // fail 字段不足
  "",                          // 空行跳过
  "20230302,数学,120",          // ok
  "20230302,数学,121",          // fail 重复行
].join("\n");

// 纯函数（同步，显式传入名单/科目）
const pure = CA.scores.parseImportText(parsedText, db.members, db.subjects);
ok("parseImportText 为同步纯函数", pure && typeof pure.okCount === "number" && typeof pure.then !== "function");

// 异步包装（await store.get）
const parsed = await CA.scores.parseImport(parsedText);
ok("parseImport 返回 Promise", typeof CA.scores.parseImport(parsedText).then === "function");
ok("parseImport okCount=4", parsed.okCount === 4, parsed.okCount);
ok("parseImport failCount=6", parsed.failCount === 6, parsed.failCount + " :: " + JSON.stringify(parsed.rows.filter((r) => !r.ok).map((r) => r.reason)));
const firstOk = parsed.rows.find((r) => r.ok);
ok("parseImport 解析出 memberId/subjectId", firstOk.memberId === "m1" && firstOk.subjectId === "sub_ma", JSON.stringify(firstOk));

// --- applyImport（异步写库） ---
resetScores();
const p2 = await CA.scores.parseImport("20230301,数学,150\n20230302,语文,88");
const r2 = await CA.scores.applyImport(p2, "e3");
ok("applyImport 命中已有记录为更新", r2.updated === 2 && r2.added === 0, JSON.stringify(r2));
const rec = db.scores.find((s) => s.memberId === "m1" && s.subjectId === "sub_ma" && s.examId === "e3");
ok("applyImport 更新数值", rec && rec.score === 150, rec && rec.score);
const p3 = await CA.scores.parseImport("20230301,英语,77"); // e1 无英语记录
const r3 = await CA.scores.applyImport(p3, "e1");
ok("applyImport 无记录为新增", r3.added === 1 && r3.updated === 0, JSON.stringify(r3));

// ============================================================
console.log("\n[5] 视图 mount（mock store/auth/ai）");
// ============================================================
resetScores();
globalThis.echarts = { init() { return { setOption() {}, resize() {}, dispose() {} }; } };

// --- 管理员 ---
role = "admin";
aiOn = true;
const root = new FakeEl("section");
let mErr = null;
try { await CA.views.scores.mount(root); } catch (e) { mErr = e; }
ok("admin mount 不抛错", !mErr, mErr && mErr.stack);
[
  "exam-select", "score-subject-filter", "score-table",
  "btn-score-import", "score-import-input",
  "chart-dist", "chart-trend", "chart-subject",
  "btn-ai-report", "ai-report-box", "btn-ai-comment", "ai-comment-box",
].forEach((id) => ok("admin 存在 #" + id, !!root.querySelector("#" + id)));
ok("管理员视图标记 .admin-only", !!root.querySelector(".admin-only"));

// AI 班级报告
root.querySelector("#btn-ai-report").dispatch("click");
await tick(30);
const reportBox = root.querySelector("#ai-report-box");
ok("AI 报告渲染 markdown", reportBox.innerHTML.indexOf("<h3>") >= 0 && reportBox.innerHTML.indexOf("<strong>") >= 0, reportBox.innerHTML.slice(0, 90));
ok("AI 报告调用 analyzeExam", aiCalls.some((c) => c[0] === "report" && c[1] === "e3"));

// 批量导入流程（异步写库 + await）
const importInput = root.querySelector("#score-import-input");
importInput.value = "20230301,数学,150\nBAD LINE\n20230399,数学,100";
root.querySelector("#btn-score-parse").dispatch("click");
ok("解析后确认按钮可用", root.querySelector("#btn-score-confirm").hidden === false);
root.querySelector("#btn-score-confirm").dispatch("click");
await tick(40);
const rec2 = db.scores.find((s) => s.memberId === "m1" && s.subjectId === "sub_ma" && s.examId === "e3");
ok("导入写库成功", rec2 && rec2.score === 150, rec2 && rec2.score);
ok("导入后 toast 汇报", toasts.some((t) => t.msg.indexOf("导入完成") >= 0));

// --- AI 关闭 ---
aiOn = false;
const root2 = new FakeEl("section");
let e2 = null;
try { await CA.views.scores.mount(root2); } catch (e) { e2 = e; }
ok("AI 关闭 mount 不抛错", !e2, e2 && e2.message);
ok("AI 关闭隐藏报告按钮", root2.querySelector("#btn-ai-report").hidden === true);
ok("AI 关闭隐藏评语按钮", root2.querySelector("#btn-ai-comment").hidden === true);

// --- 学生视角（RLS：store.get("scores") 只返回本人） ---
role = "student";
aiOn = true;
resetScores();
const root3 = new FakeEl("section");
let e3 = null;
try { await CA.views.scores.mount(root3); } catch (e) { e3 = e; }
ok("学生 mount 不抛错", !e3, e3 && e3.stack);
ok("学生面板 #student-score-panel 存在", !!root3.querySelector("#student-score-panel"));
ok("学生视图标记 .student-only", !!root3.querySelector(".student-only"));
ok("学生不渲染成绩表 #score-table", root3.querySelector("#score-table") === null);
ok("学生仍有考试选择", !!root3.querySelector("#exam-select"));
ok("学生不暴露班级成员选择提示", root3.querySelector("#score-selected-hint") === null);

// --- 学生端 AI：我的成绩诊断 / AI 学习计划 ---
ok("学生端存在 #btn-ai-diagnose", !!root3.querySelector("#btn-ai-diagnose"));
ok("学生端存在 #ai-diagnose-box", !!root3.querySelector("#ai-diagnose-box"));
ok("学生端存在 #btn-ai-plan", !!root3.querySelector("#btn-ai-plan"));
ok("学生端存在 #ai-plan-box", !!root3.querySelector("#ai-plan-box"));
ok("学生端 AI 入口默认可用", root3.querySelector("#btn-ai-diagnose").disabled === false && root3.querySelector("#btn-ai-plan").disabled === false);
root3.querySelector("#btn-ai-diagnose").dispatch("click");
await tick(30);
const diagBox = root3.querySelector("#ai-diagnose-box");
ok("成绩诊断渲染 markdown", diagBox.innerHTML.indexOf("<h3>") >= 0 && diagBox.innerHTML.indexOf("<strong>") >= 0, diagBox.innerHTML.slice(0, 80));
ok("成绩诊断调用 diagnoseScores(e3)", aiCalls.some((c) => c[0] === "diagnose" && c[1] === "e3"));
root3.querySelector("#btn-ai-plan").dispatch("click");
await tick(30);
const planBox = root3.querySelector("#ai-plan-box");
ok("学习计划渲染 markdown", planBox.innerHTML.indexOf("<h3>") >= 0, planBox.innerHTML.slice(0, 80));
ok("学习计划调用 studyPlan(e3)", aiCalls.some((c) => c[0] === "plan" && c[1] === "e3"));

// --- 学生端 AI 关闭：入口隐藏 ---
aiOn = false;
const root4 = new FakeEl("section");
let e4 = null;
try { await CA.views.scores.mount(root4); } catch (e) { e4 = e; }
ok("学生端 AI 关闭 mount 不抛错", !e4, e4 && e4.message);
ok("学生端 AI 关闭隐藏诊断入口", root4.querySelector("#btn-ai-diagnose").hidden === true);
ok("学生端 AI 关闭隐藏计划入口", root4.querySelector("#btn-ai-plan").hidden === true);
aiOn = true;

// --- unmount ---
let uErr = null;
try { CA.views.scores.unmount(); } catch (e) { uErr = e; }
ok("unmount 不抛错", !uErr, uErr && uErr.message);

// ============================================================
console.log("\n============================================");
console.log("结果：通过 " + pass + " / 失败 " + fail);
console.log("============================================\n");
if (fail > 0) process.exitCode = 1;
