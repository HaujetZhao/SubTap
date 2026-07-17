// 单词查询（纯函数）

// 词库（两级 {level: {word: def}}）→ 合并大表 {word: {level, def}}；重复词保留首个分级
export function buildVocab(vocabObj) {
  const table = {};
  const levels = Object.keys(vocabObj || {});
  for (const level of levels) {
    const dict = vocabObj[level] || {};
    for (const w of Object.keys(dict)) {
      if (!table[w]) table[w] = { level, def: dict[w] };
    }
  }
  return table;
}

// 句子文本 + 大表 → Word[]（按句中首次出现顺序、去重、只返回命中的）
export function lookupWords(text, vocab) {
  const lower = (text || '').toLowerCase();
  const tokens = lower.split(/[^a-z']+/).filter(Boolean);
  const seen = {};
  const result = [];
  for (const tok of tokens) {
    if (seen[tok]) continue;
    const entry = vocab[tok];
    if (entry) {
      seen[tok] = true;
      result.push({ word: tok, level: entry.level, def: entry.def });
    }
  }
  return result;
}
