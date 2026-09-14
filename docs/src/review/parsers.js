// 多格式解析 → 结构化章节树（1:1 复刻 Python 版规则与修复经验）
window.RH = window.RH || {};

RH.parsers = (function () {
  const _CLAUSE_RE = /^第\s*[一二三四五六七八九十百千零〇0-9]+\s*条/;
  const _CHAPTER_RE = /^第\s*[一二三四五六七八九十百千零〇0-9]+\s*[章节篇]/;
  const _NO_TITLE_ENDING = ["。", "，", "、", "；", "：", "!", "?", "?", ";"];
  const _FORMULA_CHARS = ["=", "Σ", "∑", "≥", "≤", "√", "%", "×", "÷"];
  const _LIST_MARKERS = ["•", "·", "●", "○", "■", "□", "►", "➢", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

  function isListItem(text) {
    if (_LIST_MARKERS.some(m => text.startsWith(m))) return true;
    if (text.length > 2 && /[0-9]/.test(text[0]) && ["、", ". "].includes(text.slice(1, 3)) || /^[0-9]\.\s/.test(text) || /^[0-9]+[、.．]\s?/.test(text)) return true;
    return false;
  }

  const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";

  function pdfDocOptions(data) {
    const isNode = typeof window === "undefined" || !window.document || typeof process !== "undefined" && process.versions && process.versions.node && typeof document === "undefined";
    if (isNode) {
      const path = require("path");
      const base = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "..");
      return {
        data,
        cMapUrl: path.join(base, "pdfjs-dist", "cmaps") + path.sep,
        cMapPacked: true,
        standardFontDataUrl: path.join(base, "pdfjs-dist", "standard_fonts") + path.sep,
      };
    }
    return {
      data,
      cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/",
    };
  }

  // ---------- PDF ----------
  async function parsePdf(arrayBuffer, fallbackTitle) {
    const pdf = await pdfjsLib.getDocument(pdfDocOptions(arrayBuffer)).promise;
    const allLines = [];  // {text, size, isTable}
    let scannedPages = 0, totalPages = 0;

    // 双栏检测：x 直方图找中央空白带（学术文献/双栏讲义）
    function detectColumns(items, pageW) {
      if (items.length < 20) return [items];
      const BINS = 50;
      const bins = new Array(BINS).fill(0);
      for (const it of items) {
        const b = Math.floor(it.x / pageW * BINS);
        if (b >= 0 && b < BINS) bins[b]++;
      }
      let bestGap = 0, bestStart = -1, run = 0, runStart = 0;
      for (let b = Math.floor(BINS * 0.15); b < Math.floor(BINS * 0.85); b++) {
        if (bins[b] === 0) {
          if (run === 0) runStart = b;
          run++;
          if (run > bestGap) { bestGap = run; bestStart = runStart; }
        } else run = 0;
      }
      if (bestGap >= 3) {  // 空白带 ≥ 6% 页宽
        const splitX = (bestStart + bestGap / 2) / BINS * pageW;
        const left = items.filter(i => i.x < splitX);
        const right = items.filter(i => i.x >= splitX);
        if (left.length > items.length * 0.15 && right.length > items.length * 0.15) return [left, right];
      }
      return [items];
    }

    // 栏内处理：y 聚类成行 → 列锚点 → 行分类
    function processColumnItems(items, allLines) {
      items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
      const rows = [];
      let cur = null;
      for (const it of items) {
        if (cur && Math.abs(it.y - cur.y) <= Math.max(it.size, cur.size) * 0.45) {
          cur.items.push(it);
          cur.size = Math.max(cur.size, it.size);
        } else {
          cur = { y: it.y, size: it.size, items: [it] };
          rows.push(cur);
        }
      }

      // 列锚点检测（栏级）：x 高频簇，间距 <12pt 的锚点合并
      const colHits = {};
      for (const it of items) {
        const key = Math.round(it.x / 3);
        colHits[key] = (colHits[key] || 0) + 1;
      }
      const anchors = Object.entries(colHits)
        .filter(([, n]) => n >= 3)
        .map(([k]) => parseFloat(k) * 3)
        .sort((a, b) => a - b);
      const colAnchors = [];
      for (const a of anchors) {
        if (!colAnchors.length || a - colAnchors[colAnchors.length - 1] > 12) colAnchors.push(a);
      }
      const hasTable = colAnchors.length >= 2;

      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        const plainText = row.items.map(i => i.text).join("").replace(/\s+/g, " ").trim();
        // 条款行 / 超长列 → 永远是普通行（防"第X条"被表格化拆散）
        const isClause = _CLAUSE_RE.test(plainText);
        if (hasTable && !isClause) {
          const cols = colAnchors.map(() => "");
          let hitCount = 0;
          for (const it of row.items) {
            let nearest = -1, nd = 1e9;
            for (let i = 0; i < colAnchors.length; i++) {
              const d = Math.abs(it.x - colAnchors[i]);
              if (d < nd) { nd = d; nearest = i; }
            }
            if (nearest >= 0) {
              if (nd <= 6 + it.size * 0.5) hitCount++;
              cols[nearest] += it.text;
            }
          }
          const parts = cols.map(c => c.replace(/\s+/g, " ").trim());
          const filled = parts.filter(Boolean);
          // 表格行特征：多列短值且不含句读标点（含逗号/句号的是被拆开的正文）
          const cellOk = c => c.length <= 25 && !/[，,。；！？]/.test(c);
          const isTable = filled.length >= 3
            ? filled.every(cellOk)
            : filled.length === 2 && filled.every(c => c.length <= 10 && !/[，,。；！？]/.test(c));
          if (hitCount >= 2 && isTable) {
            allLines.push({ text: filled.join(" | "), size: row.size, isTable: true });
            continue;
          }
        }
        if (plainText) allLines.push({ text: plainText, size: row.size, isTable: false });
      }
    }

    for (let pn = 1; pn <= pdf.numPages; pn++) {
      totalPages = pdf.numPages;
      const page = await pdf.getPage(pn);
      const content = await page.getTextContent();

      // 收集带坐标的 items
      const items = [];
      for (const it of content.items) {
        if (typeof it.str !== "string" || !it.str.trim()) continue;
        items.push({
          text: it.str,
          x: it.transform ? it.transform[4] : 0,
          y: it.transform ? it.transform[5] : 0,
          size: it.transform ? Math.abs(it.transform[3]) || 10 : 10,
        });
      }

      const totalChars = items.reduce((a, i) => a + i.text.length, 0);
      if (totalChars < 20) { scannedPages++; continue; }

      // 双栏检测 → 每栏独立处理（先左栏后右栏，还原阅读顺序）
      const pageW = page.getViewport({ scale: 1 }).width;
      const columns = detectColumns(items, pageW);
      for (const colItems of columns) processColumnItems(colItems, allLines);
    }

    if (!allLines.length) {
      // 全文档无文本层
      if (typeof document !== "undefined" && scannedPages === totalPages && totalPages > 0) {
        return await ocrScanPdf(pdf, fallbackTitle, totalPages, undefined);
      }
      return RH.ParsedDocument(fallbackTitle, []);
    }

    // 字号众数（行级）
    const sizeCount = {};
    for (const l of allLines) sizeCount[l.size] = (sizeCount[l.size] || 0) + 1;
    let bodySize = 10, bestN = -1;
    for (const [size, n] of Object.entries(sizeCount)) {
      if (n > bestN || (n === bestN && parseFloat(size) < bodySize)) { bodySize = parseFloat(size); bestN = n; }
    }

    const sections = [];
    let current = RH.Section("导言", 1);
    let docTitle = null;

    function pushParagraph(text) {
      if (!text) return;
      const last = current.blocks[current.blocks.length - 1];
      if (last && !isListItem(text) && !isListItem(last) && !text.includes(" | ") && !last.includes(" | ") &&
          !/[。！？；:：]$/.test(last) && last.length > 15) {
        current.blocks[current.blocks.length - 1] = last + text;
      } else {
        current.blocks.push(text);
      }
    }

    for (const line of allLines) {
      const { text, size, isTable } = line;
      if (isTable) { pushParagraph(text); continue; }
      let isTitle = false, level = 1;
      if (_CLAUSE_RE.test(text)) {
        isTitle = false;
      } else if (_CHAPTER_RE.test(text) && text.length < 40) {
        isTitle = true; level = 1;
      } else if (text.length < 40 && !_NO_TITLE_ENDING.some(e => text.endsWith(e))) {
        const hasFormula = _FORMULA_CHARS.some(c => text.includes(c));
        if (size > bodySize * 1.18 && !hasFormula) { isTitle = true; level = 1; }
      }
      if (isTitle) {
        if (docTitle === null && sections.length === 0 && current.blocks.length === 0 && allLines.length > 2) {
          docTitle = text;
          current = RH.Section(text, 1);
          sections.push(current);
        } else {
          current = RH.Section(text, level);
          sections.push(current);
        }
        continue;
      }
      if (size > bodySize * 1.18 && text.length < 40 && !_NO_TITLE_ENDING.some(e => text.endsWith(e)) && !_FORMULA_CHARS.some(c => text.includes(c))) {
        current = RH.Section(text, 1);
        sections.push(current);
      } else {
        pushParagraph(text);
      }
    }

    if (current.blocks.length && (!sections.length || sections[sections.length - 1] !== current)) sections.push(current);
    let filtered = sections.filter(s => s.blocks.length || s.title !== "导言");
    if (!filtered.length) filtered = [RH.Section("全文", 1, allLines.map(l => l.text))];
    const doc = RH.ParsedDocument(docTitle || fallbackTitle, filtered);
    doc.scannedPages = scannedPages;
    return doc;
  }

  // ---------- OCR（浏览器端） ----------
  let _tessPromise = null;
  function loadTesseract() {
    if (_tessPromise) return _tessPromise;
    _tessPromise = (async () => {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        s.onload = res; s.onerror = () => rej(new Error("tesseract.js 加载失败"));
        document.head.appendChild(s);
      });
      return window.Tesseract;
    })();
    return _tessPromise;
  }

  // worker 会话级单例：首次创建后常驻复用（扫描 PDF 每页重建 worker 是速度慢的主因）
  // 进度回调通过模块级可变引用转发（logger 在创建时固定，无法逐次更换）
  let _ocrWorker = null;
  let _ocrWorkerPromise = null;
  let _ocrLogger = () => {};

  async function getOcrWorker() {
    if (_ocrWorker) return _ocrWorker;
    if (!_ocrWorkerPromise) {
      _ocrWorkerPromise = (async () => {
        const T = await loadTesseract();
        const w = await T.createWorker("chi_sim", 1, {
          oem: 1,   // LSTM only（第二个参数同值，opts 内显式声明兜底）
          langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0",
          logger: m => _ocrLogger(m),
        });
        // PSM 6（SINGLE_BLOCK）：整页文本块模式，对文档类图片比 AUTO 稳
        try { await w.setParameters({ tessedit_pageseg_mode: "6" }); } catch (e) { console.warn("[ocr] setParameters 失败，用默认 PSM:", e && e.message); }
        return w;
      })();
      _ocrWorkerPromise.then(w => { _ocrWorker = w; }).catch(() => { _ocrWorkerPromise = null; });
    }
    return _ocrWorkerPromise;
  }

  // 灰度化 + Sauvola 局部阈值二值化（楷体细笔画友好）+ 孤立噪点清除；失败/异常退回全局 Otsu
  function binarizeCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const n = d.length / 4;
    const gray = new Uint8Array(n);
    const hist = new Array(256).fill(0);
    for (let i = 0; i < n; i++) {
      const g = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
      gray[i] = g; hist[g]++;
    }
    try {
      const bitmap = sauvolaBitmap(gray, canvas.width, canvas.height);
      const black = bitmap.reduce((a, v) => a + (v === 0 ? 1 : 0), 0);
      const ratio = black / n;
      // 全黑/全白（黑白占比 >99.5% 或 <0.5%）视为 Sauvola 失效 → 回退 Otsu
      if (ratio > 0.995 || ratio < 0.005) throw new Error("sauvola 退化");
      despeckle(bitmap, canvas.width, canvas.height);
      for (let i = 0; i < n; i++) {
        const v = bitmap[i];
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
    } catch (e) {
      otsuWrite(d, gray, hist, n);
    }
    ctx.putImageData(img, 0, 0);
  }

  // 全局 Otsu 阈值直接写回像素（回退路径）
  function otsuWrite(d, gray, hist, n) {
    const total = n;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = -1, threshold = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; threshold = t; }
    }
    for (let i = 0; i < n; i++) {
      const v = gray[i] > threshold ? 255 : 0;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
  }

  // Sauvola 局部阈值：t = mean * (1 + k * (std/128 - 1))，积分图实现 O(n)
  function sauvolaBitmap(gray, w, h) {
    const WIN = 25, K = 0.25;
    const iw = w + 1, ih = h + 1;
    // 前缀和：sum 用 Uint32（最大 255*10.24M < 2^32），sumsq 用 Float64（保证方差精度）
    const sum = new Uint32Array(iw * ih);
    const sumsq = new Float64Array(iw * ih);
    for (let y = 0; y < h; y++) {
      let rowSum = 0, rowSumsq = 0;
      const off = (y + 1) * iw, prevOff = y * iw;
      for (let x = 0; x < w; x++) {
        const g = gray[y * w + x];
        rowSum += g; rowSumsq += g * g;
        sum[off + x + 1] = sum[prevOff + x + 1] + rowSum;
        sumsq[off + x + 1] = sumsq[prevOff + x + 1] + rowSumsq;
      }
    }
    const bitmap = new Uint8Array(w * h);
    const r = WIN >> 1;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const area = (y1 - y0 + 1) * (x1 - x0 + 1);
        const a = y0 * iw, b = (y1 + 1) * iw;
        const s = sum[b + x1 + 1] - sum[a + x1 + 1] - sum[b + x0] + sum[a + x0];
        const sq = sumsq[b + x1 + 1] - sumsq[a + x1 + 1] - sumsq[b + x0] + sumsq[a + x0];
        const mean = s / area;
        const vari = sq / area - mean * mean;
        const std = vari > 0 ? Math.sqrt(vari) : 0;
        const t = mean * (1 + K * (std / 128 - 1));
        bitmap[y * w + x] = gray[y * w + x] > t ? 255 : 0;
      }
    }
    return bitmap;
  }

  // 3x3 中值式降噪（简化）：黑像素若 8 邻域黑数 ≤1 视为孤立椒点 → 置白
  function despeckle(bitmap, w, h) {
    const src = bitmap.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (src[y * w + x] !== 0) continue;
        let nb = 0;
        for (let dy = -1; dy <= 1 && nb <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            if (src[yy * w + xx] === 0) { nb++; if (nb > 1) break; }
          }
        }
        if (nb <= 1) bitmap[y * w + x] = 255;
      }
    }
  }

  async function ocrOneImage(source, onProgress) {
    _ocrLogger = m => { if (onProgress && m.status && m.progress != null) onProgress(m.status, m.progress); };
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(source);
    return (data.text || "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n");
  }

  async function ocrScanPdf(pdf, fallbackTitle, totalPages, onProgress) {
    const sections = [];
    for (let pn = 1; pn <= totalPages; pn++) {
      const page = await pdf.getPage(pn);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      binarizeCanvas(canvas);
      if (onProgress) onProgress(`OCR 第 ${pn}/${totalPages} 页`, pn / totalPages);
      let text = "";
      try {
        text = await ocrOneImage(canvas, (status, p) => {
          if (onProgress) onProgress(`OCR 识别中 (${status} ${Math.round(p * 100)}%)`, (pn - 1 + p) / totalPages);
        });
      } catch (e) { /* 单页失败继续 */ }
      const blocks = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (blocks.length) sections.push(RH.Section(`第${pn}页（OCR）`, 1, blocks));
    }
    if (!sections.length) throw new Error("扫描件 OCR 失败或无内容");
    const doc = RH.ParsedDocument(fallbackTitle, sections);
    doc.scannedPages = totalPages;
    doc.ocr = true;
    return doc;
  }

  async function parseImage(file, fallbackTitle, onProgress) {
    if (typeof document === "undefined") throw new Error("图片 OCR 需在浏览器中使用");
    const bmp = await createImageBitmap(file);
    // 楷体小字错字率高的主因是分辨率不足：放大上限 2000→3200，比例 2→3.5
    const scale = Math.min(3.5, 3200 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    binarizeCanvas(canvas);
    if (onProgress) onProgress("OCR 识别中", 0.1);
    const text = await ocrOneImage(canvas, (status, p) => {
      if (onProgress) onProgress(`OCR 识别中 (${status} ${Math.round(p * 100)}%)`, 0.1 + p * 0.9);
    });
    const blocks = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!blocks.length) throw new Error("OCR 未识别出文字");
    const doc = RH.ParsedDocument(fallbackTitle || "图片内容", [RH.Section("全文（OCR）", 1, blocks)]);
    doc.ocr = true;
    return doc;
  }

  // ---------- DOCX ----------
  async function parseDocx(arrayBuffer, fallbackTitle) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xmlText = await zip.file("word/document.xml").async("text");
    const dom = new DOMParser().parseFromString(xmlText, "application/xml");

    const sections = [];
    let current = RH.Section("导言", 1);
    let docTitle = null;
    let insideTbl = false;

    function paraOf(el) {
      // 段落文本与样式
      let style = "";
      const ps = el.getElementsByTagName("w:pStyle");
      if (ps.length) style = ps[0].getAttribute("w:val") || "";
      let text = "";
      const ts = el.getElementsByTagName("w:t");
      for (const t of ts) text += t.textContent || "";
      return { text: text.trim(), style };
    }

    const walk = (node) => {
      for (const child of node.children) {
        const tag = child.tagName;
        if (tag === "w:p") {
          if (insideTbl) continue; // 表格内段落由表格逻辑处理
          const { text, style } = paraOf(child);
          if (!text) continue;
          const sl = (style || "").toLowerCase();
          if (sl.startsWith("heading") || sl.startsWith("标题")) {
            const num = (style.match(/\d+/) || [])[0];
            const level = num ? parseInt(num, 10) : 1;
            if (docTitle === null && level <= 1 && sections.length === 0 && current.blocks.length === 0) docTitle = text;
            current = RH.Section(text, level);
            sections.push(current);
          } else {
            current.blocks.push(text);
          }
        } else if (tag === "w:tbl") {
          insideTbl = true;
          const rows = [];
          for (const tr of child.getElementsByTagName("w:tr")) {
            const cells = [];
            for (const tc of tr.getElementsByTagName("w:tc")) {
              const ts = tc.getElementsByTagName("w:t");
              let t = "";
              for (const x of ts) t += x.textContent || "";
              t = t.trim();
              if (t) cells.push(t);
            }
            if (cells.length) rows.push(cells.join(" | "));
          }
          if (rows.length) current.blocks.push(...rows);
          insideTbl = false;
        } else if (child.children && child.children.length) {
          walk(child);
        }
      }
    };
    walk(dom.documentElement);

    if (current.blocks.length && (!sections.length || sections[sections.length - 1] !== current)) sections.push(current);
    let filtered = sections.filter(s => s.blocks.length || s.title !== "导言");
    if (!filtered.length) {
      const all = [];
      for (const t of dom.getElementsByTagName("w:t")) all.push(t.textContent || "");
      filtered = [RH.Section("全文", 1, [all.join("").trim()])];
    }
    return RH.ParsedDocument(docTitle || fallbackTitle, filtered);
  }

  // ---------- PPTX ----------
  async function parsePptx(arrayBuffer, fallbackTitle) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slideFiles = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/slide(\d+)/)[1], 10) - parseInt(b.match(/slide(\d+)/)[1], 10));

    const sections = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const xmlText = await zip.file(slideFiles[i]).async("text");
      const dom = new DOMParser().parseFromString(xmlText, "application/xml");
      let title = null;
      const body = [];
      for (const sp of dom.getElementsByTagName("p:sp")) {
        // 占位符类型
        let isTitleShape = false;
        const phs = sp.getElementsByTagName("p:ph");
        if (phs.length) {
          const t = phs[0].getAttribute("type") || "";
          isTitleShape = (t === "title" || t === "ctrTitle");
        }
        const paras = [];
        for (const p of sp.getElementsByTagName("a:p")) {
          let t = "";
          // run 级解析：还原上标/下标（静电学公式 "10⁻¹⁹"、"Nm²" 等）
          const runs = p.getElementsByTagName("a:r");
          if (runs.length) {
            for (const r of runs) {
              const rPr = r.getElementsByTagName("a:rPr")[0];
              const baseline = rPr ? (parseInt(rPr.getAttribute("baseline") || "0", 10) || 0) : 0;
              let rt = "";
              for (const ts of r.getElementsByTagName("a:t")) rt += ts.textContent || "";
              if (!rt) continue;
              if (baseline > 500) rt = RH.RULES.toScript(rt, RH.RULES.SUP_MAP);
              else if (baseline < -500) rt = RH.RULES.toScript(rt, RH.RULES.SUB_MAP);
              t += rt;
            }
          }
          if (!t) {
            for (const ts of p.getElementsByTagName("a:t")) t += ts.textContent || "";
          }
          t = t.trim();
          if (!t) continue;
          // 层级与列表标记（rich 结构用）
          const lvl = parseInt(p.getAttribute("lvl") || "0", 10) || 0;
          const hasBullet = p.getElementsByTagName("a:buChar").length > 0 || p.getElementsByTagName("a:buAutoNum").length > 0;
          const k = hasBullet || lvl > 0 ? "bullet" : "para";
          paras.push({ text: t, lvl, k });
        }
        if (!paras.length) continue;
        if (isTitleShape || title === null) {
          title = paras[0].text;
          body.push(...paras.slice(1));
        } else {
          body.push(...paras);
        }
      }
      if (title === null) title = `第${i + 1}页`;
      // 公式对象（OMML）：独立收集数学文本，避免 ε、Σ 等公式内容丢失
      const mathTexts = [];
      for (const om of dom.getElementsByTagName("m:oMath")) {
        let mt = "";
        for (const t of om.getElementsByTagName("m:t")) mt += t.textContent || "";
        mt = mt.trim();
        if (mt) mathTexts.push(mt);
      }
      // 过滤与标题重复的导航行、QQ群号等噪声（物理课件常见结构）
      const cleaned = body.filter(b => {
        const bt = b.text.replace(/\s+/g, "");
        if (!bt) return false;
        if (title && bt === title.replace(/\s+/g, "")) return false;
        if (/QQ群|微信群号/.test(bt)) return false;
        return true;
      });
      if (mathTexts.length) for (const mt of mathTexts) cleaned.push({ text: mt, lvl: 0, k: "formula" });
      if (cleaned.length) {
        const sec = RH.Section(title, 1, cleaned.map(b => b.text));
        sec.rich = cleaned.map(b => ({ t: b.text, k: b.k || (b.lvl > 0 ? "bullet" : "para"), lvl: b.lvl || 0 }));
        sections.push(sec);
      }
    }
    // 跨页断句合并：上一页末行以接续标点结尾（句子未完）→ 并入下一页首行
    for (let i = 0; i < sections.length - 1; i++) {
      const prev = sections[i], cur = sections[i + 1];
      if (!prev.blocks.length || !cur.blocks.length) continue;
      const lastB = prev.blocks[prev.blocks.length - 1];
      if (/[，、和与及的][^。！？]*$/.test(lastB) && lastB.length > 6) {
        cur.blocks[0] = lastB + (cur.blocks[0] || "");
        if (prev.rich && cur.rich && prev.rich.length && cur.rich.length) {
          const mergedRich = prev.rich[prev.rich.length - 1];
          cur.rich[0] = { ...mergedRich, t: mergedRich.t + (cur.rich[0] ? cur.rich[0].t : "") };
        }
        prev.blocks.pop();
        if (prev.rich) prev.rich.pop();
        if (!prev.blocks.length) { sections.splice(i, 1); i--; }
      }
    }
    if (!sections.length) return RH.ParsedDocument(fallbackTitle, []);
    const title = sections.length === 1 ? sections[0].title : fallbackTitle;
    return RH.ParsedDocument(title, sections);
  }

  // ---------- TXT / MD ----------
  function parseTxt(text, fallbackTitle) {
    const lines = text.split(/\r?\n/);
    const sections = [];
    let current = RH.Section("导言", 1);
    let docTitle = null;
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      if (s.startsWith("#")) {
        const level = s.length - s.replace(/^#+/, "").length || 1;
        const content = s.replace(/^#+\s*/, "").trim();
        if (!content) continue;
        if (docTitle === null && level === 1 && sections.length === 0 && current.blocks.length === 0) { docTitle = content; continue; }
        current = RH.Section(content, level);
        sections.push(current);
      } else {
        current.blocks.push(s);
      }
    }
    if (current.blocks.length && (!sections.length || sections[sections.length - 1] !== current)) sections.push(current);
    let filtered = sections.filter(s => s.blocks.length || s.title !== "导言");
    if (!filtered.length) filtered = [RH.Section("全文", 1, lines.map(l => l.trim()).filter(Boolean))];
    return RH.ParsedDocument(docTitle || fallbackTitle, filtered);
  }

  async function parseFile(file, onProgress) {
    const name = file.name || file._name || "未命名";
    const ext = (name.split(".").pop() || "").toLowerCase();
    const fallbackTitle = name.replace(/\.[^.]+$/, "");
    const buf = await file.arrayBuffer();
    let doc;
    if (ext === "pdf") doc = await parsePdf(buf, fallbackTitle);
    else if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "bmp") {
      doc = await parseImage(file, fallbackTitle, onProgress);
    }
    else if (ext === "docx" || ext === "doc") doc = await parseDocx(buf, fallbackTitle);
    else if (ext === "pptx" || ext === "ppt") doc = await parsePptx(buf, fallbackTitle);
    else if (ext === "txt" || ext === "md") doc = parseTxt(new TextDecoder("utf-8").decode(buf), fallbackTitle);
    else throw new Error("不支持的格式: ." + ext);

    // 统一文本净化：清除字体映射失败符/私用区/控制字符 + 构建 rich 结构（原文面板排版用）
    for (const sec of doc.sections) {
      sec.blocks = sec.blocks.map(b => RH.RULES.sanitizeText(b)).filter(Boolean);
      if (sec.title) sec.title = RH.RULES.sanitizeText(sec.title);
      if (sec.rich) {
        sec.rich = sec.rich.map(r => ({ ...r, t: RH.RULES.sanitizeText(r.t) })).filter(r => r.t);
      } else {
        // 通用推断：表格行/公式行/列表行/普通段落
        sec.rich = sec.blocks.map(b => ({
          t: b,
          k: b.includes(" | ") ? "table"
            : /^(?:[-*•●▪◦]|\d+[.、)]\s?)/.test(b) ? "bullet"
            : /[=Σ∑∫√≥≤±×÷]/.test(b) && b.length < 80 ? "formula"
            : RH.RULES.isMetaLine(b) ? "meta" : "para",
          lvl: 0,
        }));
      }
      sec.blocks = sec.rich.map(r => r.t);  // rich 清洗后同步回 blocks（管线消费字符串）
    }
    doc.sections = doc.sections.filter(s => s.blocks.length || (s.rich && s.rich.length) || s.title !== "导言");
    return doc;
  }

  return { parseFile, parsePdf, parseDocx, parsePptx, parseTxt };
})();
