// 信息收集模块自测（Agent F3 · M3）
// 运行：node docs/test/collect_test.mjs（在 class-assistant 目录下）
// 零依赖：自带极简 DOM 桩 + mock CA.store / CA.auth / CA.ai / CA.app / CA.icon / CA.util
// 覆盖：列表按截止排序、创建字段完整、学生提交、重复提交为更新、统计票数/百分比、未提交名单、
//       AI 汇总调用链、XSS 转义、权限（学生看不到新建/汇总）。
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 一、极简 DOM 桩（覆盖 collect.js 用到的 API）
// ============================================================
function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class StubEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._text = "";
    this._html = null;
    this._listeners = {};
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.selected = false;
  }
  get className() { return this.attributes["class"] || ""; }
  set className(v) { this.attributes["class"] = String(v); }
  get id() { return this.attributes["id"] || ""; }
  set id(v) { this.attributes["id"] = String(v); }
  get firstChild() { return this.children[0] || null; }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) { this._text = String(v); this.children = []; this._html = null; }
  get innerHTML() { return this._html != null ? this._html : ""; }
  set innerHTML(v) { this._html = String(v); this._text = ""; this.children = []; }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
    return c;
  }
  setAttribute(k, v) {
    if (k === "class") this.className = v;
    else if (k === "id") this.id = v;
    else if (k.indexOf("data-") === 0) this.dataset[camel(k.slice(5))] = String(v);
    else this.attributes[k] = String(v);
  }
  getAttribute(k) {
    if (k === "class") return this.className;
    if (k === "id") return this.id;
    if (k.indexOf("data-") === 0) {
      const key = camel(k.slice(5));
      return this.dataset[key] != null ? this.dataset[key] : null;
    }
    return this.attributes[k] != null ? this.attributes[k] : null;
  }
  hasAttribute(k) { return this.getAttribute(k) != null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._listeners[type]; if (!l) return;
    const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  }
  focus() { this._focused = true; }
  blur() {}
  closest(sel) {
    let node = this;
    while (node) { if (matchesSimple(node, sel)) return node; node = node.parentNode; }
    return null;
  }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  contains(other) {
    let n = other;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }
}

function parseSimple(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const m = /^[a-zA-Z*][\w-]*/.exec(sel);
  let i = 0;
  if (m) { out.tag = m[0]; i = m[0].length; }
  while (i < sel.length) {
    const ch = sel.charAt(i);
    if (ch === "#") { const a = /^#([\w-]+)/.exec(sel.slice(i)); out.id = a[1]; i += a[0].length; }
    else if (ch === ".") { const b = /^\.([\w-]+)/.exec(sel.slice(i)); out.classes.push(b[1]); i += b[0].length; }
    else if (ch === "[") {
      const end = sel.indexOf("]", i);
      const body = sel.slice(i + 1, end);
      const eq = body.indexOf("=");
      if (eq < 0) out.attrs.push([body.trim(), null]);
      else out.attrs.push([body.slice(0, eq).trim(), body.slice(eq + 1).trim().replace(/^["']|["']$/g, "")]);
      i = end + 1;
    } else i++;
  }
  return out;
}
function matchesSimple(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  const s = parseSimple(sel);
  if (s.tag && s.tag !== "*" && el.tagName !== s.tag.toUpperCase()) return false;
  if (s.id && el.id !== s.id) return false;
  const cls = (el.className || "").split(/\s+/);
  for (const c of s.classes) if (cls.indexOf(c) < 0) return false;
  for (const [name, want] of s.attrs) {
    let have;
    if (name === "class") have = el.className;
    else if (name === "id") have = el.id;
    else if (name.indexOf("data-") === 0) have = el.dataset[camel(name.slice(5))];
    else have = el.attributes[name];
    if (have == null) return false;
    if (want != null && String(have) !== want) return false;
  }
  return true;
}
function descendants(node, out = []) {
  for (const c of node.children) { out.push(c); descendants(c, out); }
  return out;
}
function matchChain(el, parts) {
  let idx = parts.length - 1;
  if (!matchesSimple(el, parts[idx])) return false;
  idx--;
  let anc = el.parentNode;
  while (idx >= 0 && anc) {
    if (matchesSimple(anc, parts[idx])) idx--;
    anc = anc.parentNode;
  }
  return idx < 0;
}
function queryAll(root, sel) {
  const parts = String(sel).trim().split(/\s+/);
  return descendants(root).filter((el) => matchChain(el, parts));
}
function dispatch(el, event) {
  const ev = event || {};
  ev.type = ev.type || "click";
  ev.target = ev.target || el;
  ev.preventDefault = ev.preventDefault || function () { this.defaultPrevented = true; };
  ev.stopPropagation = ev.stopPropagation || function () { this._stopped = true; };
  let node = el;
  while (node) {
    const ls = node._listeners && node._listeners[ev.type];
    if (ls) for (const fn of ls.slice()) fn.call(node, ev);
    node = node.parentNode;
  }
  return ev;
}
const click = (el) => dispatch(el, { type: "click" });

const docRoot = new StubEl("body");
const documentStub = {
  body: docRoot,
  head: new StubEl("head"),
  createElement: (t) => new StubEl(t),
  getElementById(id) {
    const all = [docRoot].concat(descendants(docRoot));
    for (const el of all) if (el.id === id) return el;
    return null;
  },
  querySelector(sel) { return queryAll(docRoot, sel)[0] || null; },
  querySelectorAll(sel) { return queryAll(docRoot, sel); },
  addEventListener() {},
  removeEventListener() {},
};

// ============================================================
// 二、global 替身
// ============================================================
global.window = global;
global.document = documentStub;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.confirm = () => true;
global.alert = () => {};
global.CA = {};

// ============================================================
// 三、mock CA.store / auth / ai / app / icon / util
// ============================================================
const clone = (x) => JSON.parse(JSON.stringify(x));

function makeStore(seed) {
  const db = clone(seed);
  let counter = 0;
  return {
    _db: db,
    get(c) { return clone(db[c] || []); },
    find(c, id) {
      for (const x of (db[c] || [])) if (x.id === id) return clone(x);
      return null;
    },
    query(c, fn) { return (db[c] || []).filter(fn).map(clone); },
    add(c, obj) {
      const now = new Date().toISOString();
      const o = Object.assign({}, clone(obj), { id: clone(obj).id || ("new_" + (++counter)) });
      if (!o.createdAt) o.createdAt = now;
      o.updatedAt = now;
      (db[c] = db[c] || []).push(o);
      return clone(o);
    },
    update(c, id, patch) {
      for (const x of (db[c] || [])) {
        if (x.id === id) { Object.assign(x, clone(patch), { updatedAt: new Date().toISOString() }); return clone(x); }
      }
      return null;
    },
    remove(c, id) {
      const l = db[c] || [];
      for (let i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); return true; }
      return false;
    },
    settings() { return clone(db.settings || {}); },
    setSettings(patch) { db.settings = Object.assign({}, db.settings, patch); },
    reset() {},
    uid(p) { return (p || "id") + "_test" + (++counter); },
    memberName(mid) {
      const m = (db.members || []).filter((x) => x.id === mid)[0];
      return m ? m.name : "";
    },
  };
}

const users = {
  u_t: { id: "u_t", name: "王老师", role: "superAdmin", title: "班主任" },
  u_a: { id: "u_a", name: "李思远", role: "admin", title: "学习委员", studentNo: "20230301" },
  u_s: { id: "u_s", name: "张天宇", role: "student", title: "学生", studentNo: "20230302" },
};
let currentId = "u_t";
CA.auth = {
  current() { return users[currentId]; },
  switchTo(id) { currentId = id; },
  list() { return [users.u_t, users.u_a, users.u_s]; },
  isAdmin() { const r = users[currentId].role; return r === "admin" || r === "superAdmin"; },
  isSuperAdmin() { return users[currentId].role === "superAdmin"; },
  can(action) {
    const r = users[currentId].role;
    if (action === "notice.publish") return r === "admin" || r === "superAdmin";
    return false;
  },
};

let aiOn = true;
let summaryCalls = [];
let surveyStatsCalls = [];
CA.ai = {
  enabled() { return aiOn; },
  surveyStats(id) {
    surveyStatsCalls.push(id);
    const s = CA.store.find("surveys", id);
    if (!s) return null;
    const base = CA.collect.computeStats(id);
    return { survey: s, total: base.total, submitted: base.submitted, missing: base.missing.slice(), questions: [] };
  },
  async summarizeResponses(id) {
    summaryCalls.push(id);
    return { markdown: "## 结论\n- **多数**支持周五下午\n- 有同学希望提前通知", stats: {} };
  },
};

CA.app = {
  toasts: [],
  toast(msg) { this.toasts.push(String(msg)); },
  openModal() {}, closeModal() {}, rerender() {},
};

CA.iconCalls = [];
CA.icon = (name, size) => {
  CA.iconCalls.push(name);
  return '<svg class="icon" data-icon="' + name + '"></svg>';
};
CA.util = { fmtSmart: (v) => (v ? "SMART(" + String(v) + ")" : "—") };

// ============================================================
// 四、测试数据 & 加载模块
// ============================================================
const seed = {
  users: Object.values(users),
  members: [
    { id: "m1", name: "李思远", studentNo: "20230301" },
    { id: "m2", name: "张天宇", studentNo: "20230302" },
    { id: "m3", name: "陈嘉怡", studentNo: "20230303" },
    { id: "m4", name: "刘一鸣", studentNo: "20230304" },
    { id: "m5", name: "林晓萌", studentNo: "20230305" },
    { id: "m6", name: "赵敏", studentNo: "20230306" },
  ],
  surveys: [
    {
      id: "sv_expired", title: "过期问卷", desc: "", status: "open", anonymous: false,
      deadline: "2026-01-01T12:00:00", createdBy: "u_t", createdAt: "2026-01-01T08:00:00.000Z",
      questions: [{ qid: "q1", type: "single", title: "选一个", required: true, options: ["A", "B"] }],
    },
    {
      id: "sv_b", title: "活动报名", desc: "请报名", status: "open", anonymous: false,
      deadline: "2026-10-15T12:00:00", createdBy: "u_a", createdAt: "2026-02-01T08:00:00.000Z",
      questions: [
        { qid: "q1", type: "single", title: "项目", required: true, options: ["跑步", "跳远"] },
        { qid: "q2", type: "text", title: "备注", required: false, options: [] },
      ],
    },
    {
      id: "sv_stat", title: "统计样本", desc: "", status: "open", anonymous: false,
      deadline: "2026-10-20T12:00:00", createdBy: "u_t", createdAt: "2026-02-02T08:00:00.000Z",
      questions: [{ qid: "q1", type: "single", title: "你的选择", required: true, options: ["A", "B", "C"] }],
    },
    {
      id: "sv_dup", title: "重复提交测试", desc: "", status: "open", anonymous: false,
      deadline: "2026-10-25T12:00:00", createdBy: "u_t", createdAt: "2026-02-03T08:00:00.000Z",
      questions: [{ qid: "q1", type: "single", title: "选项", required: true, options: ["A", "B"] }],
    },
    {
      id: "sv_a", title: "晚期问卷", desc: "", status: "open", anonymous: true,
      deadline: "2026-11-01T12:00:00", createdBy: "u_a", createdAt: "2026-02-04T08:00:00.000Z",
      questions: [{ qid: "q1", type: "single", title: "问题", required: true, options: ["X", "Y"] }],
    },
    {
      id: "sv_closed", title: "已关闭问卷", desc: "", status: "closed", anonymous: false,
      deadline: "2026-12-01T12:00:00", createdBy: "u_t", createdAt: "2026-02-05T08:00:00.000Z",
      questions: [{ qid: "q1", type: "single", title: "问题", required: true, options: ["X", "Y"] }],
    },
    {
      id: "sv_xss", title: "<img src=x onerror=alert(1)>", desc: "", status: "open", anonymous: false,
      deadline: "2026-10-30T12:00:00", createdBy: "u_t", createdAt: "2026-02-06T08:00:00.000Z",
      questions: [{ qid: "q1", type: "text", title: "文本", required: false, options: [] }],
    },
  ],
  responses: [
    { id: "r1", surveyId: "sv_stat", memberId: "m1", answers: [{ qid: "q1", value: "A" }], createdAt: "2026-02-10T10:00:00.000Z" },
    { id: "r2", surveyId: "sv_stat", memberId: "m2", answers: [{ qid: "q1", value: "B" }], createdAt: "2026-02-10T10:00:00.000Z" },
    { id: "r3", surveyId: "sv_stat", memberId: "m3", answers: [{ qid: "q1", value: "A" }], createdAt: "2026-02-10T10:00:00.000Z" },
    { id: "r4", surveyId: "sv_stat", memberId: "m4", answers: [{ qid: "q1", value: "C" }], createdAt: "2026-02-10T10:00:00.000Z" },
    { id: "rx", surveyId: "sv_xss", memberId: "m1", answers: [{ qid: "q1", value: "<script>alert(1)</script>" }], createdAt: "2026-02-10T10:00:00.000Z" },
  ],
  favorites: [], subjects: [], exams: [], scores: [],
  settings: { currentUserId: "u_t", aiEnabled: true },
};

CA.store = makeStore(seed);
require(path.join(__dirname, "..", "src", "collect.js"));

// ============================================================
// 五、断言工具
// ============================================================
let passCount = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { passCount++; console.log("  ✓ " + msg); }
  else { failCount++; console.error("  ✗ " + msg); throw new Error("断言失败: " + msg); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { await tick(); await tick(); await tick(); };

const root = document.createElement("section");
document.body.appendChild(root);

function setUser(id) { currentId = id; }
function remount() { if (CA.views.collect) CA.views.collect.unmount(); CA.views.collect.mount(root); }
function rows() { return root.querySelectorAll("#collect-list .list-row"); }
function rowIds() { return rows().map((r) => r.dataset.surveyId); }
function row(id) { return rows().filter((r) => r.dataset.surveyId === id)[0]; }
function byText(nodes, text) { return nodes.filter((n) => n.textContent.indexOf(text) >= 0)[0]; }

(async () => {
  console.log("\n== A. 骨架与 DOM id ==");
  setUser("u_t");
  remount();
  ["#collect-list", "#btn-collect-new", "#collect-detail", "#collect-form"].forEach((id) => {
    ok(root.querySelector(id) !== null, "存在 " + id);
  });
  ok(root.querySelector("#btn-ai-summary") !== null && root.querySelector("#ai-summary-box") !== null,
    "管理端挂载即存在 #btn-ai-summary / #ai-summary-box（默认隐藏）");
  ok(root.querySelector("#btn-collect-new").hidden === false, "管理员可见「新建收集」");
  ok(root.querySelector("#collect-form").hidden === true, "表单默认隐藏");

  console.log("\n== B. 列表：按截止排序 / 状态 / 进度 / 匿名 ==");
  ok(rowIds().join(",") === "sv_expired,sv_b,sv_stat,sv_dup,sv_xss,sv_a,sv_closed",
    "按截止时间升序：" + rowIds().join(","));
  ok(byText(row("sv_b").querySelectorAll(".list-meta span"), "SMART(") !== undefined, "截止时间走 fmtSmart（非 ISO 直出）");
  ok(byText(row("sv_stat").querySelectorAll(".chip"), "已交") !== undefined, "提交进度以 chip 呈现");
  ok(row("sv_stat").querySelector(".chip").textContent === "已交 4/6", "进度文案 已交 4/6");
  ok(byText(row("sv_a").querySelectorAll(".badge"), "匿名") !== undefined, "匿名收集有标记");
  ok(byText(row("sv_expired").querySelectorAll(".badge"), "已截止") !== undefined, "过期显示「已截止」");
  ok(byText(row("sv_closed").querySelectorAll(".badge"), "已关闭") !== undefined, "关闭显示「已关闭」");
  ok(CA.iconCalls.indexOf("clock") >= 0 && CA.iconCalls.indexOf("clipboard") >= 0, "图标统一走 CA.icon()");

  console.log("\n== C. 创建收集表：字段完整 ==");
  const before = CA.store.get("surveys").length;
  click(root.querySelector("#btn-collect-new"));
  ok(root.querySelector("#collect-form").hidden === false, "点击新建 → 表单展开");
  const form = root.querySelector("#collect-form");
  form.querySelector('[name="title"]').value = "新问卷标题";
  form.querySelector('[name="desc"]').value = "这是说明";
  form.querySelector('[name="deadline"]').value = "2026-12-10T18:00";
  form.querySelector('[name="anonymous"]').checked = true;
  click(form.querySelector("#btn-collect-add-q"));
  let items = form.querySelectorAll(".q-item");
  ok(items.length === 2, "默认 1 题 + 添加后 2 题");
  items[0].querySelector('[name="q_title"]').value = "你的选择";
  const opts0 = items[0].querySelectorAll('[name="q_option"]');
  opts0[0].value = "选项一";
  opts0[1].value = "选项二";
  const typeSel = items[1].querySelector('[name="q_type"]');
  typeSel.value = "text";
  dispatch(typeSel, { type: "change" });
  items = form.querySelectorAll(".q-item");
  items[1].querySelector('[name="q_title"]').value = "补充说明";

  dispatch(form, { type: "submit" });
  let surveys = CA.store.get("surveys");
  ok(surveys.length === before + 1, "创建后 surveys 数量 +1");
  const created = surveys[surveys.length - 1];
  ok(created.title === "新问卷标题" && created.desc === "这是说明", "标题/说明正确");
  ok(created.status === "open" && created.anonymous === true, "status/anonymous 正确");
  ok(created.deadline === "2026-12-10T18:00", "deadline 正确");
  ok(created.createdBy === "u_t", "createdBy = 当前用户");
  ok(!!created.createdAt && !!created.updatedAt, "createdAt/updatedAt 由 store 生成");
  ok(/^sv_/.test(created.id), "id 以 sv 前缀（CA.store.uid）");
  ok(Array.isArray(created.questions) && created.questions.length === 2, "questions 数量正确");
  ok(!!created.questions[0].qid && created.questions[0].type === "single" &&
     created.questions[0].required === true &&
     created.questions[0].options.join("/") === "选项一/选项二", "单选题目字段完整");
  ok(created.questions[1].type === "text" && Array.isArray(created.questions[1].options) &&
     created.questions[1].options.length === 0, "文本题 options 为空");
  ok(root.querySelector("#collect-form").hidden === true, "提交后表单收起");

  console.log("\n== D. 校验：缺标题 / 缺选项被拦截 ==");
  click(root.querySelector("#btn-collect-new"));
  const bad = root.querySelector("#collect-form");
  dispatch(bad, { type: "submit" });
  ok(CA.store.get("surveys").length === before + 1, "非法提交不写入");
  ok(root.querySelector("#collect-form").hidden === false, "校验失败表单保持展开");
  ok(CA.collect.validate({ title: "", questions: [] }).ok === false, "validate 空草案不通过");
  ok(CA.collect.validate({
    title: "x", deadline: "2026-12-01T10:00",
    questions: [{ type: "single", title: "q", required: true, options: ["a", "a"] }],
  }).ok === false, "重复选项判为非法");
  ok(CA.collect.validate({
    title: "x", deadline: "2026-12-01T10:00",
    questions: [{ type: "text", title: "q", required: false, options: [] }],
  }).ok === true, "合法草案通过");
  click(byText(root.querySelectorAll("#collect-form .form-actions .btn"), "取消"));
  ok(root.querySelector("#collect-form").hidden === true, "取消后表单收起");

  console.log("\n== E. 统计：票数 / 百分比 / 未提交名单 ==");
  const st = CA.collect.stats("sv_stat");
  ok(st.submitted === 4 && st.total === 6, "已交 4 / 总 6");
  ok(st.questions[0].counts.A === 2 && st.questions[0].counts.B === 1 && st.questions[0].counts.C === 1, "票数 A2/B1/C1");
  const bd = st.questions[0].breakdown;
  ok(bd.filter((b) => b.label === "A")[0].percent === 50, "A 占比 50%");
  ok(bd.filter((b) => b.label === "B")[0].percent === 25, "B 占比 25%");
  ok(st.missing.length === 2 && st.missing.indexOf("林晓萌") >= 0 && st.missing.indexOf("赵敏") >= 0,
    "未提交名单 = 林晓萌、赵敏");
  ok(surveyStatsCalls.indexOf("sv_stat") >= 0, "统计复用 CA.ai.surveyStats");

  click(row("sv_stat"));
  ok(root.querySelector("#collect-detail").hidden === false, "点击列表 → 详情展开");
  const optCounts = root.querySelectorAll("#collect-detail .opt-count").map((n) => n.textContent);
  ok(optCounts.join("|").indexOf("2 票（50%）") >= 0, "结果渲染票数 + 百分比进度条文案");
  ok(root.querySelectorAll("#collect-detail .bar>i").length === 3, "每个选项一条百分比进度条");
  const missingText = root.querySelector("#collect-detail").textContent;
  ok(missingText.indexOf("未提交名单") >= 0 && missingText.indexOf("林晓萌") >= 0, "管理端显示未提交名单");

  console.log("\n== F. AI 汇总调用链 ==");
  ok(root.querySelector("#btn-ai-summary") !== null, "管理端存在 #btn-ai-summary");
  ok(root.querySelector("#ai-summary-box") !== null, "管理端存在 #ai-summary-box");
  summaryCalls = [];
  click(root.querySelector("#btn-ai-summary"));
  await flush();
  ok(summaryCalls.indexOf("sv_stat") >= 0, "调用 CA.ai.summarizeResponses");
  const boxHtml = root.querySelector("#ai-summary-box").innerHTML;
  ok(boxHtml.indexOf("<h3>") >= 0 && boxHtml.indexOf("<strong>") >= 0 && boxHtml.indexOf("<ul>") >= 0,
    "markdown 渲染为 h3 / strong / ul");

  const md = CA.collect.renderMarkdown("## 标题\n- **粗体**项\n普通段落");
  ok(md.indexOf("<h3>标题</h3>") >= 0 && md.indexOf("<strong>粗体</strong>") >= 0 &&
     md.indexOf("<li>") >= 0 && md.indexOf("<p>普通段落</p>") >= 0, "renderMarkdown 支持 ##/**/ -");

  console.log("\n== G. 关闭 / 重开 ==");
  click(byText(root.querySelectorAll("#collect-detail .btn"), "关闭收集"));
  ok(CA.store.find("surveys", "sv_stat").status === "closed", "关闭写入 status=closed");
  click(byText(root.querySelectorAll("#collect-detail .btn"), "重新开启"));
  ok(CA.store.find("surveys", "sv_stat").status === "open", "重开写入 status=open");

  console.log("\n== H. 学生视角：只列进行中 / 已截止不可填 ==");
  setUser("u_s");
  remount();
  ok(root.querySelector("#btn-collect-new").hidden === true, "学生看不到「新建」");
  ok(rowIds().indexOf("sv_closed") < 0, "学生列表不含已关闭收集");
  ok(byText(row("sv_b").querySelectorAll(".badge"), "待填写") !== undefined, "未提交显示待填写");
  click(row("sv_expired"));
  ok(root.querySelector("#collect-detail").textContent.indexOf("无法提交") >= 0, "过期收集学生不可填写");
  ok(root.querySelector("#collect-detail").querySelector("#collect-fill-form") === null, "过期不渲染填写表单");
  ok(root.querySelector("#btn-ai-summary") === null && root.querySelector("#ai-summary-box") === null,
    "学生看不到 AI 汇总按钮/容器（隐私）");
  ok(root.querySelector("#collect-detail").textContent.indexOf("未提交名单") < 0, "学生看不到未提交名单");

  console.log("\n== I. 学生提交 / 重复提交为更新 ==");
  click(row("sv_dup"));
  let fill = root.querySelector("#collect-fill-form");
  ok(fill !== null, "点击进行中收集 → 渲染填写表单");
  // 必填校验：不选直接提交
  dispatch(fill, { type: "submit" });
  ok(CA.store.query("responses", (r) => r.surveyId === "sv_dup").length === 0, "必填未选 → 不写入");
  ok(CA.app.toasts.indexOf("选项 为必填") >= 0, "必填校验给出提示");

  // 正常提交
  const radios = fill.querySelectorAll('[name="ans_q1"]');
  ok(radios.length === 2, "单选渲染为 radio 组");
  radios[0].checked = true;
  dispatch(fill, { type: "submit" });
  let dupRes = CA.store.query("responses", (r) => r.surveyId === "sv_dup" && r.memberId === "m2");
  ok(dupRes.length === 1, "提交写入一条 response");
  ok(dupRes[0].answers.length === 1 && dupRes[0].answers[0].qid === "q1" && dupRes[0].answers[0].value === "A",
    "答案值正确写入");
  ok(root.querySelector("#collect-detail").textContent.indexOf("已提交") >= 0, "提交后显示已提交状态");
  ok(root.querySelector("#collect-detail").textContent.indexOf("选项一") < 0 &&
     root.querySelector("#collect-detail").textContent.indexOf("A") >= 0, "提交后展示自己的答案");

  // 修改提交 → 更新而非新增
  const modifyBtn = byText(root.querySelectorAll("#collect-detail .form-actions .btn"), "修改提交");
  ok(modifyBtn !== undefined, "存在「修改提交」入口");
  click(modifyBtn);
  fill = root.querySelector("#collect-fill-form");
  const radios2 = fill.querySelectorAll('[name="ans_q1"]');
  radios2[1].checked = true; radios2[0].checked = false;
  dispatch(fill, { type: "submit" });
  dupRes = CA.store.query("responses", (r) => r.surveyId === "sv_dup" && r.memberId === "m2");
  ok(dupRes.length === 1, "重复提交数量不变（更新而非新增）");
  ok(dupRes[0].answers[0].value === "B", "重复提交覆盖为新答案");
  ok(CA.store.get("responses").filter((r) => r.surveyId === "sv_dup").length === 1, "库中仍只有一条 sv_dup 记录");

  // 学生列表显示已提交徽标
  remount();
  ok(byText(row("sv_dup").querySelectorAll(".badge"), "已提交") !== undefined, "已提交的学生列表带「已提交」徽标");

  console.log("\n== J. XSS 转义 ==");
  remount();
  const xssRow = row("sv_xss");
  ok(xssRow.querySelector(".list-title-text").textContent === "<img src=x onerror=alert(1)>",
    "标题按纯文本渲染");
  ok(xssRow.querySelectorAll("img").length === 0, "未注入 img 元素");
  setUser("u_t");
  remount();
  click(row("sv_xss"));
  const textItem = root.querySelector("#collect-detail .text-item");
  ok(textItem !== null && textItem.textContent.indexOf("<script>alert(1)</script>") >= 0,
    "文本回答按纯文本渲染");
  ok(root.querySelectorAll("#collect-detail script").length === 0, "未注入 script 元素");
  const mdXss = CA.collect.renderMarkdown("### <img src=x onerror=alert(1)>");
  ok(mdXss.indexOf("&lt;img") >= 0 && mdXss.indexOf("<img") < 0, "renderMarkdown 先转义再解析");

  console.log("\n== K. AI 关闭 / 学生权限 ==");
  aiOn = false;
  setUser("u_t");
  remount();
  click(row("sv_stat"));
  ok(root.querySelector("#btn-ai-summary").hidden === true, "AI 关闭 → 汇总按钮隐藏");
  ok(root.querySelector("#ai-summary-box").textContent.indexOf("未开启") >= 0 ||
     root.querySelector("#ai-summary-box").innerHTML.indexOf("未开启") >= 0, "AI 关闭有提示文案");
  aiOn = true;

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过 ✅"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
