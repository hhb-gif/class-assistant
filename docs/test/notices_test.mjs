// 通知模块自测（Agent C · 契约 §10）
// 运行：node docs/test/notices_test.mjs（在 class-assistant 目录下）
// 零依赖：自带极简 DOM 桩 + mock CA.store / CA.auth / CA.ai / CA.app
// 覆盖：置顶排序、分类筛选计数、发布字段完整、编辑/删除权限、AI 草稿回填不抛错、收藏、XSS 转义
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
// 三、mock CA.store / CA.auth / CA.ai / CA.app
// ============================================================
const clone = (x) => JSON.parse(JSON.stringify(x));

function makeStore(seed) {
  const db = clone(seed);
  return {
    _db: db,
    get(c) { return clone(db[c] || []); },
    find(c, id) {
      const l = db[c] || [];
      for (const x of l) if (x.id === id) return clone(x);
      return null;
    },
    query(c, fn) { return (db[c] || []).filter(fn).map(clone); },
    add(c, obj) {
      const now = new Date().toISOString();
      const o = Object.assign({}, obj, {
        id: "new_" + (db[c] ? db[c].length : 0) + "_" + Math.random().toString(36).slice(2, 6),
        createdAt: now,
        updatedAt: now,
      });
      (db[c] = db[c] || []).push(o);
      return clone(o);
    },
    update(c, id, patch) {
      const l = db[c] || [];
      for (const x of l) {
        if (x.id === id) { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); return clone(x); }
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
    uid(p) { return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    memberName() { return ""; },
  };
}

const users = {
  u_t: { id: "u_t", name: "王老师", role: "superAdmin", title: "班主任" },
  u_a: { id: "u_a", name: "李思远", role: "admin", title: "学习委员" },
  u_s: { id: "u_s", name: "张天宇", role: "student", title: "学生" },
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
    if (action === "notice.manageAll") return r === "superAdmin";
    if (action === "score.edit") return r === "admin" || r === "superAdmin";
    if (action === "member.manage") return r === "superAdmin";
    if (action === "settings.ai") return r === "superAdmin";
    return false;
  },
};

let aiOn = true;
let aiCalls = [];
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
};

CA.app = {
  toasts: [],
  toast(msg) { this.toasts.push(String(msg)); },
  openModal() {},
  closeModal() {},
  rerender() { this.rerenderCount = (this.rerenderCount || 0) + 1; },
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
const tick = () => new Promise((r) => setTimeout(r, 0));

const root = document.createElement("section");
document.body.appendChild(root);

function setUser(id) { currentId = id; }
function remount() { CA.views.notices.unmount(); CA.views.notices.mount(root); }
function catButton(cat) {
  return root.querySelectorAll("button[data-cat]").filter((b) => b.dataset.cat === cat)[0];
}
function itemById(id) {
  return root.querySelectorAll("#notices-list .list-row").filter((i) => i.dataset.noticeId === id)[0];
}
function formField(name) { return root.querySelector('#notice-form [name="' + name + '"]'); }

(async () => {
  console.log("\n== A. 骨架与分类筛选 ==");
  CA.views.notices.mount(root);
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

  console.log("\n== D. 发布：字段完整 ==");
  setUser("u_a"); // admin
  remount();
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
  let notices = CA.store.get("notices");
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
  ok(root.querySelector("#notice-form").hidden === false, "点击编辑 → 表单展开");
  ok(formField("title").value === "春季运动会", "编辑表单回填原标题");
  formField("title").value = "春季运动会（改）";
  dispatch(root.querySelector("#notice-form"), { type: "submit" });
  ok(CA.store.find("notices", "n3").title === "春季运动会（改）", "本人编辑成功写入");
  click(itemById("n1"));                       // n1 由 u_t 发布
  ok(root.querySelector('#notice-detail [data-action="edit"]') === null, "他人发布 → admin 无编辑按钮");
  ok(root.querySelector('#notice-detail [data-action="delete"]') === null, "他人发布 → admin 无删除按钮");

  console.log("\n== F. 删除权限（superAdmin 全部 / admin 仅本人） ==");
  click(itemById("n4"));                       // n4 由 u_a 发布
  ok(root.querySelector('#notice-detail [data-action="delete"]') !== null, "本人发布 → admin 可删除");
  click(root.querySelector('#notice-detail [data-action="delete"]'));
  ok(CA.store.find("notices", "n4") === null, "admin 删除本人通知成功");
  ok(CA.store.get("notices").length === 5, "删除后通知数 6 → 5");
  setUser("u_t"); // superAdmin
  remount();
  click(itemById("n1"));
  ok(root.querySelector('#notice-detail [data-action="delete"]') !== null, "superAdmin 对他人通知有删除按钮");
  click(root.querySelector('#notice-detail [data-action="delete"]'));
  ok(CA.store.find("notices", "n1") === null, "superAdmin 删除他人通知成功");

  console.log("\n== G. 收藏（students 可用，列表与详情同步） ==");
  setUser("u_s"); // student
  remount();
  click(itemById("n5"));
  let favBtn = root.querySelector("#notice-fav-btn");
  ok(favBtn.dataset.fav === "1" && favBtn.className.indexOf("is-fav") >= 0, "详情显示已收藏态（种子收藏）");
  click(favBtn);
  ok(CA.store.query("favorites", (f) => f.userId === "u_s" && f.noticeId === "n5").length === 0, "取消收藏写入库");
  ok(root.querySelector("#notice-fav-btn").dataset.fav === "0", "详情收藏按钮切回未收藏态");
  ok(root.querySelectorAll("#notices-list .fav-star").length === 0, "列表收藏星标同步移除");
  click(root.querySelector("#notice-fav-btn"));
  ok(CA.store.query("favorites", (f) => f.userId === "u_s" && f.noticeId === "n5").length === 1, "再次收藏写入库");
  ok(root.querySelectorAll("#notices-list .fav-star").length === 1, "列表收藏星标同步出现");

  console.log("\n== H. AI 一句话草稿 ==");
  setUser("u_a"); aiOn = true; aiCalls = []; CA.app.toasts = [];
  remount();
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
  remount();
  ok(root.querySelector("#ai-parse-wrap").hidden === true, "AI 关闭 → 整块隐藏");
  aiOn = true;
  setUser("u_s");
  remount();
  ok(root.querySelector("#ai-parse-wrap").hidden === true, "学生无发布权 → AI 块隐藏");
  ok(root.querySelector("#btn-notice-new").hidden === true, "学生隐藏发布入口");

  console.log("\n== J. XSS 转义 ==");
  setUser("u_t");
  remount();
  const maliciousItem = itemById("n5");
  ok(maliciousItem.querySelector(".notice-title").textContent === "<img src=x onerror=alert(1)>",
    "标题按纯文本渲染（未解析为元素）");
  ok(maliciousItem.querySelectorAll("img").length === 0, "页面未注入 img 元素");
  click(maliciousItem);
  ok(root.querySelector("#notice-detail .detail-content").innerHTML.indexOf("&lt;script&gt;") >= 0,
    "正文经 escapeHtml 转义后注入");

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过 ✅"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
