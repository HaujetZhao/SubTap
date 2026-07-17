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

// 中栏渲染用：句子 → 片段数组（按位置，保留标点/空格，不去重）
// 每片段 { text, level }；level = 命中级 / '超纲'（未命中词）/ null（非词标点空格）
export function tokenizeForRender(text, vocab) {
  const result = [];
  const re = /[a-z']+/gi;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) result.push({ text: text.slice(last, m.index), level: null });
    const w = m[0].toLowerCase();
    const entry = vocab[w];
    result.push({ text: m[0], level: entry ? entry.level : '超纲' });
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) result.push({ text: (text || '').slice(last), level: null });
  return result;
}

// 右栏分组用：句子 → {level: Word[]}（去重，含超纲组；超纲词 def=''）
export function classifyWords(text, vocab) {
  const lower = (text || '').toLowerCase();
  const tokens = lower.split(/[^a-z']+/).filter(Boolean);
  const seen = {};
  const groups = {};
  for (const tok of tokens) {
    if (seen[tok]) continue;
    seen[tok] = true;
    const entry = vocab[tok];
    const level = entry ? entry.level : '超纲';
    if (!groups[level]) groups[level] = [];
    groups[level].push({ word: tok, level, def: entry ? entry.def : '' });
  }
  return groups;
}
