// 留言模块自测（messages.js）
// 运行：node docs/test/messages_test.mjs（在 class-assistant 目录下）
// 零依赖：自带极简 DOM 桩 + mock（异步）CA.store / CA.auth / CA.app / CA.icon / CA.util
// 覆盖：挂载不抛错、学生有输入/提交入口、提交调用 CA.store.add("messages", …)、
//       学生只看自己、老师看全部并回复、标记已读、角色差异类、错误态、unmount 不抛错。
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 一、极简 DOM 桩（覆盖 messages.js 用到的 API）
// ============================================================
function camel(name) { return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

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
  // 支持 [id^="..."] 前缀匹配
  if (s.id == null) {
    const pre = /\[id\^="([^"]+)"\]/.exec(sel);
    if (pre && String(el.id).indexOf(pre[1]) !== 0) return false;
  }
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
global.CA = {};

// ============================================================
// 三、mock CA.store / auth / app / icon / util（全部异步，贴合 PG store）
// ============================================================
const clone = (x) => JSON.parse(JSON.stringify(x));

const seed = {
  members: [
    { id: "m1", name: "李思远", studentNo: "20230301" },
    { id: "m2", name: "张天宇", studentNo: "20230302" },
  ],
  messages: [
    {
      id: "msg_1", fromUid: "u_s", fromMemberId: "m2", content: "老师，这道题不会", 
      createdAt: "2026-09-14T09:00:00.000Z", readAt: null, replyContent: null, replyAt: null,
    },
    {
      id: "msg_2", fromUid: "u_s", fromMemberId: "m2", content: "运动会报名了吗",
      createdAt: "2026-09-13T09:00:00.000Z", readAt: "2026-09-13T10:00:00.000Z",
      replyContent: "报了，等你来", replyAt: "2026-09-13T10:00:00.000Z",
    },
    {
      id: "msg_3", fromUid: "u_x", fromMemberId: "m1", content: "老师早",
      createdAt: "2026-09-12T09:00:00.000Z", readAt: null, replyContent: null, replyAt: null,
    },
  ],
};

function makeStore(db) {
  let counter = 500;
  const addCalls = [];
  return {
    _db: db,
    _addCalls: addCalls,
    get(c) {
      if (c === "messages") return Promise.resolve(clone(db.messages || []));
      return Promise.resolve(clone(db[c] || []));
    },
    find(c, id) {
      for (const x of (db[c] || [])) if (x.id === id) return Promise.resolve(clone(x));
      return Promise.resolve(null);
    },
    query(c, fn) { return Promise.resolve((db[c] || []).filter(fn).map(clone)); },
    add(c, obj) {
      addCalls.push({ coll: c, obj: clone(obj) });
      const o = Object.assign({}, clone(obj), { id: (c === "messages" ? "msg_" : "id_") + (++counter) });
      if (!o.createdAt) o.createdAt = new Date().toISOString();
      (db[c] = db[c] || []).push(o);
      return Promise.resolve(clone(o));
    },
    update(c, id, patch) {
      for (const x of (db[c] || [])) {
        if (x.id === id) { Object.assign(x, clone(patch)); return Promise.resolve(clone(x)); }
      }
      return Promise.resolve(null);
    },
    remove(c, id) {
      const l = db[c] || [];
      for (let i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); return Promise.resolve(true); }
      return Promise.resolve(false);
    },
    memberName(mid) {
      const m = (db.members || []).filter((x) => x.id === mid)[0];
      return m ? m.name : "";
    },
  };
}

const users = {
  u_t: { id: "u_t", uid: "u_t", name: "王老师", role: "superAdmin" },
  u_s: { id: "u_s", uid: "u_s", name: "张天宇", role: "member", memberId: "m2" },
};
let currentId = "u_s";
CA.auth = {
  current() { return Promise.resolve(clone(users[currentId])); },
  list() { return Promise.resolve([users.u_t, users.u_s].map(clone)); },
  isAdmin() { const r = users[currentId].role; return r === "admin" || r === "superAdmin"; },
  isSuperAdmin() { return users[currentId].role === "superAdmin"; },
  can() { return false; },
};

CA.app = {
  toasts: [],
  toast(msg) { this.toasts.push(String(msg)); },
  openModal() {}, closeModal() {}, rerender() {}, enter() {},
};

CA.iconCalls = [];
CA.icon = (name, size) => { CA.iconCalls.push(name); return '<svg class="icon" data-icon="' + name + '"></svg>'; };
CA.util = { fmtSmart: (v) => (v ? "SMART(" + String(v) + ")" : "—") };

CA.store = makeStore(seed);
require(path.join(__dirname, "..", "src", "messages.js"));

// ============================================================
// 四、断言工具
// ============================================================
let passCount = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { passCount++; console.log("  ✓ " + msg); }
  else { failCount++; console.error("  ✗ " + msg); throw new Error("断言失败: " + msg); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 16) => { for (let i = 0; i < n; i++) await tick(); };

const root = document.createElement("section");
document.body.appendChild(root);

function setUser(id) { currentId = id; }
async function remount() {
  if (CA.views.messages) CA.views.messages.unmount();
  await CA.views.messages.mount(root);
  await flush();
}
function rows() { return root.querySelectorAll("#message-list .ca-msg-row"); }
function rowIds() { return rows().map((r) => r.dataset.msgId); }
function row(id) { return rows().filter((r) => r.dataset.msgId === id)[0]; }
function byText(nodes, text) { return nodes.filter((n) => n.textContent.indexOf(text) >= 0)[0]; }

(async () => {
  console.log("\n== A. 骨架：挂载不抛错 + 学生入口 ==");
  setUser("u_s");
  await remount();
  ok(root.querySelector("#message-list") !== null, "存在 #message-list");
  ok(root.querySelector("#message-input") !== null, "学生有 #message-input");
  ok(root.querySelector("#btn-message-send") !== null, "学生有 #btn-message-send");
  ok(root.querySelector(".ca-msg-compose").className.indexOf("student-only") >= 0,
    "学生输入区带 .student-only（角色化）");
  ok(root.querySelector("#btn-message-refresh") !== null, "存在刷新入口");
  ok(CA.iconCalls.indexOf("message") >= 0 && CA.iconCalls.indexOf("clock") >= 0, "图标统一走 CA.icon()");
  ok(root.querySelectorAll(".ca-msg-reply-form").length === 0, "学生视角不渲染回复表单");

  console.log("\n== B. 学生列表：仅自己 + 回复展示 + 时间 ==");
  ok(rowIds().sort().join(",") === "msg_1,msg_2", "学生只看到自己的留言（msg_1,msg_2）: " + rowIds().join(","));
  ok(rowIds().indexOf("msg_3") < 0, "不含他人留言 msg_3");
  ok(byText(root.querySelectorAll("#message-list .ca-msg-content"), "老师，这道题不会") !== undefined,
    "渲染留言正文（纯文本）");
  ok(row("msg_1").querySelector(".ca-msg-reply") === null &&
     row("msg_1").textContent.indexOf("老师尚未回复") >= 0, "未回复显示占位");
  ok(row("msg_2").querySelector(".ca-msg-reply") !== null &&
     row("msg_2").textContent.indexOf("报了，等你来") >= 0, "有回复显示回复块");
  ok(byText(root.querySelectorAll("#message-list .ca-msg-meta span"), "SMART(") !== undefined,
    "时间走 CA.util.fmtSmart（非 ISO 直出）");

  console.log("\n== C. 学生提交：空内容拦截 / 正常提交调用 add ==");
  const ta = root.querySelector("#message-input");
  const sendBtn = root.querySelector("#btn-message-send");
  const addBefore = CA.store._addCalls.length;
  ta.value = "   ";
  click(sendBtn);
  await flush();
  ok(CA.store._addCalls.length === addBefore, "空内容不调用 CA.store.add");
  ok(CA.app.toasts.indexOf("请输入留言内容") >= 0, "空内容给出提示");

  ta.value = "老师，我想请一天假";
  click(sendBtn);
  await flush();
  ok(CA.store._addCalls.length === addBefore + 1, "提交调用 CA.store.add 一次");
  const call = CA.store._addCalls[CA.store._addCalls.length - 1];
  ok(call.coll === "messages", "add 集合为 messages");
  ok(call.obj.content === "老师，我想请一天假", "content 正确");
  ok(call.obj.fromUid === "u_s", "fromUid = 当前用户 uid");
  ok(call.obj.fromMemberId === "m2", "fromMemberId = 当前用户名单 id");
  ok(ta.value === "", "提交后清空输入框");
  ok(CA.app.toasts.indexOf("留言已提交") >= 0, "提交成功提示");
  await flush();
  ok(rowIds().length === 3, "提交后列表刷新为 3 条");

  console.log("\n== D. 老师视角：全部留言 + 回复/已读入口 ==");
  setUser("u_t");
  await remount();
  ok(rowIds().length === 4 && rowIds().indexOf("msg_3") >= 0, "老师看到全部留言（含他人 msg_3）");
  ok(row("msg_1").className.indexOf("admin-only") >= 0, "老师行带 .admin-only（角色化）");
  ok(root.querySelector("#message-reply-msg_1") !== null, "每题一个 #message-reply-<id>");
  ok(root.querySelector("#btn-message-reply-msg_1") !== null, "有回复按钮 #btn-message-reply-<id>");
  ok(row("msg_1").querySelector(".ca-msg-reply-form").className.indexOf("admin-only") >= 0,
    "回复区带 .admin-only（角色化）");
  ok(row("msg_1").textContent.indexOf("张天宇") >= 0, "显示留言人姓名（memberName）");
  ok(row("msg_1").textContent.indexOf("未读") >= 0, "未读留言带「未读」标记");
  ok(row("msg_2").textContent.indexOf("已读") >= 0, "已读留言带「已读」标记");
  ok(root.querySelector("#btn-message-read-msg_1") !== null, "未读有「标记已读」按钮");
  ok(root.querySelector("#btn-message-read-msg_2") === null, "已读无「标记已读」按钮");

  console.log("\n== E. 老师回复 + 标记已读 ==");
  const before = clone(CA.store._db.messages.filter((m) => m.id === "msg_1")[0]);
  const replyTa = root.querySelector("#message-reply-msg_1");
  replyTa.value = "好的，明天交作业就行";
  click(root.querySelector("#btn-message-reply-msg_1"));
  await flush();
  const after = CA.store._db.messages.filter((m) => m.id === "msg_1")[0];
  ok(after.replyContent === "好的，明天交作业就行", "回复写入 replyContent");
  ok(!!after.replyAt, "回复写入 replyAt");
  ok(!!after.readAt, "回复同时把未读标记为已读");
  ok(before.replyContent === null && after.replyContent !== null, "回复前无内容");
  await flush();
  ok(row("msg_1").textContent.indexOf("好的，明天交作业就行") >= 0, "刷新后展示新回复");
  ok(root.querySelector("#btn-message-read-msg_1") === null, "回复后「标记已读」消失");

  click(root.querySelector("#btn-message-read-msg_3"));
  await flush();
  const m3 = CA.store._db.messages.filter((m) => m.id === "msg_3")[0];
  ok(!!m3.readAt, "标记已读写入 readAt");

  console.log("\n== F. 错误态：store.add 失败 → toast ==");
  setUser("u_s");
  await remount();
  const realAdd = CA.store.add;
  CA.store.add = () => Promise.reject(new Error("网络中断"));
  const toastCount = CA.app.toasts.length;
  root.querySelector("#message-input").value = "会不会失败";
  click(root.querySelector("#btn-message-send"));
  await flush();
  ok(CA.app.toasts.slice(toastCount).some((t) => t.indexOf("网络中断") >= 0), "提交失败 → try/catch + toast");
  CA.store.add = realAdd;

  console.log("\n== G. 卸载不抛错 ==");
  let threw = false;
  try { CA.views.messages.unmount(); } catch (e) { threw = true; }
  ok(!threw, "unmount 不抛错");
  threw = false;
  try { CA.views.messages.unmount(); } catch (e) { threw = true; }
  ok(!threw, "重复 unmount 不抛错（幂等）");

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
