// IndexedDB 学习记录存储（卡片 + 文档历史）
window.RH = window.RH || {};

RH.storage = (function () {
  const DB_NAME = "ca_study";
  const DB_VERSION = 1;
  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("cards")) {
          const store = db.createObjectStore("cards", { keyPath: "cardId" });
          store.createIndex("due", "due", { unique: false });
          store.createIndex("docTitle", "docTitle", { unique: false });
        }
        if (!db.objectStoreNames.contains("docs")) {
          db.createObjectStore("docs", { keyPath: "title" });
        } else {
          // 旧表结构升级：确保新字段可用（IndexedDB 无 schema，字段自由）
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function tx(db, store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function cardIdOf(docTitle, qid) {
    return docTitle + "::" + qid;
  }

  // 记录一次答题（新建或更新卡片，走 SM-2）
  async function recordAnswer(docTitle, q, ok, userAnswer) {
    const db = await openDB();
    const store = tx(db, "cards", "readwrite");
    const cardId = cardIdOf(docTitle, q.qid);
    let card = await reqToPromise(store.get(cardId));
    if (!card) {
      card = {
        cardId,
        docTitle,
        qid: q.qid,
        type: q.type,
        question: q.question,
        options: q.options || null,
        answer: q.answer,
        answerIndex: q.answerIndex != null ? q.answerIndex : null,
        explanation: q.explanation || "",
        source: q.source || null,
        difficulty: q.difficulty || 1,
        createdAt: Date.now(),
      };
    }
    const updated = RH.sm2.review(card, RH.sm2.qualityFromResult(ok));
    updated.lastUserAnswer = userAnswer || "";
    updated.answerHistory = (card.answerHistory || []).concat([{
      t: Date.now(), ok: !!ok, answer: userAnswer || "",
    }]);
    await reqToPromise(store.put(updated));
    return updated;
  }

  // 待复习卡片（due <= now）
  async function getDueCards(now) {
    now = now || Date.now();
    const db = await openDB();
    const store = tx(db, "cards", "readonly");
    const all = await reqToPromise(store.getAll());
    return all.filter(c => c.due && c.due <= now).sort((a, b) => a.due - b.due);
  }

  async function getAllCards() {
    const db = await openDB();
    return await reqToPromise(tx(db, "cards", "readonly").getAll());
  }

  async function getStats() {
    const now = Date.now();
    const cards = await getAllCards();
    const stats = {
      total: cards.length,
      due: 0, mastered: 0, weak: 0, learning: 0,
    };
    for (const c of cards) {
      const st = RH.sm2.statusOf(c, now);
      stats[st]++;
    }
    return stats;
  }

  // 文档历史（完整版：结构化数据 + 源文件 Blob；v2 新增可选 overview / engine 字段）
  async function saveDoc(title, payload) {
    try {
      const db = await openDB();
      const store = tx(db, "docs", "readwrite");
      const rec = {
        title,
        time: Date.now(),
        backend: payload.backend || "",
        overview: payload.overview || "",
        engine: payload.engine || "",
        sections: payload.sections || [],
        quiz: payload.quiz || [],
        keywords: payload.keywords || [],
        terms: payload.terms || [],
        markdown: payload.markdown || "",
        original_sections: payload.original_sections || [],
        sourceBlob: payload.sourceBlob || null,
        sourceName: payload.sourceName || "",
        sourceNames: payload.sourceNames || [],
      };
      await reqToPromise(store.put(rec));
      return true;
    } catch (e) { console.warn("[storage] saveDoc 失败:", e && e.message); return false; }
  }

  // 旧版 sections（{title, items, sources} 形态）就地转换为 v2 points 形态；旧 cloze/judge 题不受影响
  function migrateSections(rec) {
    if (rec && Array.isArray(rec.sections) && rec.sections.length &&
        rec.sections[0] && Array.isArray(rec.sections[0].items) && !rec.sections[0].points) {
      rec.sections = rec.sections.map(s => ({
        title: s.title,
        points: (s.items || []).map(it => ({ point: it, source: "", importance: "" })),
      }));
    }
    return rec;
  }

  async function getDoc(title) {
    try {
      const db = await openDB();
      const rec = await reqToPromise(tx(db, "docs", "readonly").get(title));
      return migrateSections(rec);
    } catch (e) { return null; }
  }

  async function listDocs() {
    try {
      const db = await openDB();
      const all = await reqToPromise(tx(db, "docs", "readonly").getAll());
      return all.sort((a, b) => b.time - a.time);
    } catch (e) { return []; }
  }

  async function deleteDoc(title) {
    try {
      const db = await openDB();
      await reqToPromise(tx(db, "docs", "readwrite").delete(title));
      return true;
    } catch (e) { return false; }
  }

  async function saveDocHistory(title, meta) {
    try {
      const db = await openDB();
      const store = tx(db, "docs", "readwrite");
      await reqToPromise(store.put({ title, ...meta, time: Date.now() }));
    } catch (e) { /* 非致命 */ }
  }

  async function getDocHistory() {
    try {
      const db = await openDB();
      return await reqToPromise(tx(db, "docs", "readonly").getAll());
    } catch (e) { return []; }
  }

  // 清空学习数据
  async function resetAll() {
    const db = await openDB();
    tx(db, "cards", "readwrite").clear();
    tx(db, "docs", "readwrite").clear();
  }

  return { recordAnswer, getDueCards, getAllCards, getStats, saveDoc, getDoc, listDocs, deleteDoc, getDocHistory, resetAll };
})();
