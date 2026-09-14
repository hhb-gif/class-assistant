// 班级管家 · 图标系统（内联 SVG · Lucide 风格线性图标）
// 契约：DESIGN.md 第 5 节。暴露：
//   CA.icon(name, size)  -> string       返回 <svg> 字符串
//   CA.iconEl(name, size) -> SVGElement  返回真实 SVG 元素
// 另提供 CA.icons.hydrate(root)：在不改动业务模块的前提下，把导航/附件/收藏中的
// 图标补成内联 SVG（消除 emoji 当图标的评审项）。
window.CA = window.CA || {};

CA.icons = (function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var SW = 1.75; // 统一描边粗细

  // 全部图标（stroke 线性风格，viewBox 24×24）
  var PATHS = {
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-8"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    star: '<path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z"/>',
    "star-filled": '<path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    "map-pin": '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
    "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
    sparkles: '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 14.5l.75 1.75L21.5 17l-1.75.75L19 19.5l-.75-1.75L16.5 17l1.75-.75L19 14.5z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    "trend-up": '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    "trend-down": '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
  };

  // 需要填充（而非描边）的图标
  var FILLED = { "star-filled": true };
  // 未知图标名的占位方框
  var FALLBACK = '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>';

  // 组装 <svg> 的 presentation 属性字符串
  function attrs(size, filled) {
    var a = 'viewBox="0 0 24 24" fill="' + (filled ? "currentColor" : "none") +
      '" stroke="currentColor" stroke-width="' + SW +
      '" stroke-linecap="round" stroke-linejoin="round"';
    if (size) a += ' style="width:' + size + 'px;height:' + size + 'px"';
    return a;
  }

  // 字符串形式：CA.icon("bell", 20)
  function icon(name, size) {
    var body = PATHS[name] || FALLBACK;
    return '<svg class="icon" aria-hidden="true" ' + attrs(size, !!FILLED[name]) + '>' + body + "</svg>";
  }

  // 元素形式：CA.iconEl("bell", 20)
  function iconEl(name, size) {
    if (typeof document === "undefined") return null;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", FILLED[name] ? "currentColor" : "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", String(SW));
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (size) {
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.style.width = size + "px";
      svg.style.height = size + "px";
    }
    svg.innerHTML = PATHS[name] || FALLBACK;
    return svg;
  }

  // ---------------- 运行时图标补全（不改业务模块） ----------------
  // 导航图标映射
  var NAV = { notices: "bell", scores: "chart", collect: "clipboard", review: "book", settings: "settings" };

  // 给 #tabbar 的 nav-item 补图标（文本包进 .nav-label）
  function hydrateNav() {
    if (!document || !document.querySelectorAll) return;
    var items = document.querySelectorAll("#tabbar .nav-item");
    Array.prototype.forEach.call(items, function (item) {
      if (item.getAttribute("data-ca-nav")) return;
      var name = NAV[item.getAttribute("data-view")];
      if (!name) return;
      var text = (item.textContent || "").trim();
      item.textContent = "";
      var ic = iconEl(name, 20);
      if (ic) { ic.classList.add("nav-icon"); item.appendChild(ic); }
      var label = document.createElement("span");
      label.className = "nav-label";
      label.textContent = text;
      item.appendChild(label);
      item.setAttribute("data-ca-nav", "1");
    });
  }

  // 把附件/收藏里的 emoji 替换为内联 SVG
  function hydrateGlyphs(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll(".att-icon"), function (el) {
      if (el.getAttribute("data-ca-glyph")) return;
      if (el.textContent && el.textContent.indexOf("\uD83D\uDCCE") >= 0) {
        el.textContent = "";
        var ic = iconEl("paperclip", 13);
        if (ic) el.appendChild(ic);
        el.setAttribute("data-ca-glyph", "1");
      }
    });
    Array.prototype.forEach.call(root.querySelectorAll(".fav-star"), function (el) {
      if (el.getAttribute("data-ca-glyph")) return;
      var t = el.textContent || "";
      var name = t.indexOf("\u2605") >= 0 ? "star-filled" : "star";
      el.textContent = "";
      var ic = iconEl(name, 15);
      if (ic) el.appendChild(ic);
      el.setAttribute("data-ca-glyph", "1");
    });
  }

  function hydrate(root) {
    try {
      hydrateNav();
      hydrateGlyphs(root || document);
    } catch (e) { /* 图标补全失败不影响功能 */ }
  }

  function boot() {
    hydrate(document);
    if (typeof MutationObserver !== "undefined" && document.body) {
      var pending = false;
      var obs = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        var run = function () { pending = false; hydrate(document); };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
        else setTimeout(run, 16);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); });
    } else {
      setTimeout(boot, 0);
    }
  }

  return {
    icon: icon,
    el: iconEl,
    hydrate: hydrate,
    has: function (name) { return Object.prototype.hasOwnProperty.call(PATHS, name); }
  };
})();

// 契约要求的顶层接口
CA.icon = CA.icons.icon;
CA.iconEl = CA.icons.el;
