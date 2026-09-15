// 设置页自测（WS-D：班级成员管理 / 账号管理 / 数据管理）
// 运行：node docs/test/settings_test.mjs（在 class-assistant 目录下）
// 零依赖：极简 DOM 桩 + mock（异步）CA.store / CA.auth / CA.ai / CA.llm / CA.cloud / CA.util
// 覆盖：管理员名单增删改（含级联删 scores）、学生无入口、账号管理（App 内不提供建号/重置，仅中性说明）、
//       数据管理（真实导出 JSON / 两级确认重置）。
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 一、极简 DOM 桩
// ============================================================
function camel(name) { return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

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

function makeClassList(el) {
  const read = () => (el.attributes["class"] || "").split(/\s+/).filter(Boolean);
  const write = (arr) => { el.attributes["class"] = arr.join(" "); };
  return {
    add() { const l = read(); for (const n of arguments) if (l.indexOf(n) < 0) l.push(n); write(l); },
    remove() { let l = read(); for (const n of arguments) l = l.filter((x) => x !== n); write(l); },
    contains(n) { return read().indexOf(n) >= 0; },
    toggle(n, force) {
      const has = read().indexOf(n) >= 0;
      const on = force === undefined ? !has : !!force;
      if (on) this.add(n); else this.remove(n);
      return on;
    },
  };
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
    this._classList = null;
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.selected = false;
  }
  get classList() { if (!this._classList) this._classList = makeClassList(this); return this._classList; }
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
    c.parentNode = this; this.children.push(c); return c;
  }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
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
  focus() {}
  blur() {}
  click() { dispatch(this, { type: "click" }); }
  closest(sel) { let n = this; while (n) { if (matchesSimple(n, sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) { return new StubNodeList(queryAll(this, sel)); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
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
  readyState: "complete",   // 让 app.js 立即 boot（进入应用 → _authed=true，rerender 生效）
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
const lsCalls = [];
const _ls = Object.create(null);
global.localStorage = {
  getItem(k) { lsCalls.push(String(k)); return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem(k, v) { _ls[k] = String(v); },
  removeItem(k) { delete _ls[k]; },
};
global.confirm = () => true;
global.prompt = () => "重置";
global.alert = () => {};
global.CA_CONFIG = { envId: "env-test", publishableKey: "pk-test", llm: { model: "deepseek-v4-flash" } };

const blobs = [];
global.Blob = class Blob {
  constructor(parts, opts) { this.parts = parts || []; this.type = opts && opts.type; blobs.push(this); }
};
global.URL = { createObjectURL() { return "blob:settings-test"; }, revokeObjectURL() {} };
global.CA = {};

// ============================================================
// 三、mock CA.store / auth / ai / llm / cloud / util
// ============================================================
const clone = (x) => JSON.parse(JSON.stringify(x));

const seed = {
  members: [
    { id: "m_a", name: "李思远", studentNo: "20230301" },
    { id: "m_b", name: "张天宇", studentNo: "20230302" },
  ],
  users: [
    { uid: "uid_a", memberId: "m_a", role: "member", displayName: "李思远", mustChangePassword: true },
  ],
  notices: [{ id: "n_1", title: "通知" }],
  favorites: [{ id: "f_1", userId: "uid_a", noticeId: "n_1" }],
  subjects: [{ id: "s_1", name: "语文" }],
  exams: [{ id: "e_1", name: "月考" }],
  scores: [
    { id: "sc_a", memberId: "m_a", examId: "e_1", subjectId: "s_1", score: 90 },
    { id: "sc_b", memberId: "m_b", examId: "e_1", subjectId: "s_1", score: 80 },
  ],
  surveys: [{ id: "sv_1", title: "问卷" }],
  responses: [{ id: "rs_a", surveyId: "sv_1", memberId: "m_a", answers: [] }],
  messages: [{ id: "msg_1", fromMemberId: "m_a", content: "hi" }],
  materials: [{ id: "mt_1", name: "课件" }],
};

const storeCalls = [];
const db = clone(seed);
const removeFailColls = {};   // 模拟指定集合删除被 RLS 静默过滤
let uidCounter = 0;
CA.store = {
  _db: db,
  init() { storeCalls.push({ op: "init" }); return Promise.resolve(true); },
  get(c) { storeCalls.push({ op: "get", coll: c }); return Promise.resolve(clone(db[c] || [])); },
  find(c, id) {
    storeCalls.push({ op: "find", coll: c, id });
    for (const x of (db[c] || [])) if (x.id === id || x.uid === id) return Promise.resolve(clone(x));
    return Promise.resolve(null);
  },
  query(c, fn) { storeCalls.push({ op: "query", coll: c }); return Promise.resolve((db[c] || []).filter(fn).map(clone)); },
  add(c, obj) {
    storeCalls.push({ op: "add", coll: c, obj: clone(obj) });
    const o = clone(obj);
    if (c === "members" && (db.members || []).some((m) => String(m.studentNo) === String(o.studentNo))) {
      const e = new Error("duplicate key value violates unique constraint");
      e.code = "23505";
      return Promise.reject(e);
    }
    (db[c] = db[c] || []).push(o);
    return Promise.resolve(clone(o));
  },
  update(c, id, patch) {
    storeCalls.push({ op: "update", coll: c, id, patch: clone(patch) });
    for (const x of (db[c] || [])) if (x.id === id) { Object.assign(x, clone(patch)); return Promise.resolve(clone(x)); }
    return Promise.resolve(null);
  },
  remove(c, id) {
    storeCalls.push({ op: "remove", coll: c, id });
    // 模拟 RLS 静默过滤：置位后该表删除失败（与 store.remove 回读校验后的抛错文案一致）
    if (removeFailColls[c]) {
      return Promise.reject(new Error("删除 " + c + " 失败：操作未生效（无权限，或该记录已被行级安全策略拒绝）"));
    }
    const l = db[c] || [];
    for (let i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); return Promise.resolve(true); }
    return Promise.resolve(false);
  },
  settings() { return { aiEnabled: true }; },
  setSettings() {},
  reset() { return Promise.resolve(true); },
  uid(p) { return (p || "id") + "_" + (++uidCounter); },
  memberName(mid) { const m = (db.members || []).filter((x) => x.id === mid)[0]; return m ? m.name : ""; },
};

const authUsers = {
  admin: { id: "uid_admin", name: "王老师", role: "superAdmin", memberId: null, studentNo: "", mustChangePassword: false },
  committee: { id: "uid_committee", name: "陈班委", role: "admin", memberId: null, studentNo: "", mustChangePassword: false },
  student: { id: "uid_a", name: "李思远", role: "member", memberId: "m_a", studentNo: "20230301", mustChangePassword: false },
};
let currentUser = authUsers.admin;
CA.auth = {
  current() { return Promise.resolve(clone(currentUser)); },
  isAdmin() { return currentUser.role === "admin" || currentUser.role === "superAdmin"; },
  isSuperAdmin() { return currentUser.role === "superAdmin"; },
  can() { return false; },
  logout() { return Promise.resolve(true); },
};

CA.ai = { enabled() { return true; }, info() { return { model: "deepseek-v4-flash" }; } };
CA.llm = { ready() { return true; } };
CA.util = { fmtDate: () => "2026-09-15" };

// 云函数桩：probe 返回可控结果（App 内已隐藏建号/重置入口，故不再断言 create/resetPassword）
let probeReply = { ok: true };
CA.cloud = {
  init() {},
  ready() { return true; },
  lastError() { return null; },
  app: {
    callFunction(o) {
      const action = o && o.data && o.data.action;
      if (action === "probe") return Promise.resolve({ result: clone(probeReply) });
      return Promise.resolve({ result: { ok: true } });
    },
  },
};

// ============================================================
// 四、DOM 骨架 + 加载 app.js
// ============================================================
const root = document.createElement("section");
root.id = "view-root";
document.body.appendChild(root);

const toastEl = document.createElement("div");
toastEl.id = "toast";
document.body.appendChild(toastEl);

const maskEl = document.createElement("div");
maskEl.id = "modal-mask";
maskEl.hidden = true;
document.body.appendChild(maskEl);

const boxEl = document.createElement("div");
boxEl.id = "modal-box";
maskEl.appendChild(boxEl);

require(path.join(__dirname, "..", "src", "app.js"));

// ============================================================
// 五、断言工具
// ============================================================
let passCount = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { passCount++; console.log("  ✓ " + msg); }
  else { failCount++; console.error("  ✗ " + msg); throw new Error("断言失败: " + msg); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await tick(); };
const toArr = (l) => Array.prototype.slice.call(l || []);
const byText = (nodes, text) => toArr(nodes).filter((n) => n.textContent.indexOf(text) >= 0)[0];
const allByText = (nodes, text) => toArr(nodes).filter((n) => n.textContent.indexOf(text) >= 0);

function lastToast() { return document.getElementById("toast").textContent; }
function modalBox() { return document.getElementById("modal-box"); }
function settingsView() { return root.querySelector("#view-settings"); }

async function mountSettings() {
  CA.app.switchView("settings");
  await flush();
  return settingsView();
}
function memberRow(view, studentNo) {
  return toArr(view.querySelectorAll(".table tr")).filter((tr) => tr.textContent.indexOf(studentNo) >= 0)[0];
}
function formInput(form, name) { return form.querySelector('[name="' + name + '"]'); }

(async () => {
  await flush();   // 等 boot() 完成（进入应用）

  console.log("\n== A. 管理员：名单渲染 + 新增入口 + 账号列 ==");
  currentUser = authUsers.admin;
  probeReply = { ok: true };
  let view = await mountSettings();
  ok(view.querySelector("table") !== null, "管理员可见班级名单表格");
  ok(allByText(view.querySelectorAll(".head-actions .btn"), "新增成员").length === 1, "存在「新增成员」入口");
  ok(view.textContent.indexOf("2 人") >= 0, "名单人数显示 2 人");
  ok(view.querySelector(".settings-alert.info") !== null, "显示账号中性说明条（管理员统一导入）");
  ok(view.querySelectorAll(".acct-cell .btn").length === 0, "账号列不渲染建号/重置按钮（App 内不提供）");
  ok(view.textContent.indexOf("未建账号") >= 0, "未绑定成员标注「未建账号」");

  console.log("\n== B. 学生：无管理入口 ==");
  currentUser = authUsers.student;
  view = await mountSettings();
  ok(view.textContent.indexOf("新增成员") < 0, "学生看不到「新增成员」");
  ok(view.querySelector(".head-actions") === null, "学生不渲染名单管理卡");
  ok(view.textContent.indexOf("重置数据") < 0, "学生看不到「重置数据」");
  ok(view.textContent.indexOf("导出数据 JSON") >= 0, "学生仍可导出自己的数据");

  console.log("\n== B2. 班委(admin)：不渲染「重置数据」（仅超管可见） ==");
  currentUser = authUsers.committee;
  view = await mountSettings();
  ok(CA.auth.isAdmin() === true && CA.auth.isSuperAdmin() === false, "班委 isAdmin=true / isSuperAdmin=false");
  ok(byText(view.querySelectorAll(".btn"), "重置数据") == null, "班委不渲染「重置数据」按钮");
  ok(view.textContent.indexOf("仅超级管理员可用") >= 0, "班委看到「仅超级管理员可用」说明");
  ok(view.textContent.indexOf("导出数据 JSON") >= 0, "班委仍可导出数据");
  currentUser = authUsers.admin;
  view = await mountSettings();
  ok(byText(view.querySelectorAll(".btn"), "重置数据") != null, "超级管理员看到「重置数据」按钮");

  console.log("\n== C. 新增成员：参数与刷新 ==");
  currentUser = authUsers.admin;
  probeReply = { ok: true };
  view = await mountSettings();
  click(byText(view.querySelectorAll(".head-actions .btn"), "新增成员"));
  await flush();
  let form = modalBox().querySelector("form");
  ok(form !== null, "点击新增 → 打开表单弹窗");
  formInput(form, "name").value = "陈嘉怡";
  formInput(form, "studentNo").value = "20230309";
  const addBefore = storeCalls.filter((c) => c.op === "add" && c.coll === "members").length;
  dispatch(form, { type: "submit" });
  await flush();
  const addCall = storeCalls.filter((c) => c.op === "add" && c.coll === "members").pop();
  ok(storeCalls.filter((c) => c.op === "add" && c.coll === "members").length === addBefore + 1, "调用 CA.store.add(members)");
  ok(/^m_/.test(addCall.obj.id), "id 以 m_ 开头（CA.store.uid(\"m\")）");
  ok(addCall.obj.name === "陈嘉怡" && addCall.obj.studentNo === "20230309", "参数 name/studentNo 正确");
  view = settingsView();
  ok(view.textContent.indexOf("3 人") >= 0, "名单人数刷新为 3 人");

  console.log("\n== D. 校验：学号格式非法被拒 ==");
  click(byText(view.querySelectorAll(".head-actions .btn"), "新增成员"));
  await flush();
  form = modalBox().querySelector("form");
  formInput(form, "name").value = "测试";
  formInput(form, "studentNo").value = "ab";
  const addBefore2 = storeCalls.filter((c) => c.op === "add" && c.coll === "members").length;
  dispatch(form, { type: "submit" });
  await flush();
  ok(storeCalls.filter((c) => c.op === "add" && c.coll === "members").length === addBefore2, "非法学号不写入");
  ok(modalBox().querySelector("form") !== null, "校验失败弹窗保持打开");

  console.log("\n== E. 学号重复 → 可读提示 ==");
  formInput(form, "name").value = "冒名";
  formInput(form, "studentNo").value = "20230301";   // 已存在
  dispatch(form, { type: "submit" });
  await flush();
  ok(lastToast().indexOf("已存在") >= 0 && lastToast().indexOf("唯一") >= 0, "重复学号 toast 可读提示：" + lastToast());
  ok(storeCalls.filter((c) => c.op === "add" && c.obj && c.obj.studentNo === "20230301").length === 0, "重复学号不写入");

  console.log("\n== F. 编辑成员 ==");
  click(byText(modalBox().querySelectorAll(".btn"), "取消"));
  await flush();
  view = settingsView();
  click(byText(memberRow(view, "20230302").querySelectorAll(".member-actions .btn"), "编辑"));
  await flush();
  form = modalBox().querySelector("form");
  ok(formInput(form, "studentNo").value === "20230302", "编辑表单回填学号");
  formInput(form, "name").value = "张天宇改";
  dispatch(form, { type: "submit" });
  await flush();
  const upd = storeCalls.filter((c) => c.op === "update" && c.coll === "members").pop();
  ok(upd && upd.id === "m_b", "编辑调用 update(members, m_b)");
  ok(upd.patch.name === "张天宇改", "编辑写入新姓名");

  console.log("\n== G. 删除成员：confirm + 级联 ==");
  global.confirm = () => false;
  view = settingsView();
  storeCalls.length = 0;
  click(byText(memberRow(view, "20230301").querySelectorAll(".member-actions .btn"), "删除"));
  await flush();
  ok(!storeCalls.some((c) => c.op === "remove" && c.coll === "members"), "confirm=false 不删成员");
  ok((await CA.store.get("members")).some((m) => m.studentNo === "20230301"), "成员保留");

  global.confirm = () => true;
  view = settingsView();
  storeCalls.length = 0;
  click(byText(memberRow(view, "20230301").querySelectorAll(".member-actions .btn"), "删除"));
  await flush();
  const removes = storeCalls.filter((c) => c.op === "remove");
  const iScores = removes.findIndex((c) => c.coll === "scores");
  const iMember = removes.findIndex((c) => c.coll === "members");
  ok(iScores >= 0 && iMember > iScores, "先删关联 scores 再删 member");
  ok((await CA.store.get("members")).every((m) => m.id !== "m_a"), "成员 m_a 已删除");
  ok((await CA.store.get("scores")).every((s) => s.memberId !== "m_a"), "关联成绩已删除");
  ok(lastToast().indexOf("已删除成员") >= 0, "删除成功 toast");

  console.log("\n== H. 导出：真实拉取，不读 localStorage.ca_db ==");
  probeReply = { ok: true };
  view = await mountSettings();
  lsCalls.length = 0;
  storeCalls.length = 0;
  blobs.length = 0;
  click(byText(view.querySelectorAll(".btn"), "导出数据 JSON"));
  await flush(40);
  const gotColls = storeCalls.filter((c) => c.op === "get").map((c) => c.coll);
  ["members", "users", "notices", "favorites", "subjects", "exams", "scores", "surveys", "responses", "messages", "materials"]
    .forEach((c) => ok(gotColls.indexOf(c) >= 0, "导出逐个读取集合 " + c));
  ok(lsCalls.indexOf("ca_db") < 0, "不再读取 localStorage.ca_db");
  ok(blobs.length === 1, "生成下载 Blob");
  const parsed = JSON.parse(blobs[0].parts[0]);
  ok(parsed && typeof parsed.data === "object", "导出 JSON 含 data 字段");
  ok(Array.isArray(parsed.data.members) && parsed.data.members.length >= 1, "data.members 为数组");
  ok(typeof parsed.exportedAt === "string" && parsed.env === "env-test", "含 exportedAt / env");

  console.log("\n== I. 重置：两级确认 + 保留 members/users ==");
  view = await mountSettings();
  global.confirm = () => false;
  global.prompt = () => "重置";
  storeCalls.length = 0;
  click(byText(view.querySelectorAll(".btn"), "重置数据"));
  await flush(40);
  ok(!storeCalls.some((c) => c.op === "query" && c.coll === "notices"), "confirm=false 不做任何删除");

  global.confirm = () => true;
  global.prompt = () => "确认";
  storeCalls.length = 0;
  click(byText(view.querySelectorAll(".btn"), "重置数据"));
  await flush(40);
  ok(!storeCalls.some((c) => c.op === "remove"), "未输入「重置」不执行");

  global.prompt = () => "重置";
  storeCalls.length = 0;
  click(byText(view.querySelectorAll(".btn"), "重置数据"));
  await flush(80);
  ["notices", "favorites", "subjects", "exams", "scores", "surveys", "responses", "messages", "materials"]
    .forEach((c) => ok((db[c] || []).length === 0, "重置清空集合 " + c));
  ok((db.members || []).length >= 1, "重置保留 members");
  ok((db.users || []).length >= 1, "重置保留 users");
  ok(lastToast().indexOf("已清空") >= 0, "重置结果 toast 汇总：" + lastToast());

  console.log("\n== I2. 重置失败被如实上报（RLS 静默过滤） ==");
  currentUser = authUsers.admin;
  probeReply = { ok: true };
  (db.notices = db.notices || []).push({ id: "n_fail", title: "删不掉的通知" });
  removeFailColls.notices = true;
  global.confirm = () => true;
  global.prompt = () => "重置";
  storeCalls.length = 0;
  view = await mountSettings();
  click(byText(view.querySelectorAll(".btn"), "重置数据"));
  await flush(80);
  ok(lastToast().indexOf("失败") >= 0 && lastToast().indexOf("notices") >= 0, "删除被 RLS 拒绝时如实上报失败：" + lastToast());
  ok((db.notices || []).some((n) => n.id === "n_fail"), "被拒的通知仍在（未被静默当成功）");
  removeFailColls.notices = false;

  console.log("\n== J. 账号服务：App 内不提供建号（中性说明） ==");
  probeReply = { ok: false, code: "NO_CREDENTIAL", message: "缺少环境变量：TC_SECRET_ID, TCB_API_KEY" };
  view = await mountSettings();
  const alert = view.querySelector(".settings-alert.info");
  ok(alert !== null, "显示中性说明条 (.settings-alert.info)");
  ok(alert.textContent.indexOf("管理员统一导入") >= 0, "说明文案提到管理员统一导入");
  ok(alert.textContent.indexOf("TC_SECRET_ID") < 0, "不暴露技术细节 TC_SECRET_ID");
  ok(view.querySelectorAll(".acct-cell .btn").length === 0, "名单账号列不渲染建号/重置按钮");

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
