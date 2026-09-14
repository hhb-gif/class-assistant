// SM-2 间隔复习算法（Anki 同款简化版）
window.RH = window.RH || {};

RH.sm2 = (function () {
  // quality: 0-5（自动映射：答对=4，答错=1）
  function review(card, quality, now) {
    now = now || Date.now();
    let { ef = 2.5, interval = 0, reps = 0, lapses = 0 } = card;

    if (quality >= 3) {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.round(interval * ef);
      if (interval > 365) interval = 365;
    } else {
      reps = 0;
      lapses += 1;
      interval = 1;
    }
    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ef < 1.3) ef = 1.3;

    return {
      ...card,
      ef: Math.round(ef * 100) / 100,
      interval,
      reps,
      lapses,
      due: now + interval * 24 * 3600 * 1000,
      lastReview: now,
      lastResult: quality >= 3 ? "right" : "wrong",
    };
  }

  // 自动判分映射
  function qualityFromResult(ok) {
    return ok ? 4 : 1;
  }

  // 卡片状态标签
  function statusOf(card, now) {
    now = now || Date.now();
    if (card.due && card.due <= now) return "due";
    if (card.interval >= 21) return "mastered";
    if (card.lastResult === "wrong") return "weak";
    return "learning";
  }

  return { review, qualityFromResult, statusOf };
})();
