// 单词查询（纯函数）
import { lemmatize, applyRules } from './lemmatize.js';

// 解析 token → { level, def, lemma } 或 null。
// 原词先查词库；未命中再试 lemmatize 生成的原形候选；仍无命中则对第一层候选再还原
// 一层（双层：encodings → encoding → encode；surprisingly → surprising → surprise）。
// 第二层只允许 ≥3 的特征派生后缀（与 lemmatizeChain 第 2 层同一门槛）：
// 裸去 -s/-er/-ly 会跨词界（cleansing→cleans→clean，真词基是 cleanse）。
// 去双写二义对仲裁：候选里同时出现 a 与 a+重复尾辅音（pul/pull、put/putt、ad/add）且
// 都命中词库时，取分级最早者。此对纯长度序无法裁决（put 必须赢 putt，又必须输给 pull），
// 通用"取最早级"又会重演 cod/code 误配（bites→bit、canes→can），故只对这一对形态施裁。
function resolve(tok, vocab) {
  const direct = vocab[tok];
  if (direct) return { level: direct.level, def: direct.def, lemma: tok };
  const cands = lemmatize(tok);
  const loser = new Set();
  for (const a of cands) {
    const last = a.at(-1);
    if ('aeiou'.includes(last)) continue;
    const b = a + last;
    if (cands.includes(b) && vocab[a] && vocab[b]) loser.add(vocab[b].ord < vocab[a].ord ? a : b);
  }
  for (const cand of cands) {
    if (loser.has(cand)) continue;
    const e = vocab[cand];
    if (e) return { level: e.level, def: e.def, lemma: cand };
  }
  for (const cand of cands) {
    for (const cand2 of applyRules(cand, 3)) {
      const e = vocab[cand2];
      if (e) return { level: e.level, def: e.def, lemma: cand2 };
    }
  }
  return null;
}

// 词库（两级 {level: {word: def}}）→ 合并大表 {word: {level, def, ord}}；重复词保留首个分级。
// ord = 级别序号（键序即从易到难），供 resolve 多候选命中时取最常用级。
export function buildVocab(vocabObj) {
  const table = {};
  const levels = Object.keys(vocabObj || {});
  for (const [ord, level] of levels.entries()) {
    const dict = vocabObj[level] || {};
    for (const w of Object.keys(dict)) {
      if (!table[w]) table[w] = { level, def: dict[w], ord };
    }
  }
  return table;
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
