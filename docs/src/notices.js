// 通知 / 资料分发模块（P1a 异步迁移版）
// 契约依据：CONTRACT.md §6.3 DOM id、§7 模块接口、§8 ai.js 契约
// 设计依据：DESIGN.md §4 组件类名、§5 图标（禁止 emoji）、§6 时间规则（禁止 ISO 直出）
// 数据层：CA.store 已切 CloudBase PG（返回 Promise）；CA.auth.current()/list() 亦为异步。
//         除 memberName/settings/uid 外一律 await；渲染改读内存缓存，避免重复请求。
// 暴露：CA.views.notices = { mount(rootEl), unmount() }
// 零依赖 · IIFE · 中文注释 · ES2017
window.CA = window.CA || {};
CA.views = CA.views || {};

CA.views.notices = (function () {
  "use strict";

  // ================= 常量 =================
  var CATEGORIES = ["考试安排", "作业信息", "活动信息", "班级通知", "其他"];
  var TIME_LABELS = ["考试时间", "截止时间", "报名截止", "活动时间", "相关时间"];
  var SOON_MS = 3 * 24 * 60 * 60 * 1000; // 距截止 3 天内视为「临近截止」
  var AI_HINT_DEFAULT = "描述后点击右侧按钮，AI 会生成结构化草稿供你核对。";

  // ---- 附件上传/下载（PG 云存储 pgstore，桶名放入 storage.from()，key 不含桶前缀）----
  var ATTACH_BUCKET = "attachments";             // 已建的私有桶
  var ATTACH_MAX_BYTES = 20 * 1024 * 1024;       // 单文件体积上限：20MB
  var ATTACH_MAX_COUNT = 10;                     // 单条通知附件数量上限
  var ATTACH_SIGNED_TTL = 3600;                  // 签名下载链接有效期（秒）
  var ATTACH_ALLOWED_EXT = [                     // 常见类型白名单（按扩展名判定，MIME 常为空不可靠）
    "pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "csv", "ppt", "pptx",
    "png", "jpg", "jpeg", "gif", "webp", "zip", "rar", "7z", "mp3", "m4a", "wav", "mp4"
  ];

  // ================= 模块状态与缓存 =================
  var rootEl = null;                 // mount 传入的视图容器
  var mountToken = 0;                // 挂载令牌：卸载/重挂后丢弃过期的异步结果
  var state = {
    activeCat: "全部",               // 当前分类筛选
    detailId: null,                  // 详情面板展示的通知 id
    editingId: null,                 // 正在编辑的通知 id（null=新建）
    formOpen: false,                 // 表单是否展开
    aiBusy: false,                   // AI 解析进行中
    saving: false,                   // 表单提交进行中
    me: null,                        // 当前用户（异步加载后的快照）
    pendingAttachments: [],          // 表单待提交附件（含已上传的 { name,size,type,path }）
    draftId: null,                   // 新建通知的本地预生成 id（用于附件目录，发布时复用为通知 id）
    attaching: false,                // 附件上传进行中
  };
  var noticesCache = [];             // notices 集合缓存（渲染读缓存，写后整体刷新）
  var noticeById = {};               // id → notice
  var favoritesCache = [];           // favorites 集合缓存（按当前用户筛选）
  var usersById = {};                // userId → 展示名（发布人）
  var summaryCache = {};             // 学生端 AI 摘要缓存：noticeId → { points, keywords, warnings }
  var askCache = {};                 // 学生端「问问 AI」会话缓存：noticeId → [{ role, content }]
  var styleInjected = false;         // 学生端 AI 卡片的局部样式只需注入一次

  // ================= 通用小工具 =================
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // 局部 HTML 转义（防 XSS）：凡经 innerHTML 注入的动态文本，必须先过此函数
  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 创建元素：h("div", { class:"x", text:"hi" }) / h("span", {}, "文本")
  function h(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!has(attrs, k)) continue;
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "dataset") {
          for (var dk in attrs[k]) node.dataset[dk] = attrs[k][dk];
        } else {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (text != null) node.textContent = text;
    return node;
  }

  // 清空子节点（不用 innerHTML，避免依赖 HTML 解析）
  function clear(node) {
    while (node && node.children && node.children.length) {
      node.removeChild(node.children[0]);
    }
  }

  // 在 root 内查询（rootEl 为空时安全返回 null）
  function q(sel) { return rootEl ? rootEl.querySelector(sel) : null; }

  // 统一失败提示：优先 err.message，其次 fallback
  function toastError(err, fallback) {
    var msg = (err && err.message) || fallback || "操作失败";
    if (CA.app && CA.app.toast) CA.app.toast(msg, "error");
  }

  // 按钮忙碌态：禁用 + .is-loading（可选切换文案）
  function setBusy(btn, busy, busyText, idleText) {
    if (!btn) return;
    btn.disabled = !!busy;
    var cls = String(btn.className || "").replace(/\s*is-loading/g, "");
    btn.className = busy ? (cls + " is-loading") : cls;
    if (busy && busyText != null) btn.textContent = busyText;
    else if (!busy && idleText != null) btn.textContent = idleText;
  }

  // 图标按钮忙碌态：禁用 + .is-loading，文案切换作用在 .btn-label（保留图标）
  function btnLabelBusy(btn, busy, busyText, idleText) {
    if (!btn) return;
    btn.disabled = !!busy;
    var cls = String(btn.className || "").replace(/\s*is-loading/g, "");
    btn.className = busy ? (cls + " is-loading") : cls;
    var label = btn.querySelector ? btn.querySelector(".btn-label") : null;
    if (label) {
      if (busy && busyText != null) label.textContent = busyText;
      else if (!busy && idleText != null) label.textContent = idleText;
    } else {
      if (busy && busyText != null) btn.textContent = busyText;
      else if (!busy && idleText != null) btn.textContent = idleText;
    }
  }

  // AI 整体开关（settings.aiEnabled && CA.llm.ready()）；缺失时视为关闭
  function aiEnabled() {
    return !!(CA.ai && CA.ai.enabled && CA.ai.enabled());
  }

  // 学生端 AI 卡片的局部样式：只注入一次（颜色一律走 CSS 变量，DESIGN.md §12）
  var NOTICE_AI_CSS =
    "#ai-notice-assist .ai-points{margin:6px 0;padding-left:20px;color:var(--text-2);line-height:1.7}" +
    "#ai-notice-assist .ai-points li{margin:2px 0}" +
    "#ai-notice-assist .ai-keywords{margin-top:8px;flex-wrap:wrap;gap:6px}" +
    "#ai-notice-assist .ai-ask-row{align-items:center;gap:8px}" +
    "#ai-notice-assist .ai-ask-row .input{flex:1 1 auto;min-width:0}" +
    "#ai-notice-ask-log{display:flex;flex-direction:column;gap:8px;margin:10px 0}" +
    "#ai-notice-ask-log:empty{display:none;margin:0}" +
    ".ai-bubble{max-width:88%;padding:8px 12px;border:2px solid var(--line);border-radius:var(--r);font-size:var(--fs-sm);line-height:1.6;white-space:pre-wrap;word-break:break-word}" +
    ".ai-bubble-user{align-self:flex-end;background:var(--role-soft);color:var(--text);border-bottom-right-radius:var(--r-xs)}" +
    ".ai-bubble-ai{align-self:flex-start;background:var(--surface);color:var(--text);box-shadow:var(--shadow-xs)}" +
    ".ai-bubble-error{align-self:flex-start;background:var(--danger-soft);color:var(--danger-text);border-color:var(--danger)}";

  function injectAiStyles() {
    if (styleInjected) return;
    styleInjected = true;
    if (typeof document === "undefined" || !document.createElement) return;
    var host = document.head || document.body;
    if (!host || typeof host.appendChild !== "function") return;
    var style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.textContent = NOTICE_AI_CSS;
    host.appendChild(style);
  }

  // ================= 图标（DESIGN.md §5，禁止 emoji） =================
  // 统一封装 CA.iconEl / CA.icon；两者都不可用时退化为带 .icon 钩子的占位 span（不抛错）
  function iconNode(name, size) {
    if (CA.iconEl) {
      try {
        var el = CA.iconEl(name, size);
        if (el) return el;
      } catch (e) { /* 图标系统异常不阻断渲染 */ }
    }
    if (CA.icon) {
      try {
        var holder = document.createElement("span");
        holder.innerHTML = CA.icon(name, size);
        if (holder.firstChild) return holder.firstChild;
      } catch (e2) { /* 同上 */ }
    }
    var span = h("span", { class: "icon" });
    span.setAttribute("data-icon", name || "");
    return span;
  }

  // ================= 时间（DESIGN.md §6.1，禁止 ISO 直出） =================
  // 优先 CA.util；测试/单测环境缺 CA.util 时退回本地等价实现
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function toDate(v) {
    if (v == null || v === "") return null;
    var d = (v instanceof Date) ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function localFmtSmart(v) {
    var d = toDate(v);
    if (!d) return "";
    var n = new Date();
    var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var n0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var diffDays = Math.round((d0 - n0) / 86400000);
    var hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    if (diffDays === 0) return "今天 " + hm;
    if (diffDays === 1) return "明天 " + hm;
    if (diffDays === -1) return "昨天 " + hm;
    if (d.getFullYear() === n.getFullYear()) return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + hm;
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function localFmtRange(a, b) {
    var da = toDate(a), db = toDate(b);
    if (!da) return "";
    if (!db) return localFmtSmart(a);
    var sameDay = da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
    return localFmtSmart(a) + " ~ " + (sameDay ? (pad2(db.getHours()) + ":" + pad2(db.getMinutes())) : localFmtSmart(b));
  }
  function fmtSmartV(v) {
    if (CA.util && typeof CA.util.fmtSmart === "function") return CA.util.fmtSmart(v);
    return localFmtSmart(v);
  }
  function fmtRangeV(a, b) {
    if (CA.util && typeof CA.util.fmtRange === "function") return CA.util.fmtRange(a, b);
    return localFmtRange(a, b);
  }

  // 字节大小格式化
  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  // 截止时间是否临近（未过期且 3 天内）
  function isDeadlineSoon(deadline) {
    if (!deadline) return false;
    var t = Date.parse(deadline);
    if (isNaN(t)) return false;
    var diff = t - Date.now();
    return diff >= 0 && diff <= SOON_MS;
  }

  // 通知时间展示（区间用 fmtRange，单点用 fmtSmart；绝不输出原始 ISO）
  function noticeTimeText(n) {
    var label = n.timeLabel || "时间";
    var hasA = !!n.deadline, hasB = !!n.endTime;
    if (hasA && hasB) return label + " " + fmtRangeV(n.deadline, n.endTime);
    if (hasA) return label + " " + fmtSmartV(n.deadline);
    if (hasB) return label + " " + fmtSmartV(n.endTime);
    return "";
  }

  // 附件类型徽标：按扩展名归类
  function attType(name) {
    var ext = String(name || "").split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].indexOf(ext) >= 0) return { key: "img", label: "图片" };
    if (["xls", "xlsx", "csv"].indexOf(ext) >= 0) return { key: "sheet", label: "表格" };
    if (["ppt", "pptx"].indexOf(ext) >= 0) return { key: "slide", label: "演示" };
    if (["zip", "rar", "7z", "tar", "gz"].indexOf(ext) >= 0) return { key: "zip", label: "压缩包" };
    if (ext === "pdf") return { key: "pdf", label: "PDF" };
    if (["doc", "docx", "txt", "md"].indexOf(ext) >= 0) return { key: "doc", label: "文档" };
    return { key: "file", label: "文件" };
  }

  // ================= 附件上传 / 下载（云存储） =================
  // 错误对象 → 可读文案（兼容 { message } / { msg } / { code } / 字符串）
  function errMsgOf(e) {
    if (!e) return "未知错误";
    return e.message || e.msg || e.code || String(e);
  }

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

  // 取扩展名（小写）
  function extOf(name) {
    var parts = String(name || "").split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
  }

  // 前端校验（体积 / 白名单）；通过返回 ""，否则返回可读错误文案
  function validateAttachFile(file) {
    if (!file) return "无效文件";
    var size = Number(file.size) || 0;
    if (size > ATTACH_MAX_BYTES) {
      return "「" + (file.name || "文件") + "」超过 20MB 上限，无法上传";
    }
    var ext = extOf(file.name);
    if (ATTACH_ALLOWED_EXT.indexOf(ext) < 0) {
      return "「" + (file.name || "文件") + "」类型不支持（" + (ext || "未知") + "）";
    }
    return "";
  }

  // 云存储桶句柄；未就绪返回 null（由调用方给出可读错误）
  function attachBucket() {
    var app = (CA.cloud && CA.cloud.app) ? CA.cloud.app : null;
    if (!app || !app.storage || typeof app.storage.from !== "function") return null;
    return app.storage.from(ATTACH_BUCKET);
  }

  // 上传单个文件 → { name, size, type, path }（path 为桶内 key：<noticeId>/<token>-<name>）
  function uploadAttachment(file, folderId) {
    var bucket = attachBucket();
    if (!bucket || typeof bucket.upload !== "function") {
      return Promise.reject(new Error("云存储未就绪：无法上传附件（请确认已登录且网络正常）"));
    }
    var key = folderId + "/" + genToken() + "-" + sanitizeFileName(file.name);
    return Promise.resolve(bucket.upload(key, file)).then(function (res) {
      if (res && res.error) throw new Error(errMsgOf(res.error));
      return {
        name: file.name || sanitizeFileName(file.name),
        size: Number(file.size) || 0,
        type: file.type || "",
        path: key
      };
    });
  }

  // 私有桶取签名下载链接（PG 模式返回 { data: { fullSignedURL } }，兼容 signedUrl/url/字符串）
  function signedUrlOf(path) {
    var bucket = attachBucket();
    if (!bucket || typeof bucket.createSignedUrl !== "function") {
      return Promise.reject(new Error("云存储未就绪：无法获取下载链接"));
    }
    return Promise.resolve(bucket.createSignedUrl(path, ATTACH_SIGNED_TTL)).then(function (res) {
      if (res && res.error) throw new Error(errMsgOf(res.error));
      var d = (res && res.data) ? res.data : res;
      var url = (d && (d.fullSignedURL || d.signedUrl || d.url)) || (typeof res === "string" ? res : "");
      if (!url) throw new Error("存储服务未返回下载链接，请稍后重试");
      return url;
    });
  }

  // 触发浏览器下载（<a download>），宿主环境缺 appendChild/click 时静默降级
  function triggerDownload(url, name) {
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

  // 渲染表单待提交附件列表（#notice-attach-list）
  function renderAttachList() {
    var list = q("#notice-attach-list");
    if (!list) return;
    clear(list);
    state.pendingAttachments.forEach(function (a, i) {
      var chip = h("div", { class: "attach" });
      chip.appendChild(iconNode("paperclip", 14));
      chip.appendChild(h("span", { class: "att-name", text: a.name || "未命名" }));
      chip.appendChild(h("span", { class: "att-size", text: fmtSize(a.size) }));
      var rm = h("button", { class: "btn btn-quiet btn-sm", type: "button", text: "移除" });
      rm.dataset.attRemove = String(i);
      chip.appendChild(rm);
      list.appendChild(chip);
    });
  }

  // 选择文件 → 逐个上传 → 写入 pendingAttachments
  function onAttachSelect(e) {
    var input = (e && e.target) || q("#notice-attach-input");
    var files = (input && input.files) ? Array.prototype.slice.call(input.files) : [];
    if (input) input.value = "";              // 允许重复选择同一文件
    if (!files.length) return;
    if (!canPublish()) { CA.app.toast("无上传权限"); return; }
    if (state.attaching) { CA.app.toast("附件上传中，请稍候"); return; }

    // 新建通知：先本地生成通知 id（发布时复用），使附件目录与通知 id 一致
    if (!state.editingId && !state.draftId) state.draftId = storeUid("n");
    var folderId = state.editingId || state.draftId;

    var accepted = [];
    files.forEach(function (f) {
      var err = validateAttachFile(f);
      if (err) CA.app.toast(err, "error");
      else accepted.push(f);
    });
    if (!accepted.length) return;

    var room = ATTACH_MAX_COUNT - state.pendingAttachments.length;
    if (room <= 0) { CA.app.toast("最多添加 " + ATTACH_MAX_COUNT + " 个附件", "error"); return; }
    if (accepted.length > room) {
      CA.app.toast("最多添加 " + ATTACH_MAX_COUNT + " 个附件，已忽略多余文件", "error");
      accepted = accepted.slice(0, room);
    }

    var btn = q("#btn-notice-attach");
    state.attaching = true;
    btnLabelBusy(btn, true, "上传中…");

    var chain = Promise.resolve();
    accepted.forEach(function (f) {
      chain = chain.then(function () {
        return uploadAttachment(f, folderId).then(function (rec) {
          state.pendingAttachments.push(rec);
          renderAttachList();
        }, function (err) {
          toastError(err, "上传附件失败：" + (f.name || ""));
        });
      });
    });
    return chain.then(function () {
      state.attaching = false;
      btnLabelBusy(btn, false, null, "添加附件");
    });
  }

  // 移除待提交附件（仅从列表移除；已上传对象按最小权限不在此处删除）
  function onAttachRemove(idx) {
    if (idx < 0 || idx >= state.pendingAttachments.length) return;
    state.pendingAttachments.splice(idx, 1);
    renderAttachList();
  }

  // 详情附件下载：createSignedUrl → 触发下载
  function onAttachDownload(btn) {
    var n = state.detailId ? (noticeById[state.detailId] || null) : null;
    var idx = (btn && btn.dataset) ? Number(btn.dataset.attIndex) : -1;
    var atts = (n && n.attachments) || [];
    var a = (idx >= 0 && idx < atts.length) ? atts[idx] : null;
    if (!a) { CA.app.toast("未找到该附件信息"); return Promise.resolve(); }
    if (!a.path) { CA.app.toast("该附件缺少存储路径（历史数据），无法下载"); return Promise.resolve(); }

    setBusy(btn, true);
    return signedUrlOf(a.path).then(function (url) {
      triggerDownload(url, a.name);
      CA.app.toast("已开始下载：" + (a.name || "附件"), "success");
    }).catch(function (err) {
      toastError(err, "附件下载失败");
    }).then(function () {
      setBusy(btn, false);
    });
  }

  // 向上查找带指定 data-* 的祖先（浏览器 / 测试桩通用）
  function closestData(node, key) {
    while (node) {
      if (node.dataset && node.dataset[key] != null) return node;
      node = node.parentNode;
    }
    return null;
  }

  // 由 userId 取展示名（发布人）：读 mount 时加载的用户名缓存
  function userName(id) {
    return usersById[id] || "";
  }

  // ================= 渲染小构件（DESIGN.md §4） =================
  // 徽标：badge(cls, iconName, text)
  function badge(cls, iconName, text) {
    var b = h("span", { class: "badge" + (cls ? " " + cls : "") });
    if (iconName) b.appendChild(iconNode(iconName, 13));
    if (text) b.appendChild(h("span", { text: text }));
    return b;
  }

  // 元信息项：图标 + 文本
  function metaItem(iconName, text, extraClass) {
    var s = h("span", { class: "meta-item" + (extraClass ? " " + extraClass : "") });
    if (iconName) s.appendChild(iconNode(iconName, 14));
    s.appendChild(h("span", { text: text }));
    return s;
  }

  // ================= 空态插画（v4：Agnes 插画，DESIGN §4.10 / §13.1） =================
  // 只需给 .empty-icon 追加 ca-art ca-art-notices，即由 CSS 换上 empty-notices.png，
  // 无需内联 SVG、无需改结构；.empty-icon.ca-art 的尺寸/去边框也由 CSS 承担。
  function emptyState(title, desc) {
    var e = h("div", { class: "empty" });
    e.appendChild(h("div", { class: "empty-icon ca-art ca-art-notices", "aria-hidden": "true" }));
    e.appendChild(h("div", { class: "empty-title", text: title }));
    if (desc) e.appendChild(h("p", { class: "empty-desc", text: desc }));
    return e;
  }

  // 列表入场 stagger：优先复用 app.js 的 enter，缺失时本地降级
  function stagger(box) {
    if (CA.app && typeof CA.app.enter === "function") { CA.app.enter(box); return; }
    if (!box || !box.classList) return;
    box.classList.remove("ca-enter");
    void box.offsetWidth;
    box.classList.add("ca-enter");
    if (box.__enterT) clearTimeout(box.__enterT);
    box.__enterT = setTimeout(function () { if (box.classList) box.classList.remove("ca-enter"); }, 820);
  }

  // ================= 权限（同步） =================
  function me() { return state.me; }

  function canPublish() {
    return !!(CA.auth && CA.auth.can && CA.auth.can("notice.publish"));
  }

  // 编辑/删除统一权限判定：
  //  - superAdmin（notice.manageAll）→ 可管理全部
  //  - admin → 仅自己发布的（且拥有发布权）
  function canManage(notice) {
    if (!CA.auth || !CA.auth.can) return false;
    if (CA.auth.can("notice.manageAll")) return true;
    var u = me();
    return !!(u && notice && notice.publisherId === u.id && CA.auth.can("notice.publish"));
  }

  // ================= 角色（仅用于视觉/布局差异，不参与权限判断） =================
  // 优先读 app.js 设置的归一化角色（DESIGN.md §10）；缺失时按权限能力降级推断。
  function uiRole() {
    if (CA.app && typeof CA.app.role === "function") {
      try { return CA.app.role(); } catch (e) { /* 降级 */ }
    }
    if (CA.auth && CA.auth.can) {
      if (CA.auth.can("notice.manageAll")) return "teacher";
      if (CA.auth.can("notice.publish")) return "admin";
    }
    return "student";
  }
  function isManagerView() {
    var r = uiRole();
    return r === "teacher" || r === "admin";
  }

  // ================= 收藏（读缓存） =================
  function favRecordsOf(noticeId) {
    var u = me();
    if (!u) return [];
    return favoritesCache.filter(function (f) {
      return f.userId === u.id && f.noticeId === noticeId;
    });
  }

  function isFav(noticeId) {
    return favRecordsOf(noticeId).length > 0;
  }

  // ================= 数据加载（异步，写缓存） =================
  function safe(p, fallback) {
    return Promise.resolve(p).then(function (v) { return v; }, function () { return fallback; });
  }

  // 发布人姓名缓存：auth.list() 对管理员返回全部，对普通用户仅返回自己（权限内尽力解析）
  function loadUsers() {
    usersById = {};
    var p = (CA.auth && CA.auth.list) ? CA.auth.list() : Promise.resolve([]);
    return safe(p, []).then(function (list) {
      (list || []).forEach(function (u) {
        if (u && u.id != null) usersById[u.id] = u.name || "";
      });
    });
  }

  // 当前用户缓存（mount / 刷新时更新）
  function loadMe() {
    var p = (CA.auth && CA.auth.current) ? CA.auth.current() : Promise.resolve(null);
    return safe(p, null).then(function (u) { state.me = u || null; });
  }

  function indexNotices() {
    noticeById = {};
    noticesCache.forEach(function (n) {
      if (n && n.id != null) noticeById[n.id] = n;
    });
  }

  // notices 为关键数据（失败必须暴露）；favorites/users/me 尽力而为
  function loadAll() {
    var pNotices = CA.store.get("notices");
    var pFavs = safe(CA.store.get("favorites"), []);
    var pUsers = loadUsers();
    var pMe = loadMe();
    return Promise.all([pNotices, pFavs, pUsers, pMe]).then(function (arr) {
      noticesCache = arr[0] || [];
      favoritesCache = arr[1] || [];
      indexNotices();
    });
  }

  // 写操作后的整体刷新（重新拉取 + 重渲染）
  function refresh() {
    return loadAll().then(function () {
      if (!rootEl) return;
      renderAll();
    }, function (err) {
      toastError(err, "刷新通知失败");
    });
  }

  // 按 id 取通知：优先缓存，未命中再查云端
  function findNotice(id) {
    if (noticeById[id]) return Promise.resolve(noticeById[id]);
    return safe(CA.store.find("notices", id), null);
  }

  // ================= 排序 / 筛选 =================
  // 置顶优先，其次按创建时间倒序
  function sortForList(list) {
    return list.slice().sort(function (a, b) {
      var pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      var ta = Date.parse(a.createdAt || "") || 0;
      var tb = Date.parse(b.createdAt || "") || 0;
      return tb - ta;
    });
  }

  // ================= 骨架渲染（只执行一次） =================
  function renderShell() {
    injectAiStyles();
    clear(rootEl);
    var stack = h("div", { class: "stack" });

    // ---- 工具栏卡片：标题 + 发布按钮（按角色差异化文案） ----
    var manager = isManagerView();
    // v4：顶部工具栏作为「海报块」——.card-ink 墨底反白提升视觉重心；
    //     .card-sticker 标记贴纸位，内嵌 .ca-sticker（仅学生端显示，见下）
    var toolbar = h("div", { class: "card card-ink card-sticker notices-toolbar " + (manager ? "is-manager" : "is-reader") });
    var thead = h("div", { class: "card-head" });
    var ttitle = h("div", { class: "card-title" });
    ttitle.appendChild(iconNode("bell", 18));
    ttitle.appendChild(h("span", { text: "通知与资料" }));
    // 贴纸点缀：.student-only 由 CSS 按 body.role-* 在学生端显示、管理端隐藏
    ttitle.appendChild(h("span", { class: "ca-sticker student-only", text: "通知板" }));
    thead.appendChild(ttitle);

    var btnNew = h("button", { id: "btn-notice-new", class: "btn btn-primary", type: "button" });
    btnNew.appendChild(iconNode("plus", 16));
    btnNew.appendChild(h("span", { text: "发布通知" }));
    thead.appendChild(btnNew);
    toolbar.appendChild(thead);
    // 角色语境说明（纯视觉文案，不参与权限判断；老师/管理员强调管理，学生强调阅读）
    // 追加 .dim，使说明在 .card-ink 墨底上自动反白弱化（DESIGN §4.2）
    toolbar.appendChild(h("div", {
      class: "toolbar-note dim",
      text: manager
        ? "发布、编辑、删除通知；可用「AI 一句话草稿」快速起草。"
        : "阅读通知与资料，收藏你需要持续关注的内容。"
    }));
    stack.appendChild(toolbar);

    // ---- AI 一句话草稿卡片（#ai-parse-wrap 整块显隐）----
    var aiWrap = h("div", { id: "ai-parse-wrap", class: "card ai-parse" });
    var aiHead = h("div", { class: "card-head" });
    var aiTitle = h("div", { class: "card-title" });
    aiTitle.appendChild(iconNode("sparkles", 18));
    aiTitle.appendChild(h("span", { text: "AI 一句话草稿" }));
    aiHead.appendChild(aiTitle);
    aiHead.appendChild(badge("badge-ai", null, "AI"));
    aiWrap.appendChild(aiHead);

    var aiInput = h("textarea", {
      id: "ai-parse-input",
      class: "input",
      rows: "2",
      placeholder: "一句话描述（例：下周三 15:00 报告厅开家长会，请带成绩单）",
    });
    aiWrap.appendChild(aiInput);

    var aiFoot = h("div", { class: "row-between" });
    var aiHint = h("div", { id: "ai-parse-hint", class: "field-hint", text: AI_HINT_DEFAULT });
    var aiBtn = h("button", { id: "btn-ai-parse", class: "btn btn-ai", type: "button" });
    aiBtn.appendChild(iconNode("sparkles", 16));
    aiBtn.appendChild(h("span", { class: "btn-label", text: "AI 生成草稿" }));
    aiFoot.appendChild(aiHint);
    aiFoot.appendChild(aiBtn);
    aiWrap.appendChild(aiFoot);
    stack.appendChild(aiWrap);

    // ---- 分类筛选：分段控件 ----
    var filters = h("div", { id: "notices-filters", class: "segmented" });
    stack.appendChild(filters);

    // ---- 列表 / 详情 / 表单 ----
    var list = h("div", { id: "notices-list", class: "card-list" });
    var detail = h("div", { id: "notice-detail" });
    var form = buildForm();
    stack.appendChild(list);
    stack.appendChild(detail);
    stack.appendChild(form);

    rootEl.appendChild(stack);

    // ---- 事件绑定（全部挂在 root 内元素上，随 DOM 移除自动回收）----
    btnNew.addEventListener("click", onCreateClick);
    aiBtn.addEventListener("click", onAiClick);

    // 分类筛选：委托
    filters.addEventListener("click", function (e) {
      var btn = closestData(e.target || e.srcElement, "cat");
      if (!btn) return;
      state.activeCat = btn.dataset.cat;
      renderFilters();
      renderList();
      stagger(list);
    });

    // 列表点击 → 详情：委托
    list.addEventListener("click", function (e) {
      var item = closestData(e.target || e.srcElement, "noticeId");
      if (!item) return;
      state.detailId = item.dataset.noticeId;
      renderList();    // 更新选中态
      renderDetail();
    });

    // 详情操作：委托（收藏 / 编辑 / 删除 / 附件下载提示）
    detail.addEventListener("click", function (e) {
      var act = closestData(e.target || e.srcElement, "action");
      if (!act) return;
      var action = act.dataset.action;
      var id = state.detailId;
      if (action === "fav") toggleFav(id);
      else if (action === "edit") openEditForm(id);
      else if (action === "delete") handleDelete(id);
      else if (action === "attach") onAttachDownload(act);
    });

    // 表单提交 / 取消
    form.addEventListener("submit", handleSubmit);
    var cancel = form.querySelector("#btn-notice-cancel");
    if (cancel) cancel.addEventListener("click", function () { closeForm(); });
  }

  // ================= 表单 =================
  // 带 .input 统一样式的下拉
  function selectInput(name, options, def) {
    var s = h("select", { name: name, class: "input" });
    for (var i = 0; i < options.length; i++) {
      var val = options[i];
      var opt = h("option", { value: val }, val || "—");
      if (val === def) opt.selected = true;
      s.appendChild(opt);
    }
    s.value = def;
    return s;
  }

  // .form-grid > .form-field > .label (+ .req) + 控件
  function formField(labelText, inputEl, opts) {
    opts = opts || {};
    var wrap = h("div", { class: "form-field" + (opts.span2 ? " span-2" : "") });
    var lbl = h("label", { class: "label", text: labelText });
    if (opts.required) lbl.appendChild(h("span", { class: "req", text: " *" }));
    wrap.appendChild(lbl);
    wrap.appendChild(inputEl);
    if (opts.hint) wrap.appendChild(h("div", { class: "field-hint", text: opts.hint }));
    return wrap;
  }

  // 复选框字段：.label + .row > input + 说明
  function checkField(labelText, inputEl, hintText) {
    var wrap = h("div", { class: "form-field" });
    wrap.appendChild(h("label", { class: "label", text: labelText }));
    var row = h("label", { class: "row" });
    row.appendChild(inputEl);
    row.appendChild(h("span", { class: "muted", text: hintText || "启用" }));
    wrap.appendChild(row);
    return wrap;
  }

  // 附件上传字段：隐藏 file input + 自定义按钮 + 待提交列表 + 约束提示（不新增 CSS 依赖）
  function buildAttachField() {
    var wrap = h("div", { class: "form-field span-2" });
    wrap.appendChild(h("label", { class: "label", text: "附件" }));

    var row = h("div", { class: "row" });
    var input = h("input", { id: "notice-attach-input", type: "file", multiple: "multiple" });
    input.hidden = true;
    input.setAttribute("hidden", "");        // 隐藏原生控件，仅用按钮触发
    row.appendChild(input);

    var btn = h("button", { id: "btn-notice-attach", class: "btn btn-quiet", type: "button" });
    btn.appendChild(iconNode("paperclip", 16));
    btn.appendChild(h("span", { class: "btn-label", text: "添加附件" }));
    row.appendChild(btn);
    wrap.appendChild(row);

    var list = h("div", { id: "notice-attach-list", class: "row" });
    wrap.appendChild(list);
    wrap.appendChild(h("div", {
      id: "notice-attach-hint", class: "field-hint",
      text: "支持 PDF / Office / 图片 / 压缩包等常用类型，单文件不超过 20MB，最多 " + ATTACH_MAX_COUNT + " 个。"
    }));

    // 事件（元素随表单创建一次，无需解绑）
    btn.addEventListener("click", function () { if (input.click) input.click(); });
    input.addEventListener("change", onAttachSelect);
    list.addEventListener("click", function (e) {
      var rm = closestData(e.target || e.srcElement, "attRemove");
      if (rm) onAttachRemove(Number(rm.dataset.attRemove));
    });

    return wrap;
  }

  function buildForm() {
    var form = h("form", { id: "notice-form", class: "card notice-form" });
    form.hidden = true;

    var head = h("div", { class: "card-head" });
    head.appendChild(h("div", { class: "card-title form-heading", text: "发布通知" }));
    form.appendChild(head);

    var grid = h("div", { class: "form-grid" });

    var title = h("input", { name: "title", class: "input", type: "text", placeholder: "通知标题", maxlength: "60" });
    var category = selectInput("category", CATEGORIES, "班级通知");
    var timeLabel = selectInput("timeLabel", [""].concat(TIME_LABELS), "");
    var deadline = h("input", { name: "deadline", class: "input", type: "text", placeholder: "如 2026-06-20 18:00" });
    var endTime = h("input", { name: "endTime", class: "input", type: "text", placeholder: "如 2026-06-20 20:00" });
    var location = h("input", { name: "location", class: "input", type: "text", placeholder: "地点" });
    var course = h("input", { name: "course", class: "input", type: "text", placeholder: "课程（可选）" });
    var content = h("textarea", { name: "content", class: "input", rows: "5", placeholder: "通知正文" });
    var pinned = h("input", { name: "pinned", type: "checkbox" });
    var important = h("input", { name: "important", type: "checkbox" });

    grid.appendChild(formField("标题", title, { required: true, span2: true }));
    grid.appendChild(formField("分类", category));
    grid.appendChild(formField("时间标签", timeLabel, { hint: "可选，用于说明下方时间的含义" }));
    grid.appendChild(formField("截止时间", deadline));
    grid.appendChild(formField("结束时间", endTime));
    grid.appendChild(formField("地点", location));
    grid.appendChild(formField("课程", course));
    grid.appendChild(formField("正文", content, { span2: true }));
    grid.appendChild(buildAttachField());
    grid.appendChild(checkField("置顶", pinned, "发布后置顶显示"));
    grid.appendChild(checkField("重要", important, "标记为重要通知"));
    form.appendChild(grid);

    var actions = h("div", { class: "form-actions" });
    actions.appendChild(h("button", { id: "btn-notice-cancel", class: "btn btn-quiet", type: "button" }, "取消"));
    actions.appendChild(h("button", { id: "btn-notice-save", class: "btn btn-primary", type: "submit" }, "保存"));
    form.appendChild(actions);

    return form;
  }

  function setField(scope, name, val) {
    var el = scope.querySelector('[name="' + name + '"]');
    if (el && val != null) el.value = val;
  }

  function setChecked(scope, name, val) {
    var el = scope.querySelector('[name="' + name + '"]');
    if (el) el.checked = !!val;
  }

  // 渲染表单：显隐 + 标题 + 回填（state.editingId 决定编辑/新建，读缓存）
  function renderForm() {
    var form = q("#notice-form");
    if (!form) return;
    var open = state.formOpen && canPublish();
    form.hidden = !open;
    var heading = form.querySelector(".form-heading");
    if (heading) heading.textContent = state.editingId ? "编辑通知" : "发布通知";

    var src = state.editingId ? (noticeById[state.editingId] || null) : null;
    setField(form, "title", src ? src.title : "");
    setField(form, "category", src ? src.category : "班级通知");
    setField(form, "timeLabel", src ? src.timeLabel : "");
    setField(form, "deadline", src ? src.deadline : "");
    setField(form, "endTime", src ? src.endTime : "");
    setField(form, "location", src ? src.location : "");
    setField(form, "course", src ? src.course : "");
    setField(form, "content", src ? src.content : "");
    setChecked(form, "pinned", src ? src.pinned : false);
    setChecked(form, "important", src ? src.important : false);
    renderAttachList();   // 待提交附件列表随编辑对象回填
  }

  // 从表单收集数据（字段对齐数据模型，附件/链接由发布时补默认空数组）
  function collectForm() {
    var f = q("#notice-form");
    if (!f) return null;
    var val = function (name) { var e = f.querySelector('[name="' + name + '"]'); return e ? String(e.value || "") : ""; };
    var chk = function (name) { var e = f.querySelector('[name="' + name + '"]'); return !!(e && e.checked); };
    return {
      title: val("title").trim(),
      category: val("category") || "其他",
      content: val("content"),
      timeLabel: val("timeLabel"),
      deadline: val("deadline"),
      endTime: val("endTime"),
      location: val("location"),
      course: val("course"),
      pinned: chk("pinned"),
      important: chk("important"),
    };
  }

  // ================= 筛选与列表（读缓存，纯同步） =================
  function renderFilters() {
    var wrap = q("#notices-filters");
    if (!wrap) return;
    clear(wrap);
    var all = noticesCache;
    var cats = ["全部"].concat(CATEGORIES);
    cats.forEach(function (cat) {
      var count = cat === "全部"
        ? all.length
        : all.filter(function (n) { return n.category === cat; }).length;
      var b = h("button", { class: "seg-item" + (state.activeCat === cat ? " active" : ""), type: "button" });
      b.dataset.cat = cat;
      b.appendChild(h("span", { class: "filter-name", text: cat }));
      b.appendChild(h("span", { class: "filter-count", text: String(count) }));
      wrap.appendChild(b);
    });
  }

  // 列表项：.card-list > .list-row
  function buildListItem(n) {
    var soon = isDeadlineSoon(n.deadline);
    var item = h("div", { class: "list-row" });
    item.dataset.noticeId = n.id;
    item.dataset.cat = n.category || "";
    if (state.detailId === n.id) item.className += " is-active";

    var main = h("div", { class: "list-main" });

    // 徽标行：重要 / 置顶 / 分类 / 收藏
    var badges = h("div", { class: "row" });
    if (n.important) badges.appendChild(badge("badge-important", "alert", "重要"));
    if (n.pinned) badges.appendChild(badge("badge-pinned", "pin", "置顶"));
    if (n.category) badges.appendChild(badge("badge-cat", null, n.category));
    if (isFav(n.id)) {
      var fav = badge("fav-star", "star-filled", null);
      fav.title = "已收藏";
      badges.appendChild(fav);
    }
    if (badges.children.length) main.appendChild(badges);

    // 标题
    main.appendChild(h("div", { class: "notice-title", text: n.title || "（无标题）" }));

    // 元信息：时间 / 地点 / 课程 / 附件 / 临近截止
    var meta = h("div", { class: "notice-meta row" });
    var tt = noticeTimeText(n);
    if (tt) meta.appendChild(metaItem("clock", tt));
    if (n.location) meta.appendChild(metaItem("map-pin", n.location));
    if (n.course) meta.appendChild(metaItem("book", n.course));

    var atts = n.attachments || [];
    if (atts.length) {
      var att = h("span", { class: "meta-item" });
      att.appendChild(iconNode("paperclip", 14));
      att.appendChild(h("span", { class: "att-count", text: atts.length + " 个附件" }));
      meta.appendChild(att);
    }

    if (soon) {
      var chip = h("span", { class: "chip" });
      chip.appendChild(iconNode("clock", 13));
      chip.appendChild(h("span", { text: "临近截止" }));
      meta.appendChild(chip);
    }

    if (meta.children.length) main.appendChild(meta);
    item.appendChild(main);
    return item;
  }

  function renderList() {
    var box = q("#notices-list");
    if (!box) return;
    clear(box);
    var filtered = state.activeCat === "全部"
      ? noticesCache
      : noticesCache.filter(function (n) { return n.category === state.activeCat; });
    var sorted = sortForList(filtered);
    if (!sorted.length) {
      box.appendChild(emptyState("暂无通知", "当前分类下还没有通知，发布后可在这里查看。"));
      return;
    }
    sorted.forEach(function (n) {
      box.appendChild(buildListItem(n));
    });
  }

  // ================= 详情 =================
  function renderDetail() {
    var box = q("#notice-detail");
    if (!box) return;
    clear(box);
    var n = state.detailId ? (noticeById[state.detailId] || null) : null;
    if (!n) {
      box.appendChild(emptyState("未选择通知", "从上方列表选择一条通知，这里会显示完整内容与附件。"));
      return;
    }

    var wrap = h("div", { class: "stack" });

    // ---- 头部卡片：徽标 + 标题 + 元信息 + 操作（.card-sticker 提供贴纸位） ----
    var head = h("div", { class: "card card-sticker notice-detail-head" });
    var badges = h("div", { class: "row" });
    if (n.important) badges.appendChild(badge("badge-important", "alert", "重要"));
    if (n.pinned) badges.appendChild(badge("badge-pinned", "pin", "置顶"));
    if (n.category) badges.appendChild(badge("badge-cat", null, n.category));
    // 贴纸点缀：学生端对重要通知追加「必看」贴纸（.student-only 由 CSS 隐藏管理端）
    if (n.important) badges.appendChild(h("span", { class: "ca-sticker student-only", text: "必看" }));
    head.appendChild(badges);
    head.appendChild(h("h3", { class: "detail-title", text: n.title || "（无标题）" }));

    var meta = h("div", { class: "detail-meta row" });
    var tt = noticeTimeText(n);
    if (tt) meta.appendChild(metaItem("clock", tt));
    if (n.location) meta.appendChild(metaItem("map-pin", n.location));
    if (n.course) meta.appendChild(metaItem("book", n.course));
    var pub = userName(n.publisherId);
    if (pub) meta.appendChild(metaItem("user", "发布人：" + pub));
    if (meta.children.length) head.appendChild(meta);

    // 操作区：收藏（所有人；学生端为第一动作）；编辑/删除（可管理，管理端带文字更醒目）
    var actions = h("div", { class: "detail-actions row" });
    var fav = isFav(n.id);
    // v4（DESIGN §13.5）：学生端「收藏」是第一主行动 → .btn-lime；管理端为次要动作 → .btn-ghost
    var favBtn = h("button", { id: "notice-fav-btn", class: "btn fav-action " + (isManagerView() ? "btn-ghost" : "btn-lime"), type: "button", title: fav ? "取消收藏" : "收藏" });
    favBtn.dataset.action = "fav";
    favBtn.dataset.fav = fav ? "1" : "0";
    if (fav) favBtn.className += " is-fav";
    favBtn.appendChild(iconNode(fav ? "star-filled" : "star", 16));
    favBtn.appendChild(h("span", { text: fav ? "已收藏" : "收藏" }));
    actions.appendChild(favBtn);

    if (canManage(n)) {
      var manage = h("div", { class: "manage-actions row" });
      var editBtn = h("button", { class: "btn btn-quiet btn-labeled", type: "button", title: "编辑" });
      editBtn.dataset.action = "edit";
      editBtn.appendChild(iconNode("edit", 16));
      editBtn.appendChild(h("span", { text: "编辑" }));
      manage.appendChild(editBtn);

      var delBtn = h("button", { class: "btn btn-danger btn-labeled", type: "button", title: "删除" });
      delBtn.dataset.action = "delete";
      delBtn.appendChild(iconNode("trash", 16));
      delBtn.appendChild(h("span", { text: "删除" }));
      manage.appendChild(delBtn);
      actions.appendChild(manage);
    }
    head.appendChild(actions);
    wrap.appendChild(head);

    // ---- 正文卡片（学生端阅读强调：.reader-emphasis） ----
    var contentCard = h("div", { class: "card reader-emphasis" });
    contentCard.appendChild(h("div", { class: "card-title", text: "通知正文" }));
    var content = h("div", { class: "detail-content" });
    content.innerHTML = escapeHtml(n.content || "—").replace(/\n/g, "<br>");
    contentCard.appendChild(content);
    wrap.appendChild(contentCard);

    // ---- 学生端 AI 入口（AI 摘要 / 问问 AI）：管理端不渲染，保持老师端不变 ----
    if (!isManagerView()) {
      wrap.appendChild(renderNoticeAssist(n));
    }

    // ---- 附件卡片：.attach 胶囊 ----
    var atts = n.attachments || [];
    if (atts.length) {
      var aw = h("div", { class: "card" });
      aw.appendChild(h("div", { class: "card-title", text: "附件" }));
      var alist = h("div", { class: "row" });
      atts.forEach(function (a, i) {
        var t = attType(a.name);
        var row = h("button", { class: "attach", type: "button" });
        row.dataset.action = "attach";
        row.dataset.attIndex = String(i);   // 下载时定位附件（读取 path）
        row.appendChild(iconNode("paperclip", 14));
        row.appendChild(h("span", { class: "att-name", text: a.name }));
        row.appendChild(badge("badge-muted", null, t.label));
        row.appendChild(h("span", { class: "att-size", text: fmtSize(a.size) }));
        alist.appendChild(row);
      });
      aw.appendChild(alist);
      wrap.appendChild(aw);
    }

    // ---- 链接卡片 ----
    var links = n.links || [];
    if (links.length) {
      var lw = h("div", { class: "card" });
      lw.appendChild(h("div", { class: "card-title", text: "相关链接" }));
      var lrow = h("div", { class: "row" });
      links.forEach(function (l) {
        var a = h("a", { class: "attach", href: l.url, target: "_blank", rel: "noopener noreferrer" });
        a.appendChild(iconNode("link", 14));
        a.appendChild(h("span", { text: l.title || l.url }));
        lrow.appendChild(a);
      });
      lw.appendChild(lrow);
      wrap.appendChild(lw);
    }

    box.appendChild(wrap);
  }

  // ================= 交互处理（异步） =================
  function onCreateClick() {
    if (!canPublish()) { CA.app.toast("无发布权限"); return; }
    state.editingId = null;
    state.formOpen = true;
    state.pendingAttachments = [];
    state.draftId = storeUid("n");   // 预生成通知 id：作为附件目录，发布时复用
    renderForm();
    var input = q('[name="title"]');
    if (input && input.focus) input.focus();
  }

  function openEditForm(id) {
    return findNotice(id).then(function (n) {
      if (!n) return;
      if (!canPublish()) { CA.app.toast("无编辑权限"); return; }
      if (!canManage(n)) { CA.app.toast("只能编辑自己发布的通知"); return; }
      state.editingId = id;
      state.formOpen = true;
      state.pendingAttachments = (n.attachments || []).slice();   // 回填既有附件
      state.draftId = null;
      renderForm();
    });
  }

  function closeForm() {
    state.formOpen = false;
    state.editingId = null;
    state.pendingAttachments = [];
    state.draftId = null;
    renderForm();
  }

  function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (state.saving) return;

    var data = collectForm();
    if (!data) return;
    if (!data.title) { CA.app.toast("请填写标题"); return; }

    // 先做权限预检，避免进入忙碌态后才拒绝
    if (state.editingId) {
      var exist = noticeById[state.editingId];
      if (exist && !canManage(exist)) { CA.app.toast("无权编辑该通知"); return; }
    } else if (!canPublish()) {
      CA.app.toast("无发布权限");
      return;
    }

    var editing = !!state.editingId;
    var saveBtn = q("#btn-notice-save");
    state.saving = true;
    setBusy(saveBtn, true, "保存中…");

    // 附件随通知落库（jsonb 数组）
    data.attachments = state.pendingAttachments.slice();

    var op = editing
      ? CA.store.update("notices", state.editingId, data)
      : CA.store.add("notices", (function () {
        var payload = {};
        for (var k in data) { if (has(data, k)) payload[k] = data[k]; }
        if (state.draftId) payload.id = state.draftId;   // 复用附件目录所用 id
        payload.links = [];
        payload.publisherId = (me() || {}).id;
        return payload;
      })());

    return Promise.resolve(op).then(function () {
      state.formOpen = false;
      state.editingId = null;
      state.pendingAttachments = [];
      state.draftId = null;
      renderAttachList();
      CA.app.toast(editing ? "已更新通知" : "已发布通知", "success");
      return refresh();
    }).catch(function (err) {
      toastError(err, editing ? "更新通知失败" : "发布通知失败");
    }).then(function () {
      state.saving = false;
      setBusy(saveBtn, false, null, "保存");
    });
  }

  function handleDelete(id) {
    return findNotice(id).then(function (n) {
      if (!n) return;
      if (!canManage(n)) { CA.app.toast("只能删除自己发布的通知"); return; }
      var ok = true;
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        ok = window.confirm("确认删除该通知？");
      }
      if (!ok) return;
      var delBtn = q('#notice-detail [data-action="delete"]');
      setBusy(delBtn, true);
      return CA.store.remove("notices", id).then(function () {
        if (state.detailId === id) state.detailId = null;
        CA.app.toast("已删除通知", "success");
        return refresh();
      }).catch(function (err) {
        toastError(err, "删除通知失败");
        setBusy(delBtn, false);
      });
    });
  }

  // 收藏切换（异步写库后刷新缓存）
  function toggleFav(noticeId) {
    var u = me();
    if (!u) { CA.app.toast("请先选择身份"); return; }
    var recs = favRecordsOf(noticeId);
    var op = recs.length
      ? CA.store.remove("favorites", recs[0].id)
      : CA.store.add("favorites", { userId: u.id, noticeId: noticeId });
    return Promise.resolve(op)
      .then(function () { return CA.store.get("favorites"); })
      .then(function (list) {
        favoritesCache = list || [];
        if (!rootEl) return;
        renderList();   // 列表收藏态同步
        renderDetail(); // 详情收藏态同步
      })
      .catch(function (err) { toastError(err, "收藏操作失败"); });
  }

  // ---- AI 一句话草稿 ----
  function setAiBusy(busy) {
    state.aiBusy = !!busy;
    var btn = q("#btn-ai-parse");
    if (!btn) return;
    btn.disabled = !!busy;
    btn.className = busy ? "btn btn-ai is-loading" : "btn btn-ai";
    var label = btn.querySelector(".btn-label");
    if (label) label.textContent = busy ? "生成中…" : "AI 生成草稿";
  }

  function applyDraft(draft) {
    if (!draft || !canPublish()) return;
    if (!state.formOpen) { state.editingId = null; state.formOpen = true; }
    renderForm();
    var form = q("#notice-form");
    if (!form) return;

    if (draft.title != null) setField(form, "title", draft.title);
    if (draft.category && CATEGORIES.indexOf(draft.category) >= 0) setField(form, "category", draft.category);
    if (draft.timeLabel && TIME_LABELS.indexOf(draft.timeLabel) >= 0) setField(form, "timeLabel", draft.timeLabel);
    if (draft.deadline != null) setField(form, "deadline", draft.deadline);
    if (draft.endTime != null) setField(form, "endTime", draft.endTime);
    if (draft.location != null) setField(form, "location", draft.location);
    if (draft.course != null) setField(form, "course", draft.course);
    if (draft.content != null) setField(form, "content", draft.content);
    if (draft.important != null) setChecked(form, "important", !!draft.important);

    var hint = q("#ai-parse-hint");
    if (hint) {
      var warns = draft.warnings || [];
      hint.textContent = warns.length ? ("提示：" + warns.join("；")) : "草稿已生成，请核对内容后发布";
    }
  }

  function onAiClick() {
    if (state.aiBusy) return;
    var input = q("#ai-parse-input");
    var text = input ? String(input.value || "").trim() : "";
    if (!text) { CA.app.toast("请先输入一句话描述"); return; }
    if (!(CA.ai && CA.ai.enabled && CA.ai.enabled())) { CA.app.toast("AI 助手未开启"); return; }

    setAiBusy(true);

    var p;
    try {
      p = CA.ai.parseNotice(text);
    } catch (err) {
      CA.app.toast((err && err.message) || "AI 解析失败");
      setAiBusy(false);
      return;
    }

    return Promise.resolve(p)
      .then(function (draft) {
        applyDraft(draft);
        CA.app.toast("已生成草稿，请核对后发布", "success");
      })
      .catch(function (err) {
        CA.app.toast((err && err.message) || "AI 解析失败");
      })
      .then(function () { setAiBusy(false); });
  }

  // ---- 学生端 AI：通知要点摘要 + 基于正文的问答 ----
  // 纯文本安全渲染：要点/关键词/回答一律用 textContent 注入，绝不拼接 HTML
  function addBubble(logEl, kind, text) {
    if (!logEl) return null;
    var cls = kind === "user" ? "ai-bubble ai-bubble-user"
      : (kind === "error" ? "ai-bubble ai-bubble-error" : "ai-bubble ai-bubble-ai");
    var b = h("div", { class: cls, text: String(text == null ? "" : text) });
    logEl.appendChild(b);
    return b;
  }

  // 渲染摘要结果：要点列表 + 关键词 chips
  function renderSummaryBox(boxEl, res) {
    if (!boxEl) return;
    clear(boxEl);
    if (!res) return;
    var points = Array.isArray(res.points) ? res.points : [];
    if (points.length) {
      var ul = h("ul", { class: "ai-points" });
      points.forEach(function (p) { ul.appendChild(h("li", { text: p })); });
      boxEl.appendChild(ul);
    }
    var keywords = Array.isArray(res.keywords) ? res.keywords : [];
    if (keywords.length) {
      var kw = h("div", { class: "row ai-keywords" });
      keywords.forEach(function (k) { kw.appendChild(h("span", { class: "chip", text: k })); });
      boxEl.appendChild(kw);
    }
    var warns = res.warnings || [];
    if (warns.length) boxEl.appendChild(h("div", { class: "field-hint", text: "提示：" + warns.join("；") }));
  }

  // 由缓存恢复问答气泡
  function renderAskLog(logEl, noticeId) {
    if (!logEl) return;
    clear(logEl);
    (askCache[noticeId] || []).forEach(function (m) {
      addBubble(logEl, m.role === "assistant" ? "ai" : "user", m.content);
    });
  }

  function onAiSummary(n, btn, box, hint) {
    if (!aiEnabled() || btn.disabled) return;
    btnLabelBusy(btn, true, "生成中…");
    if (hint) hint.textContent = "正在提炼要点…";
    var p;
    try {
      p = CA.ai.summarizeNotice(n.id);
    } catch (err) {
      btnLabelBusy(btn, false, null, "AI 摘要");
      if (hint) hint.textContent = "生成失败，请重试。";
      toastError(err, "AI 摘要失败");
      return;
    }
    return Promise.resolve(p).then(function (res) {
      summaryCache[n.id] = res;
      renderSummaryBox(box, res);
      var warns = (res && res.warnings) || [];
      if (hint) hint.textContent = warns.length ? ("提示：" + warns.join("；")) : "要点已生成，请结合原文核对。";
      CA.app.toast("已生成要点摘要", "success");
    }).catch(function (err) {
      if (hint) hint.textContent = "生成失败，请重试。";
      toastError(err, "AI 摘要失败");
    }).then(function () {
      btnLabelBusy(btn, false, null, "AI 摘要");
    });
  }

  function onAiAsk(n, btn, input, log) {
    if (!aiEnabled() || btn.disabled) return;
    var q = input ? String(input.value || "").trim() : "";
    if (!q) { CA.app.toast("请先输入你的问题"); return; }
    var hist = (askCache[n.id] || []).slice();   // 传给 AI 的历史（不含本轮）
    addBubble(log, "user", q);
    if (input) input.value = "";
    btnLabelBusy(btn, true, "生成中…");
    // context 取当前通知正文；正文为空时退回标题
    var context = (n.content && String(n.content).trim()) || n.title || "";
    var p;
    try {
      p = CA.ai.askAbout({ context: context, question: q, history: hist });
    } catch (err) {
      addBubble(log, "error", (err && err.message) || "AI 回答失败，请重试");
      btnLabelBusy(btn, false, null, "问问 AI");
      toastError(err, "AI 回答失败");
      return;
    }
    return Promise.resolve(p).then(function (ans) {
      var text = String(ans == null ? "" : ans);
      addBubble(log, "ai", text);
      askCache[n.id] = hist.concat([{ role: "user", content: q }, { role: "assistant", content: text }]);
    }).catch(function (err) {
      addBubble(log, "error", (err && err.message) || "AI 回答失败，请重试");
      askCache[n.id] = hist.concat([{ role: "user", content: q }]);
      toastError(err, "AI 回答失败");
    }).then(function () {
      btnLabelBusy(btn, false, null, "问问 AI");
    });
  }

  // 构建学生端 AI 卡片（#ai-notice-assist）：AI 摘要 + 问问 AI
  function renderNoticeAssist(n) {
    var card = h("div", { id: "ai-notice-assist", class: "card card-sticker student-only" });

    var chead = h("div", { class: "card-head" });
    var ctitle = h("div", { class: "card-title" });
    ctitle.appendChild(iconNode("sparkles", 18));
    ctitle.appendChild(h("span", { text: "AI 学习助手" }));
    ctitle.appendChild(h("span", { class: "ca-sticker", text: "AI" }));
    chead.appendChild(ctitle);
    chead.appendChild(badge("badge-ai", null, "AI"));
    card.appendChild(chead);
    card.appendChild(h("p", { class: "field-hint", text: "基于本条通知帮你提炼要点、答疑解惑（结果仅供参考，请以原文为准）。" }));

    // ---- AI 摘要 ----
    var sumWrap = h("div", { id: "ai-notice-summary-wrap" });
    var sumHead = h("div", { class: "row-between" });
    var sumHint = h("div", { id: "ai-notice-summary-hint", class: "field-hint", text: "点击「AI 摘要」提炼本条通知要点。" });
    var sumBtn = h("button", { id: "btn-ai-notice-summary", class: "btn btn-ai btn-sm", type: "button" });
    sumBtn.appendChild(iconNode("sparkles", 14));
    sumBtn.appendChild(h("span", { class: "btn-label", text: "AI 摘要" }));
    sumHead.appendChild(sumHint);
    sumHead.appendChild(sumBtn);
    sumWrap.appendChild(sumHead);
    var sumBox = h("div", { id: "ai-notice-summary-box" });
    sumWrap.appendChild(sumBox);
    card.appendChild(sumWrap);

    // ---- 问问 AI ----
    var askWrap = h("div", { id: "ai-notice-ask-wrap" });
    var log = h("div", { id: "ai-notice-ask-log" });
    askWrap.appendChild(log);
    var askRow = h("div", { class: "row-between ai-ask-row" });
    var askInput = h("input", {
      id: "ai-notice-ask-input", class: "input", type: "text",
      placeholder: "就这条通知提问，例如：考试要带什么？", maxlength: "200"
    });
    var askBtn = h("button", { id: "btn-ai-notice-ask", class: "btn btn-ai btn-sm", type: "button" });
    askBtn.appendChild(iconNode("sparkles", 14));
    askBtn.appendChild(h("span", { class: "btn-label", text: "问问 AI" }));
    askRow.appendChild(askInput);
    askRow.appendChild(askBtn);
    askWrap.appendChild(askRow);
    card.appendChild(askWrap);

    // 恢复缓存（切换通知/收藏刷新后不丢已有结果）
    if (summaryCache[n.id]) renderSummaryBox(sumBox, summaryCache[n.id]);
    renderAskLog(log, n.id);

    // 事件（元素随 renderDetail 重建，无需解绑）
    sumBtn.addEventListener("click", function () { onAiSummary(n, sumBtn, sumBox, sumHint); });
    askBtn.addEventListener("click", function () { onAiAsk(n, askBtn, askInput, log); });
    askInput.addEventListener("keydown", function (e) {
      var key = e && (e.key || e.keyCode);
      if (key === "Enter" || key === 13) {
        if (e.preventDefault) e.preventDefault();
        onAiAsk(n, askBtn, askInput, log);
      }
    });

    card.hidden = !aiEnabled();   // AI 关闭时隐藏两个入口（含整卡）
    return card;
  }

  // ================= 权限相关的可见性 =================
  function renderPermission() {
    var btnNew = q("#btn-notice-new");
    if (btnNew) btnNew.hidden = !canPublish();
    var aiWrap = q("#ai-parse-wrap");
    var aiOn = aiEnabled();
    if (aiWrap) aiWrap.hidden = !(canPublish() && aiOn);
    // 学生端 AI 卡片：AI 关闭时隐藏两个入口
    var assist = q("#ai-notice-assist");
    if (assist) assist.hidden = !aiOn;
  }

  // ================= 渲染总入口 =================
  function renderAll() {
    if (!canPublish()) {
      state.formOpen = false;
      state.editingId = null;
    }
    renderFilters();
    renderList();
    renderDetail();
    renderForm();
    renderPermission();
  }

  // ================= 加载态 / 加载失败 =================
  // 加载骨架：列表 3 行占位（.skeleton-row），筛选与详情清空
  function renderLoading() {
    var filters = q("#notices-filters");
    if (filters) clear(filters);
    var list = q("#notices-list");
    if (list) {
      clear(list);
      for (var i = 0; i < 3; i++) {
        var row = h("div", { class: "skeleton-row", "aria-hidden": "true" });
        var main = h("div", { class: "skeleton-line" });
        main.appendChild(h("div", { class: "skeleton skeleton-title" }));
        main.appendChild(h("div", { class: "skeleton" }));
        row.appendChild(main);
        list.appendChild(row);
      }
    }
    var detail = q("#notice-detail");
    if (detail) clear(detail);
  }

  // 加载失败：列表区展示空态 + 重新加载按钮
  function renderLoadError(err) {
    var list = q("#notices-list");
    if (list) {
      clear(list);
      var e = emptyState("加载失败", (err && err.message) || "无法加载通知，请稍后重试。");
      var btn = h("button", { class: "btn btn-primary", type: "button", text: "重新加载" });
      btn.addEventListener("click", function () {
        setBusy(btn, true, "加载中…");
        loadAll().then(function () {
          if (!rootEl) return;
          renderAll();
        }).catch(function (e2) {
          toastError(e2, "加载通知失败");
          setBusy(btn, false, null, "重新加载");
        });
      });
      e.appendChild(btn);
      list.appendChild(e);
    }
    var detail = q("#notice-detail");
    if (detail) clear(detail);
  }

  // ================= 生命周期 =================
  function resetState() {
    state.activeCat = "全部";
    state.detailId = null;
    state.editingId = null;
    state.formOpen = false;
    state.aiBusy = false;
    state.saving = false;
    state.me = null;
    state.pendingAttachments = [];
    state.draftId = null;
    state.attaching = false;
    noticesCache = [];
    noticeById = {};
    favoritesCache = [];
    usersById = {};
    summaryCache = {};
    askCache = {};
  }

  // mount 改为 async：先同步渲染壳与骨架，再 await 数据后渲染内容
  function mount(root) {
    rootEl = root;
    var token = ++mountToken;
    resetState();
    renderShell();
    renderPermission();
    renderLoading();

    return loadAll().then(function () {
      if (token !== mountToken || rootEl !== root) return; // 已卸载/重挂：丢弃过期结果
      renderAll();
    }, function (err) {
      if (token !== mountToken || rootEl !== root) return;
      toastError(err, "加载通知失败");
      renderLoadError(err);
      renderPermission();
    });
  }

  function unmount() {
    mountToken++; // 使在途异步结果失效
    if (rootEl) clear(rootEl);
    rootEl = null;
  }

  // 仅暴露契约要求的接口
  return { mount: mount, unmount: unmount };
})();
