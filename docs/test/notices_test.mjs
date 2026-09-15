// 通知模块自测（P1a 异步迁移版 · 契约 §10）
// 运行：node docs/test/notices_test.mjs（在 class-assistant 目录下）
// 零依赖：自带极简 DOM 桩 + mock CA.store / CA.auth / CA.ai / CA.app
// 迁移要点：CA.store/CA.auth 的 mock 改为返回 Promise；mount() 为 async；
//          所有异步触发后用 tick() 冲刷微任务再断言。
// 覆盖：骨架 id、置顶排序、分类筛选计数、发布字段完整、编辑/删除权限、
//      收藏同步、AI 草稿回填与失败路径、AI 关闭/无权限降级、XSS 转义。
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 一、极简 DOM 桩（仅覆盖 notices.js 用到的 API）
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

// ---- 单段选择器解析与匹配：支持 tag / #id / .class / [attr] / [attr="v"] ----
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

// ---- document 桩 ----
const docRoot = new StubEl("body");
const documentStub = {
  body: docRoot,
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
// 二、global 替身（沿用 node_test.js 的 window=global 模式）
// ============================================================
global.window = global;
global.document = documentStub;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.confirm = () => true;
global.alert = () => {};
global.CA = {};

// ============================================================
// 三、mock CA.store / CA.auth / CA.ai / CA.app（异步版）
// ============================================================
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const settle = (v) => Promise.resolve(v);

// 模拟「RLS 静默拦截」开关：置 true 后写操作不报错但数据不变（PostgREST 真实行为）
let denyWrite = false;

function makeStore(seed) {
  const db = clone(seed);
  // 注意：store.js 的 uid/settings/memberName 保持同步，其余返回 Promise
  return {
    _db: db,
    get(c) { return settle(clone(db[c] || [])); },
    find(c, id) {
      const l = db[c] || [];
      for (const x of l) if (x.id === id) return settle(clone(x));
      return settle(null);
    },
    query(c, fn) { return settle((db[c] || []).filter(fn).map(clone)); },
    add(c, obj) {
      const now = new Date().toISOString();
      const o = Object.assign({}, obj, {
        id: obj.id || ("new_" + (db[c] ? db[c].length : 0) + "_" + Math.random().toString(36).slice(2, 6)),
        createdAt: now,
        updatedAt: now,
      });
      (db[c] = db[c] || []).push(o);
      return settle(clone(o));
    },
    update(c, id, patch) {
      const l = db[c] || [];
      if (denyWrite) {
        // 模拟 PostgreSQL RLS 拦下越权写入 —— PostgREST 返回「0 行受影响、无 error」，
        // 记录原样保留。前端若不回读就会把「没改到」当成功。
        const cur = l.filter((x) => x.id === id)[0];
        return settle(cur ? clone(cur) : null);
      }
      for (const x of l) {
        if (x.id === id) { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); return settle(clone(x)); }
      }
      return settle(null);
    },
    remove(c, id) {
      const l = db[c] || [];
      if (denyWrite) return settle(true);   // 同上：不报错，但记录没被删掉
      for (let i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); return settle(true); }
      return settle(false);
    },
    settings() { return clone(db.settings || {}); },
    setSettings(patch) { db.settings = Object.assign({}, db.settings, patch); },
    reset() {},
    uid(p) { return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    memberName() { return ""; },
  };
}

const users = {
  u_t: { id: "u_t", name: "王老师", role: "superAdmin", title: "班主任" },
  u_a: { id: "u_a", name: "李思远", role: "admin", title: "学习委员" },
  // ⚠️ 必须用真实数据里的角色名 member（不是 "student"）：
  //    users.role 的取值域是 member|admin|superAdmin（见 ROADMAP §4.3 / auth.js PERMS）。
  //    历史上测试写成 "student" 会掩盖「按 member 判定」相关的回归。
  u_s: { id: "u_s", name: "张天宇", role: "member", title: "学生" },
};
let currentId = "u_t";
CA.auth = {
  // P1a：current / list 为异步；isAdmin / can 保持同步
  current() { return settle(users[currentId]); },
  list() { return settle([users.u_t, users.u_a, users.u_s]); },
  isAdmin() { const r = users[currentId].role; return r === "admin" || r === "superAdmin"; },
  isSuperAdmin() { return users[currentId].role === "superAdmin"; },
  can(action) {
    const r = users[currentId].role;
    if (action === "notice.publish") return r === "admin" || r === "superAdmin";
    if (action === "notice.manageAll") return r === "superAdmin";
    if (action === "score.edit") return r === "admin" || r === "superAdmin";
    if (action === "member.manage") return r === "superAdmin";
    if (action === "settings.ai") return r === "superAdmin";
    return false;
  },
};

let aiOn = true;
let aiCalls = [];
let aiSummaryCalls = [];
let aiAskCalls = [];
// 可覆盖实现：各用例按需替换
let aiSummaryImpl = async () => ({ points: ["要点一", "要点二", "要点三"], keywords: ["考试", "时间"], warnings: [] });
let aiAskImpl = async () => "这是 AI 的回答。";
CA.ai = {
  enabled() { return aiOn; },
  async parseNotice(text) {
    aiCalls.push(text);
    return {
      title: "AI标题", category: "活动信息", timeLabel: "活动时间",
      deadline: "2026-06-20T18:00", endTime: "", location: "体育馆",
      course: "", content: "AI正文", important: true,
      warnings: ["分类为默认推断值"],
    };
  },
  // 学生端新增（Wave 2b-2）：记录调用参数，实现可被用例替换
  summarizeNotice(noticeId) { aiSummaryCalls.push(noticeId); return aiSummaryImpl(noticeId); },
  askAbout(input) { aiAskCalls.push(input); return aiAskImpl(input); },
};

CA.app = {
  toasts: [],
  toast(msg) { this.toasts.push(String(msg)); },
  openModal() {},
  closeModal() {},
  rerender() { this.rerenderCount = (this.rerenderCount || 0) + 1; },
};

// ---- 云存储 mock（CA.cloud.app.storage.from('attachments').upload / createSignedUrl）----
const storageCalls = { bucket: null, uploads: [], signed: [] };
let uploadImpl = async (key) => ({ data: { id: key } });
let signedImpl = async (key, exp) => ({ data: { fullSignedURL: "https://signed.example/" + encodeURIComponent(key) + "?e=" + exp } });
const bucketStub = {
  upload(key, file) {
    storageCalls.uploads.push({ key, name: file && file.name, size: file && file.size });
    return uploadImpl(key, file);
  },
  createSignedUrl(key, exp) {
    storageCalls.signed.push({ key, exp });
    return signedImpl(key, exp);
  },
};
function resetStorage() {
  storageCalls.bucket = null;
  storageCalls.uploads = [];
  storageCalls.signed = [];
  uploadImpl = async (key) => ({ data: { id: key } });
}
CA.cloud = {
  app: { storage: { from(b) { storageCalls.bucket = b; return bucketStub; } } },
  ensure() {},
  ready() { return true; },
  lastError() { return null; },
};

// 图标系统（DESIGN.md §5）：notices.js 期望 CA.iconEl(name, size) 返回 SVG 元素
CA.iconEl = (name, size) => {
  const el = document.createElement("span");
  el.className = "icon";
  el.dataset.icon = String(name || "");
  el.dataset.size = String(size == null ? "" : size);
  return el;
};
CA.icon = (name, size) => '<svg class="icon" data-icon="' + name + '" data-size="' + size + '"></svg>';

// ============================================================
// 四、测试数据 & 加载模块
// ============================================================
const soon = new Date(Date.now() + 86400000).toISOString();       // 1 天后 → 临近
const far = new Date(Date.now() + 30 * 86400000).toISOString();   // 30 天后

const seed = {
  users: Object.values(users),
  members: [],
  notices: [
    {
      id: "n1", title: "期中考试安排", category: "考试安排", pinned: true, important: true,
      publisherId: "u_t", createdAt: "2026-06-01T10:00:00Z", deadline: far, timeLabel: "考试时间",
      location: "教学楼", course: "", content: "考试正文\n第二行",
      attachments: [{ name: "考场表.pdf", size: 2048, type: "application/pdf" }],
      links: [{ title: "教务处公告", url: "https://example.com/notice" }],
    },
    {
      id: "n2", title: "数学作业提交", category: "作业信息", pinned: true, important: false,
      publisherId: "u_t", createdAt: "2026-06-02T10:00:00Z", deadline: soon, timeLabel: "截止时间",
      location: "", course: "数学", content: "作业正文", attachments: [], links: [],
    },
    {
      id: "n3", title: "春季运动会", category: "活动信息", pinned: false, important: false,
      publisherId: "u_a", createdAt: "2026-06-03T10:00:00Z", deadline: far, timeLabel: "活动时间",
      location: "操场", course: "", content: "活动正文", attachments: [], links: [],
    },
    {
      id: "n4", title: "班级值日安排", category: "班级通知", pinned: false, important: false,
      publisherId: "u_a", createdAt: "2026-06-04T10:00:00Z", deadline: "", timeLabel: "",
      location: "", course: "", content: "值日正文", attachments: [], links: [],
    },
    {
      id: "n5", title: "<img src=x onerror=alert(1)>", category: "其他", pinned: false, important: false,
      publisherId: "u_t", createdAt: "2026-06-05T10:00:00Z", deadline: "", timeLabel: "",
      location: "", course: "", content: "<script>alert(1)</script>\n正文", attachments: [], links: [],
    },
  ],
  favorites: [{ id: "f1", userId: "u_s", noticeId: "n5", createdAt: "2026-06-06T00:00:00Z" }],
  subjects: [], exams: [], scores: [],
  settings: { currentUserId: "u_t", aiEnabled: true },
};

CA.store = makeStore(seed);
require(path.join(__dirname, "..", "src", "notices.js"));

// ============================================================
// 五、断言工具 & 测试流程
// ============================================================
let passCount = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { passCount++; console.log("  ✓ " + msg); }
  else { failCount++; console.error("  ✗ " + msg); throw new Error("断言失败: " + msg); }
}
// 冲刷微任务：async 视图操作（mount / 提交 / 收藏 / AI）后用一次即可
const tick = () => new Promise((r) => setTimeout(r, 0));

const root = document.createElement("section");
document.body.appendChild(root);

function setUser(id) { currentId = id; }
async function remount() { CA.views.notices.unmount(); await CA.views.notices.mount(root); }
function catButton(cat) {
  return root.querySelectorAll("button[data-cat]").filter((b) => b.dataset.cat === cat)[0];
}
function itemById(id) {
  return root.querySelectorAll("#notices-list .list-row").filter((i) => i.dataset.noticeId === id)[0];
}
function formField(name) { return root.querySelector('#notice-form [name="' + name + '"]'); }

(async () => {
  console.log("\n== A. 骨架与分类筛选 ==");
  await CA.views.notices.mount(root);
  ["#notices-filters", "#notices-list", "#notice-detail", "#btn-notice-new",
   "#notice-form", "#ai-parse-input", "#btn-ai-parse", "#ai-parse-hint"].forEach((id) => {
    ok(root.querySelector(id) !== null, "存在 " + id);
  });
  ok(root.querySelectorAll("button[data-cat]").length === 6, "筛选项 6 个（全部 + 5 分类）");
  ok(catButton("全部").querySelector(".filter-count").textContent === "5", "「全部」计数 = 5");
  ok(catButton("考试安排").querySelector(".filter-count").textContent === "1", "「考试安排」计数 = 1");
  ok(catButton("作业信息").querySelector(".filter-count").textContent === "1", "「作业信息」计数 = 1");

  console.log("\n== B. 列表：置顶排序 / 临近高亮 / 附件标记 ==");
  let items = root.querySelectorAll("#notices-list .list-row");
  ok(items.length === 5, "列表共 5 条");
  ok(items[0].dataset.noticeId === "n2" && items[1].dataset.noticeId === "n1",
    "置顶优先且按创建时间倒序（n2, n1 在前）");
  ok(items[0].querySelector(".chip") !== null, "n2 临近截止 → 列表项带 .chip 提示");
  ok(itemById("n1").querySelector(".att-count").textContent === "1 个附件", "附件图标 + 数量显示");

  console.log("\n== C. 分类筛选交互 ==");
  click(catButton("活动信息"));
  let filtered = root.querySelectorAll("#notices-list .list-row");
  ok(filtered.length === 1 && filtered[0].dataset.noticeId === "n3", "筛选「活动信息」→ 1 条（n3）");
  click(catButton("全部"));
  ok(root.querySelectorAll("#notices-list .list-row").length === 5, "切回「全部」→ 5 条");

  console.log("\n== C2. 列表点击 toggle（再点同一条 → 收起） ==");
  ok(itemById("n1").getAttribute("aria-expanded") === "false", "初始未选中项 aria-expanded=false");
  click(itemById("n1"));
  ok(itemById("n1").className.indexOf("is-active") >= 0 &&
     itemById("n1").getAttribute("aria-expanded") === "true",
    "首次点击 → 选中态（.is-active + aria-expanded=true）");
  ok(root.querySelector("#notice-detail").textContent.indexOf("期中考试安排") >= 0,
    "首次点击 → 详情展开并显示该通知");
  click(itemById("n1"));   // 重新取元素（renderList 会重建列表）
  ok(root.querySelector("#notice-detail").textContent.indexOf("未选择通知") >= 0,
    "再次点击同一条 → 详情回到「未选择通知」空态");
  ok(root.querySelector("#notice-detail").textContent.indexOf("期中考试安排") < 0,
    "收起后详情不再包含该通知内容");
  ok(itemById("n1").className.indexOf("is-active") < 0 &&
     itemById("n1").getAttribute("aria-expanded") === "false",
    "取消选中 → 列表项移除 .is-active / aria-expanded=false");
  // 点另一条：选中态转移，仍正常展开
  click(itemById("n1"));
  click(itemById("n2"));
  ok(itemById("n2").getAttribute("aria-expanded") === "true" &&
     itemById("n1").getAttribute("aria-expanded") === "false",
    "点击另一条 → 选中态由 n1 转移到 n2");
  ok(root.querySelector("#notice-detail").textContent.indexOf("数学作业提交") >= 0,
    "切换另一条 → 详情更新为 n2");
  click(itemById("n2"));
  ok(root.querySelector("#notice-detail").textContent.indexOf("未选择通知") >= 0,
    "再点当前条 → 再次收起（toggle 可反复）");

  console.log("\n== D. 发布：字段完整（异步 store） ==");
  setUser("u_a"); // admin
  await remount();
  ok(root.querySelector("#btn-notice-new").hidden === false, "admin 可见发布按钮");
  click(root.querySelector("#btn-notice-new"));
  ok(root.querySelector("#notice-form").hidden === false, "点击发布 → 表单展开");
  formField("title").value = "新通知标题";
  formField("category").value = "考试安排";
  formField("timeLabel").value = "截止时间";
  formField("deadline").value = far;
  formField("endTime").value = "";
  formField("location").value = "实验室";
  formField("course").value = "物理";
  formField("content").value = "这是正文";
  formField("pinned").checked = true;
  formField("important").checked = false;
  dispatch(root.querySelector("#notice-form"), { type: "submit" });
  await tick();
  let notices = await CA.store.get("notices");
  ok(notices.length === 6, "发布后通知数 5 → 6");
  const created = notices[notices.length - 1];
  ok(created.title === "新通知标题" && created.category === "考试安排", "创建对象标题/分类正确");
  ok(created.timeLabel === "截止时间" && created.location === "实验室" && created.course === "物理",
    "timeLabel/location/course 完整");
  ok(created.deadline === far && created.endTime === "" && created.content === "这是正文",
    "deadline/endTime/content 完整");
  ok(created.pinned === true && created.important === false, "pinned/important 布尔正确");
  ok(created.publisherId === "u_a", "publisherId 写入当前用户");
  ok(Array.isArray(created.attachments) && created.attachments.length === 0, "attachments 默认空数组");
  ok(Array.isArray(created.links) && created.links.length === 0, "links 默认空数组");
  ok(!!created.id && !!created.createdAt, "id/createdAt 由 store 生成");
  ok(root.querySelector("#notice-form").hidden === true, "提交后表单收起");

  console.log("\n== E. 编辑权限（admin 本人可改 / 他人不可改） ==");
  setUser("u_a");
  click(itemById("n3"));                       // n3 由 u_a 发布
  ok(root.querySelector('#notice-detail [data-action="edit"]') !== null, "本人发布 → 详情显示编辑按钮");
  click(root.querySelector('#notice-detail [data-action="edit"]'));
  await tick();
  ok(root.querySelector("#notice-form").hidden === false, "点击编辑 → 表单展开");
  ok(formField("title").value === "春季运动会", "编辑表单回填原标题");
  formField("title").value = "春季运动会（改）";
  dispatch(root.querySelector("#notice-form"), { type: "submit" });
  await tick();
  ok((await CA.store.find("notices", "n3")).title === "春季运动会（改）", "本人编辑成功写入");
  click(itemById("n1"));                       // n1 由 u_t 发布
  ok(root.querySelector('#notice-detail [data-action="edit"]') === null, "他人发布 → admin 无编辑按钮");
  ok(root.querySelector('#notice-detail [data-action="delete"]') === null, "他人发布 → admin 无删除按钮");

  console.log("\n== F. 删除权限（superAdmin 全部 / admin 仅本人） ==");
  click(itemById("n4"));                       // n4 由 u_a 发布
  ok(root.querySelector('#notice-detail [data-action="delete"]') !== null, "本人发布 → admin 可删除");
  click(root.querySelector('#notice-detail [data-action="delete"]'));
  await tick();
  ok((await CA.store.find("notices", "n4")) === null, "admin 删除本人通知成功");
  ok((await CA.store.get("notices")).length === 5, "删除后通知数 6 → 5");
  setUser("u_t"); // superAdmin
  await remount();
  click(itemById("n1"));
  ok(root.querySelector('#notice-detail [data-action="delete"]') !== null, "superAdmin 对他人通知有删除按钮");
  click(root.querySelector('#notice-detail [data-action="delete"]'));
  await tick();
  ok((await CA.store.find("notices", "n1")) === null, "superAdmin 删除他人通知成功");

  console.log("\n== G. 收藏（students 可用，列表与详情同步） ==");
  setUser("u_s"); // student
  await remount();
  click(itemById("n5"));
  let favBtn = root.querySelector("#notice-fav-btn");
  ok(favBtn.dataset.fav === "1" && favBtn.className.indexOf("is-fav") >= 0, "详情显示已收藏态（种子收藏）");
  click(favBtn);
  await tick();
  ok((await CA.store.query("favorites", (f) => f.userId === "u_s" && f.noticeId === "n5")).length === 0, "取消收藏写入库");
  ok(root.querySelector("#notice-fav-btn").dataset.fav === "0", "详情收藏按钮切回未收藏态");
  ok(root.querySelectorAll("#notices-list .fav-star").length === 0, "列表收藏星标同步移除");
  click(root.querySelector("#notice-fav-btn"));
  await tick();
  ok((await CA.store.query("favorites", (f) => f.userId === "u_s" && f.noticeId === "n5")).length === 1, "再次收藏写入库");
  ok(root.querySelectorAll("#notices-list .fav-star").length === 1, "列表收藏星标同步出现");

  console.log("\n== H. AI 一句话草稿（异步回填） ==");
  setUser("u_a"); aiOn = true; aiCalls = []; CA.app.toasts = [];
  await remount();
  ok(root.querySelector("#ai-parse-wrap").hidden === false, "admin + AI 开启 → AI 块可见");
  root.querySelector("#ai-parse-input").value = "明天下午在体育馆开运动会";
  click(root.querySelector("#btn-ai-parse"));
  await tick();
  ok(aiCalls.length === 1, "调用 CA.ai.parseNotice 一次");
  ok(root.querySelector("#notice-form").hidden === false, "AI 解析后表单自动展开");
  ok(formField("title").value === "AI标题", "标题回填");
  ok(formField("category").value === "活动信息", "分类回填");
  ok(formField("location").value === "体育馆", "地点回填");
  ok(formField("content").value === "AI正文", "正文回填");
  ok(formField("important").checked === true, "重要标记回填");
  ok(root.querySelector("#ai-parse-hint").textContent.indexOf("提示") >= 0, "warnings 展示在 #ai-parse-hint");

  // AI 失败路径
  CA.ai.parseNotice = () => Promise.reject(new Error("AI 服务开小差"));
  root.querySelector("#ai-parse-input").value = "再试一次";
  click(root.querySelector("#btn-ai-parse"));
  await tick();
  ok(CA.app.toasts.indexOf("AI 服务开小差") >= 0, "AI 失败 → toast(err.message)");
  ok(root.querySelector("#btn-ai-parse").disabled === false, "失败后按钮恢复可用");

  console.log("\n== I. AI 关闭 / 无权限时隐藏 ==");
  CA.ai.parseNotice = async () => ({ title: "x", warnings: [] });
  aiOn = false;
  await remount();
  ok(root.querySelector("#ai-parse-wrap").hidden === true, "AI 关闭 → 整块隐藏");
  aiOn = true;
  setUser("u_s");
  await remount();
  ok(root.querySelector("#ai-parse-wrap").hidden === true, "学生无发布权 → AI 块隐藏");
  ok(root.querySelector("#btn-notice-new").hidden === true, "学生隐藏发布入口");

  console.log("\n== J. XSS 转义 ==");
  setUser("u_t");
  await remount();
  const maliciousItem = itemById("n5");
  ok(maliciousItem.querySelector(".notice-title").textContent === "<img src=x onerror=alert(1)>",
    "标题按纯文本渲染（未解析为元素）");
  ok(maliciousItem.querySelectorAll("img").length === 0, "页面未注入 img 元素");
  click(maliciousItem);
  ok(root.querySelector("#notice-detail .detail-content").innerHTML.indexOf("&lt;script&gt;") >= 0,
    "正文经 escapeHtml 转义后注入");

  console.log("\n== K. 学生端 AI 摘要 / 问问 AI ==");
  aiSummaryImpl = async () => ({ points: ["要点一", "要点二", "要点三"], keywords: ["考试", "时间"], warnings: [] });
  aiAskImpl = async () => "这是 AI 的回答。";
  aiSummaryCalls = []; aiAskCalls = [];
  aiOn = true;
  setUser("u_s"); // student
  await remount();
  ok(root.querySelector("#ai-notice-assist") === null, "未选择通知时详情为空态，无 AI 卡片（学生）");
  click(itemById("n2"));
  ok(root.querySelector("#ai-notice-assist") !== null, "学生端选中通知 → 出现 #ai-notice-assist");
  ok(root.querySelector("#ai-notice-assist").className.indexOf("student-only") >= 0,
    "AI 卡片带 .student-only（角色化）");
  ["#ai-notice-summary-wrap", "#btn-ai-notice-summary", "#ai-notice-summary-box",
   "#ai-notice-ask-wrap", "#ai-notice-ask-input", "#btn-ai-notice-ask", "#ai-notice-ask-log"].forEach((id) => {
    ok(root.querySelector(id) !== null, "存在 " + id);
  });

  // 摘要：成功渲染要点 + 关键词 chips
  click(root.querySelector("#btn-ai-notice-summary"));
  await tick();
  ok(aiSummaryCalls.length === 1 && aiSummaryCalls[0] === "n2", "调用 CA.ai.summarizeNotice(n2) 一次");
  ok(root.querySelectorAll("#ai-notice-summary-box .ai-points li").length === 3, "渲染 3 条要点");
  ok(root.querySelectorAll("#ai-notice-summary-box .chip").length === 2, "渲染 2 个关键词 chip");
  ok(root.querySelector("#btn-ai-notice-summary").disabled === false, "摘要完成后按钮恢复可用");

  // 摘要：纯文本安全渲染（AI 输出含标签时不解析）
  aiSummaryImpl = async () => ({
    points: ["<script>alert(1)</script>"], keywords: ["<img src=x onerror=alert(1)>"], warnings: [],
  });
  click(root.querySelector("#btn-ai-notice-summary"));
  await tick();
  const sumLi = root.querySelectorAll("#ai-notice-summary-box .ai-points li")[0];
  ok(sumLi.textContent === "<script>alert(1)</script>", "要点按纯文本渲染（未解析为元素）");
  ok(root.querySelectorAll("#ai-notice-summary-box script").length === 0 &&
     root.querySelectorAll("#ai-notice-summary-box img").length === 0, "摘要区未注入 script/img 元素");

  // 摘要：失败路径
  aiSummaryImpl = async () => { throw new Error("摘要服务开小差"); };
  CA.app.toasts = [];
  click(root.querySelector("#btn-ai-notice-summary"));
  await tick();
  ok(CA.app.toasts.indexOf("摘要服务开小差") >= 0, "摘要失败 → toast(err.message)");
  ok(root.querySelector("#btn-ai-notice-summary").disabled === false, "失败后摘要按钮恢复可用");

  // 问答：首轮
  aiAskImpl = async () => "考试请携带准考证与黑色签字笔。";
  aiAskCalls = []; CA.app.toasts = [];
  root.querySelector("#ai-notice-ask-input").value = "考试要带什么？";
  click(root.querySelector("#btn-ai-notice-ask"));
  await tick();
  ok(aiAskCalls.length === 1, "调用 CA.ai.askAbout 一次");
  ok(aiAskCalls[0].question === "考试要带什么？", "question 传入正确");
  ok(aiAskCalls[0].context.indexOf("作业正文") >= 0, "context 使用当前通知正文");
  ok(Array.isArray(aiAskCalls[0].history) && aiAskCalls[0].history.length === 0, "首轮 history 为空");
  const bubbles = root.querySelectorAll("#ai-notice-ask-log .ai-bubble");
  ok(bubbles.length === 2, "问答气泡 = 用户 1 + AI 1");
  ok(bubbles[0].className.indexOf("ai-bubble-user") >= 0 && bubbles[0].textContent === "考试要带什么？",
    "用户气泡文案正确");
  ok(bubbles[1].className.indexOf("ai-bubble-ai") >= 0 && bubbles[1].textContent.indexOf("准考证") >= 0,
    "AI 气泡文案正确");
  ok(root.querySelector("#ai-notice-ask-input").value === "", "提问后输入框清空");
  ok(root.querySelector("#btn-ai-notice-ask").disabled === false, "回答完成后按钮恢复可用");

  // 问答：第二轮 history 累积
  root.querySelector("#ai-notice-ask-input").value = "还有别的吗？";
  click(root.querySelector("#btn-ai-notice-ask"));
  await tick();
  ok(aiAskCalls.length === 2, "第二次调用 askAbout");
  ok(aiAskCalls[1].history.length === 2 &&
     aiAskCalls[1].history[0].role === "user" && aiAskCalls[1].history[1].role === "assistant",
    "第二轮 history 含上轮问答");
  ok(root.querySelectorAll("#ai-notice-ask-log .ai-bubble").length === 4, "第二轮后共 4 个气泡");

  // 问答：空问题拦截
  CA.app.toasts = [];
  root.querySelector("#ai-notice-ask-input").value = "   ";
  click(root.querySelector("#btn-ai-notice-ask"));
  await tick();
  ok(CA.app.toasts.indexOf("请先输入你的问题") >= 0, "空问题 → toast 提示且不请求 AI");

  // AI 关闭 → 隐藏学生端 AI 卡片
  aiOn = false;
  await remount();
  click(itemById("n2"));
  ok(root.querySelector("#ai-notice-assist") !== null && root.querySelector("#ai-notice-assist").hidden === true,
    "AI 关闭 → 学生端 AI 卡片隐藏");

  // 老师端：不渲染学生卡，AI 一句话草稿仍保留
  aiOn = true;
  setUser("u_t");
  await remount();
  click(itemById("n2"));
  ok(root.querySelector("#ai-notice-assist") === null, "老师端不渲染学生端 AI 卡片");
  ok(root.querySelector("#ai-parse-wrap") !== null && root.querySelector("#btn-ai-parse") !== null,
    "老师端「AI 一句话草稿」入口保留不变");

  console.log("\n== L. 既有 DOM id 未破坏（契约 §6.3） ==");
  ["#notices-filters", "#notices-list", "#notice-detail", "#btn-notice-new",
   "#notice-form", "#ai-parse-input", "#btn-ai-parse", "#ai-parse-hint"].forEach((id) => {
    ok(root.querySelector(id) !== null, "既有 id 仍存在 " + id);
  });
  ok(root.querySelector("#btn-ai-notice-summary") === null,
    "老师端不残留学生端新 id（#btn-ai-notice-summary）");

  console.log("\n== M. 附件上传 / 下载 ==");
  setUser("u_a");            // admin：具备发布/上传权
  aiOn = true;
  resetStorage();
  await remount();
  click(root.querySelector("#btn-notice-new"));
  ok(root.querySelector("#notice-attach-input") !== null, "表单存在附件上传入口 #notice-attach-input");
  ok(root.querySelector("#btn-notice-attach") !== null, "存在自定义上传按钮 #btn-notice-attach");
  ok(root.querySelector("#notice-attach-list") !== null, "存在待提交附件列表 #notice-attach-list");
  ok(root.querySelector("#notice-attach-input").hasAttribute("hidden"),
    "原生 file input 隐藏（自定义按钮触发）");

  // M1 正常上传：选择文件 → 调用 upload → 列表出现
  const fileInput = root.querySelector("#notice-attach-input");
  fileInput.files = [{ name: "成绩单.pdf", size: 1024, type: "application/pdf" }];
  dispatch(fileInput, { type: "change" });
  await tick();
  ok(storageCalls.uploads.length === 1, "选择文件后调用 storage.upload 一次");
  ok(storageCalls.bucket === "attachments", "bucket 名传入 storage.from('attachments')");
  ok(storageCalls.uploads[0].key.indexOf("成绩单.pdf") >= 0, "对象 key 含文件名");
  const folderId = storageCalls.uploads[0].key.split("/")[0];
  ok(folderId.indexOf("n_") === 0, "对象 key 目录为预生成通知 id（n_ 前缀）");
  ok(root.querySelectorAll("#notice-attach-list .attach").length === 1, "待提交列表显示 1 个附件");

  // M2 表单校验：体积超限 / 类型白名单
  CA.app.toasts = [];
  fileInput.files = [{ name: "超大.pdf", size: 21 * 1024 * 1024, type: "application/pdf" }];
  dispatch(fileInput, { type: "change" });
  await tick();
  ok(storageCalls.uploads.length === 1, "超过 20MB 不触发上传");
  ok(CA.app.toasts.join("|").indexOf("20MB") >= 0, "超限给出可读体积提示");
  CA.app.toasts = [];
  fileInput.files = [{ name: "病毒.exe", size: 10, type: "application/octet-stream" }];
  dispatch(fileInput, { type: "change" });
  await tick();
  ok(storageCalls.uploads.length === 1, "非白名单类型不触发上传");
  ok(CA.app.toasts.join("|").indexOf("类型不支持") >= 0, "非白名单给出可读类型提示");

  // M3 发布落库：attachments 含 path
  formField("title").value = "带附件的通知";
  formField("category").value = "班级通知";
  dispatch(root.querySelector("#notice-form"), { type: "submit" });
  await tick();
  const withAtt = (await CA.store.get("notices")).filter((x) => x.title === "带附件的通知")[0];
  ok(!!withAtt, "带附件的通知已发布");
  ok(Array.isArray(withAtt.attachments) && withAtt.attachments.length === 1, "落库 attachments 长度 1");
  ok(withAtt.attachments[0].path === storageCalls.uploads[0].key, "attachments[0].path 等于上传 key");
  ok(withAtt.attachments[0].name === "成绩单.pdf" && withAtt.attachments[0].size === 1024 &&
     withAtt.attachments[0].type === "application/pdf", "attachments 元素含 name/size/type");
  ok(withAtt.id === folderId, "发布通知 id 复用附件目录 id");

  // M4 上传失败：真实错误 toast + 按钮恢复
  resetStorage();
  uploadImpl = async () => { throw new Error("存储服务不可用"); };
  CA.app.toasts = [];
  click(root.querySelector("#btn-notice-new"));
  root.querySelector("#notice-attach-input").files = [{ name: "a.pdf", size: 100, type: "application/pdf" }];
  dispatch(root.querySelector("#notice-attach-input"), { type: "change" });
  await tick();
  ok(CA.app.toasts.join("|").indexOf("存储服务不可用") >= 0, "上传失败 → toast 真实错误");
  ok(root.querySelector("#btn-notice-attach").disabled === false, "失败后上传按钮恢复可用");

  // M5 下载：点击详情附件 → createSignedUrl(path, 3600)
  resetStorage();
  await remount();
  click(itemById(withAtt.id));
  const attBtn = root.querySelector('#notice-detail [data-action="attach"]');
  ok(attBtn !== null, "详情附件带下载入口 [data-action=attach]");
  click(attBtn);
  await tick();
  ok(storageCalls.signed.length === 1, "点击附件调用 createSignedUrl 一次");
  ok(storageCalls.signed[0].key === withAtt.attachments[0].path, "createSignedUrl 传入附件 path");
  ok(storageCalls.signed[0].exp === 3600, "签名有效期 3600 秒");

  // M6 下载失败：真实错误 toast
  resetStorage();
  signedImpl = async () => { throw new Error("签名服务超时"); };
  CA.app.toasts = [];
  click(attBtn);
  await tick();
  ok(CA.app.toasts.join("|").indexOf("签名服务超时") >= 0, "下载失败 → toast 真实错误");

  // M7 历史附件缺 path：可读提示且不请求签名
  resetStorage();
  const legacy = await CA.store.add("notices", {
    title: "历史附件", category: "其他", content: "旧数据", publisherId: "u_a",
    attachments: [{ name: "old.pdf", size: 12, type: "application/pdf" }], links: [],
  });
  await remount();
  click(itemById(legacy.id));
  const legacyBtn = root.querySelector('#notice-detail [data-action="attach"]');
  CA.app.toasts = [];
  click(legacyBtn);
  await tick();
  ok(storageCalls.signed.length === 0, "无 path 附件不请求签名 URL");
  ok(CA.app.toasts.join("|").indexOf("存储路径") >= 0, "无 path 给出可读提示（非“演示环境不支持”）");

  console.log("\n== N. 权限回归：member（真实角色名）不得管理通知 ==");
  // 角色取值域是 member|admin|superAdmin；「学生」= member。
  // 这条用例防止历史上把学生写成 "student" 而掩盖真实判定。
  setUser("u_s");
  await remount();
  ok(CA.auth.can("notice.publish") === false, "member：can(notice.publish) = false");
  ok(CA.auth.can("notice.manageAll") === false, "member：can(notice.manageAll) = false");
  ok(root.querySelector("#btn-notice-new").hidden === true, "member：隐藏「发布通知」入口");
  ok(root.querySelector("#ai-parse-wrap").hidden === true, "member：隐藏 AI 一句话草稿");
  ok(root.querySelector("#notice-form").hidden === true, "member：发布/编辑表单保持隐藏");
  click(itemById("n2"));
  ok(root.querySelector('#notice-detail [data-action="edit"]') === null, "member：详情无「编辑」");
  ok(root.querySelector('#notice-detail [data-action="delete"]') === null, "member：详情无「删除」");
  ok(root.querySelector('#notice-detail [data-action="fav"]') !== null, "member：仍可收藏（只读动作保留）");

  console.log("\n== O. RLS 静默拦截必须报错（不能弹「已更新/已删除」） ==");
  // 越权写入在 PG 里是「0 行受影响 + 无 error」，前端必须回读确认，否则会假成功。
  setUser("u_a");                 // admin，且 n3 由 u_a 发布（可管理）
  await remount();
  click(itemById("n3"));
  ok(root.querySelector('#notice-detail [data-action="delete"]') !== null, "前置：admin 对自己发布的 n3 有删除按钮");

  denyWrite = true;               // 打开「静默拦截」模拟
  CA.app.toasts = [];
  click(root.querySelector('#notice-detail [data-action="delete"]'));
  await tick(); await tick();
  ok(CA.app.toasts.indexOf("已删除通知") < 0, "静默拦截：不得弹「已删除通知」");
  ok(CA.app.toasts.join("|").indexOf("未生效") >= 0, "静默拦截：提示操作未生效");
  ok((await CA.store.find("notices", "n3")) !== null, "静默拦截：n3 实际仍在（未被误删）");

  // 更新同理：改标题但写入被拦 → 必须报错且旧标题保留
  CA.app.toasts = [];
  click(root.querySelector('#notice-detail [data-action="edit"]'));
  await tick();
  const titleInput = formField("title");
  titleInput.value = "被拦截的标题";
  dispatch(root.querySelector("#notice-form"), { type: "submit" });
  await tick(); await tick();
  ok(CA.app.toasts.indexOf("已更新通知") < 0, "静默拦截：不得弹「已更新通知」");
  ok(CA.app.toasts.join("|").indexOf("未生效") >= 0, "静默拦截：更新提示未生效");
  const n3row = await CA.store.find("notices", "n3");
  ok(!!n3row && n3row.title !== "被拦截的标题", "静默拦截：标题未被改写");
  denyWrite = false;

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过 ✅"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
