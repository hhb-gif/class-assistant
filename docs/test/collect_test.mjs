// 信息收集模块自测（P1b 异步迁移版）
// 运行：node docs/test/collect_test.mjs（在 class-assistant 目录下）
// 零依赖：自带极简 DOM 桩 + mock（异步）CA.store / CA.auth / CA.ai / CA.app / CA.icon / CA.util
// 覆盖：列表按截止排序、创建字段完整、学生提交、重复提交为更新、统计票数/百分比、未提交名单、
//       AI 汇总调用链、XSS 转义、权限（学生看不到新建/汇总）、异步 loading/错误态。
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

// 类 NodeList：只有 length / 数字索引 / item() / forEach，故意不提供 map/filter/slice，
// 用来暴露「在 querySelectorAll 结果上直接调数组方法」这类真实浏览器才会炸的 bug。
class StubNodeList {
  constructor(items) {
    const list = items || [];
    this.length = list.length;
    for (let i = 0; i < list.length; i++) this[i] = list[i];
  }
  item(i) { return this[i] != null ? this[i] : null; }
  forEach(cb, thisArg) {
    for (let i = 0; i < this.length; i++) cb.call(thisArg, this[i], i, this);
  }
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
  scrollIntoView() {}
  closest(sel) {
    let node = this;
    while (node) { if (matchesSimple(node, sel)) return node; node = node.parentNode; }
    return null;
  }
  querySelectorAll(sel) { return new StubNodeList(queryAll(this, sel)); }
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
  querySelectorAll(sel) { return new StubNodeList(queryAll(docRoot, sel)); },
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
// 三、mock CA.store / auth / ai / app / icon / util（全部异步，贴合 PG store）
// ============================================================
const clone = (x) => JSON.parse(JSON.stringify(x));

function makeStore(seed) {
  const db = clone(seed);
  let counter = 0;
  return {
    _db: db,
    get(c) { return Promise.resolve(clone(db[c] || [])); },
    find(c, id) {
      for (const x of (db[c] || [])) if (x.id === id) return Promise.resolve(clone(x));
      return Promise.resolve(null);
    },
    query(c, fn) { return Promise.resolve((db[c] || []).filter(fn).map(clone)); },
    add(c, obj) {
      const now = new Date().toISOString();
      const o = Object.assign({}, clone(obj), { id: clone(obj).id || ("new_" + (++counter)) });
      if (!o.createdAt) o.createdAt = now;
      o.updatedAt = now;
      (db[c] = db[c] || []).push(o);
      return Promise.resolve(clone(o));
    },
    update(c, id, patch) {
      for (const x of (db[c] || [])) {
        if (x.id === id) { Object.assign(x, clone(patch), { updatedAt: new Date().toISOString() }); return Promise.resolve(clone(x)); }
      }
      return Promise.resolve(null);
    },
    remove(c, id) {
      const l = db[c] || [];
      for (let i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); return Promise.resolve(true); }
      return Promise.resolve(false);
    },
    settings() { return clone(db.settings || {}); },
    setSettings(patch) { db.settings = Object.assign({}, db.settings, patch); },
    reset() { return Promise.resolve(true); },
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
  current() { return Promise.resolve(clone(users[currentId])); },
  list() { return Promise.resolve([users.u_t, users.u_a, users.u_s].map(clone)); },
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
  async surveyStats(id) {
    surveyStatsCalls.push(id);
    const s = await CA.store.find("surveys", id);
    if (!s) return null;
    const base = await CA.collect.computeStats(id);
    return { survey: s, total: base.total, submitted: base.submitted, missing: base.missing.slice(), questions: [] };
  },
  async summarizeResponses(id) {
    summaryCalls.push(id);
    return { markdown: "## 结论\n- **多数**支持周五下午\n- 有同学希望提前通知", stats: {} };
  },
  composeAnswerCalls: [],
  async composeAnswer(input) {
    this.composeAnswerCalls.push(input);
    return "AI 生成草稿内容";
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

// 云端 RPC 桩：可控（记录调用参数、内存匿名提交、可强制失败）
let rpcCalls = [];
let rpcFail = null;
const anonStore = {};   // surveyId -> { token -> answers }
CA.cloud = {
  app: {
    rdb() {
      return {
        rpc(fn, params) {
          rpcCalls.push({ fn, params: clone(params) });
          if (rpcFail) return Promise.reject(new Error("rpc 网络中断"));
          if (fn === "submit_anonymous") {
            const k = params.p_survey_id;
            anonStore[k] = anonStore[k] || {};
            anonStore[k][params.p_token] = clone(params.p_answers);
            return Promise.resolve({ data: { ok: true }, error: null });
          }
          if (fn === "my_anonymous") {
            const rec = (anonStore[params.p_survey_id] || {})[params.p_token];
            if (rec) return Promise.resolve({ data: { ok: true, found: true, answers: clone(rec) }, error: null });
            return Promise.resolve({ data: { ok: true, found: false, answers: null }, error: null });
          }
          if (fn === "anon_summary") {
            const subs = Object.values(anonStore[params.p_survey_id] || {});
            const perQ = {};
            subs.forEach((ans) => (ans || []).forEach((a) => {
              const vals = Array.isArray(a.value) ? a.value : [a.value];
              perQ[a.qid] = perQ[a.qid] || {};
              vals.forEach((v) => { if (v != null && v !== "") perQ[a.qid][v] = (perQ[a.qid][v] || 0) + 1; });
            }));
            const s = (seed.surveys || []).filter((x) => x.id === params.p_survey_id)[0];
            const questions = ((s && s.questions) || []).map((q) => {
              const c = perQ[q.qid] || {};
              return {
                qid: q.qid, type: q.type, title: q.title, options: q.options || [],
                counts: q.type === "text" ? {} : c,
                texts: q.type === "text" ? Object.keys(c) : [],
              };
            });
            return Promise.resolve({ data: { ok: true, submitted: subs.length, questions }, error: null });
          }
          return Promise.resolve({ data: { ok: true }, error: null });
        },
      };
    },
  },
};

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
// 异步渲染涉及多层 Promise，多轮 tick 确保全部落定
const flush = async (n = 16) => { for (let i = 0; i < n; i++) await tick(); };

const root = document.createElement("section");
document.body.appendChild(root);

function setUser(id) { currentId = id; }
async function remount() {
  if (CA.views.collect) CA.views.collect.unmount();
  await CA.views.collect.mount(root);
  await flush();
}
function rows() { return root.querySelectorAll("#collect-list .list-row"); }
// querySelectorAll 返回类 NodeList（无 map/filter），测试自身也要先 slice 成真数组
const toArr = (l) => Array.prototype.slice.call(l || []);
function rowIds() { return toArr(rows()).map((r) => r.dataset.surveyId); }
function row(id) { return toArr(rows()).filter((r) => r.dataset.surveyId === id)[0]; }
function byText(nodes, text) { return toArr(nodes).filter((n) => n.textContent.indexOf(text) >= 0)[0]; }

(async () => {
  console.log("\n== A. 骨架与 DOM id ==");
  setUser("u_t");
  await remount();
  ["#collect-list", "#btn-collect-new", "#collect-detail", "#collect-form"].forEach((id) => {
    ok(root.querySelector(id) !== null, "存在 " + id);
  });
  ok(root.querySelector("#btn-ai-summary") !== null && root.querySelector("#ai-summary-box") !== null,
    "管理端挂载即存在 #btn-ai-summary / #ai-summary-box（默认隐藏）");
  ok(root.querySelector("#btn-collect-new").hidden === false, "管理员可见「新建收集」");
  ok(root.querySelector("#collect-form").hidden === true, "表单默认隐藏");
  ok(root.querySelector("#btn-collect-new").className.indexOf("admin-only") >= 0,
    "管理动作按钮带 .admin-only（角色化）");

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
  const before = (await CA.store.get("surveys")).length;
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
  await flush();
  let surveys = await CA.store.get("surveys");
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
  await flush();
  const bad = root.querySelector("#collect-form");
  dispatch(bad, { type: "submit" });
  await flush();
  ok((await CA.store.get("surveys")).length === before + 1, "非法提交不写入");
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
  const st = await CA.collect.stats("sv_stat");
  ok(st.submitted === 4 && st.total === 6, "已交 4 / 总 6");
  ok(st.questions[0].counts.A === 2 && st.questions[0].counts.B === 1 && st.questions[0].counts.C === 1, "票数 A2/B1/C1");
  const bd = st.questions[0].breakdown;
  ok(bd.filter((b) => b.label === "A")[0].percent === 50, "A 占比 50%");
  ok(bd.filter((b) => b.label === "B")[0].percent === 25, "B 占比 25%");
  ok(st.missing.length === 2 && st.missing.indexOf("林晓萌") >= 0 && st.missing.indexOf("赵敏") >= 0,
    "未提交名单 = 林晓萌、赵敏");
  ok(surveyStatsCalls.indexOf("sv_stat") >= 0, "统计尽力复用 CA.ai.surveyStats");

  click(row("sv_stat"));
  await flush();
  ok(root.querySelector("#collect-detail").hidden === false, "点击列表 → 详情展开");
  const optCounts = toArr(root.querySelectorAll("#collect-detail .opt-count")).map((n) => n.textContent);
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
  await flush();
  ok((await CA.store.find("surveys", "sv_stat")).status === "closed", "关闭写入 status=closed");
  click(byText(root.querySelectorAll("#collect-detail .btn"), "重新开启"));
  await flush();
  ok((await CA.store.find("surveys", "sv_stat")).status === "open", "重开写入 status=open");

  console.log("\n== G2. 列表点击 toggle（再点同一条 → 收起） ==");
  ok(row("sv_stat").getAttribute("aria-expanded") === "true" &&
     row("sv_stat").className.indexOf("is-active") >= 0, "已选中项：.is-active + aria-expanded=true");
  click(row("sv_stat"));   // 再点同一条
  await flush();
  ok(root.querySelector("#collect-detail").hidden === true, "再次点击同一条 → 详情收起（hidden）");
  ok(root.querySelector("#collect-detail").children.length === 0, "收起后详情内容清空");
  ok(row("sv_stat").getAttribute("aria-expanded") === "false" &&
     row("sv_stat").className.indexOf("is-active") < 0, "收起后列表项移除 .is-active / aria-expanded=false");
  // 点另一条：选中态转移，仍正常展开
  click(row("sv_b"));
  await flush();
  ok(root.querySelector("#collect-detail").hidden === false, "点击另一条 → 详情展开");
  ok(row("sv_b").getAttribute("aria-expanded") === "true" &&
     row("sv_stat").getAttribute("aria-expanded") === "false", "选中态转移到 sv_b");
  click(row("sv_b"));   // 再点当前条
  await flush();
  ok(root.querySelector("#collect-detail").hidden === true, "再次点击当前条 → 再次收起");

  console.log("\n== H. 学生视角：只列进行中 / 已截止不可填 ==");
  setUser("u_s");
  await remount();
  ok(root.querySelector("#btn-collect-new").hidden === true, "学生看不到「新建」");
  ok(rowIds().indexOf("sv_closed") < 0, "学生列表不含已关闭收集");
  ok(byText(row("sv_b").querySelectorAll(".badge"), "待填写") !== undefined, "未提交显示待填写");
  click(row("sv_expired"));
  await flush();
  ok(root.querySelector("#collect-detail").textContent.indexOf("无法提交") >= 0, "过期收集学生不可填写");
  ok(root.querySelector("#collect-detail").querySelector("#collect-fill-form") === null, "过期不渲染填写表单");
  ok(root.querySelector("#btn-ai-summary") === null && root.querySelector("#ai-summary-box") === null,
    "学生看不到 AI 汇总按钮/容器（隐私）");
  ok(root.querySelector("#collect-detail").textContent.indexOf("未提交名单") < 0, "学生看不到未提交名单");

  console.log("\n== I. 学生提交 / 重复提交为更新 ==");
  click(row("sv_dup"));
  await flush();
  let fill = root.querySelector("#collect-fill-form");
  ok(fill !== null, "点击进行中收集 → 渲染填写表单");
  // 必填校验：不选直接提交
  dispatch(fill, { type: "submit" });
  await flush();
  ok((await CA.store.query("responses", (r) => r.surveyId === "sv_dup")).length === 0, "必填未选 → 不写入");
  ok(CA.app.toasts.indexOf("选项 为必填") >= 0, "必填校验给出提示");

  // 正常提交
  const radios = fill.querySelectorAll('[name="ans_q1"]');
  ok(radios.length === 2, "单选渲染为 radio 组");
  radios[0].checked = true;
  dispatch(fill, { type: "submit" });
  await flush();
  let dupRes = await CA.store.query("responses", (r) => r.surveyId === "sv_dup" && r.memberId === "m2");
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
  await flush();
  fill = root.querySelector("#collect-fill-form");
  const radios2 = fill.querySelectorAll('[name="ans_q1"]');
  radios2[1].checked = true; radios2[0].checked = false;
  dispatch(fill, { type: "submit" });
  await flush();
  dupRes = await CA.store.query("responses", (r) => r.surveyId === "sv_dup" && r.memberId === "m2");
  ok(dupRes.length === 1, "重复提交数量不变（更新而非新增）");
  ok(dupRes[0].answers[0].value === "B", "重复提交覆盖为新答案");
  ok((await CA.store.get("responses")).filter((r) => r.surveyId === "sv_dup").length === 1, "库中仍只有一条 sv_dup 记录");

  // 学生列表显示已提交徽标
  await remount();
  ok(byText(row("sv_dup").querySelectorAll(".badge"), "已提交") !== undefined, "已提交的学生列表带「已提交」徽标");
  ok(row("sv_dup").querySelector(".student-only") !== null, "学生状态标记带 .student-only（角色化）");

  console.log("\n== I2. 学生文本题：AI 帮我写 ==");
  setUser("u_s");
  await remount();
  click(row("sv_b"));
  await flush();
  const fill2 = root.querySelector("#collect-fill-form");
  ok(fill2 !== null, "进行中收集渲染填写表单（sv_b）");
  const aiComposeBtn = root.querySelector("#btn-ai-compose-q2");
  ok(aiComposeBtn !== null, "文本题出现 #btn-ai-compose-<qid> 入口");
  ok(aiComposeBtn.className.indexOf("btn-ai") >= 0, "AI 入口使用 .btn-ai（DESIGN §4.4）");
  ok(aiComposeBtn.closest(".student-only") !== null, "AI 入口带 .student-only（角色化）");
  ok(root.querySelector("#btn-ai-compose-q1") === null, "仅文本题有 AI 入口（单选题无）");

  const ta2 = fill2.querySelector('[name="ans_q2"]');
  CA.ai.composeAnswerCalls = [];
  global.confirm = () => true;
  ta2.value = "我自己的草稿";
  click(aiComposeBtn);
  await flush();
  ok(CA.ai.composeAnswerCalls.length === 1, "点击 → 调用 CA.ai.composeAnswer");
  ok(CA.ai.composeAnswerCalls[0].question === "备注", "question 传题目 title");
  ok(CA.ai.composeAnswerCalls[0].hints === "请报名", "hints 回退到问卷说明（文本题无 options）");
  ok(ta2.value === "AI 生成草稿内容", "返回文本填入 textarea（确认替换后）");
  ok(CA.app.toasts.indexOf("已生成草稿，可修改") >= 0, "提示「已生成草稿，可修改」");

  global.confirm = () => false;
  ta2.value = "保留我写的";
  const callsBefore = CA.ai.composeAnswerCalls.length;
  click(aiComposeBtn);
  await flush();
  ok(ta2.value === "保留我写的", "已有内容且拒绝覆盖 → 保留原值");
  ok(CA.ai.composeAnswerCalls.length === callsBefore, "拒绝覆盖时不调用 AI");
  global.confirm = () => true;

  const realCompose = CA.ai.composeAnswer;
  CA.ai.composeAnswer = async () => { throw new Error("AI 生成失败测试"); };
  const toastCount = CA.app.toasts.length;
  click(aiComposeBtn);
  await flush();
  ok(CA.app.toasts.slice(toastCount).some((t) => t.indexOf("AI 生成失败测试") >= 0), "失败 → try/catch + toast");
  CA.ai.composeAnswer = realCompose;

  aiOn = false;
  await remount();
  click(row("sv_b"));
  await flush();
  ok(root.querySelector("#btn-ai-compose-q2") === null, "AI 关闭 → 不渲染 AI 入口");
  aiOn = true;

  console.log("\n== J. XSS 转义 ==");
  await remount();
  const xssRow = row("sv_xss");
  ok(xssRow.querySelector(".list-title-text").textContent === "<img src=x onerror=alert(1)>",
    "标题按纯文本渲染");
  ok(xssRow.querySelectorAll("img").length === 0, "未注入 img 元素");
  setUser("u_t");
  await remount();
  click(row("sv_xss"));
  await flush();
  const textItem = root.querySelector("#collect-detail .text-item");
  ok(textItem !== null && textItem.textContent.indexOf("<script>alert(1)</script>") >= 0,
    "文本回答按纯文本渲染");
  ok(root.querySelectorAll("#collect-detail script").length === 0, "未注入 script 元素");
  const mdXss = CA.collect.renderMarkdown("### <img src=x onerror=alert(1)>");
  ok(mdXss.indexOf("&lt;img") >= 0 && mdXss.indexOf("<img") < 0, "renderMarkdown 先转义再解析");

  console.log("\n== K. AI 关闭 / 学生权限 ==");
  aiOn = false;
  setUser("u_t");
  await remount();
  click(row("sv_stat"));
  await flush();
  ok(root.querySelector("#btn-ai-summary").hidden === true, "AI 关闭 → 汇总按钮隐藏");
  ok(root.querySelector("#ai-summary-box").textContent.indexOf("未开启") >= 0 ||
     root.querySelector("#ai-summary-box").innerHTML.indexOf("未开启") >= 0, "AI 关闭有提示文案");
  aiOn = true;

  console.log("\n== L. 匿名提交（学生端 RPC 链路） ==");
  setUser("u_s");
  await remount();
  ok(row("sv_a") !== undefined && byText(row("sv_a").querySelectorAll(".badge"), "待填写") === undefined,
    "匿名学生列表不做同步「待填写」判断");
  rpcCalls = [];
  click(row("sv_a"));
  await flush();
  ok(rpcCalls.some((c) => c.fn === "my_anonymous" && c.params.p_survey_id === "sv_a"),
    "打开匿名问卷 → 调 my_anonymous");
  const afill = root.querySelector("#collect-fill-form");
  ok(afill !== null, "匿名未提交 → 渲染填写表单");
  ok(root.querySelector("#collect-detail").textContent.indexOf("换设备") >= 0, "匿名填写页有「仅本机」提示");

  const aradios = afill.querySelectorAll('[name="ans_q1"]');
  ok(aradios.length === 2, "匿名单选渲染为 radio 组");
  aradios[0].checked = true;
  rpcCalls = [];
  dispatch(afill, { type: "submit" });
  await flush();
  const anonSub = rpcCalls.filter((c) => c.fn === "submit_anonymous")[0];
  ok(!!anonSub, "提交匿名问卷 → 调 submit_anonymous");
  ok(anonSub.params.p_survey_id === "sv_a", "p_survey_id 正确");
  ok(/^[0-9a-f]{32,}$/.test(anonSub.params.p_token), "p_token 为 32+ 位十六进制");
  ok(Array.isArray(anonSub.params.p_answers) &&
     anonSub.params.p_answers[0].qid === "q1" && anonSub.params.p_answers[0].value === "X",
    "p_answers 为 [{qid,value}] 数组");
  ok((await CA.store.query("responses", (r) => r.surveyId === "sv_a")).length === 0,
    "匿名提交不写入 responses 表");
  ok(root.querySelector("#collect-detail").textContent.indexOf("已提交") >= 0, "提交后回显「已提交」");
  ok(byText(root.querySelectorAll("#collect-detail .form-actions .btn"), "修改提交") !== undefined,
    "提交后提供「修改提交」入口");

  // 修改提交：同一 token 覆盖，不新增记录
  const firstToken = anonSub.params.p_token;
  click(byText(root.querySelectorAll("#collect-detail .form-actions .btn"), "修改提交"));
  await flush();
  const afill2 = root.querySelector("#collect-fill-form");
  const aradios2 = afill2.querySelectorAll('[name="ans_q1"]');
  aradios2[0].checked = false; aradios2[1].checked = true;
  rpcCalls = [];
  dispatch(afill2, { type: "submit" });
  await flush();
  const anonSub2 = rpcCalls.filter((c) => c.fn === "submit_anonymous")[0];
  ok(!!anonSub2 && anonSub2.params.p_token === firstToken, "修改提交复用同一 token（本机凭据稳定）");
  ok(Object.keys(anonStore["sv_a"] || {}).length === 1, "同机重复提交只保留一条匿名记录");

  console.log("\n== M. 匿名提交（管理端聚合，不含未交名单） ==");
  setUser("u_t");
  await remount();
  ok(row("sv_a").querySelector(".chip") === null, "匿名收集管理端列表不显示「已交 X/Y」");
  rpcCalls = [];
  click(row("sv_a"));
  await flush();
  ok(rpcCalls.some((c) => c.fn === "anon_summary" && c.params.p_survey_id === "sv_a"),
    "管理端打开匿名问卷 → 调 anon_summary");
  const anonDetText = root.querySelector("#collect-detail").textContent;
  ok(anonDetText.indexOf("未提交名单") < 0, "匿名管理端不渲染「未提交名单」");
  ok(anonDetText.indexOf("未提交") < 0, "匿名 KPI 不含「未提交」反推");
  ok(anonDetText.indexOf("已提交") >= 0, "匿名管理端显示「已提交」");
  ok(root.querySelectorAll("#collect-detail .opt-row").length === 2, "按问卷选项渲染聚合票数条");
  ok(anonDetText.indexOf("1 票（100%）") >= 0, "聚合票数正确（修改后为 Y 1 票）");
  ok(anonDetText.indexOf("李思远") < 0 && anonDetText.indexOf("张天宇") < 0,
    "聚合结果不含任何成员姓名");

  console.log("\n== N. computeStats 匿名分支（回归非匿名） ==");
  const anonStats = await CA.collect.computeStats("sv_a");
  ok(anonStats && anonStats.anonymous === true, "匿名 computeStats 标记 anonymous");
  ok(Array.isArray(anonStats.missing) && anonStats.missing.length === 0, "匿名 missing = []");
  ok(Array.isArray(anonStats.missingIds) && anonStats.missingIds.length === 0, "匿名 missingIds = []");
  const nonAnonStats = await CA.collect.computeStats("sv_stat");
  ok(nonAnonStats.missing.length === 2 && nonAnonStats.missingIds.length === 2,
    "非匿名 computeStats 仍返回未提交名单（回归）");

  console.log("\n== O. genAnonToken（纯函数） ==");
  ok(typeof CA.collect.genAnonToken === "function", "对外暴露 genAnonToken");
  const t1 = CA.collect.genAnonToken();
  const t2 = CA.collect.genAnonToken();
  ok(/^[0-9a-f]{32,}$/.test(t1), "token 为 32+ 位十六进制（字符集/长度）");
  ok(t1 !== t2, "两次生成不同");
  ok(CA.collect.anonToken("sv_a") === CA.collect.anonToken("sv_a"), "anonToken 在本机稳定复用");

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
