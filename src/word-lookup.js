// 单词查询（纯函数）
import { lemmatize } from './lemmatize.js';

// 解析 token → { level, def, lemma } 或 null。
// 原词先查词库；未命中再试 lemmatize 生成的原形候选，命中即用其级别/释义/原形。
function resolve(tok, vocab) {
  const direct = vocab[tok];
  if (direct) return { level: direct.level, def: direct.def, lemma: tok };
  for (const cand of lemmatize(tok)) {
    const e = vocab[cand];
    if (e) return { level: e.level, def: e.def, lemma: cand };
  }
  return null;
}

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

// 句子文本 + 大表 → Word[]（按句中首次出现顺序、按原形去重、只返回命中的）
// 命中项 word 字段存【原形】（如 raises → word='raise'）；直接命中时 word 即原词小写。
// 单字母 token（噪声）整体跳过，不进任何结果。
export function lookupWords(text, vocab) {
  const lower = (text || '').toLowerCase();
  const tokens = lower.split(/[^a-z']+/).filter(Boolean);
  const seen = {};
  const result = [];
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    const r = resolve(tok, vocab);
    if (!r) continue;
    if (seen[r.lemma]) continue;
    seen[r.lemma] = true;
    result.push({ word: r.lemma, level: r.level, def: r.def });
  }
  return result;
}

// 中栏渲染用：句子 → 片段数组（按位置，保留标点/空格，不去重）
// 每片段 { text, level }；level = 还原后命中级别 / '超纲'（还原后仍未命中）/ null（非词标点空格）
// text 始终保留原文形式（raises 仍显示 raises），仅级别随还原结果走。
export function tokenizeForRender(text, vocab) {
  const result = [];
  const re = /[a-z']+/gi;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) result.push({ text: text.slice(last, m.index), level: null });
    const w = m[0].toLowerCase();
    // 单字母 token（噪声）：显示原文但不着色（既非命中也非超纲）
    const r = w.length < 2 ? null : resolve(w, vocab);
    result.push({ text: m[0], level: r ? r.level : (w.length < 2 ? null : '超纲') });
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) result.push({ text: (text || '').slice(last), level: null });
  return result;
}

// 右栏分组用：句子 → {level: Word[]}（去重，含超纲组；超纲词 def=''）
// 命中项按【原形】去重：同原形的多个变形（raises/raising）合并为一条，word=原形、def=原形释义。
// 超纲项按文中形式去重，word=文中形式、def=''。
export function classifyWords(text, vocab) {
  const lower = (text || '').toLowerCase();
  const tokens = lower.split(/[^a-z']+/).filter(Boolean);
  const seenLemma = {};
  const seenTok = {};
  const groups = {};
  for (const tok of tokens) {
    if (tok.length < 2) continue; // 单字母噪声：不进任何分组（含超纲）
    const r = resolve(tok, vocab);
    if (r) {
      if (seenLemma[r.lemma]) continue;
      seenLemma[r.lemma] = true;
      if (!groups[r.level]) groups[r.level] = [];
      groups[r.level].push({ word: r.lemma, level: r.level, def: r.def });
    } else {
      if (seenTok[tok]) continue;
      seenTok[tok] = true;
      if (!groups['超纲']) groups['超纲'] = [];
      groups['超纲'].push({ word: tok, level: '超纲', def: '' });
    }
  }
  return groups;
}
