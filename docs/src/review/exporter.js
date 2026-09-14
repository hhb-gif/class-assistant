// Word (.docx) exporter v2.1 —— minimal valid OOXML written by hand, zipped with JSZip (already loaded via CDN / node_modules)
// No new dependencies. Exports: RH.exporter.docxBlob / quizDocxBlob / filenameDocx / filenameQuizDocx
window.RH = window.RH || {};

RH.exporter = (function () {
  const DOC_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  // ===== Static OOXML package parts =====
  const CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    "</Types>";

  const RELS_ROOT =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  const RELS_DOC =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  // Normal: SimSun (宋体) 21 half-points = 10.5pt (五号), 1.5x line spacing.
  // Title / Heading1-3 built on Normal with outline levels for Word navigation pane.
  const STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:docDefaults>" +
    "<w:rPrDefault><w:rPr>" +
    '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/>' +
    "</w:rPr></w:rPrDefault>" +
    "<w:pPrDefault><w:pPr>" +
    '<w:spacing w:line="360" w:lineRule="auto"/>' +
    "</w:pPr></w:pPrDefault>" +
    "</w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
    '<w:name w:val="Normal"/><w:qFormat/>' +
    "</w:style>" +
    '<w:style w:type="paragraph" w:styleId="Title">' +
    '<w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    "<w:pPr>" +
    '<w:spacing w:before="240" w:after="240"/>' +
    '<w:jc w:val="center"/>' +
    "</w:pPr>" +
    "<w:rPr><w:b/><w:sz w:val=\"36\"/><w:szCs w:val=\"36\"/></w:rPr>" +
    "</w:style>" +
    '<w:style w:type="paragraph" w:styleId="Heading1">' +
    '<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    "<w:pPr>" +
    "<w:keepNext/>" +
    '<w:spacing w:before="280" w:after="140"/>' +
    '<w:outlineLvl w:val="0"/>' +
    "</w:pPr>" +
    "<w:rPr><w:b/><w:sz w:val=\"28\"/><w:szCs w:val=\"28\"/></w:rPr>" +
    "</w:style>" +
    '<w:style w:type="paragraph" w:styleId="Heading2">' +
    '<w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    "<w:pPr>" +
    "<w:keepNext/>" +
    '<w:spacing w:before="200" w:after="100"/>' +
    '<w:outlineLvl w:val="1"/>' +
    "</w:pPr>" +
    "<w:rPr><w:b/><w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/></w:rPr>" +
    "</w:style>" +
    '<w:style w:type="paragraph" w:styleId="Heading3">' +
    '<w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
    "<w:pPr>" +
    "<w:keepNext/>" +
    '<w:spacing w:before="160" w:after="80"/>' +
    '<w:outlineLvl w:val="2"/>' +
    "</w:pPr>" +
    "<w:rPr><w:b/><w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/></w:rPr>" +
    "</w:style>" +
    "</w:styles>";

  // ===== XML helpers =====
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function run(text) {
    return '<w:r><w:t xml:space="preserve">' + esc(text) + "</w:t></w:r>";
  }

  // Paragraph with optional named style (Title / Heading1 / Heading2 / Heading3 / null = Normal)
  function para(styleId, text) {
    const pPr = styleId ? '<w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr>' : "";
    return "<w:p>" + pPr + (text ? run(text) : "") + "</w:p>";
  }

  // A4 page with 2.54cm margins
  function sectPr() {
    return (
      "<w:sectPr>" +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
      "</w:sectPr>"
    );
  }

  function wrapDoc(paras) {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" + paras.join("") + sectPr() + "</w:body></w:document>"
    );
  }

  // Zip the minimal 5-part package into a .docx Blob
  async function zipToBlob(documentXml) {
    const JSZipCtor = typeof JSZip !== "undefined" ? JSZip : (typeof window !== "undefined" && window.JSZip);
    if (!JSZipCtor) throw new Error("JSZip 未加载");
    const zip = new JSZipCtor();
    zip.file("[Content_Types].xml", CONTENT_TYPES);
    zip.file("_rels/.rels", RELS_ROOT);
    zip.file("word/document.xml", documentXml);
    zip.file("word/_rels/document.xml.rels", RELS_DOC);
    zip.file("word/styles.xml", STYLES);
    const ab = await zip.generateAsync({ type: "arraybuffer" });
    return new Blob([ab], { type: DOC_MIME });
  }

  // ===== Content builders =====
  const IMP_MARK = { high: "●", medium: "◐", low: "○" };
  const CN_NUM = "一二三四五六七八九十";
  const cnNum = (i) => (i < 10 ? CN_NUM[i] : String(i + 1));

  // points[] 双兼容：v2 points / 旧 items（字符串数组）
  function normalizePoints(sec) {
    if (sec && Array.isArray(sec.points)) return sec.points;
    if (sec && Array.isArray(sec.items)) return sec.items;
    return [];
  }

  function pointPrefix(p) {
    // Example-kind points (Agent B schema) get the 【例题】 tag instead of the importance mark
    if (p && p.kind === "example") return "【例题】";
    const mark = p && IMP_MARK[p.importance] ? IMP_MARK[p.importance] : "·";
    return mark;
  }

  function sectionParas(sections) {
    const out = [para("Heading1", "复习要点")];
    (sections || []).forEach((sec, i) => {
      out.push(para("Heading2", cnNum(i) + "、" + (sec.title || "")));
      normalizePoints(sec).forEach((raw) => {
        const p = typeof raw === "string" ? { point: raw } : raw;
        // Long points are exported in full, never truncated
        out.push(para(null, pointPrefix(p) + " " + (p.point || "")));
      });
    });
    return out;
  }

  function questionParas(quiz) {
    const out = [];
    (quiz || []).forEach((q, i) => {
      out.push(para("Heading3", (i + 1) + ". " + (q.question || "")));
      if (q.type === "choice" && Array.isArray(q.options)) {
        q.options.forEach((o, oi) => out.push(para(null, String.fromCharCode(65 + oi) + ". " + (o == null ? "" : o))));
      } else if (q.type === "judge") {
        out.push(para(null, "（判断题）正确 / 错误"));
      }
      // cloze: keep the ____ blank as-is inside the stem, no extra line
    });
    return out;
  }

  function answerParas(quiz) {
    const out = [];
    (quiz || []).forEach((q, i) => {
      let ans;
      if (q.type === "choice" && q.answerIndex != null) {
        ans = "答案：" + String.fromCharCode(65 + q.answerIndex) + ". " + (q.answer || "");
      } else {
        ans = "答案：" + (q.answer == null ? "" : q.answer);
      }
      out.push(para(null, (i + 1) + ". " + ans));
      if (q.explanation) out.push(para(null, "解析：" + q.explanation));
      if (typeof q.source === "string" && q.source) {
        out.push(para(null, "出处：" + q.source.slice(0, 80)));
      }
    });
    return out;
  }

  // ===== Public API =====
  // Full study-notes document: title / overview / keywords / sections / quiz / answers.
  // If vm.sections is empty (quiz-import scenario) only the quiz part is emitted.
  async function docxBlob(vm) {
    vm = vm || {};
    const paras = [para("Title", (vm.title || "") + " · 复习要点")];
    if (vm.overview) {
      paras.push(para("Heading2", "全文速览"));
      paras.push(para(null, vm.overview));
    }
    if (Array.isArray(vm.keywords) && vm.keywords.length) {
      paras.push(para("Heading2", "关键词"));
      paras.push(para(null, vm.keywords.join("、")));
    }
    if (Array.isArray(vm.sections) && vm.sections.length) {
      paras.push(...sectionParas(vm.sections));
    }
    if (Array.isArray(vm.quiz) && vm.quiz.length) {
      paras.push(para("Heading1", "练习题"));
      paras.push(...questionParas(vm.quiz));
      paras.push(para("Heading1", "答案与解析"));
      paras.push(...answerParas(vm.quiz));
    }
    return zipToBlob(wrapDoc(paras));
  }

  // Pure exam-paper document: questions first, answers at the end
  async function quizDocxBlob(vm) {
    vm = vm || {};
    const quiz = Array.isArray(vm.quiz) ? vm.quiz : [];
    const paras = [para("Title", (vm.title || "") + " · 自测卷")];
    if (quiz.length) {
      paras.push(para("Heading1", "一、试题"));
      paras.push(...questionParas(quiz));
      paras.push(para("Heading1", "二、答案与解析"));
      paras.push(...answerParas(quiz));
    }
    return zipToBlob(wrapDoc(paras));
  }

  // File-name helpers (strip characters illegal in Windows file names)
  function cleanName(t) {
    return String(t == null ? "" : t).replace(/[\\/:*?"<>|]/g, "").trim();
  }
  function filenameDocx(vm) {
    return cleanName(vm && vm.title) + "_复习要点.docx";
  }
  function filenameQuizDocx(vm) {
    return cleanName(vm && vm.title) + "_自测卷.docx";
  }

  return { docxBlob, quizDocxBlob, filenameDocx, filenameQuizDocx };
})();

// node-test compatibility: expose RH.exporter as CommonJS export
(typeof module !== "undefined" && module.exports) ? module.exports = RH.exporter : 0;
