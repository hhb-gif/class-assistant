// materials.js —— 班级共享资料库（老师上传 → 全班可学）· WS-C
// 契约：CA.views.materials = { mount(rootEl), unmount() }
// 设计依据：DESIGN.md §4 组件类名、§5 图标（禁止 emoji）、§6 时间规则（禁止 ISO 直出）、§10 角色差异化
// 数据层：CA.store 为 CloudBase PG（返回 Promise）；集合 materials → 表 class_materials
//         （列名映射见 store.js MAPS / 迁移 20260915010200_class_materials.sql）。
// 云存储：复用既有 pgstore 桶 attachments；key = materials/<materialId>/<token>-<safeFileName>；
//         上传 / 签名下载严格照 notices.js 的既有唯一正确写法：
//           app.storage.from(bucket).upload(key, file)
//           app.storage.from(bucket).createSignedUrl(path, ttl)
//         返回体兼容 { data: { fullSignedURL } } / signedUrl / url / 字符串。
//
// ⚠️ D4 边界（务必保留）：ROADMAP 的 D4 决策是「复习记录留本机（IndexedDB）」。
//    本模块只把「资料文件」上云做全班共享；复习解析结果与学习记录仍在本机——
//    学生点「加入我的复习」时，文件交给 window.RH 解析后写入 RH.storage（IndexedDB），
//    绝不写云端数据库。
//
// ⚠️ 删除语义：删除资料只删 class_materials 登记记录，云存储对象**保留**
//    （沿用「最小权限不删对象」的既有约定，避免误删/越权删桶内文件）。
//
// ⚠️ 空态插画：materials 暂无专属 Agnes 插画（styles.css 未定义 .ca-art-materials），
//    故空态走线性 SVG 兜底；若后续补插画，只需把 MATERIAL_ART 改为 "ca-art-materials"。
//
// 依赖（全部特性探测，缺失时安全降级，绝不抛未捕获异常）：
//   CA.store / CA.auth / CA.util / CA.icon / CA.app.toast / CA.cloud；window.RH（可选）
//
// 零依赖 · IIFE · 中文注释 · ES2017
window.CA = window.CA || {};

(function () {
  "use strict";

  // ============================================================
  // 常量
  // ============================================================
  var MATERIAL_BUCKET = "attachments";              // 复用既有私有桶
  var MATERIAL_MAX_BYTES = 20 * 1024 * 1024;        // 单文件体积上限：20MB（与 notices 同口径）
  var MATERIAL_SIGNED_TTL = 3600;                   // 签名下载链接有效期（秒）
  var MATERIAL_ALLOWED_EXT = [                      // 扩展名白名单（与 notices.ATTACH_ALLOWED_EXT 同口径）
    "pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "csv", "ppt", "pptx",
    "png", "jpg", "jpeg", "gif", "webp", "zip", "rar", "7z", "mp3", "m4a", "wav", "mp4"
  ];
  var MATERIAL_ART = "";                            // 无专属 Agnes 插画，留空即走线性 SVG 兜底

  // ============================================================
  // 基础工具
  // ============================================================
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // NodeList 没有数组方法；统一 slice 成真数组后再操作（见 collect.js 顶部警示）
  function toArray(list) { return Array.prototype.slice.call(list || []); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg, type) {
    try { if (CA.app && typeof CA.app.toast === "function") CA.app.toast(msg, type); } catch (e) { /* 忽略 */ }
  }

  function toastError(err, fallback) {
    toast((err && err.message) || fallback || "操作失败", "error");
  }

  function errMsgOf(e) {
    if (!e) return "未知错误";
    return e.message || e.msg || e.code || String(e);
  }

  function fmtSmart(v) {
    try {
      if (CA.util && typeof CA.util.fmtSmart === "function") return CA.util.fmtSmart(v) || "—";
    } catch (e) { /* 落到兜底 */ }
    return v == null || v === "" ? "—" : String(v);
  }

  function fmtSize(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n < 0) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (Math.round(n / 102.4) / 10) + " KB";
    return (Math.round(n / (1024 * 1024) * 10) / 10) + " MB";
  }

  // 极简 DOM 构造（与 collect.js / scores.js 同款）
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k === "value") { el.value = v; el.setAttribute("value", String(v)); }
        else if (k === "checked") { el.checked = !!v; if (v) el.setAttribute("checked", ""); }
        else if (k === "hidden") { el.hidden = !!v; if (v) el.setAttribute("hidden", ""); }
        else if (k === "disabled") { el.disabled = !!v; if (v) el.setAttribute("disabled", ""); }
        else el.setAttribute(k, v);
      });
    }
    if (kids != null) {
      [].concat(kids).forEach(function (c) { if (c != null && c !== false) el.appendChild(c); });
    }
    return el;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function safe(p, fallback) {
    return Promise.resolve(p).then(function (v) { return v; }, function () { return fallback; });
  }

  // store 调用包装：同步抛错也转成 rejected Promise，统一走 catch
  function tryStore(fn) {
    try { return Promise.resolve(fn()); }
    catch (e) { return Promise.reject(e); }
  }

  function setLoading(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    var cls = String(btn.className || "").replace(/\s*is-loading/g, "");
    btn.className = on ? (cls + " is-loading") : cls;
  }

  function setBusy(btn, busy, busyText, idleText) {
    setLoading(btn, busy);
    if (!btn) return;
    if (busy && busyText != null) btn.textContent = busyText;
    else if (!busy && idleText != null) btn.textContent = idleText;
  }

  // ============================================================
  // 图标（统一走 CA.icon()；icons.js 未就位时内置兜底 SVG，绝不使用 emoji）
  // ============================================================
  var FALLBACK_ICONS = {
    "folder": '<path d="M4 5a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
    "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    "trash": '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    "book": '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "refresh": '<path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
    "alert": '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.3 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.3a2 2 0 0 0-3.4 0Z"/>',
    "file": '<path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/>'
  };

  function icon(name, size) {
    if (CA.icon && typeof CA.icon === "function") {
      try { return CA.icon(name, size); } catch (e) { /* 落到兜底 */ }
    }
    var body = FALLBACK_ICONS[name] || FALLBACK_ICONS.file;
    var px = size || 16;
    return '<svg class="icon" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + "</svg>";
  }

  function iconEl(name, size) {
    return h("span", { class: "icon-wrap", html: icon(name, size) });
  }

  // ============================================================
  // 文件工具（纯函数，便于单测）
  // ============================================================
  // 唯一 token（用于对象 key，不依赖外部 uuid 库）
  function genToken() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 存储 id：优先复用 CA.store.uid，缺失时本地降级
  function storeUid(prefix) {
    if (CA.store && typeof CA.store.uid === "function") return CA.store.uid(prefix);
    return (prefix || "id") + "_" + genToken();
  }

  // 文件名安全化：去掉路径分隔符与控制字符，控制长度（保留中文与常见符号）
  function sanitizeFileName(name) {
    var s = String(name == null ? "file" : name).replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "_");
    s = s.replace(/^\s+|\s+$/g, "");
    if (!s) s = "file";
    if (s.length > 80) {
      var dot = s.lastIndexOf(".");
      var ext = dot > 0 ? s.slice(dot) : "";
      s = s.slice(0, 80 - ext.length) + ext;
    }
    return s;
  }

  function extOf(name) {
    var parts = String(name || "").split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
  }

  // 前端校验（体积 / 白名单）；通过返回 ""，否则返回可读错误文案
  function validateFile(file) {
    if (!file) return "无效文件";
    var size = Number(file.size) || 0;
    if (size > MATERIAL_MAX_BYTES) {
      return "「" + (file.name || "文件") + "」超过 20MB 上限，无法上传";
    }
    var ext = extOf(file.name);
    if (MATERIAL_ALLOWED_EXT.indexOf(ext) < 0) {
      return "「" + (file.name || "文件") + "」类型不支持（" + (ext || "未知") + "）";
    }
    return "";
  }

  // 对象 key 规划：materials/<materialId>/<token>-<safeFileName>
  // —— 目录用资料 id，便于「先定 id → 上传 → 落库」链路一致，也便于按资料定位对象。
  function buildStorageKey(materialId, fileName) {
    return "materials/" + String(materialId || "unknown") + "/" + genToken() + "-" + sanitizeFileName(fileName);
  }

  function filesOf(input) {
    if (!input || !input.files) return [];
    var fl = input.files;
    if (typeof fl.length !== "number") return [];
    var out = [];
    for (var i = 0; i < fl.length; i++) out.push(fl[i]);
    return out;
  }

  // ============================================================
  // 云存储（严格照 notices.js 写法）
  // ============================================================
  function bucketOf() {
    var app = (CA.cloud && CA.cloud.app) ? CA.cloud.app : null;
    if (!app || !app.storage || typeof app.storage.from !== "function") return null;
    return app.storage.from(MATERIAL_BUCKET);
  }

  // 上传单个文件到指定 key；失败一律 reject（绝不允许静默吞掉上传失败）
  function uploadFile(file, key) {
    var bucket = bucketOf();
    if (!bucket || typeof bucket.upload !== "function") {
      return Promise.reject(new Error("云存储未就绪：无法上传资料（请确认已登录且网络正常）"));
    }
    return Promise.resolve(bucket.upload(key, file)).then(function (res) {
      if (res && res.error) throw new Error(errMsgOf(res.error));
      return key;
    });
  }

  // 私有桶取签名下载链接（兼容 { data: { fullSignedURL } } / signedUrl / url / 字符串）
  function signedUrlOf(path) {
    var bucket = bucketOf();
    if (!bucket || typeof bucket.createSignedUrl !== "function") {
      return Promise.reject(new Error("云存储未就绪：无法获取下载链接"));
    }
    return Promise.resolve(bucket.createSignedUrl(path, MATERIAL_SIGNED_TTL)).then(function (res) {
      if (res && res.error) throw new Error(errMsgOf(res.error));
      var d = (res && res.data) ? res.data : res;
      var url = (d && (d.fullSignedURL || d.signedUrl || d.url)) || (typeof res === "string" ? res : "");
      if (!url) throw new Error("存储服务未返回下载链接，请稍后重试");
      return url;
    });
  }

  // 触发浏览器下载（<a download>），宿主环境缺 appendChild/click 时静默降级
  function triggerDownload(url, name) {
    if (!url) return;
    var link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", name || "");
    link.setAttribute("rel", "noopener");
    link.style.display = "none";
    var host = document.body || document.documentElement;
    if (host && host.appendChild) host.appendChild(link);
    if (typeof link.click === "function") link.click();
    if (link.parentNode && link.parentNode.removeChild) link.parentNode.removeChild(link);
  }

  // ============================================================
  // 本机复习引擎桥接（window.RH；D4：解析/记录只在本机）
  // ============================================================
  function RH() { return (typeof window !== "undefined" && window.RH) ? window.RH : null; }

  function stripExt(name) { return String(name || "").replace(/\.[^.]+$/, "") || "未命名文档"; }

  function fetchFn() {
    if (typeof window !== "undefined" && typeof window.fetch === "function") return window.fetch;
    if (typeof fetch === "function") return fetch;
    return null;
  }

  // blob → File（宿主缺 File 构造器时退回朴素对象，RH 只用 name/type/size）
  function makeFile(blob, m) {
    var name = m.fileName || "material.bin";
    var type = m.fileType || (blob && blob.type) || "";
    if (typeof File === "function") {
      try { return new File([blob], name, { type: type }); } catch (e) { /* 落到朴素对象 */ }
    }
    return { name: name, type: type, size: (blob && blob.size) || 0, _blob: blob };
  }

  // 交给 RH：解析 → 管线 → 存本机（IndexedDB）。任何一步失败都 reject（由调用方降级）。
  function parseAndSave(file, m) {
    var rh = RH();
    if (!rh || !rh.parsers || typeof rh.parsers.parseFile !== "function") {
      return Promise.reject(new Error("复习引擎未加载"));
    }
    return Promise.resolve(rh.parsers.parseFile(file)).then(function (doc) {
      if (rh.pipeline && typeof rh.pipeline.run === "function") {
        return Promise.resolve(rh.pipeline.run(doc)).then(function (vm) { return vm || {}; });
      }
      return {};
    }).then(function (vm) {
      if (!rh.storage || typeof rh.storage.saveDoc !== "function") {
        throw new Error("复习存储未加载");
      }
      return Promise.resolve(rh.storage.saveDoc(vm.title || stripExt(m.fileName), {
        backend: vm.backend || "", overview: vm.overview || "", engine: vm.engine || "rule",
        sections: vm.sections || [], quiz: vm.quiz || [], keywords: vm.keywords || [], terms: vm.terms || [],
        original_sections: vm.original_sections || [], markdown: "",
        sourceBlob: file, sourceName: m.fileName, sourceNames: [m.fileName]
      }));
    });
  }

  // 学生「加入我的复习」：签名 URL → 取回文件 → 交本机 RH 解析并存 IndexedDB。
  // RH 不可用 / 解析失败 → 降级为「已下载到本机」并 toast 说明，绝不抛未捕获异常。
  function addToReview(m, btn) {
    if (!m || !m.filePath) { toast("该资料缺少存储路径，无法下载", "error"); return Promise.resolve(); }
    setLoading(btn, true);
    var url = "";
    return signedUrlOf(m.filePath).then(function (u) {
      url = u;
      var rh = RH();
      var fetchImpl = fetchFn();
      if (!rh || !rh.parsers || typeof rh.parsers.parseFile !== "function" || !fetchImpl) {
        return { fallback: "本机复习引擎不可用" };
      }
      return Promise.resolve(fetchImpl(u)).then(function (res) {
        if (res && res.ok === false) throw new Error("文件下载失败（HTTP " + (res && res.status) + "）");
        return res.blob();
      }).then(function (blob) {
        return parseAndSave(makeFile(blob, m), m);
      }).then(function () { return { ok: true }; }, function (err) {
        return { fallback: "解析失败：" + errMsgOf(err) };
      });
    }).then(function (res) {
      if (res && res.ok) {
        toast("已加入我的复习：解析与学习记录仅存本机", "success");
        return;
      }
      triggerDownload(url, m.fileName);
      toast((res && res.fallback ? res.fallback + "，" : "") + "已下载到本机", "info");
    }).catch(function (err) {
      toastError(err, "加入复习失败");
    }).then(function () { setLoading(btn, false); });
  }

  // ============================================================
  // 样式（模块自注入 <style>，不改 styles.css；只用 CSS 变量）
  // ============================================================
  var styleInjected = false;

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    if (typeof document === "undefined" || !document.createElement) return;
    var host = document.head || document.body;
    if (!host || typeof host.appendChild !== "function") return;
    var css =
      ".ca-materials{display:flex;flex-direction:column;gap:16px}" +
      ".ca-materials .toolbar-note{font-size:var(--fs-sm);color:var(--text-3);margin-top:10px}" +
      ".ca-materials .materials-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".ca-materials .materials-filters .input{flex:1;min-width:160px}" +
      ".ca-materials .materials-filters select.input{flex:none;min-width:140px}" +
      ".ca-materials .list-row{display:flex;align-items:center;gap:12px;padding:12px 14px}" +
      ".ca-materials .list-row .list-main{flex:1;min-width:0}" +
      ".ca-materials .list-row .row{gap:8px;flex:none}" +
      ".ca-materials .list-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".ca-materials .list-title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}" +
      ".ca-materials .list-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}" +
      ".ca-materials .list-meta .icon-wrap{display:inline-flex;color:var(--text-3)}" +
      ".ca-materials .materials-desc{margin:4px 0 0;font-size:var(--fs-sm);color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ca-materials .materials-file-hint{font-size:12.5px;color:var(--text-3);margin-top:6px}" +
      // 移动端：列表行换行，操作按钮另起一行右对齐，筛选控件铺满，避免挤压主信息
      "@media(max-width:767px){" +
      ".ca-materials{gap:12px}" +
      ".ca-materials .list-row{flex-wrap:wrap}" +
      ".ca-materials .list-row .row{flex-wrap:wrap;width:100%;justify-content:flex-end}" +
      ".ca-materials .list-title-text{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}" +
      ".ca-materials .materials-desc{white-space:normal}" +
      ".ca-materials .materials-filters .input{flex:1 1 100%}" +
      ".ca-materials .materials-filters select.input{flex:1 1 100%}" +
      "}";
    var style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.textContent = css;
    host.appendChild(style);
  }

  // ============================================================
  // 视图状态
  // ============================================================
  var state = null;
  var mountToken = 0;

  function currentUser() { return (state && state.me) || {}; }

  function isAdmin() {
    try {
      if (CA.auth && typeof CA.auth.isAdmin === "function") return !!CA.auth.isAdmin();
    } catch (e) { /* 降级到挂载快照 */ }
    return !!(state && state.isAdmin);
  }

  function findMaterial(id) {
    var list = (state && state.materials) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function uploaderName(uid) {
    if (uid == null) return "";
    var byId = (state && state.usersById) || {};
    if (byId[uid]) return byId[uid];
    var me = currentUser();
    if (me && me.id === uid && me.name) return me.name;
    return "";
  }

  function sortedMaterials() {
    return ((state && state.materials) || []).slice().sort(function (a, b) {
      var ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      var tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ta !== tb) return tb - ta;   // 最新在前
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  }

  function subjects() {
    var out = [];
    sortedMaterials().forEach(function (m) {
      var s = String(m.subject || "").trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  function filtered() {
    var q = String((state && state.query) || "").trim().toLowerCase();
    var subj = (state && state.filterSubject) || "";
    return sortedMaterials().filter(function (m) {
      if (subj && String(m.subject || "") !== subj) return false;
      if (q && String(m.title || "").toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  // ============================================================
  // 数据加载
  // ============================================================
  function loadAll() {
    var pMe = (CA.auth && CA.auth.current) ? safe(CA.auth.current(), null) : Promise.resolve(null);
    var pUsers = (CA.auth && CA.auth.list) ? safe(CA.auth.list(), []) : Promise.resolve([]);
    return Promise.all([CA.store.get("materials"), pMe, pUsers]).then(function (arr) {
      state.materials = arr[0] || [];
      state.me = arr[1] || null;
      state.usersById = {};
      (arr[2] || []).forEach(function (u) { if (u && u.id != null) state.usersById[u.id] = u.name || ""; });
      try {
        state.isAdmin = !!(CA.auth && typeof CA.auth.isAdmin === "function" && CA.auth.isAdmin());
      } catch (e) { /* 保持原值 */ }
    });
  }

  // ============================================================
  // 渲染
  // ============================================================
  // 空态：无专属 Agnes 插画时走线性 SVG 兜底（MATERIAL_ART 为空）
  function emptyState(title, desc) {
    var box = h("div", { class: "empty" });
    if (MATERIAL_ART) {
      box.appendChild(h("div", { class: "empty-icon ca-art " + MATERIAL_ART, "aria-hidden": "true" }));
    } else {
      box.appendChild(h("div", { class: "empty-icon", "aria-hidden": "true", html: icon("folder", 40) }));
    }
    box.appendChild(h("div", { class: "empty-title", text: title }));
    if (desc) box.appendChild(h("p", { class: "empty-desc", text: desc }));
    return box;
  }

  function stagger(box) {
    if (CA.app && typeof CA.app.enter === "function") { CA.app.enter(box); return; }
    if (!box || !box.classList) return;
    box.classList.remove("ca-enter");
    void box.offsetWidth;
    box.classList.add("ca-enter");
    if (box.__enterT) clearTimeout(box.__enterT);
    box.__enterT = setTimeout(function () { if (box.classList) box.classList.remove("ca-enter"); }, 820);
  }

  function renderPermission() {
    if (!state) return;
    if (state.newBtn) state.newBtn.hidden = !isAdmin();
    // 非管理员不保留表单展开态
    if (!isAdmin() && state.formEl && !state.formEl.hidden) closeForm();
  }

  function renderFilters() {
    if (!state || !state.subjectEl) return;
    var sel = state.subjectEl;
    var cur = state.filterSubject || "";
    sel.innerHTML = "";
    sel.appendChild(h("option", { value: "", text: "全部科目" }));
    var subs = subjects();
    subs.forEach(function (s) { sel.appendChild(h("option", { value: s, text: s })); });
    sel.value = subs.indexOf(cur) >= 0 ? cur : "";
    state.filterSubject = sel.value || "";
  }

  function renderList() {
    var list = state && state.listEl;
    if (!list) return;
    list.innerHTML = "";
    var all = (state && state.materials) || [];
    var items = filtered();

    if (!items.length) {
      var filtering = !!(state.query || state.filterSubject);
      if (filtering && all.length) {
        list.appendChild(emptyState("没有匹配的资料", "换个关键词或科目试试。"));
      } else if (state.isAdmin) {
        list.appendChild(emptyState("还没有资料", "点击右上角「上传资料」，把讲义、试卷或笔记发给全班。"));
      } else {
        list.appendChild(emptyState("暂无共享资料", "老师上传后会显示在这里。"));
      }
      return;
    }
    items.forEach(function (m) { list.appendChild(listRow(m)); });
    stagger(list);
  }

  function listRow(m) {
    var row = h("div", { class: "list-row", "data-material-id": m.id });
    var main = h("div", { class: "list-main" });

    var title = h("div", { class: "list-title" }, [
      h("span", { class: "list-title-text", text: m.title || "未命名资料" })
    ]);
    if (m.subject) title.appendChild(h("span", { class: "badge badge-cat", text: m.subject }));
    main.appendChild(title);

    var meta = h("div", { class: "list-meta" });
    meta.appendChild(iconEl("clock", 13));
    meta.appendChild(h("span", { text: fmtSmart(m.createdAt) }));
    meta.appendChild(h("span", { text: "·" }));
    meta.appendChild(h("span", { text: fmtSize(m.fileSize) }));
    var who = uploaderName(m.uploaderUid);
    if (who) {
      meta.appendChild(h("span", { text: "·" }));
      meta.appendChild(h("span", { text: who }));
    }
    main.appendChild(meta);

    if (m.description) main.appendChild(h("p", { class: "materials-desc", text: m.description }));
    row.appendChild(main);

    var side = h("div", { class: "row" });

    // 下载：全班可用
    var dl = h("button", { class: "btn btn-sm", type: "button" }, [iconEl("download", 14), h("span", { text: "下载" })]);
    dl.addEventListener("click", function () { onDownload(m, dl); });
    side.appendChild(dl);

    if (state.isAdmin) {
      var edit = h("button", { class: "btn btn-quiet btn-sm admin-only", type: "button" }, [iconEl("edit", 14), h("span", { text: "编辑" })]);
      edit.addEventListener("click", function () { openForm(m); });
      side.appendChild(edit);

      var del = h("button", { class: "btn btn-danger btn-sm admin-only", type: "button" }, [iconEl("trash", 14), h("span", { text: "删除" })]);
      del.addEventListener("click", function () { onDelete(m, del); });
      side.appendChild(del);
    } else {
      var add = h("button", { class: "btn btn-lime btn-sm student-only", type: "button" }, [iconEl("book", 14), h("span", { text: "加入我的复习" })]);
      add.addEventListener("click", function () { addToReview(m, add); });
      side.appendChild(add);
    }
    row.appendChild(side);
    return row;
  }

  // 加载骨架：列表 3 行占位
  function renderLoading() {
    var list = state && state.listEl;
    if (!list) return;
    list.innerHTML = "";
    for (var i = 0; i < 3; i++) {
      var row = h("div", { class: "skeleton-row", "aria-hidden": "true" });
      var line = h("div", { class: "skeleton-line" });
      line.appendChild(h("div", { class: "skeleton skeleton-title" }));
      line.appendChild(h("div", { class: "skeleton" }));
      row.appendChild(line);
      list.appendChild(row);
    }
  }

  // 加载失败：空态 + 「重新加载」
  function renderLoadError(err) {
    var list = state && state.listEl;
    if (!list) return;
    list.innerHTML = "";
    var box = emptyState("加载失败", (err && err.message) || "无法加载资料，请稍后重试。");
    var btn = h("button", { class: "btn", type: "button", text: "重新加载" });
    btn.addEventListener("click", function () {
      setBusy(btn, true, "加载中…");
      loadAll().then(function () {
        if (!state) return;
        renderFilters(); renderList(); renderPermission();
      }).catch(function (err2) {
        toastError(err2, "加载资料失败");
        setBusy(btn, false, null, "重新加载");
      });
    });
    box.appendChild(btn);
    list.appendChild(box);
  }

  function refresh() {
    if (!state || !state.root) return Promise.resolve();
    return loadAll().then(function () {
      if (!state || !state.root) return;
      renderFilters();
      renderList();
      renderPermission();
    }).catch(function (err) {
      if (!state || !state.root) return;
      renderLoadError(err);
    });
  }

  // ============================================================
  // 表单：新建 / 编辑
  // ============================================================
  function field(labelText, input, required) {
    var f = h("div", { class: "form-field" });
    var lab = h("label", { class: "label" }, [h("span", { text: labelText })]);
    if (required) lab.appendChild(h("span", { class: "req", text: " *" }));
    f.appendChild(lab);
    f.appendChild(input);
    return f;
  }

  function valueOf(form, name) {
    var el = form && form.querySelector ? form.querySelector('[name="' + name + '"]') : null;
    return el && el.value != null ? String(el.value) : "";
  }

  function showFormError(msg) {
    var box = state && state.formEl && state.formEl.querySelector ? state.formEl.querySelector("#materials-form-error") : null;
    if (box) { box.hidden = !msg; box.textContent = msg || ""; }
  }

  function openForm(m) {
    if (!isAdmin()) { toast("无管理权限"); return; }
    if (!state || !state.formEl) return;
    state.formOpen = true;
    state.editingId = m ? m.id : null;
    state.formEl.hidden = false;
    renderForm();
    if (state.formEl.scrollIntoView) {
      try { state.formEl.scrollIntoView({ block: "start" }); } catch (e) { /* 忽略 */ }
    }
  }

  function closeForm() {
    if (!state) return;
    state.formOpen = false;
    state.editingId = null;
    state.fileInput = null;
    if (state.formEl) { state.formEl.hidden = true; state.formEl.innerHTML = ""; }
  }

  function renderForm() {
    var form = state.formEl;
    if (!form) return;
    form.innerHTML = "";
    var editing = !!state.editingId;
    var m = editing ? (findMaterial(state.editingId) || {}) : {};

    form.appendChild(field("标题", h("input", {
      class: "input", type: "text", name: "title", maxlength: "60",
      value: editing ? (m.title || "") : "", placeholder: "如：第三章 函数笔记"
    }), true));

    form.appendChild(field("科目", h("input", {
      class: "input", type: "text", name: "subject",
      value: editing ? (m.subject || "") : "", placeholder: "选填，如：数学"
    }), false));

    var desc = h("textarea", { class: "input", name: "desc", rows: "2", placeholder: "补充说明（选填）" });
    desc.value = editing ? (m.description || "") : "";
    form.appendChild(field("说明", desc, false));

    if (!editing) {
      var fileField = h("div", { class: "form-field" });
      fileField.appendChild(h("label", { class: "label" }, [
        h("span", { text: "文件" }), h("span", { class: "req", text: " *" })
      ]));
      var fileInput = h("input", {
        class: "input", type: "file", name: "file", id: "materials-file-input",
        accept: MATERIAL_ALLOWED_EXT.map(function (e) { return "." + e; }).join(",")
      });
      fileField.appendChild(fileInput);
      var hint = h("div", { class: "materials-file-hint", text: "PDF / Word / PPT / Excel / TXT / Markdown / 图片，单个不超过 20MB。" });
      fileField.appendChild(hint);
      fileInput.addEventListener("change", function () {
        var f = filesOf(fileInput)[0];
        hint.textContent = f
          ? ("已选择：" + (f.name || "文件") + "（" + fmtSize(f.size) + "）")
          : "PDF / Word / PPT / Excel / TXT / Markdown / 图片，单个不超过 20MB。";
      });
      form.appendChild(fileField);
      state.fileInput = fileInput;
    } else {
      state.fileInput = null;
      form.appendChild(h("p", { class: "muted span-2", text: "编辑仅修改标题 / 科目 / 说明；如需更换文件，请删除后重新上传。" }));
    }

    form.appendChild(h("div", { class: "field-error span-2", id: "materials-form-error", hidden: true }));

    var actions = h("div", { class: "form-actions span-2" });
    actions.appendChild(h("button", { class: "btn btn-primary", type: "submit", text: editing ? "保存修改" : "上传资料" }));
    var cancel = h("button", { class: "btn btn-quiet", type: "button", text: "取消" });
    cancel.addEventListener("click", closeForm);
    actions.appendChild(cancel);
    form.appendChild(actions);
  }

  // 提交：新建 = 先上传文件（云存储）再入库；编辑 = 仅更新标题/科目/说明
  function onSubmitForm() {
    if (!state || !isAdmin()) { toast("无上传权限"); return Promise.resolve(); }
    var form = state.formEl;
    var editing = !!state.editingId;

    var title = valueOf(form, "title").trim();
    var subject = valueOf(form, "subject").trim();
    var description = valueOf(form, "desc").trim();

    var errors = [];
    if (!title) errors.push("请填写标题");
    else if (title.length > 60) errors.push("标题过长（最多 60 字）");

    var file = editing ? null : (filesOf(state.fileInput)[0] || null);
    if (!editing && !file) errors.push("请选择要上传的文件");
    if (!editing && file) {
      var fe = validateFile(file);
      if (fe) errors.push(fe);
    }
    if (errors.length) {
      showFormError(errors.join("；"));
      toast(errors[0], "error");
      return Promise.resolve();
    }
    showFormError("");

    var submitBtn = form.querySelector ? form.querySelector('button[type="submit"]') : null;
    setBusy(submitBtn, true, editing ? "保存中…" : "上传中…");

    if (editing) {
      var id = state.editingId;
      return tryStore(function () {
        return CA.store.update("materials", id, { title: title, subject: subject, description: description });
      }).then(function () {
        toast("已保存修改", "success");
        closeForm();
        return refresh();
      }).catch(function (err) {
        // RLS 拒绝会返回 42501 / row-level security 文案，原样透出
        toastError(err, "保存失败");
        setBusy(submitBtn, false, null, "保存修改");
      });
    }

    // 新建：先本地生成 id（= 对象目录名），再上传，最后入库
    var newId = storeUid("mt");
    var key = buildStorageKey(newId, file.name);
    var uploaded = false;

    return uploadFile(file, key).then(function () {
      uploaded = true;
      return tryStore(function () {
        return CA.store.add("materials", {
          id: newId,
          title: title,
          subject: subject,
          description: description,
          fileName: file.name,
          filePath: key,
          fileSize: Number(file.size) || 0,
          fileType: file.type || ""
        });
      });
    }).then(function () {
      toast("资料已上传", "success");
      closeForm();
      return refresh();
    }).catch(function (err) {
      if (uploaded) {
        // 文件已进桶但登记失败：明确提示，不假成功（云存储对象保留，可重试登记）
        toast("文件已上传，但登记失败：" + errMsgOf(err), "error");
      } else {
        toastError(err, "上传失败");
      }
      setBusy(submitBtn, false, null, editing ? "保存修改" : "上传资料");
    });
  }

  // ============================================================
  // 下载 / 删除
  // ============================================================
  function onDownload(m, btn) {
    if (!m || !m.filePath) { toast("该资料缺少存储路径，无法下载", "error"); return Promise.resolve(); }
    setLoading(btn, true);
    return signedUrlOf(m.filePath).then(function (url) {
      triggerDownload(url, m.fileName);
      toast("已开始下载", "success");
    }).catch(function (err) {
      toastError(err, "下载失败");
    }).then(function () { setLoading(btn, false); });
  }

  function onDelete(m, btn) {
    var okConfirm = true;
    try {
      if (typeof window.confirm === "function") {
        okConfirm = window.confirm("确定删除资料「" + (m.title || "") + "」吗？\n仅删除登记记录，已上传的文件对象会保留。");
      }
    } catch (e) { okConfirm = true; }
    if (!okConfirm) return Promise.resolve();

    setLoading(btn, true);
    // 只删记录；云存储对象保留（最小权限不删对象）
    return tryStore(function () { return CA.store.remove("materials", m.id); }).then(function () {
      toast("已删除", "success");
      return refresh();
    }).catch(function (err) {
      toastError(err, "删除失败");
      setLoading(btn, false);
    });
  }

  // ============================================================
  // 挂载 / 卸载
  // ============================================================
  function mount(rootEl) {
    var token = ++mountToken;
    state = {
      root: rootEl,
      isAdmin: false,
      me: null,
      usersById: {},
      materials: [],
      query: "",
      filterSubject: "",
      formOpen: false,
      editingId: null,
      listEl: null,
      formEl: null,
      newBtn: null,
      searchEl: null,
      subjectEl: null,
      fileInput: null
    };
    injectStyles();
    // 幂等：重复 mount 时清空容器（app.js 也会清，单测/热重载需自我保护）
    rootEl.innerHTML = "";

    var wrap = h("div", { class: "ca-materials" });

    // 顶部工具栏：标题 + 上传入口（管理端专属）+ 角色语境说明
    var toolbar = h("div", { class: "card ca-materials-toolbar" });
    var top = h("div", { class: "card-head" });
    top.appendChild(h("div", { class: "card-title" }, [iconEl("folder", 20), h("span", { text: "班级资料" })]));
    var newBtn = h("button", { class: "btn btn-primary admin-only", id: "btn-materials-new", type: "button", hidden: true }, [iconEl("upload", 16), h("span", { text: "上传资料" })]);
    newBtn.addEventListener("click", function () {
      if (!isAdmin()) { toast("无管理权限"); return; }
      if (state.formOpen) { closeForm(); return; }
      openForm(null);
    });
    top.appendChild(newBtn);
    toolbar.appendChild(top);
    toolbar.appendChild(h("div", {
      class: "toolbar-note",
      text: "老师 / 管理员：上传讲义、试卷与笔记，供全班学习。学生：浏览、下载，并可一键加入本机复习。"
    }));
    wrap.appendChild(toolbar);

    // 上传 / 编辑表单（始终在 DOM，默认隐藏；.admin-only 视觉兜底）
    var form = h("form", { class: "form-grid card admin-only", id: "materials-form", hidden: true });
    form.addEventListener("submit", function (ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      onSubmitForm();
    });
    state.formEl = form;
    wrap.appendChild(form);

    // 筛选 / 搜索（全班可用）
    var filters = h("div", { class: "card materials-filters" });
    var search = h("input", { class: "input", type: "search", id: "materials-search", placeholder: "搜索标题关键词…" });
    search.addEventListener("input", function () {
      if (!state) return;
      state.query = search.value || "";
      renderList();
    });
    var subjectSel = h("select", { class: "input", id: "materials-subject-filter" });
    subjectSel.addEventListener("change", function () {
      if (!state) return;
      state.filterSubject = subjectSel.value || "";
      renderList();
    });
    filters.appendChild(search);
    filters.appendChild(subjectSel);
    state.searchEl = search;
    state.subjectEl = subjectSel;
    wrap.appendChild(filters);

    // 列表
    var list = h("div", { class: "card-list", id: "materials-list" });
    state.listEl = list;
    wrap.appendChild(list);

    state.newBtn = newBtn;
    rootEl.appendChild(wrap);
    renderLoading();
    renderFilters();

    return loadAll().then(function () {
      if (token !== mountToken || !state || state.root !== rootEl) return;   // 已卸载/重挂：丢弃过期结果
      renderFilters();
      renderList();
      renderPermission();
    }, function (err) {
      if (token !== mountToken || !state || state.root !== rootEl) return;
      toastError(err, "加载资料失败");
      renderLoadError(err);
      renderPermission();
    });
  }

  function unmount() {
    mountToken++;   // 使在途异步结果失效
    state = null;
  }

  // ============================================================
  // 对外
  // ============================================================
  CA.views = CA.views || {};
  CA.views.materials = { mount: mount, unmount: unmount };

  // 便于单测与复用（纯函数 + 云存储桥接）
  CA.materials = {
    MATERIAL_BUCKET: MATERIAL_BUCKET,
    MATERIAL_MAX_BYTES: MATERIAL_MAX_BYTES,
    MATERIAL_ALLOWED_EXT: MATERIAL_ALLOWED_EXT.slice(),
    validateFile: validateFile,
    buildStorageKey: buildStorageKey,
    sanitizeFileName: sanitizeFileName,
    extOf: extOf,
    fmtSize: fmtSize,
    uploadFile: uploadFile,
    signedUrlOf: signedUrlOf,
    triggerDownload: triggerDownload,
    addToReview: addToReview
  };
})();
