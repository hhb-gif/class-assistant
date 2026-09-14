// 复习视图自测（Agent R2）
// 运行：node docs/test/review_test.mjs（在 class-assistant 目录下）
// 零依赖：自带极简 DOM 桩 + mock window.RH（parsers/pipeline/storage/sm2/exporter）与 CA.*
// 覆盖：mount 不抛错、四个子 Tab 切换、上传流程调用链（mock 文件）、要点渲染、练习答题反馈与
//       recordAnswer 调用、复习统计与到期列表/筛选、资料库列表与打开/删除、导出调用、
//       AI 关闭联动降级、RH 缺失优雅降级、XSS 转义。
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 一、极简 DOM 桩（与 collect_test.mjs 同款）
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
    this.files = null;
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
  click() { dispatch(this, { type: "click" }); }
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

let urlCalls = 0;
global.URL = {
  createObjectURL() { urlCalls++; return "blob:mock"; },
  revokeObjectURL() {},
};

// ============================================================
// 三、mock CA.*
// ============================================================
CA.iconCalls = [];
CA.icon = (name) => {
  CA.iconCalls.push(name);
  return '<svg class="icon" data-icon="' + name + '"></svg>';
};
CA.util = { fmtSmart: (v) => (v ? "SMART" : "—") };
CA.app = {
  toasts: [],
  toast(msg) { this.toasts.push(String(msg)); },
  openModal() {}, closeModal() {}, rerender() {},
};
let aiOn = true;
CA.ai = { enabled() { return aiOn; } };

// ============================================================
// 四、mock window.RH
// ============================================================
const parseCalls = [];
const pipelineCalls = [];
const recordCalls = [];
const saveCalls = [];
const getDocCalls = [];
const exporterCalls = { docx: 0, quiz: 0 };
let llmReadySeen = null;
let pipelineResult = null;

const VM = {
  title: "高等数学第一章",
  engine: "llm",
  backend: "test-model",
  overview: "本章介绍极限的定义与性质。",
  keywords: ["极限", "连续"],
  terms: ["导数"],
  sections: [
    {
      title: "极限",
      points: [
        { point: "极限的定义：当自变量趋近某值时函数值的走向。", source: "原文片段A", importance: "high" },
        { point: "例题：用定义证明极限存在。", source: "原文片段B", importance: "medium", kind: "example" },
      ],
    },
  ],
  quiz: [
    { qid: "ai1", type: "choice", question: "极限的定义是什么？", options: ["选项A", "选项B", "选项C", "选项D"], answerIndex: 0, answer: "选项A", explanation: "依据定义", source: "原文片段A", difficulty: 1 },
    { qid: "ai2", type: "choice", question: "第二个问题？", options: ["甲", "乙", "丙", "丁"], answerIndex: 2, answer: "丙", explanation: "解析2", source: "", difficulty: 2 },
  ],
  original_sections: [],
};

const OFFLINE_VM = {
  title: "离线资料",
  engine: "rule",
  backend: "rule/word_overlap",
  overview: "离线模式生成。",
  keywords: ["规则"],
  terms: [],
  sections: [{ title: "章", points: [{ point: "离线要点", source: "", importance: "" }] }],
  quiz: [{ qid: "r1", type: "choice", question: "离线题？", options: ["对", "错"], answerIndex: 0, answer: "对", explanation: "e", source: "", difficulty: 1 }],
  original_sections: [],
};

const XSS_VM = {
  title: "<img src=x onerror=alert(1)>",
  engine: "rule",
  backend: "",
  overview: "<script>alert(1)</script>",
  keywords: ["<img src=x onerror=alert(1)>"],
  terms: [],
  sections: [{ title: "章", points: [{ point: "<script>alert(1)</script>", source: "<img src=y onerror=alert(2)>", importance: "low" }] }],
  quiz: [{ qid: "x1", type: "choice", question: "<img src=x onerror=alert(3)>", options: ["<script>alert(4)</script>", "b"], answerIndex: 0, answer: "<script>alert(4)</script>", explanation: "<img src=x onerror=alert(5)>", source: "", difficulty: 1 }],
  original_sections: [],
};

const docRecords = [
  {
    title: "高数笔记", time: Date.now(), engine: "llm", backend: "m", overview: "o",
    keywords: [], terms: [],
    sections: [{ title: "s", points: [{ point: "p1" }, { point: "p2" }] }],
    quiz: [{ qid: "q1", type: "choice", question: "Q1", options: ["a", "b"], answerIndex: 0, answer: "a", explanation: "e", source: "" }],
    original_sections: [],
  },
  {
    title: "英语笔记", time: Date.now() - 1000, engine: "rule", overview: "", keywords: [], terms: [],
    sections: [], quiz: [], original_sections: [],
  },
];

function makeRH() {
  return {
    parsers: {
      parseFile(file, onProgress) {
        parseCalls.push(file);
        if (onProgress) onProgress("解析", 0.3);
        return Promise.resolve({
          title: file.name.replace(/\.[^.]+$/, ""),
          sections: [{ title: "章", blocks: ["内容"], rich: [{ t: "内容", k: "para", lvl: 0 }] }],
        });
      },
    },
    pipeline: {
      run(doc, onProgress) {
        pipelineCalls.push(doc);
        llmReadySeen = (typeof RH !== "undefined" && RH.llm && RH.llm.ready) ? RH.llm.ready() : null;
        if (onProgress) {
          onProgress("summarize", "提炼中", 0.5);
          onProgress("quiz", "出题中", 0.8);
        }
        const useLlm = (typeof RH !== "undefined" && RH.llm && RH.llm.ready) ? RH.llm.ready() : true;
        return Promise.resolve(useLlm ? pipelineResult : OFFLINE_VM);
      },
    },
    storage: {
      recordAnswer(docTitle, q, ok, userAnswer) {
        recordCalls.push({ docTitle, qid: q.qid, ok, userAnswer });
        return Promise.resolve({ cardId: docTitle + "::" + q.qid });
      },
      getStats() { return Promise.resolve({ total: 5, due: 2, mastered: 3, weak: 1, learning: 1 }); },
      getDueCards() {
        return Promise.resolve([
          { cardId: "c1", docTitle: "高等数学第一章", qid: "ai1", type: "choice", question: "极限的定义是什么？", options: ["选项A", "选项B"], answerIndex: 0, answer: "选项A", explanation: "e", source: "", difficulty: 1, due: 1 },
          { cardId: "c2", docTitle: "英语笔记", qid: "e1", type: "choice", question: "word?", options: ["甲", "乙"], answerIndex: 1, answer: "乙", explanation: "", source: "", difficulty: 1, due: 1 },
        ]);
      },
      getAllCards() { return Promise.resolve([]); },
      saveDoc(title) { saveCalls.push(title); return Promise.resolve(true); },
      getDoc(title) {
        getDocCalls.push(title);
        const rec = docRecords.filter((r) => r.title === title)[0];
        return Promise.resolve(rec || null);
      },
      listDocs() { return Promise.resolve(docRecords.slice()); },
      deleteDoc(title) { this._deleted = title; return Promise.resolve(true); },
    },
    sm2: {
      qualityFromResult(ok) { return ok ? 4 : 1; },
      review(card) { return card; },
      statusOf() { return "learning"; },
    },
    exporter: {
      docxBlob() { exporterCalls.docx++; return Promise.resolve({ size: 1 }); },
      quizDocxBlob() { exporterCalls.quiz++; return Promise.resolve({ size: 1 }); },
      filenameDocx(vm) { return vm.title + "_复习要点.docx"; },
      filenameQuizDocx(vm) { return vm.title + "_自测卷.docx"; },
      _deleted: null,
    },
    llm: { ready() { return true; }, info() { return { model: "test-model" }; } },
  };
}
global.RH = makeRH();

require(path.join(__dirname, "..", "src", "review-view.js"));

// ============================================================
// 五、断言工具
// ============================================================
let passCount = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { passCount++; console.log("  ✓ " + msg); }
  else { failCount++; console.error("  ✗ " + msg); throw new Error("断言失败: " + msg); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };

const root = document.createElement("section");
document.body.appendChild(root);

function remount() {
  CA.views.review.unmount();
  root.innerHTML = "";
  CA.views.review.mount(root);
}
function tab(key) { return root.querySelectorAll("#review-tabs .seg-item").filter((b) => b.getAttribute("data-tab") === key)[0]; }
function byText(nodes, text) { return nodes.filter((n) => n.textContent.indexOf(text) >= 0)[0]; }
function fakeFile(name, text) {
  return { name, type: "text/plain", arrayBuffer: async () => new ArrayBuffer(0), text: async () => (text || name) };
}
function upload(files) {
  const input = root.querySelector("#review-file-input");
  input.files = files;
  dispatch(input, { type: "change" });
}

(async () => {
  console.log("\n== A. 纯函数 ==");
  const f = CA.review.formatVm({
    title: "T", engine: "llm", backend: "m",
    sections: [{ title: "s", points: ["字符串要点", { point: "p2", importance: "bogus" }] }],
    quiz: [{ type: "choice", question: "Q", options: ["a", "b"], answer: "b" }],
  });
  ok(f.engineLabel === "AI · m", "formatVm 引擎徽标 AI · model");
  ok(f.sections[0].points.length === 2 && f.sections[0].points[0].point === "字符串要点", "字符串要点被归一化");
  ok(f.sections[0].points[1].importance === "", "非法 importance 置空");
  ok(f.quiz[0].answerIndex === 1, "缺 answerIndex 时按 answer 文本回填");
  ok(CA.review.answerState({ options: ["a", "b"], answerIndex: 1 }, 1).correct === true, "answerState 命中");
  ok(CA.review.answerState({ options: ["a", "b"], answerIndex: 1 }, 0).correct === false, "answerState 未命中");
  ok(CA.review.answerState({ options: ["a", "b"], answerIndex: 1 }, null).answered === false, "answerState 未作答");
  ok(CA.review.mergeDocs([{ title: "A", sections: [{ title: "s" }] }, { title: "B", sections: [] }]).sections.length === 1, "mergeDocs 合并章节");

  console.log("\n== B. mount 与 DOM id ==");
  remount();
  [
    "#review-upload", "#review-file-input", "#review-progress", "#review-progress-bar", "#review-progress-text",
    "#review-result", "#review-doc-title", "#review-engine-badge", "#review-tabs",
    "#review-pane-points", "#review-pane-quiz", "#review-pane-study", "#review-pane-library",
    "#review-overview", "#review-keywords", "#review-sections",
    "#review-quiz-list", "#review-quiz-stats", "#review-study-stats", "#review-due-list", "#review-doc-filter",
    "#review-library-list", "#review-quiz-import", "#review-export-docx", "#review-export-quiz",
  ].forEach((id) => ok(root.querySelector(id) !== null, "存在 " + id));
  await flush();
  ok(root.querySelector("#review-doc-filter").querySelectorAll("option").length === 3, "到期资料筛选含 全部 + 2 份资料");

  console.log("\n== C. 四个子 Tab 切换 ==");
  ok(tab("points") !== undefined && tab("quiz") !== undefined && tab("study") !== undefined && tab("library") !== undefined, "四个子 Tab 存在");
  ok(root.querySelector("#review-pane-points").hidden === false, "默认显示要点 pane");
  click(tab("quiz"));
  ok(root.querySelector("#review-pane-quiz").hidden === false && root.querySelector("#review-pane-points").hidden === true, "切到练习 pane");
  click(tab("study"));
  ok(root.querySelector("#review-pane-study").hidden === false, "切到复习 pane");
  click(tab("library"));
  ok(root.querySelector("#review-pane-library").hidden === false, "切到资料库 pane");
  click(tab("points"));

  console.log("\n== D. 上传流程调用链（AI 路径） ==");
  pipelineResult = VM;
  aiOn = true;
  upload([fakeFile("notes.txt")]);
  await flush();
  ok(parseCalls.length === 1 && parseCalls[0].name === "notes.txt", "调用 RH.parsers.parseFile");
  ok(pipelineCalls.length === 1, "调用 RH.pipeline.run");
  ok(saveCalls.indexOf("高等数学第一章") >= 0, "调用 RH.storage.saveDoc 存档");
  ok(root.querySelector("#review-doc-title").textContent === "高等数学第一章", "结果头显示文档标题");
  ok(root.querySelector("#review-engine-badge").textContent.indexOf("AI · test-model") >= 0, "引擎徽标显示 AI · {model}");
  ok(String(root.querySelector("#review-progress-bar").style.width) === "100%", "进度条推进到 100%");

  console.log("\n== E. 要点渲染 ==");
  ok(root.querySelector("#review-overview").textContent.indexOf("极限的定义与性质") >= 0, "概述卡渲染");
  ok(root.querySelectorAll("#review-keywords .chip").length === 3, "关键词 + 术语 chips");
  ok(root.querySelectorAll("#review-sections .ca-review-point").length === 2, "章节要点渲染");
  ok(root.querySelectorAll('#review-sections [data-importance="high"]').length === 1, "重要度 high 徽标");
  ok(byText(root.querySelectorAll("#review-sections .badge"), "例") !== undefined, "example 类加「例」徽标");
  const pt = root.querySelectorAll("#review-sections .ca-review-point")[0];
  ok(pt.querySelector(".ca-review-source").hidden === true, "要点原文默认收起");
  click(pt);
  ok(pt.querySelector(".ca-review-source").hidden === false, "点击要点展开 source 原文");

  console.log("\n== F. 练习答题反馈与 recordAnswer ==");
  click(tab("quiz"));
  const qs = root.querySelectorAll("#review-quiz-list .ca-review-q");
  ok(qs.length === 2, "渲染 2 道练习题");
  const c1 = qs[0];
  click(c1.querySelectorAll(".ca-review-opt")[0]);
  ok(c1.querySelectorAll(".ca-review-opt.is-selected").length === 1, "选项选中态");
  click(c1.querySelector(".form-actions .btn"));
  ok(c1.querySelectorAll(".ca-review-opt.is-correct").length === 1, "答对反馈（绿 is-correct）");
  ok(c1.querySelector(".ca-review-feedback").hidden === false && c1.querySelector(".ca-review-feedback").textContent.indexOf("解析") >= 0, "显示解析");
  ok(recordCalls.filter((r) => r.qid === "ai1")[0].ok === true, "recordAnswer(ok=true) 被调用");

  const c2 = qs[1];
  click(c2.querySelectorAll(".ca-review-opt")[0]);
  click(c2.querySelector(".form-actions .btn"));
  ok(c2.querySelectorAll(".ca-review-opt.is-wrong").length === 1, "答错反馈（红 is-wrong）");
  ok(recordCalls.filter((r) => r.qid === "ai2")[0].ok === false, "recordAnswer(ok=false) 被调用");
  const qStats = root.querySelector("#review-quiz-stats").textContent;
  ok(qStats.indexOf("已答 2 / 2") >= 0 && qStats.indexOf("50%") >= 0, "练习统计：已答 2/2 正确率 50%（" + qStats + "）");

  console.log("\n== G. 导出调用 ==");
  click(root.querySelector("#review-export-docx"));
  await flush();
  ok(exporterCalls.docx === 1, "docxBlob 被调用");
  ok(urlCalls >= 1, "下载触发 URL.createObjectURL");
  click(root.querySelector("#review-export-quiz"));
  await flush();
  ok(exporterCalls.quiz === 1, "quizDocxBlob 被调用");

  console.log("\n== H. 复习统计 / 到期列表 / 筛选 ==");
  click(tab("study"));
  const statsText = root.querySelector("#review-study-stats").textContent;
  ok(statsText.indexOf("今日到期") >= 0 && statsText.indexOf("已掌握") >= 0 && statsText.indexOf("薄弱") >= 0, "四项统计渲染");
  ok(root.querySelectorAll("#review-due-list .ca-review-due").length === 2, "今日到期列表渲染 2 张卡片");
  const sel = root.querySelector("#review-doc-filter");
  sel.value = "英语笔记";
  dispatch(sel, { type: "change" });
  ok(root.querySelectorAll("#review-due-list .ca-review-due").length === 1, "按资料筛选后仅 1 张");
  sel.value = "";
  dispatch(sel, { type: "change" });
  const dueCard = root.querySelectorAll("#review-due-list .ca-review-due")[0];
  click(dueCard.querySelectorAll(".ca-review-opt")[0]);
  click(dueCard.querySelector(".form-actions .btn"));
  ok(recordCalls.filter((r) => r.docTitle === "高等数学第一章" && r.qid === "ai1").length >= 2, "到期卡片答题写入 recordAnswer");

  console.log("\n== I. 资料库列表 / 打开 / 删除 ==");
  click(tab("library"));
  ok(root.querySelectorAll("#review-library-list .list-row").length === 2, "资料库列表渲染 2 条");
  const row0 = root.querySelector('#review-library-list .list-row[data-doc-title="高数笔记"]');
  ok(row0 !== null && row0.textContent.indexOf("要点 2 条") >= 0, "列表显示要点数");
  click(row0.querySelector('[data-act="delete"]'));
  await flush();
  ok(global.RH.storage._deleted === "高数笔记", "删除调用 RH.storage.deleteDoc");
  const row1 = root.querySelector('#review-library-list .list-row[data-doc-title="英语笔记"]');
  click(row1.querySelector('[data-act="open"]'));
  await flush();
  ok(getDocCalls.indexOf("英语笔记") >= 0, "打开调用 RH.storage.getDoc");
  ok(root.querySelector("#review-doc-title").textContent === "英语笔记", "打开后恢复文档");

  console.log("\n== J. AI 关闭联动（规则降级） ==");
  aiOn = false;
  llmReadySeen = null;
  upload([fakeFile("offline.txt")]);
  await flush();
  ok(llmReadySeen === false, "AI 关闭时 RH.llm.ready 被临时置为 false（走规则降级）");
  ok(global.RH.llm.ready() === true, "运行结束后恢复 RH.llm.ready");
  ok(root.querySelector("#review-engine-badge").textContent === "离线模式", "徽标显示「离线模式」");
  aiOn = true;

  console.log("\n== K. XSS 转义 ==");
  pipelineResult = XSS_VM;
  upload([fakeFile("xss.txt")]);
  await flush();
  const titleEl = root.querySelector("#review-doc-title");
  ok(titleEl.textContent === "<img src=x onerror=alert(1)>", "标题按纯文本渲染");
  ok(titleEl.querySelectorAll("img").length === 0, "标题未注入 img");
  ok(root.querySelectorAll("#review-quiz-list img").length === 0, "题目未注入 img");
  ok(root.querySelectorAll("#review-sections script").length === 0, "要点未注入 script");
  ok(root.querySelector("#review-sections").textContent.indexOf("<script>alert(1)</script>") >= 0, "要点按纯文本渲染");

  console.log("\n== L. RH 缺失优雅降级 ==");
  delete global.RH;
  let threw = false;
  try { remount(); } catch (e) { threw = true; console.error(e); }
  ok(!threw, "RH 缺失时 mount 不抛错");
  await flush();
  ok(root.querySelector("#review-engine-badge").textContent.indexOf("未就绪") >= 0, "徽标提示「复习引擎未就绪」");
  ok(root.querySelector("#review-file-input").disabled === true, "上传输入被禁用");
  ok(root.querySelectorAll("#review-due-list .empty").length === 1, "到期列表显示空态");
  ok(root.querySelectorAll("#review-library-list .empty").length === 1, "资料库显示空态");

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过 ✅"}`);
  process.exit(failCount ? 1 : 0);
})().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
