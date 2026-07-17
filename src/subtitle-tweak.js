// 字幕时间微调：计算每句的有效播放区间
// 考虑全局起始偏移、末尾延长、句末连接（连到下一句开头）

// 返回 Map<id, { effStart, effEnd }>
export function computeEffectiveRanges(sentences, opts) {
  const { offset = 0, extend = 0, linkNext = false } = opts || {};
  const map = new Map();
  const n = sentences.length;
  for (let i = 0; i < n; i++) {
    const s = sentences[i];
    const next = i + 1 < n ? sentences[i + 1] : null;
    const effStart = s.start + offset;
    let effEnd;
    if (linkNext && next) {
      effEnd = next.start + offset; // 连到下一句的有效开头（连接优先，忽略 extend）
    } else {
      effEnd = s.end + extend;
    }
    if (effEnd <= effStart) effEnd = effStart + 0.05; // 最小 50ms 段
    map.set(s.id, { effStart, effEnd });
  }
  return map;
}
