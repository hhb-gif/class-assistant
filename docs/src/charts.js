// charts.js —— ECharts 封装 + 无 echarts（CDN 失败）时的 CSS 降级
// 依赖：全局 window.echarts（可选）；本模块零依赖，echarts 缺失时渲染 CSS 条形图/表格
// 配色对齐 DESIGN.md 第 9 节：主序列 --primary(#0d9488)、对比 --info/--warn、网格 #eef2f6
window.CA = window.CA || {};
CA.charts = (function () {
  "use strict";

  // ---------- 图表色板（与 DESIGN.md 设计 token 对齐；ECharts 需要字面量颜色） ----------
  const P = {
    primary: "#0d9488",       // --primary
    primaryLight: "#5eead4",  // 主色浅（面积渐变）
    info: "#0284c7",          // --info
    warn: "#d97706",          // --warn
    success: "#16a34a",       // --success
    danger: "#dc2626",        // --danger
    grid: "#eef2f6",          // 网格线（极淡）
    axisLine: "#e2e8f0",      // 轴线
    axisText: "#94a3b8",      // 轴文字（--text-3）
    text: "#0f172a",          // --text
    surface: "#ffffff",       // tooltip 底
    border: "#e2e8f0"         // --border
  };

  // 图表实例缓存：el -> { el, inst }，重复调用同一容器先 dispose
  const instances = [];
  // resize 单例监听标志，避免重复绑定
  let resizeBound = false;

  // HTML 转义（防 XSS）
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function round1(v) {
    const n = Number(v);
    return isFinite(n) ? Math.round(n * 10) / 10 : 0;
  }

  // echarts 全局是否可用
  function available() {
    return !!(typeof window !== "undefined" && window.echarts &&
      typeof window.echarts.init === "function");
  }

  // ---------- ECharts 通用样式片段 ----------
  function tooltipStyle(trigger, pointer) {
    return {
      trigger: trigger || "axis",
      axisPointer: pointer ? { type: pointer } : undefined,
      backgroundColor: P.surface,
      borderColor: P.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: P.text, fontSize: 12 },
      extraCssText: "border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.12);"
    };
  }

  function axisLabel() {
    return { color: P.axisText, fontSize: 12 };
  }

  function splitLine() {
    return { lineStyle: { color: P.grid } };
  }

  function axisLine() {
    return { lineStyle: { color: P.axisLine } };
  }

  // ---------- resize 自适应（单例） ----------
  function onResize() {
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i].inst;
      if (inst && typeof inst.resize === "function") {
        try { inst.resize(); } catch (e) { /* 忽略单实例 resize 异常 */ }
      }
    }
  }

  function bindResize() {
    if (resizeBound) return;
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    window.addEventListener("resize", onResize);
    resizeBound = true;
  }

  function unbindResize() {
    if (!resizeBound) return;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("resize", onResize);
    }
    resizeBound = false;
  }

  // 销毁指定容器上的旧实例（重复调用同一 el 时先清理）
  function disposeEl(el) {
    for (let i = instances.length - 1; i >= 0; i--) {
      if (instances[i].el === el) {
        try {
          const inst = instances[i].inst;
          if (inst && typeof inst.dispose === "function") inst.dispose();
        } catch (e) { /* 忽略 */ }
        instances.splice(i, 1);
      }
    }
  }

  // 通用渲染入口：优先 echarts；不可用/初始化失败则走 fallbackRenderer
  function render(el, option, fallbackRenderer) {
    if (!el) return null;
    disposeEl(el);
    el.innerHTML = ""; // 清空旧内容（含降级内容）
    if (available()) {
      bindResize();
      let inst = null;
      try {
        inst = window.echarts.init(el);
      } catch (e) {
        inst = null;
      }
      if (inst) {
        try {
          inst.setOption(option);
          instances.push({ el: el, inst: inst });
          return inst;
        } catch (e) {
          try { inst.dispose && inst.dispose(); } catch (e2) { /* 忽略 */ }
        }
      }
    }
    if (typeof fallbackRenderer === "function") fallbackRenderer(el);
    return null;
  }

  // ---------- 降级渲染（使用 styles.css 的 .bar-* 设计类，主色 + 数值标签） ----------
  function emptyHtml(title, desc) {
    return '<div class="empty">' +
      '<div class="empty-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/>' +
      '<rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="5" width="3" height="13" rx="1"/></svg>' +
      "</div>" +
      '<div class="empty-title">' + esc(title || "暂无数据") + "</div>" +
      (desc ? '<p class="empty-desc">' + esc(desc) + "</p>" : "") +
      "</div>";
  }

  // 条形图降级：mode = "count"（按最大值归一）或 "percent"（按满分归一，显示百分比）
  function fallbackBars(el, items, mode) {
    const list = items || [];
    if (!list.length) {
      el.innerHTML = emptyHtml("暂无图表数据", "录入成绩后即可查看分布与对比。");
      return;
    }
    const denom = Math.max.apply(null, list.map(function (it) {
      return mode === "percent" ? (it.full || 100) : (it.value || 0);
    }).concat([1]));
    let html = '<div class="bar-chart">';
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const raw = Number(it.value) || 0;
      const pct = denom > 0 ? Math.max(0, Math.min(100, raw / denom * 100)) : 0;
      let valText;
      if (mode === "percent") {
        const full = it.full || 100;
        valText = round1(raw) + " / " + full + "（" + Math.round(full ? raw / full * 100 : 0) + "%）";
      } else {
        valText = String(raw);
      }
      html += '<div class="bar-row">' +
        '<span class="bar-label" title="' + esc(it.label) + '">' + esc(it.label) + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
        '<span class="bar-value">' + esc(valText) + "</span></div>";
    }
    html += "</div>";
    el.innerHTML = html;
  }

  // 折线图降级：渲染为表格（行 = 类别，列 = 系列）
  function fallbackTable(el, categories, series) {
    const cats = categories || [];
    const ss = series || [];
    if (!cats.length) {
      el.innerHTML = emptyHtml("暂无图表数据", "录入成绩后即可查看历次趋势。");
      return;
    }
    let html = '<div class="table-wrap"><table class="table table-compact"><thead><tr><th>项目</th>';
    for (let i = 0; i < ss.length; i++) html += '<th class="num">' + esc(ss[i].name) + "</th>";
    html += "</tr></thead><tbody>";
    for (let r = 0; r < cats.length; r++) {
      html += "<tr><td>" + esc(cats[r]) + "</td>";
      for (let c = 0; c < ss.length; c++) {
        const v = (ss[c].data || [])[r];
        html += '<td class="num">' + (v == null || v === "" ? "—" : esc(round1(v))) + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table></div>";
    el.innerHTML = html;
  }

  // ---------- 对外图表 ----------

  // 分数段分布柱状图（单序列：主色，显示数值标签）
  function distribution(el, opts) {
    opts = opts || {};
    const labels = opts.labels || [];
    const counts = opts.counts || [];
    return render(el, {
      tooltip: tooltipStyle("axis", "shadow"),
      grid: { left: 8, right: 16, top: 24, bottom: 4, containLabel: true },
      xAxis: {
        type: "category", data: labels,
        axisLabel: axisLabel(), axisLine: axisLine(), axisTick: { show: false }
      },
      yAxis: {
        type: "value", minInterval: 1,
        axisLabel: axisLabel(), splitLine: splitLine(), axisLine: { show: false }
      },
      series: [{
        type: "bar", data: counts, barMaxWidth: 42,
        itemStyle: { color: P.primary, borderRadius: [6, 6, 0, 0] },
        label: { show: true, position: "top", color: P.text, fontSize: 11 }
      }]
    }, function (fb) {
      fallbackBars(fb, labels.map(function (l, i) { return { label: l, value: counts[i] || 0 }; }), "count");
    });
  }

  // 历次趋势折线图（多序列显示图例；单序列隐藏图例并加主色面积）
  function trend(el, opts) {
    opts = opts || {};
    const colors = [P.primary, P.info, P.warn, P.success];
    const rawSeries = opts.series || [];
    const multi = rawSeries.length > 1;
    const series = rawSeries.map(function (s, i) {
      const color = colors[i % colors.length];
      const item = {
        name: s.name, type: "line", smooth: true, connectNulls: true, data: s.data || [],
        symbol: "circle", symbolSize: 7,
        lineStyle: { width: 2.5, color: color },
        itemStyle: { color: color }
      };
      if (!multi) {
        item.areaStyle = {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: "rgba(13,148,136,.22)" }, { offset: 1, color: "rgba(13,148,136,0)" }]
          }
        };
      }
      return item;
    });
    return render(el, {
      tooltip: tooltipStyle("axis", "line"),
      legend: multi
        ? { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: P.axisText, fontSize: 12 } }
        : { show: false },
      grid: { left: 8, right: 16, top: 16, bottom: multi ? 36 : 8, containLabel: true },
      xAxis: {
        type: "category", data: opts.categories || [], boundaryGap: false,
        axisLabel: axisLabel(), axisLine: axisLine(), axisTick: { show: false }
      },
      yAxis: {
        type: "value", scale: true,
        axisLabel: axisLabel(), splitLine: splitLine(), axisLine: { show: false }
      },
      series: series
    }, function (fb) {
      fallbackTable(fb, opts.categories || [], opts.series || []);
    });
  }

  // 科目均分对比柱状图（单序列主色 + 满分参考线，tooltip 显示百分比）
  function subjectCompare(el, opts) {
    opts = opts || {};
    const subjects = opts.subjects || [];
    const averages = opts.averages || [];
    const fullScores = opts.fullScores || [];
    let maxFull = 0;
    for (let i = 0; i < fullScores.length; i++) {
      const f = Number(fullScores[i]) || 0;
      if (f > maxFull) maxFull = f;
    }
    const data = subjects.map(function (s, i) { return round1(averages[i] || 0); });
    const option = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: P.surface,
        borderColor: P.border,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: P.text, fontSize: 12 },
        extraCssText: "border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.12);",
        formatter: function (params) {
          const p = params && params[0];
          if (!p) return "";
          const i = p.dataIndex;
          const full = Number(fullScores[i]) || 100;
          const avg = Number(averages[i]) || 0;
          return esc(p.name) + "<br/>均分 " + round1(avg) + " / " + full +
            "（" + Math.round(full ? avg / full * 100 : 0) + "%）";
        }
      },
      grid: { left: 8, right: 16, top: 24, bottom: 4, containLabel: true },
      xAxis: {
        type: "category", data: subjects,
        axisLabel: axisLabel(), axisLine: axisLine(), axisTick: { show: false }
      },
      yAxis: {
        type: "value",
        axisLabel: axisLabel(), splitLine: splitLine(), axisLine: { show: false }
      },
      series: [{
        type: "bar", data: data, barMaxWidth: 46,
        itemStyle: { color: P.primary, borderRadius: [6, 6, 0, 0] },
        label: { show: true, position: "top", color: P.text, fontSize: 11 }
      }]
    };
    if (maxFull > 0) {
      option.series[0].markLine = {
        silent: true,
        symbol: "none",
        lineStyle: { type: "dashed", color: P.warn },
        data: [{ yAxis: maxFull, label: { formatter: "满分 " + maxFull, position: "end", color: P.warn } }]
      };
    }
    return render(el, option, function (fb) {
      fallbackBars(fb, subjects.map(function (s, i) {
        return { label: s, value: averages[i] || 0, full: fullScores[i] || 100 };
      }), "percent");
    });
  }

  // 清理全部实例（unmount 时调用）
  function disposeAll() {
    while (instances.length) {
      const it = instances.pop();
      try { it.inst && typeof it.inst.dispose === "function" && it.inst.dispose(); } catch (e) { /* 忽略 */ }
    }
    unbindResize();
  }

  return {
    available: available,
    distribution: distribution,
    trend: trend,
    subjectCompare: subjectCompare,
    disposeAll: disposeAll,
  };
})();
