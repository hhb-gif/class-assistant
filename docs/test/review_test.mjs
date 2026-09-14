// review-view.js 契约/交互测试（CA 原生复习视图 · 复用 RH 引擎）
// 运行：node docs/test/review_test.mjs（在 class-assistant 目录下）
//
// 背景：P3 复习重构——弃用 iframe，改为 CA 原生 v4 视图调用 window.RH 引擎（REVIEW.md §1/§2/§3）。
// 本测试只加载 ../src/review-view.js，并 mock 最小 window.RH 引擎接口与 DOM，验证：
//   A. CA.views.review = { mount, unmount } 契约；旧 CA.review.* 不暴露
//   B. mount 后 REVIEW.md §2 全部 DOM id 存在、结构正确（上传区/三阶段进度/子 Tab/各面板）
//   C. 走上传链路（mock 引擎）：引擎徽标「离线模式」、要点/练习题渲染、进度隐藏
//   D. AI 关闭降级：pipeline 调用时 RH.llm.ready() 被置为 false（走规则路径）
//   E. AI 开启：引擎徽标「AI · {model}」、RH.llm.ready() 为 true
//   F. 复习（SM-2）入口：今日无到期卡片时渲染空态
//   G. unmount() 不抛错、非法入参不抛错
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 一、极简 DOM 桩（满足 review-view.js 用到的能力）
// ============================================================
function camel(name) { return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

class StubEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this._text = "";
    this._html = "";
    this._listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.files = null;
  }
  get className() { return this.attributes["class"] || ""; }
  set className(v) { this.attributes["class"] = String(v); }
  get id() { return this.attributes["id"] || ""; }
  set id(v) { this.attributes["id"] = String(v); }
  get firstChild() { return this.children.length ? this.children[0] : null; }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); if (v === "") this.children = []; }
  get classList() {
    const self = this;
    const list = () => String(self.className).split(/\s+/).filter(Boolean);
    return {
      add(...names) { const s = list(); names.forEach((n) => { if (s.indexOf(n) < 0) s.push(n); }); self.className = s.join(" "); },
      remove(...names) { self.className = list().filter((n) => names.indexOf(n) < 0).join(" "); },
      toggle(n, force) { const has = list().indexOf(n) >= 0; const on = force === undefined ? !has : !!force; if (on) this.add(n); else this.remove(n); return on; },
      contains(n) { return list().indexOf(n) >= 0; }
    };
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  setAttribute(k, v) {
    if (k === "class") this.className = v;
    else if (k === "id") this.id = v;
    else this.attributes[k] = String(v);
  }
  getAttribute(k) {
    if (k === "class") return this.className;
    if (k === "id") return this.id;
    return this.attributes[k] != null ? this.attributes[k] : null;
  }
  hasAttribute(k) { return this.getAttribute(k) != null; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const arr = this._listeners[type]; if (!arr) return;
    const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev = ev || {};
    if (!ev.target) ev.target = this;
    if (typeof ev.preventDefault !== "function") ev.preventDefault = () => {};
    const arr = this._listeners[ev.type] || [];
    arr.slice().forEach((fn) => fn(ev));
    return true;
  }
  click() { return this.dispatchEvent({ type: "click" }); }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
}

function parseSimple(sel) {
  const out = { tag: null, id: null, classes: [] };
  const m = /^[a-zA-Z*][\w-]*/.exec(sel);
  let i = 0;
  if (m) { out.tag = m[0]; i = m[0].length; }
  while (i < sel.length) {
    const ch = sel.charAt(i);
    if (ch === "#") { const a = /^#([\w-]+)/.exec(sel.slice(i)); out.id = a[1]; i += a[0].length; }
    else if (ch === ".") { const b = /^\.([\w-]+)/.exec(sel.slice(i)); out.classes.push(b[1]); i += b[0].length; }
    else i++;
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
  return true;
}
function descendants(node, out = []) {
  for (const c of node.children) { out.push(c); descendants(c, out); }
  return out;
}
function queryAll(root, sel) {
  return descendants(root).filter((el) => matchesSimple(el, sel));
}

const body = new StubEl("body");
const head = new StubEl("head");
const html = new StubEl("html");
html.appendChild(head);
html.appendChild(body);

function documentScan() { return [head, body].concat(descendants(head), descendants(body)); }

const documentStub = {
  body, head,
  documentElement: html,
  createElement: (t) => new StubEl(t),
  getElementById(id) { for (const el of documentScan()) if (el.id === id) return el; return null; },
  querySelector(sel) { return queryAll(body, sel)[0] || null; },
  querySelectorAll(sel) { return documentScan().filter((el) => el.nodeType === 1 && matchesSimple(el, sel)); },
  addEventListener() {},
  removeEventListener() {},
};

// ============================================================
// 二、global 替身（window 指向 global，方便 window.RH / window.CA 互访）
// ============================================================
global.window = global;
global.document = documentStub;
global.CA = { app: { toast() {} } };

// ---- mock 引擎状态 ----
let aiOn = false;
let rhLlmReady = true;
const captured = {};   // { llmReadyAtCall }

function makeRH() {
  const ruleVm = () => ({
    title: "测试文档", engine: "rule", backend: "rule/word_overlap",
    overview: "", keywords: ["测试"], terms: [],
    sections: [{ title: "第一章", points: [{ point: "要点一", source: "定义：测试要点一。", importance: "high" }] }],
    quiz: [{ qid: "r1", type: "choice", question: "题干？", options: ["甲", "乙", "丙", "丁"], answerIndex: 0, answer: "甲", explanation: "因为甲", difficulty: 1 }],
    original_sections: [{ title: "第一章", blocks: ["定义：测试要点一。"], rich: null }]
  });
  const llmVm = () => {
    const vm = ruleVm();
    vm.engine = "llm"; vm.backend = "deepseek-v4-flash"; vm.overview = "全文总览";
    vm.quiz = [{ qid: "ai1", type: "choice", question: "题干？", options: ["甲", "乙", "丙", "丁"], answerIndex: 0, answer: "甲", explanation: "因为甲", difficulty: 2 }];
    return vm;
  };
  return {
    llm: {
      ready() { return rhLlmReady; },
      info() { return { model: "deepseek-v4-flash" }; }
    },
    parsers: {
      parseFile(file, onProgress) {
        if (onProgress) onProgress("已解析", 1);
        return Promise.resolve({
          title: "测试文档",
          sections: [{ title: "第一章", blocks: ["定义：测试要点一。", "测试要点二。"], rich: null }]
        });
      }
    },
    pipeline: {
      run(doc, onProgress) {
        captured.llmReadyAtCall = window.RH.llm.ready();
        if (onProgress) onProgress("summarize", "提炼完成", 0.9);
        return Promise.resolve(aiOn ? llmVm() : ruleVm());
      }
    },
    storage: {
      recordAnswer() { return Promise.resolve({}); },
      getDueCards() { return Promise.resolve([]); },
      getAllCards() { return Promise.resolve([]); },
      getStats() { return Promise.resolve({ total: 0, due: 0, mastered: 0, weak: 0 }); },
      saveDoc() { return Promise.resolve(true); },
      getDoc() { return Promise.resolve(null); },
      listDocs() { return Promise.resolve([]); },
      deleteDoc() { return Promise.resolve(true); }
    },
    sm2: {
      review(card) { return card; },
      qualityFromResult(ok) { return ok ? 4 : 1; },
      statusOf() { return "learning"; }
    },
    exporter: {
      docxBlob() { return Promise.resolve({}); },
      quizDocxBlob() { return Promise.resolve({}); },
      filenameDocx() { return "a.docx"; },
      filenameQuizDocx() { return "b.docx"; }
    }
  };
}

global.RH = makeRH();
global.CA.store = { settings() { return { aiEnabled: aiOn }; } };

require(path.join(__dirname, "..", "src", "review-view.js"));

// ============================================================
// 三、断言工具
// ============================================================
let passCount = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { passCount++; console.log("  \u2713 " + msg); }
  else { failCount++; console.error("  \u2717 " + msg); throw new Error("断言失败: " + msg); }
}
function byId(id) { return documentStub.getElementById(id); }
function flush(ms) { return new Promise((r) => setTimeout(r, ms || 40)); }

// app.js 同款结构：#view-root > section#view-review
const viewRoot = documentStub.createElement("main");
viewRoot.id = "view-root";
body.appendChild(viewRoot);
const section = documentStub.createElement("section");
section.id = "view-review";
viewRoot.appendChild(section);

const V = () => global.CA.views.review;

// §2 DOM id 清单（REVIEW.md）
const SEC2_IDS = [
  "review-upload", "review-file-input",
  "review-progress", "review-progress-bar", "review-progress-text",
  "review-result", "review-doc-title", "review-engine-badge",
  "review-tabs", "review-pane-points", "review-pane-quiz", "review-pane-study", "review-pane-library",
  "review-overview", "review-keywords", "review-sections",
  "review-quiz-list", "review-quiz-stats",
  "review-study-stats", "review-due-list", "review-doc-filter",
  "review-library-list", "review-quiz-import",
  "review-export-docx", "review-export-quiz"
];

async function run() {
  console.log("\n== A. 契约 ==");
  ok(global.CA.views && V(), "CA.views.review 已注册");
  ok(typeof V().mount === "function", "mount 是函数");
  ok(typeof V().unmount === "function", "unmount 是函数");
  ok(typeof global.CA.review === "undefined", "旧 CA.review.* 接口未暴露");

  console.log("\n== B. mount：§2 DOM id 全覆盖 ==");
  await V().mount(section);
  await flush();
  SEC2_IDS.forEach((id) => ok(byId(id) !== null, "存在 #" + id));
  ok(documentStub.getElementById("review-tabs").className.indexOf("segmented") >= 0, "#review-tabs 使用 .segmented");
  ok(section.contains(byId("review-upload")), "#review-upload 位于视图容器内");
  ok(byId("review-upload").querySelector(".ca-art-review") !== null, "上传区空态插画 .ca-art-review（empty-review.png）");
  ok(byId("review-result").contains(byId("review-pane-points")), "要点面板在 #review-result 内");
  ok(byId("review-result").contains(byId("review-pane-library")), "资料库面板在 #review-result 内");
  ok(section.querySelector("#ca-review-style") === null,
    "样式注入到 head（#ca-review-style 不在视图容器内）");
  const styleCount = documentScan().filter((el) => el.id === "ca-review-style").length;
  ok(styleCount === 1, "复习专用样式只注入一次（.ca-review-* 前缀，未改 styles.css）");

  console.log("\n== B2. 信息架构：顶部主卡合框 + 内容卡单框 ==");
  const mainCard = byId("review-upload").parentNode;
  ok(/\bcard\b/.test(mainCard.className) && /ca-review-main/.test(mainCard.className),
    "上传/进度/结果头合并进同一主卡 .card.ca-review-main");
  ok(mainCard.contains(byId("review-progress")), "进度区在主卡内（无独立卡片）");
  ok(mainCard.contains(byId("review-doc-title")) && mainCard.contains(byId("review-engine-badge")),
    "结果头（标题 / 引擎徽标）在主卡内，不再单独套卡");
  ok(!byId("review-result").contains(byId("review-doc-title")), "结果头不在 #review-result 内（避免卡中卡）");
  ok(byId("review-result").querySelectorAll(".card").length === 1,
    "#review-result 内仅一张内容卡（四面板共用一层边框）");
  ok(section.querySelectorAll(".card").length === 2, "整屏仅 2 张卡片（顶部主卡 + 内容卡）");

  console.log("\n== C. 上传链路（AI 关闭 · 规则降级） ==");
  aiOn = false;
  const input = byId("review-file-input");
  input.files = [{ name: "生物.txt", arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }];
  input.dispatchEvent({ type: "change" });
  await flush(60);
  ok(captured.llmReadyAtCall === false, "AI 关闭时 pipeline 调用前 RH.llm.ready() 已被置为 false（走规则降级）");
  ok(byId("review-engine-badge").textContent === "离线模式", "引擎徽标为「离线模式」（实际：" + byId("review-engine-badge").textContent + "）");
  ok(byId("review-doc-title").textContent.indexOf("测试文档") >= 0, "#review-doc-title 已填充文档标题");
  ok(byId("review-result").hidden === false, "结果区已显示");
  ok(byId("review-progress").hidden === true, "三阶段进度条在处理完成后隐藏");
  ok(byId("review-sections").querySelector("li.ca-review-point") !== null, "要点列表已渲染（.ca-review-point）");
  const pointLi = byId("review-sections").querySelector("li.ca-review-point");
  ok(pointLi.querySelector(".badge") !== null, "要点带重要度徽标（.badge，非 emoji）");
  pointLi.dispatchEvent({ type: "click" });
  ok(pointLi.querySelector(".ca-review-source") !== null, "点击要点展开原文 source 片段");
  ok(byId("review-quiz-list").querySelector(".ca-review-quiz-item") !== null, "练习题已渲染（.ca-review-quiz-item）");
  ok(byId("review-quiz-stats").textContent.indexOf("已答") >= 0, "#review-quiz-stats 显示练习进度");
  ok(byId("review-pane-points").hidden === false, "默认激活要点面板");
  ok(byId("review-pane-quiz").hidden === true, "非激活面板隐藏");

  console.log("\n== C2. 子项以分隔线/列表组织，不再套独立卡片 ==");
  const hasCardCls = (el) => (el.className || "").split(/\s+/).indexOf("card") >= 0;
  ok(!hasCardCls(byId("review-sections").querySelector("li.ca-review-point")),
    "要点项 .ca-review-point 无 .card 边框");
  ok(!hasCardCls(byId("review-quiz-list").querySelector(".ca-review-quiz-item")),
    "练习项 .ca-review-quiz-item 无 .card 边框");
  ok(byId("review-study-stats").className.indexOf("ca-review-stats") >= 0,
    "复习统计改为平铺指标条 .ca-review-stats（非 4 个卡片）");
  ok(section.querySelectorAll(".card").length === 2, "渲染后整屏仍仅 2 张卡片（无逐项卡片）");

  console.log("\n== D. 练习答题即时反馈 ==");
  const optBtn = byId("review-quiz-list").querySelector(".ca-review-option");
  optBtn.dispatchEvent({ type: "click" });
  const fb = byId("review-quiz-list").querySelector(".ca-review-feedback");
  ok(fb !== null && fb.hidden === false, "答题后显示反馈区");
  ok(/ok|bad/.test(fb.className), "反馈区套用 ok/bad 状态类（无硬编码颜色）");
  ok(byId("review-quiz-stats").textContent.indexOf("已答 1") >= 0, "练习统计更新为已答 1 题");

  console.log("\n== E. 复习（SM-2）入口：无到期卡片 → 空态 ==");
  byId("review-start-due").dispatchEvent({ type: "click" });
  await flush(30);
  ok(byId("review-due-list").querySelector(".empty") !== null, "无到期卡片时 #review-due-list 渲染 .empty 空态");
  ok(byId("review-study-stats").querySelectorAll(".stat").length === 4, "#review-study-stats 渲染 4 项统计");

  console.log("\n== F. AI 开启：引擎徽标 AI · {model} ==");
  aiOn = true;
  V().unmount();
  await V().mount(section);
  await flush();
  const input2 = byId("review-file-input");
  input2.files = [{ name: "生物.txt", arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }];
  input2.dispatchEvent({ type: "change" });
  await flush(60);
  ok(captured.llmReadyAtCall === true, "AI 开启时 RH.llm.ready() 为 true（走 LLM 主路径）");
  ok(byId("review-engine-badge").textContent === "AI · deepseek-v4-flash",
    "引擎徽标为「AI · deepseek-v4-flash」（实际：" + byId("review-engine-badge").textContent + "）");

  console.log("\n== G. unmount 与非法入参防御 ==");
  let threw = false;
  try { V().unmount(); V().unmount(); } catch (e) { threw = true; console.error(e); }
  ok(!threw, "连续 unmount() 不抛错");
  let threw2 = false;
  try { V().mount(null); V().mount(undefined); V().mount({}); } catch (e) { threw2 = true; console.error(e); }
  ok(!threw2, "mount(null/undefined/{}) 不抛错");
  let threw3 = false;
  try { await V().mount(section); await flush(20); V().unmount(); } catch (e) { threw3 = true; console.error(e); }
  ok(!threw3, "重复 mount → unmount 不抛错");

  console.log("\n========================================");
  console.log(`通过 ${passCount} 项断言${failCount ? `，失败 ${failCount} 项` : "，全部通过"}`);
  process.exit(failCount ? 1 : 0);
}

run().catch((e) => {
  console.error("\n测试中断:", (e && e.stack) || e);
  process.exit(1);
});
