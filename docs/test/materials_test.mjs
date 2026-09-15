// 班级共享资料库模块自测（WS-C · materials.js）
// 运行：node docs/test/materials_test.mjs（在 class-assistant 目录下）
// 零依赖：自带极简 DOM 桩 + mock（异步）CA.store / CA.auth / CA.cloud(storage) / CA.app / CA.icon / CA.util
//         + 可控 window.RH / fetch / File。
// 覆盖：
//   A. 骨架 / DOM id / 角色可见性（.admin-only 语义）
//   B. 文件校验（体积 / 扩展名白名单，纯函数 + 表单拦截）
//   C. 老师上传：先 upload 后 add、key 前缀 materials/、id 前缀 mt_、字段映射完整
//   D. 上传失败 → 不写库 + toast 错误
//   E. 上传成功但入库失败 → 明确提示「文件已上传但登记失败」
//   F. 编辑：只改标题/科目/说明
//   G. 删除：confirm=false 不删；confirm=true 调 remove
//   H. 学生：列表渲染 + 标题搜索 + 科目筛选
//   I. 下载：createSignedUrl 兼容 {data:{fullSignedURL}} 与字符串返回
//   J. 加入我的复习：RH 可用 → parseFile/pipeline/saveDoc；RH 缺失或解析失败 → 降级下载不抛错
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 一、极简 DOM 桩（覆盖 materials.js 用到的 API）
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

const clickLog = [];

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
  click() { this._clicked = true; clickLog.push(this); }
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

class FileStub {
  constructor(parts, name, opts) {
    this.name = name;
    this.type = (opts && opts.type) || "";
    this.size = 0;
  }
}
global.File = FileStub;

// ============================================================
// 三、mock CA.store / auth / cloud(storage) / app / icon / util
// ============================================================
const clone = (x) => JSON.parse(JSON.stringify(x));
const callLog = [];

const storeState = {
  db: {},
  addImpl: null,
  addCalls: [],
  removeCalls: [],
  updateCalls: [],
};
let storeCounter = 0;

const seed = {
  materials: [
    { id: "mt_a", title: "第三章 函数笔记", subject: "数学", description: "课堂补充整理",
      fileName: "函数笔记.pdf", filePath: "materials/mt_a/tok-函数笔记.pdf", fileSize: 2048,
      fileType: "application/pdf", uploaderUid: "u_t", createdAt: "2026-03-01T08:00:00.000Z" },
    { id: "mt_b", title: "英语高频词汇表", subject: "英语", description: "",
      fileName: "词汇表.docx", filePath: "materials/mt_b/tok-词汇表.docx", fileSize: 10240,
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      uploaderUid: "u_a", createdAt: "2026-03-02T08:00:00.000Z" },
    { id: "mt_c", title: "物理实验报告模板", subject: "物理", description: "",
      fileName: "物理模板.docx", filePath: "materials/mt_c/tok-物理模板.docx", fileSize: 5120,
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      uploaderUid: "u_t", createdAt: "2026-03-03T08:00:00.000Z" },
  ],
};
storeState.db = clone(seed);

CA.store = {
  get(c) { return Promise.resolve(clone(storeState.db[c] || [])); },
  find(c, id) {
    for (const x of (storeState.db[c] || [])) if (x.id === id) return Promise.resolve(clone(x));
    return Promise.resolve(null);
  },
  query(c, fn) { return Promise.resolve((storeState.db[c] || []).filter(fn).map(clone)); },
  add(c, obj) {
    storeState.addCalls.push({ coll: c, obj: clone(obj) });
    callLog.push("add");
    if (storeState.addImpl) return storeState.addImpl(c, obj);
    const o = Object.assign({}, clone(obj), { id: clone(obj).id || ("new_" + (++storeCounter)) });
    if (!o.createdAt) o.createdAt = new Date().toISOString();
    (storeState.db[c] = storeState.db[c] || []).push(o);
    return Promise.resolve(clone(o));
  },
  update(c, id, patch) {
    storeState.updateCalls.push({ coll: c, id, patch: clone(patch) });
    for (const x of (storeState.db[c] || [])) {
      if (x.id === id) { Object.assign(x, clone(patch)); return Promise.resolve(clone(x)); }
    }
    return Promise.resolve(null);
  },
  remove(c, id) {
    storeState.removeCalls.push({ coll: c, id });
    const l = storeState.db[c] || [];
    for (let i = 0; i < l.length; i++) if (l[i].id === id) { l.splice(i, 1); return Promise.resolve(true); }
    return Promise.resolve(true);
  },
  settings() { return {}; },
  setSettings() {},
  reset() { return Promise.resolve(true); },
  uid(p) { return (p || "id") + "_test" + (++storeCounter); },
  memberName() { return ""; },
};

let currentRole = "superAdmin";
const users = {
  superAdmin: { id: "u_t", name: "王老师", role: "superAdmin" },
  admin: { id: "u_a", name: "李思远", role: "admin" },
  student: { id: "u_s", name: "张天宇", role: "student" },
};
CA.auth = {
  current() { return Promise.resolve(clone(users[currentRole])); },
  list() { return Promise.resolve([users.superAdmin, users.admin, users.student].map(clone)); },
  isAdmin() { return currentRole === "admin" || currentRole === "superAdmin"; },
  isSuperAdmin() { return currentRole === "superAdmin"; },
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

// ---- 云存储 mock（CA.cloud.app.storage.from('attachments')）----
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
  uploadImpl = async (key) => { callLog.push("upload"); return { data: { id: key } }; };
  signedImpl = async (key, exp) => ({ data: { fullSignedURL: "https://signed.example/" + encodeURIComponent(key) + "?e=" + exp } });
}
resetStorage();
CA.cloud = {
  app: { storage: { from(b) { storageCalls.bucket = b; return bucketStub; } } },
  ensure() {}, ready() { return true; }, lastError() { return null; },
};

// fetch mock（学生「加入我的复习」取回文件）
global.fetch = async () => ({ ok: true, status: 200, blob: async () => ({ type: "application/pdf", size: 4096 }) });

require(path.join(__dirname, "..", "src", "materials.js"));

// ============================================================
// 四、断言工具
// ============================================================
let passCount = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { passCount++; console.log("  ✓ " + msg); }
  else { failCount++; console.error("  ✗ " + msg); throw new Error("断言失败: " + msg); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };
const toArr = (l) => Array.prototype.slice.call(l || []);

const root = document.createElement("section");
root.id = "view-materials";
document.body.appendChild(root);

function setRole(r) { currentRole = r; }
function resetDb() {
  storeState.db = clone(seed);
  storeState.addCalls = [];
  storeState.updateCalls = [];
  storeState.removeCalls = [];
}
async function remount() {
  if (CA.views.materials) CA.views.materials.unmount();
  await CA.views.materials.mount(root);
  await flush();
}
function rows() { return root.querySelectorAll("#materials-list .list-row"); }
function rowIds() { return toArr(rows()).map((r) => r.dataset.materialId); }
function row(id) { return toArr(rows()).filter((r) => r.dataset.materialId === id)[0]; }
function byText(nodes, text) { return toArr(nodes).filter((n) => n.textContent.indexOf(text) >= 0)[0]; }
function toasts() { return CA.app.toasts.join("|"); }
function openNewForm() {
  click(root.querySelector("#btn-materials-new"));
}
function fillAndSubmit(title, subject, desc, file) {
  const form = root.querySelector("#materials-form");
  form.querySelector('[name="title"]').value = title;
  form.querySelector('[name="subject"]').value = subject == null ? "" : subject;
  const ta = form.querySelector('[name="desc"]');
  if (ta) ta.value = desc == null ? "" : desc;
  const fi = form.querySelector('[name="file"]');
  if (fi && file) fi.files = [file];
  dispatch(form, { type: "submit" });
}

(async () => {
  console.log("\n== A. 骨架 / DOM id / 角色可见性 ==");
  setRole("superAdmin");
  await remount();
  ["#materials-list", "#materials-form", "#btn-materials-new", "#materials-search", "#materials-subject-filter"].forEach((id) => {
    ok(root.querySelector(id) !== null, "存在 " + id);
  });
  ok(root.querySelector("#btn-materials-new").hidden === false, "管理员可见「上传资料」");
  ok(root.querySelector("#btn-materials-new").className.indexOf("admin-only") >= 0, "上传入口带 .admin-only");
  ok(root.querySelector("#materials-form").hidden === true, "表单默认隐藏");
  ok(root.querySelector("#materials-form").className.indexOf("admin-only") >= 0, "表单带 .admin-only");
  ok(rowIds().length === 3, "列表渲染 3 条资料");
  ok(rowIds()[0] === "mt_c", "最新在前（createdAt desc）：" + rowIds().join(","));
  ok(row("mt_a").querySelectorAll(".badge").length >= 1, "科目以 badge 呈现");
  ok(byText(row("mt_a").querySelectorAll(".list-meta span"), "SMART(") !== undefined, "上传时间走 fmtSmart（非 ISO 直出）");

  setRole("student");
  await remount();
  ok(root.querySelector("#btn-materials-new").hidden === true, "学生看不到「上传资料」");
  ok(root.querySelector("#materials-form").hidden === true, "学生表单保持隐藏");
  ok(row("mt_b") !== undefined && row("mt_b").querySelector(".student-only") !== null, "学生端操作带 .student-only");
  ok(row("mt_a").querySelector(".admin-only") === null, "学生端不渲染编辑/删除（.admin-only）");
  setRole("superAdmin");
  await remount();

  console.log("\n== B. 文件校验（体积 / 扩展名白名单） ==");
  ok(CA.materials.validateFile({ name: "a.pdf", size: 1024 }) === "", "合法 pdf 通过");
  ok(CA.materials.validateFile({ name: "a.PDF", size: 1024 }) === "", "扩展名大小写不敏感");
  ok(CA.materials.validateFile({ name: "big.pdf", size: 21 * 1024 * 1024 }).indexOf("20MB") >= 0, "超 20MB 被拒（可读文案）");
  ok(CA.materials.validateFile({ name: "virus.exe", size: 10 }).indexOf("类型不支持") >= 0, "非白名单扩展名被拒");
  ok(CA.materials.buildStorageKey("mt_x", "第三章 笔记.pdf").indexOf("materials/mt_x/") === 0, "buildStorageKey 目录 = materials/<id>/");
  ok(CA.materials.fmtSize(2048) === "2 KB" && CA.materials.fmtSize(1024 * 1024) === "1 MB", "fmtSize 换单位正确");
  ok(CA.materials.sanitizeFileName("a/b\\c.txt") === "a_b_c.txt", "文件名安全化去掉路径分隔符");

  // DOM 级拦截：超限 / 非白名单都不触发上传
  resetStorage();
  openNewForm();
  fillAndSubmit("超限文件", "数学", "", { name: "big.pdf", size: 21 * 1024 * 1024, type: "application/pdf" });
  await flush();
  ok(storageCalls.uploads.length === 0, "超 20MB 不触发 upload");
  ok(toasts().indexOf("20MB") >= 0, "超限给出可读提示");
  fillAndSubmit("坏类型", "数学", "", { name: "x.exe", size: 10, type: "application/octet-stream" });
  await flush();
  ok(storageCalls.uploads.length === 0, "非白名单不触发 upload");
  ok(toasts().indexOf("类型不支持") >= 0, "非白名单给出可读提示");
  ok(storeState.db.materials.length === 3, "被拒时库内数量不变");
  click(byText(root.querySelectorAll("#materials-form .form-actions .btn"), "取消"));
  ok(root.querySelector("#materials-form").hidden === true, "取消后表单收起");

  console.log("\n== C. 老师上传：先 upload 后 add ==");
  resetStorage();
  callLog.length = 0;
  openNewForm();
  ok(root.querySelector("#materials-form").hidden === false, "点击上传 → 表单展开");
  fillAndSubmit("第三章 函数笔记", "数学", "课堂补充", { name: "函数笔记.pdf", size: 2048, type: "application/pdf" });
  await flush();

  ok(storageCalls.bucket === "attachments", "bucket 名传入 storage.from('attachments')");
  ok(storageCalls.uploads.length === 1, "触发一次 upload");
  const key = storageCalls.uploads[0].key;
  const parts = key.split("/");
  ok(key.indexOf("materials/") === 0, "对象 key 前缀 materials/");
  ok(parts.length === 3 && /^mt_/.test(parts[1]), "key 第二段 = mt_ 资料 id（" + parts[1] + "）");
  ok(parts[2].indexOf("函数笔记.pdf") >= 0, "key 含安全化文件名");
  ok(callLog.indexOf("upload") >= 0 && callLog.indexOf("add") >= 0 && callLog.indexOf("upload") < callLog.indexOf("add"),
    "先 upload 后 add（调用顺序正确）");
  ok(storeState.addCalls.length === 1 && storeState.addCalls[0].coll === "materials", "add 写入 materials 集合");
  const obj = storeState.addCalls[0].obj;
  ok(obj.id === parts[1], "入库 id 与对象目录一致");
  ok(obj.title === "第三章 函数笔记" && obj.subject === "数学" && obj.description === "课堂补充", "标题/科目/说明正确");
  ok(obj.fileName === "函数笔记.pdf" && obj.filePath === key, "fileName / filePath 正确");
  ok(obj.fileSize === 2048 && obj.fileType === "application/pdf", "fileSize / fileType 正确");
  ok(root.querySelector("#materials-form").hidden === true, "上传后表单收起");
  ok(rowIds().indexOf(parts[1]) >= 0, "上传后列表出现新资料");
  ok(toasts().indexOf("资料已上传") >= 0, "上传成功 toast");

  console.log("\n== D. 上传失败 → 不写库 + toast 错误 ==");
  resetStorage();
  const addBefore = storeState.addCalls.length;
  const dbBefore = storeState.db.materials.length;
  uploadImpl = async () => { throw new Error("存储服务不可用"); };
  CA.app.toasts = [];
  openNewForm();
  fillAndSubmit("失败资料", "语文", "", { name: "失败.pdf", size: 100, type: "application/pdf" });
  await flush();
  ok(storageCalls.uploads.length === 1, "确实尝试了上传");
  ok(storeState.addCalls.length === addBefore, "上传失败不写库");
  ok(storeState.db.materials.length === dbBefore, "库内数量不变");
  ok(toasts().indexOf("存储服务不可用") >= 0, "toast 真实错误（未静默吞掉）");
  click(byText(root.querySelectorAll("#materials-form .form-actions .btn"), "取消"));

  console.log("\n== E. 上传成功但入库失败 → 明确提示 ==");
  resetStorage();
  const dbBefore2 = storeState.db.materials.length;
  const realAdd = CA.store.add;
  CA.store.add = () => Promise.reject(new Error("new row violates row-level security policy (42501)"));
  CA.app.toasts = [];
  openNewForm();
  fillAndSubmit("登记失败资料", "历史", "", { name: "登记.pdf", size: 100, type: "application/pdf" });
  await flush();
  ok(storageCalls.uploads.length === 1, "文件确已上传");
  ok(storeState.db.materials.length === dbBefore2, "登记失败不落库");
  ok(toasts().indexOf("文件已上传") >= 0 && toasts().indexOf("登记失败") >= 0,
    "明确提示「文件已上传，但登记失败」，不假成功");
  CA.store.add = realAdd;
  click(byText(root.querySelectorAll("#materials-form .form-actions .btn"), "取消"));

  console.log("\n== F. 编辑：只改标题/科目/说明 ==");
  await remount();
  click(byText(row("mt_a").querySelectorAll(".btn"), "编辑"));
  await flush();
  ok(root.querySelector("#materials-form").hidden === false, "点击编辑 → 表单展开");
  const editForm = root.querySelector("#materials-form");
  ok(editForm.querySelector('[name="title"]').value === "第三章 函数笔记", "标题回填");
  ok(editForm.querySelector('[name="subject"]').value === "数学", "科目回填");
  ok(editForm.querySelector('[name="file"]') === null, "编辑态不出现文件选择（文件不可换）");
  storeState.updateCalls.length = 0;
  editForm.querySelector('[name="title"]').value = "函数笔记（修订）";
  editForm.querySelector('[name="subject"]').value = "数学拓展";
  dispatch(editForm, { type: "submit" });
  await flush();
  ok(storeState.updateCalls.length === 1 && storeState.updateCalls[0].id === "mt_a", "update 命中 mt_a");
  ok(storeState.updateCalls[0].patch.title === "函数笔记（修订）" &&
     storeState.updateCalls[0].patch.subject === "数学拓展", "仅更新标题/科目/说明");
  ok(storeState.updateCalls[0].patch.filePath === undefined, "编辑不携带 filePath（文件不变）");
  // 还原，避免影响后续断言
  await CA.store.update("materials", "mt_a", { title: "第三章 函数笔记", subject: "数学" });

  console.log("\n== G. 删除：confirm 语义 ==");
  await remount();
  storeState.removeCalls.length = 0;
  global.confirm = () => false;
  click(byText(row("mt_c").querySelectorAll(".btn"), "删除"));
  await flush();
  ok(storeState.removeCalls.length === 0, "confirm=false 不删除");
  ok(row("mt_c") !== undefined, "取消后资料仍在列表");
  global.confirm = () => true;
  click(byText(row("mt_c").querySelectorAll(".btn"), "删除"));
  await flush();
  ok(storeState.removeCalls.length === 1 && storeState.removeCalls[0].id === "mt_c", "confirm=true 调 remove");
  ok(storeState.removeCalls[0].coll === "materials", "remove 作用于 materials 集合");
  ok(row("mt_c") === undefined, "删除后从列表移除");

  console.log("\n== H. 学生：列表渲染 + 搜索 + 筛选 ==");
  setRole("student");
  resetDb();
  await remount();
  ok(rowIds().length === 3, "学生可见全部 3 条共享资料");
  ok(row("mt_a").querySelector(".student-only") !== null, "学生操作按钮带 .student-only");
  // 搜索
  const search = root.querySelector("#materials-search");
  search.value = "函数";
  dispatch(search, { type: "input" });
  await flush();
  ok(rowIds().length === 1 && rowIds()[0] === "mt_a", "标题搜索「函数」→ 1 条");
  search.value = "";
  dispatch(search, { type: "input" });
  await flush();
  ok(rowIds().length === 3, "清空搜索 → 恢复全部");
  // 筛选
  const sel = root.querySelector("#materials-subject-filter");
  ok(toArr(sel.children).length === 4, "科目下拉含「全部科目」+ 3 个科目");
  sel.value = "英语";
  dispatch(sel, { type: "change" });
  await flush();
  ok(rowIds().length === 1 && rowIds()[0] === "mt_b", "按科目「英语」筛选 → 1 条");
  sel.value = "不存在科目";
  dispatch(sel, { type: "change" });
  await flush();
  ok(root.querySelector("#materials-list").textContent.indexOf("没有匹配") >= 0, "无匹配给出空态文案");
  sel.value = "";
  dispatch(sel, { type: "change" });
  await flush();

  console.log("\n== I. 下载：签名 URL 兼容两种返回 ==");
  resetStorage();
  const u1 = await CA.materials.signedUrlOf("materials/mt_a/x.pdf");
  ok(u1 === "https://signed.example/" + encodeURIComponent("materials/mt_a/x.pdf") + "?e=3600",
    "兼容 { data: { fullSignedURL } }（且 TTL=3600）");
  ok(storageCalls.signed.length === 1 && storageCalls.signed[0].exp === 3600, "createSignedUrl(path, 3600)");
  signedImpl = async () => "https://plain.example/direct";
  const u2 = await CA.materials.signedUrlOf("materials/mt_a/x.pdf");
  ok(u2 === "https://plain.example/direct", "兼容字符串直接返回");
  signedImpl = async () => ({ signedUrl: "https://signedurl.example/s" });
  const u3 = await CA.materials.signedUrlOf("materials/mt_a/x.pdf");
  ok(u3 === "https://signedurl.example/s", "兼容 { signedUrl }");
  resetStorage();
  const clickBefore = clickLog.length;
  click(byText(row("mt_b").querySelectorAll(".btn"), "下载"));
  await flush();
  ok(storageCalls.signed.length === 1 && storageCalls.signed[0].key === "materials/mt_b/tok-词汇表.docx",
    "下载按 filePath 取签名 URL");
  ok(clickLog.length > clickBefore, "触发浏览器下载（<a> click）");
  ok(toasts().indexOf("已开始下载") >= 0, "下载成功 toast");

  console.log("\n== J. 加入我的复习：RH 集成 / 降级 ==");
  setRole("student");
  await remount();
  resetStorage();
  const rhCalls = { parse: 0, pipeline: 0, save: 0, savedTitle: null, savedRec: null };
  global.window.RH = {
    parsers: { parseFile: async (file) => { rhCalls.parse++; rhCalls.file = file; return { title: "词汇表", sections: [] }; } },
    pipeline: { run: async () => { rhCalls.pipeline++; return { title: "英语高频词汇表", engine: "rule", sections: [], quiz: [] }; } },
    storage: { saveDoc: async (title, rec) => { rhCalls.save++; rhCalls.savedTitle = title; rhCalls.savedRec = rec; } },
  };
  CA.app.toasts = [];
  click(byText(row("mt_b").querySelectorAll(".btn"), "加入我的复习"));
  await flush();
  ok(rhCalls.parse === 1, "调用 RH.parsers.parseFile");
  ok(rhCalls.pipeline === 1, "调用 RH.pipeline.run");
  ok(rhCalls.save === 1, "调用 RH.storage.saveDoc（存本机 IndexedDB）");
  ok(rhCalls.savedTitle === "英语高频词汇表", "saveDoc 标题用 pipeline 结果");
  ok(rhCalls.savedRec && rhCalls.savedRec.sourceName === "词汇表.docx", "saveDoc 携带源文件名");
  ok(rhCalls.file && rhCalls.file.name === "词汇表.docx", "File 名称 = 资料文件名");
  ok(toasts().indexOf("仅存本机") >= 0, "提示「解析与学习记录仅存本机」");

  // RH 缺失 → 降级为「已下载到本机」，不抛未捕获异常
  delete global.window.RH;
  resetStorage();
  const clickBefore2 = clickLog.length;
  CA.app.toasts = [];
  click(byText(row("mt_b").querySelectorAll(".btn"), "加入我的复习"));
  await flush();
  ok(clickLog.length > clickBefore2, "RH 缺失 → 触发下载（<a> click）");
  ok(toasts().indexOf("已下载到本机") >= 0, "RH 缺失 → 降级提示「已下载到本机」");

  // RH 存在但解析失败 → 同样降级，不抛错
  global.window.RH = {
    parsers: { parseFile: async () => { throw new Error("解析器崩溃"); } },
    pipeline: { run: async () => ({}) },
    storage: { saveDoc: async () => {} },
  };
  resetStorage();
  const clickBefore3 = clickLog.length;
  CA.app.toasts = [];
  click(byText(row("mt_b").querySelectorAll(".btn"), "加入我的复习"));
  await flush();
  ok(clickLog.length > clickBefore3, "解析失败 → 触发下载兜底");
  ok(toasts().indexOf("解析失败") >= 0 && toasts().indexOf("已下载到本机") >= 0,
    "解析失败 → 降级提示（不抛未捕获异常）");
  delete global.window.RH;

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
