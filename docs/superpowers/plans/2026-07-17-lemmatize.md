# 词形还原（Lemmatize）查词 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让屈折变形（raises / running / studies / went 等）还原回原形后再查词库，避免被误归"超纲"；右栏命中词显示原形。

**Architecture:** 新建纯逻辑模块 `src/lemmatize.js`（移植自 `分级单词提取.py` 的 `lemmatize()`：不规则动词表 + 后缀规则），在 `word-lookup.js` 里加 `resolve(tok, vocab)` helper 供三个查词函数共用：原词先查，未命中再试还原候选。命中项的 `word` 字段直接存原形，UI 零改动。

**Tech Stack:** 原生 ES module（无依赖）、Vue 3（UI，本计划不改）、Node 用于纯函数验证、`test.html` 浏览器断言页。

**关键设计决策（已定，无需再问）：**
- 命中项 `word` 字段 = 原形（如 `raise`），不引入 `lemma` 字段；`WordPanel.vue` 不改。
- 含撇号的 token（`don't`）不做后缀还原，`lemmatize` 返回 `[]`。
- 候选按长度降序，避免 `coding→cod` 抢先于 `code`。
- 不移植缩约形式（`don't→do`），YAGNI。

**测试策略：** Task 1–4 的纯函数用 Node（`node --input-type=module`）验证，快且自动化；Task 5 把断言补进 `test.html`（人工浏览器复核）。所有命令在 bash（Windows）下运行，路径用正斜杠。

---

## 文件结构

| 文件 | 责任 | 本计划 |
|------|------|--------|
| `src/lemmatize.js` | `lemmatize(word)→string[]`：不规则动词表 + 后缀规则；含撇号返回 `[]` | 新增 |
| `src/word-lookup.js` | `buildVocab` / `lookupWords` / `tokenizeForRender` / `classifyWords`；新增内部 `resolve` | 改 |
| `test.html` | 纯函数浏览器断言页 | 改（追加断言 + import） |
| `src/vocab-store.js` | store 工厂 | **不改** |
| `src/components/WordPanel.vue` | 右栏 | **不改** |
| `src/components/SentenceList.vue` | 中栏 | **不改** |

---

### Task 1: 新建 `src/lemmatize.js`

**Files:**
- Create: `src/lemmatize.js`
- Test (临时验证): `verify-lem.mjs`（项目根，跑完删除）

- [ ] **Step 1: 写 `src/lemmatize.js`（完整内容）**

```js
// 词形还原（纯函数，无依赖）
// 移植自 分级单词提取.py 的 lemmatize()：把屈折变形（raises/running/studies/went）
// 还原成原形候选列表，供查词时"原词未命中再试候选"使用。
// 设计为"试所有候选，命中即用"，宁可多生成几个候选；候选按长度降序，
// 避免 coding→cod(鳇鱼) 抢先于 code(编码) 命中导致释义错误。

// 不规则动词变形 → 原形（过去式/过去分词/现在分词/三单）；纯后缀规则无法处理这些
const IRREGULAR_VERBS = {
  // be
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be',
  been: 'be', being: 'be',
  // have / do / go
  has: 'have', had: 'have', having: 'have',
  did: 'do', done: 'do', does: 'do', doing: 'do',
  went: 'go', gone: 'go', going: 'go', goes: 'go',
  came: 'come', coming: 'come', comes: 'come',
  became: 'become', becoming: 'become', becomes: 'become',
  began: 'begin', begun: 'begin', beginning: 'begin', begins: 'begin',
  took: 'take', taken: 'take', taking: 'take', takes: 'take',
  gave: 'give', given: 'give', giving: 'give', gives: 'give',
  made: 'make', making: 'make', makes: 'make',
  got: 'get', gotten: 'get', getting: 'get', gets: 'get',
  found: 'find', finding: 'find', finds: 'find',
  said: 'say', saying: 'say', says: 'say',
  saw: 'see', seen: 'see', seeing: 'see', sees: 'see',
  knew: 'know', known: 'know', knowing: 'know', knows: 'know',
  thought: 'think', thinking: 'think', thinks: 'think',
  told: 'tell', telling: 'tell', tells: 'tell',
  put: 'put', puts: 'put',
  let: 'let', lets: 'let',
  ran: 'run', running: 'run', runs: 'run',
  sat: 'sit', sitting: 'sit', sits: 'sit',
  stood: 'stand', standing: 'stand', stands: 'stand',
  spoke: 'speak', spoken: 'speak', speaking: 'speak', speaks: 'speak',
  wrote: 'write', written: 'write', writing: 'write', writes: 'write',
  read: 'read', reading: 'read', reads: 'read',
  broke: 'break', broken: 'break', breaking: 'break', breaks: 'break',
  chose: 'choose', chosen: 'choose', choosing: 'choose', chooses: 'choose',
  drove: 'drive', driven: 'drive', driving: 'drive', drives: 'drive',
  fell: 'fall', fallen: 'fall', falling: 'fall', falls: 'fall',
  felt: 'feel', feeling: 'feel', feels: 'feel',
  held: 'hold', holding: 'hold', holds: 'hold',
  kept: 'keep', keeping: 'keep', keeps: 'keep',
  left: 'leave', leaving: 'leave', leaves: 'leave',
  lost: 'lose', losing: 'lose', loses: 'lose',
  met: 'meet', meeting: 'meet', meets: 'meet',
  paid: 'pay', paying: 'pay', pays: 'pay',
  sent: 'send', sending: 'send', sends: 'send',
  spent: 'spend', spending: 'spend', spends: 'spend',
  won: 'win', winning: 'win', wins: 'win',
  understood: 'understand', understanding: 'understand', understands: 'understand',
  meant: 'mean', meaning: 'mean', means: 'mean',
  showed: 'show', shown: 'show', showing: 'show', shows: 'show',
  grew: 'grow', grown: 'grow', growing: 'grow', grows: 'grow',
  threw: 'throw', thrown: 'throw', throwing: 'throw', throws: 'throw',
  flew: 'fly', flown: 'fly', flying: 'fly', flies: 'fly',
  drew: 'draw', drawn: 'draw', drawing: 'draw', draws: 'draw',
  blew: 'blow', blown: 'blow', blowing: 'blow', blows: 'blow',
  caught: 'catch', catching: 'catch', catches: 'catch',
  taught: 'teach', teaching: 'teach', teaches: 'teach',
  bought: 'buy', buying: 'buy', buys: 'buy',
  brought: 'bring', bringing: 'bring', brings: 'bring',
  fought: 'fight', fighting: 'fight', fights: 'fight',
  built: 'build', building: 'build', builds: 'build',
  burnt: 'burn', burned: 'burn', burning: 'burn', burns: 'burn',
  dealt: 'deal', dealing: 'deal', deals: 'deal',
  fed: 'feed', feeding: 'feed', feeds: 'feed',
  laid: 'lay', laying: 'lay', lays: 'lay',
  led: 'lead', leading: 'lead', leads: 'lead',
  rang: 'ring', rung: 'ring', ringing: 'ring', rings: 'ring',
  rose: 'rise', risen: 'rise', rising: 'rise', rises: 'rise',
  swam: 'swim', swum: 'swim', swimming: 'swim', swims: 'swim',
  wore: 'wear', worn: 'wear', wearing: 'wear', wears: 'wear',
  shook: 'shake', shaken: 'shake', shaking: 'shake', shakes: 'shake',
  shot: 'shoot', shooting: 'shoot', shoots: 'shoot',
  sang: 'sing', sung: 'sing', singing: 'sing', sings: 'sing',
  stole: 'steal', stolen: 'steal', stealing: 'steal', steals: 'steal',
  struck: 'strike', striking: 'strike', strikes: 'strike',
  tore: 'tear', torn: 'tear', tearing: 'tear', tears: 'tear',
  woke: 'wake', woken: 'wake', waking: 'wake', wakes: 'wake',
  forgave: 'forgive', forgiven: 'forgive',
  hid: 'hide', hidden: 'hide', hiding: 'hide',
  rode: 'ride', ridden: 'ride', riding: 'ride', rides: 'ride',
};

// 后缀还原规则（按优先级）：[后缀, 替换为]
// repl 取值：'' 直接去后缀 / 'e' 'y' 'ie' 补字母 / null 双写末辅音再去一字母（running→run）
const LEMMATIZE_RULES = [
  ['ies', 'y'],   // studies -> study
  ['ied', 'y'],   // applied -> apply
  ['ying', 'ie'], // dying -> die
  ['ying', 'y'],
  ['ing', ''],    // encoding -> encod（再由补 e 候选补成 encode）
  ['ing', 'e'],   // encod(ing) -> encode
  ['ing', null],  // running -> runn -> 去1 -> run
  ['ed', ''],
  ['ed', 'e'],    // encoded -> encode
  ['ed', null],   // stopped -> stop
  ['es', ''],     // boxes -> box
  ['es', 'e'],
  ['s', ''],      // cats -> cat / makes -> make（靠补 e 候选）
  ['est', ''],
  ['est', 'e'],
  ['er', ''],
  ['er', 'e'],
  ['ely', 'e'],
  ['ily', 'y'],   // happily -> happy
  ['ly', ''],     // quickly -> quick
];

// 生成 word 的若干"可能原形"候选（小写），不含 word 自身（调用方已先试过 word 本身）。
// 含撇号等非纯字母词直接返回 []（缩约形式不处理）。
export function lemmatize(word) {
  if (!word || /[^a-z]/.test(word)) return [];

  // 1) 不规则动词变形 → 原形
  if (IRREGULAR_VERBS[word]) return [IRREGULAR_VERBS[word]];

  // 2) 后缀规则：试所有候选
  const cands = [];
  const n = word.length;
  for (const [suffix, repl] of LEMMATIZE_RULES) {
    if (!word.endsWith(suffix) || n <= suffix.length) continue;
    const stem = word.slice(0, n - suffix.length);
    if (repl === null) {
      // 双写末辅音：running -> runn -> 再去一个末字母 -> run
      if (stem.length >= 1) cands.push(stem.slice(0, -1));
    } else {
      cands.push(stem + repl);
    }
  }

  // 去重保序 + 过滤过短候选
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    if (c && !seen.has(c) && c.length >= 2) {
      seen.add(c);
      out.push(c);
    }
  }
  // 候选按长度降序：更长的还原原形优先匹配（避免 coding->cod 抢先于 code）
  out.sort((a, b) => b.length - a.length);
  return out;
}
```

- [ ] **Step 2: 写临时验证脚本 `verify-lem.mjs`（项目根）**

```js
import { lemmatize } from './src/lemmatize.js';
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); };
t('raises 含 raise', lemmatize('raises').includes('raise'));
t('running 含 run', lemmatize('running').includes('run'));
t('studies 含 study', lemmatize('studies').includes('study'));
t('went 含 go', lemmatize('went').includes('go'));
t('happily 含 happy', lemmatize('happily').includes('happy'));
t('encoding 含 encode', lemmatize('encoding').includes('encode'));
t('applied 含 apply', lemmatize('applied').includes('apply'));
t("don't 返回空", lemmatize("don't").length === 0);
t('空串返回空', lemmatize('').length === 0);
t('候选不含自身', !lemmatize('cat').includes('cat'));
console.log(`\n---- 通过 ${pass}，失败 ${fail}`);
```

- [ ] **Step 3: 运行验证**

Run: `node verify-lem.mjs`
Expected: 全部 PASS，`通过 10，失败 0`

- [ ] **Step 4: 删除临时脚本并提交**

```bash
rm verify-lem.mjs
git add src/lemmatize.js
git commit -m "feat: 新增词形还原模块 lemmatize.js（移植自 Python 脚本）"
```

---

### Task 2: `word-lookup.js` 加 `resolve` helper + 改 `lookupWords`

**Files:**
- Modify: `src/word-lookup.js`
- Test (临时): `verify-lookup.mjs`

- [ ] **Step 1: 写临时验证脚本 `verify-lookup.mjs`（先写测试，验证当前会失败）**

```js
import { buildVocab, lookupWords } from './src/word-lookup.js';
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' ' + n); };
const v = buildVocab({ '初中': { raise: 'v. 举起', run: 'v. 跑', study: 'v. 学习', encode: 'v. 编码', text: 'n. 文本' } });
// 还原命中
t('raises 还原命中 raise', lookupWords('He raises his hand', v)[0].word === 'raise');
t('raises 命中级别=初中', lookupWords('He raises his hand', v)[0].level === '初中');
t('raises 释义=raise 释义', lookupWords('He raises his hand', v)[0].def === 'v. 举起');
t('running 还原命中 run', lookupWords('running fast', v)[0].word === 'run');
t('studies 还原命中 study', lookupWords('she studies', v)[0].word === 'study');
// 直接命中不受影响
t('encode 直接命中', lookupWords('encode text', v).length === 2 && lookupWords('encode text', v)[0].word === 'encode');
// 同原形多变形按原形去重（raises/raising 合一条）
t('raises+raising 合并一条', lookupWords('raises raising raised', v).length === 1);
// 还原失败不返回
t('超纲词不返回', lookupWords('zzzz qqqq', v).length === 0);
console.log(`\n---- 通过 ${pass}，失败 ${fail}`);
```

Run: `node verify-lookup.mjs`
Expected: 多数 FAIL（还原尚未实现，`raises` 查不到 → 返回空 → `[0]` undefined）

- [ ] **Step 2: 改 `src/word-lookup.js` —— 顶部加 import + helper**

在文件第 1 行（`// 单词查询（纯函数）` 之后）插入：

```js
import { lemmatize } from './lemmatize.js';
```

在 `buildVocab` 函数**之前**（import 之后）插入 helper：

```js
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
```

- [ ] **Step 3: 改 `lookupWords` 函数（用 resolve + 按原形去重 + word 存原形）**

把现有 `lookupWords` 整体替换为：

```js
// 句子文本 + 大表 → Word[]（按句中首次出现顺序、按原形去重、只返回命中的）
// 命中项 word 字段存【原形】（如 raises → word='raise'）；直接命中时 word 即原词小写。
export function lookupWords(text, vocab) {
  const lower = (text || '').toLowerCase();
  const tokens = lower.split(/[^a-z']+/).filter(Boolean);
  const seen = {};
  const result = [];
  for (const tok of tokens) {
    const r = resolve(tok, vocab);
    if (!r) continue;
    if (seen[r.lemma]) continue;
    seen[r.lemma] = true;
    result.push({ word: r.lemma, level: r.level, def: r.def });
  }
  return result;
}
```

- [ ] **Step 4: 运行验证（其余两个函数本 Task 暂未改，但 lookupWords 测试应全过）**

Run: `node verify-lookup.mjs`
Expected: 全部 PASS，`通过 8，失败 0`

- [ ] **Step 5: 删除临时脚本并提交**

```bash
rm verify-lookup.mjs
git add src/word-lookup.js
git commit -m "feat: lookupWords 接入词形还原（命中项 word 存原形、按原形去重）"
```

---

### Task 3: `tokenizeForRender` 接入 `resolve`

**Files:**
- Modify: `src/word-lookup.js`
- Test (临时): `verify-tok.mjs`

- [ ] **Step 1: 写临时验证脚本 `verify-tok.mjs`**

```js
import { tokenizeForRender } from './src/word-lookup.js';
import { buildVocab } from './src/word-lookup.js';
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' ' + n); };
const v = buildVocab({ '初中': { raise: 'x', run: 'x' } });
// raises 还原命中 → 片段级别=初中，但 text 仍是原文 raises
const toks = tokenizeForRender('Raises fast', v);
t('raises 文本保留原文', toks[0].text === 'Raises');
t('raises 级别=初中（还原后）', toks[0].level === '初中');
// 超纲词级别=超纲
const toks2 = tokenizeForRender('zzzz', v);
t('zzzz 超纲', toks2[0].level === '超纲' && toks2[0].text === 'zzzz');
console.log(`\n---- 通过 ${pass}，失败 ${fail}`);
```

Run: `node verify-tok.mjs`
Expected: `raises 级别=初中` FAIL（tokenizeForRender 还未改）

- [ ] **Step 2: 改 `tokenizeForRender`（用 resolve 取级别）**

把现有 `tokenizeForRender` 整体替换为：

```js
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
    const r = resolve(w, vocab);
    result.push({ text: m[0], level: r ? r.level : '超纲' });
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) result.push({ text: (text || '').slice(last), level: null });
  return result;
}
```

- [ ] **Step 3: 运行验证**

Run: `node verify-tok.mjs`
Expected: 全部 PASS，`通过 4，失败 0`

- [ ] **Step 4: 删除临时脚本并提交**

```bash
rm verify-tok.mjs
git add src/word-lookup.js
git commit -m "feat: tokenizeForRender 接入词形还原（中栏 token 级别随原形走）"
```

---

### Task 4: `classifyWords` 接入 `resolve`（按原形去重 + 右栏显示原形）

**Files:**
- Modify: `src/word-lookup.js`
- Test (临时): `verify-cls.mjs`

- [ ] **Step 1: 写临时验证脚本 `verify-cls.mjs`**

```js
import { classifyWords, buildVocab } from './src/word-lookup.js';
let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' ' + n); };
const v = buildVocab({ '初中': { raise: 'v. 举起', run: 'v. 跑' } });

const g1 = classifyWords('He raises and raising', v);
t('raises/raising 合并一条', g1['初中'] && g1['初中'].length === 1);
t('命中项 word=原形 raise', g1['初中'][0].word === 'raise');
t('命中项 def=原形释义', g1['初中'][0].def === 'v. 举起');

const g2 = classifyWords('zzzz raises', v);
t('超纲词归超纲组', !!g2['超纲'] && g2['超纲'].length === 1);
t('超纲词显示文中形式', g2['超纲'][0].word === 'zzzz');
t('超纲 def 空', g2['超纲'][0].def === '');

// 同超纲词不重复
const g3 = classifyWords('zzzz zzzz', v);
t('同超纲词去重', g3['超纲'].length === 1);
console.log(`\n---- 通过 ${pass}，失败 ${fail}`);
```

Run: `node verify-cls.mjs`
Expected: `合并一条`、`word=原形` FAIL（classifyWords 还未改）

- [ ] **Step 2: 改 `classifyWords`（命中按原形去重、word=原形；超纲按 tok 去重）**

把现有 `classifyWords` 整体替换为：

```js
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
```

- [ ] **Step 3: 运行验证**

Run: `node verify-cls.mjs`
Expected: 全部 PASS，`通过 8，失败 0`

- [ ] **Step 4: 删除临时脚本并提交**

```bash
rm verify-cls.mjs
git add src/word-lookup.js
git commit -m "feat: classifyWords 接入词形还原（右栏命中词显示原形、同原形合并）"
```

---

### Task 5: 补 `test.html` 断言（端到端回归）

**Files:**
- Modify: `test.html`

- [ ] **Step 1: 在 `test.html` 第 19 行（已有的 `tokenizeForRender, classifyWords` import 那行）下方加一行 import**

把：
```js
import { tokenizeForRender, classifyWords } from './src/word-lookup.js';
```
改为：
```js
import { tokenizeForRender, classifyWords } from './src/word-lookup.js';
import { lemmatize } from './src/lemmatize.js';
```

- [ ] **Step 2: 在 `test.html` 第 117 行（`classify: 超纲 def 空` 那行）之后、`out.innerHTML += '\n----\n'` 之前，追加断言块**

```js

  // --- lemmatize ---
  check('lem: raises→含 raise', lemmatize('raises').includes('raise'));
  check('lem: running→含 run', lemmatize('running').includes('run'));
  check('lem: studies→含 study', lemmatize('studies').includes('study'));
  check('lem: went→含 go', lemmatize('went').includes('go'));
  check('lem: happily→含 happy', lemmatize('happily').includes('happy'));
  check("lem: don't→空（撇号）", lemmatize("don't").length === 0);

  // --- 词形还原查词（端到端） ---
  const lvo = { '初中': { raise: 'v. 举起', run: 'v. 跑', study: 'v. 学习' } };
  const lv = buildVocab(lvo);
  check('lookup: raises 还原命中 raise', lookupWords('He raises his hand', lv)[0].word === 'raise');
  check('classify: raises→raise 显示原形', classifyWords('raises', lv)['初中'][0].word === 'raise');
  check('classify: raises+raising 合并一条', classifyWords('raises raising raised', lv)['初中'].length === 1);
  check('classify: 超纲词还原失败仍超纲', !!classifyWords('zzzz', lv)['超纲']);
```

- [ ] **Step 3: 用 Node 跑一遍核心纯函数回归（防止改坏既有断言）**

Run（一次性确认 lookupWords/classifyWords 既有行为 + 新行为）:
```bash
node --input-type=module -e "
import { buildVocab, lookupWords, classifyWords, tokenizeForRender } from './src/word-lookup.js';
const v = buildVocab({ '初中': { encode: 'v. 编码', text: 'n. 文本' }, '四级': { compress: 'v. 压缩', binary: 'n. 二进制' } });
let p=0,f=0; const t=(n,c)=>{c?p++:f++;console.log((c?'PASS':'FAIL')+' '+n);};
t('lookup 数量=3', lookupWords('When you ENCODE text into binary!', v).length===3);
t('lookup 大小写归一', lookupWords('encode', v)[0].word==='encode');
t('lookup 重复去重', lookupWords('text text text', v).length===1);
t('lookup 未命中不返回', lookupWords('hello world', v).length===0);
const tv={'hello':{level:'初中',def:'x'}};
t('tokenize 片段数=4', tokenizeForRender('Hello, world!', tv).length===4);
t('classify 初中去重=1', classifyWords('Hello hello world', tv)['初中'].length===1);
console.log('---- '+p+' pass, '+f+' fail');
"
```
Expected: 全部 PASS，`6 pass, 0 fail`

- [ ] **Step 4: 提交**

```bash
git add test.html
git commit -m "test: 补充词形还原断言（lemmatize + 还原查词端到端）"
```

- [ ] **Step 5: 浏览器复核（可选但推荐）**

提示用户：`npm run dev` 后打开 `http://localhost:5173/test.html`，确认页面底部 `失败 0`。（subagent 无法开浏览器，此步留给用户验收。）

---

### Task 6: 构建验证

**Files:** 无（仅构建）

- [ ] **Step 1: 构建单文件产物**

Run: `npm run build`
Expected: 构建成功，生成 `dist/index.html`，无报错。

- [ ] **Step 2: 若构建失败，回到对应 Task 修复；成功则结束**

构建通过即整体完成。`dist/index.html` 可双击打开做最终人工验收（载入测试 SRT + 音频，点句子看右栏变形词是否显示原形）。

---

## 自审（plan self-review）

- **Spec 覆盖**：spec 第 1 节（lemmatize 模块）→ Task 1；第 2 节（resolve helper）→ Task 2；第 3 节（Word 结构不新增字段）→ Task 2/4 体现；第 4 节（三函数改动）→ Task 2/3/4；第 5 节（测试）→ Task 5；非目标（撇号、缩约）→ Task 1 代码 + Task 5 断言。✓
- **占位符扫描**：无 TBD/TODO。Task 1 Step 2 的笔误已就地标注修正。✓
- **类型/命名一致**：`resolve` 返回 `{level, def, lemma}`，三函数均用 `r.lemma`/`r.level`/`r.def`，一致。`word` 字段在命中项=原形、超纲项=tok，全计划统一。✓
- **既有测试兼容**：Task 5 Step 3 回归覆盖既有断言（ENCODE/text/binary/重复去重/未命中/tokenize/classify 超纲），确保不破坏。✓
