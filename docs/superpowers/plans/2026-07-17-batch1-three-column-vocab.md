# 批次一实施计划：三栏布局 + 词库内置 + 分级勾选

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把第一版（顶部按钮栏 + 用户选词库 + 右栏扁平单词）重构为三栏布局（左设置/中字幕/右单词）、词库构建期内置、左栏分级勾选、右栏按级分栏显示。

**Architecture:** 沿用第一版"多文件开发 + build.js 内联成 dist/index.html"。**采用 ES6 模块（`import`/`export`，`<script type="module">`）**，取代第一版的 IIFE + `window.App` 命名空间——依赖关系显式、作用域干净。新增 `src/vocab-store.js` 管内置词库 + 勾选状态 + 按级查询；重写 `index.html` body、`styles.css`、`ui.js`；调整 `main.js`（移除词库上传、接入 store）和 `build.js`（注入词库 + 内联模块）。`srt-parser.js`、`word-lookup.js`、`player.js` 改成 ES module 导出（接口不变）。纯函数（按级分组）扩展 test.html 验证。

**Tech Stack:** 原生 HTML/CSS/JavaScript（ES6 模块，无框架）、Node（构建脚本）、浏览器测试页。

**运行环境:** ES6 模块需 http(s) 加载，**不能 file:// 直接打开**。开发期用 Python 起本地服务器（见末尾"本地服务器"）。dist 单文件内联后无外部依赖，可直接打开或托管 GitHub Pages。

**当前状态:** 在 `feature/srt-audio-player` 分支。目录已扁平化（无 player/ 层级）。第一版功能完整可用（但用的是 IIFE/window.App，本批改为 ES module）。

**关键约束（所有子代理必须遵守）：**
- 用户偏好：注释/总结用中文。Windows 10，但 shell 是 bash（正斜杠、Unix 语法）。
- **用 ES6 模块**：`export function/const`，`import { x } from './y.js'`，`<script type="module">`。**不用** IIFE、**不用** `window.App` 全局命名空间。
- 现有逻辑接口（本批保持同名，仅改成 export/import 形式）：
  - `parseSRT(text)` → `Sentence[]`（`{id,start,end,text}`）；`timestampToSeconds(ts)`（src/srt-parser.js）
  - `buildVocab(vocabObj)` → 大表；`lookupWords(text, vocab)` → 扁平 `Word[]`（`{word,level,def}`）（src/word-lookup.js）
  - `Player` 类：`new Player(audioEl)`、`setSrc`、`onStop`、`playSegment(start,end)`、`stop`（src/player.js）

---

## 文件结构总览

```
（项目根目录）
├── index.html              # 重写 body：三栏结构；<script type="module" src="src/main.js">
├── build.js                # 改：注入词库 + 内联 ES 模块
├── test.html               # 扩展：<script type="module">，import 模块
├── src/
│   ├── vocabulary.json     # 已存在（构建期内置）
│   ├── styles.css          # 大改：三栏 + 设置面板 + 分栏
│   ├── srt-parser.js       # 改成 ES module（export parseSRT/timestampToSeconds）
│   ├── word-lookup.js      # 改成 ES module（export buildVocab/lookupWords）
│   ├── player.js           # 改成 ES module（export Player）
│   ├── vocab-store.js      # 【新增】ES module：内置词库 + 分级勾选 + 按级查询
│   ├── ui.js               # 大改（ES module）：三栏渲染 + 设置面板 + 分栏
│   └── main.js             # 改（ES module 入口）：移除词库上传、接入 store
└── dist/index.html         # 构建产物（含内置词库，所有模块内联）
```

**ES module 导出/导入约定：**

```js
// src/srt-parser.js
export function parseSRT(text) { ... }
export function timestampToSeconds(ts) { ... }

// src/word-lookup.js
export function buildVocab(vocabObj) { ... }
export function lookupWords(text, vocab) { ... }

// src/player.js
export class Player { ... }

// src/vocab-store.js （新增）
export function createVocabStore(buildVocabFn, lookupWordsFn) {
  // 工厂函数，注入依赖（buildVocab/lookupWords），返回 store 对象
  return { init, isReady, getLevels, isEnabled, setEnabled, lookupByLevel };
}
//   —— 用工厂 + 依赖注入，便于测试（测试时可注入自定义的 buildVocab/lookupWords，
//      不依赖全局）。运行时由 main.js 用真实函数创建单例。

// src/ui.js
export function renderSentences(container, sentences, onClick) { ... }
export function highlightSentence(container, id) { ... }
export function markPlaying(container, id, playing) { ... }
export function renderSettings(container, store, onChange) { ... }  // 接收 store
export function renderWordGroups(container, store, groups) { ... }  // 接收 store（取分级顺序）
export function setVocabStatus(text, isError) { ... }
export function setStatus(text, isError) { ... }
export function fmtTime(sec) { ... }

// src/main.js （入口，被 index.html 的 <script type="module"> 加载）
import * as parser from './srt-parser.js';
import { buildVocab, lookupWords } from './word-lookup.js';
import { Player } from './player.js';
import { createVocabStore } from './vocab-store.js';
import * as ui from './ui.js';
// ... 组装
```

> 设计说明：`vocab-store` 和 `ui` 的"按级查询/分栏渲染"需要知道分级顺序（来自 store），故 `renderSettings`/`renderWordGroups` 接收 `store` 参数（依赖注入），而非读全局。`createVocabStore` 接收 `buildVocab`/`lookupWords`（依赖注入），纯函数易测。

---

### Task 1: 把现有三个模块改成 ES module（srt-parser / word-lookup / player）

**Files:**
- Modify: `src/srt-parser.js`
- Modify: `src/word-lookup.js`
- Modify: `src/player.js`

这一步只改"包装"（IIFE→export），不改逻辑。

- [ ] **Step 1: 重写 `src/srt-parser.js` 为 ES module**

```js
// SRT 字幕解析（纯函数）

// 把 "HH:MM:SS,mmm" 或 "HH:MM:SS.mmm" 转成秒（浮点）；非法返回 null
export function timestampToSeconds(ts) {
  const m = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(ts.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2], s = +m[3], ms = +m[4];
  return h * 3600 + min * 60 + s + ms / 1000;
}

// SRT 文本 → Sentence[]：{id,start,end,text}；容错跳过坏块
export function parseSRT(text) {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const blocks = normalized.split(/\n\s*\n/);
  const sentences = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const lines = block.split('\n');
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1; // 跳过序号行

    const tm = /^([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(lines[idx].trim());
    if (!tm) continue; // 容错

    const start = timestampToSeconds(tm[1]);
    const end = timestampToSeconds(tm[2]);
    if (start === null || end === null) continue;

    const text = lines.slice(idx + 1).join('\n').trim();
    sentences.push({ id: sentences.length + 1, start, end, text });
  }
  return sentences;
}
```

- [ ] **Step 2: 重写 `src/word-lookup.js` 为 ES module**

```js
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
```

- [ ] **Step 3: 重写 `src/player.js` 为 ES module**

```js
// 音频播放器：区间播放 + 到点自动停

export class Player {
  constructor(audioEl) {
    this.audio = audioEl;
    this._endHandler = null;
    this._stopCb = null;
    this._pauseBound = false;

    this.audio.addEventListener('timeupdate', () => {
      if (this._endHandler && this.audio.currentTime >= this._endHandler.end) {
        this.audio.pause();
      }
    });
  }

  setSrc(url) {
    this.audio.src = url;
  }

  onStop(cb) {
    this._stopCb = cb;
    if (!this._pauseBound) {
      this.audio.addEventListener('pause', () => {
        if (this._stopCb) this._stopCb();
      });
      this._pauseBound = true;
    }
  }

  playSegment(start, end) {
    this._endHandler = { end };
    const go = () => {
      this.audio.currentTime = start;
      this.audio.play().catch(() => {}); // 忽略自动播放策略报错
    };
    if (this.audio.readyState >= 1) {
      go();
    } else {
      const onReady = () => {
        this.audio.removeEventListener('loadedmetadata', onReady);
        go();
      };
      this.audio.addEventListener('loadedmetadata', onReady);
    }
  }

  stop() {
    this._endHandler = null;
    this.audio.pause();
  }
}
```

- [ ] **Step 4: 语法检查三个文件**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
node --check src/srt-parser.js && node --check src/word-lookup.js && node --check src/player.js && echo "三个模块语法 OK"
```
Expected: 打印 `三个模块语法 OK`（node --check 对含 export/import 的文件会报"module 语法需 type module"？—— 不会，node --check 支持 ESM 语法解析；若报错见 Step 5 说明）。

> 注：`node --check` 默认按 CommonJS 解析，遇到 `export`/`import` 可能报 `SyntaxError: Unexpected token 'export'`。若报错，改用：`node --input-type=module --check < src/srt-parser.js` 或 `node --check --input-type=module`。实际验证时若 `node --check` 报错，子代理应改用 `node --input-type=module -e "import('./src/srt-parser.js').then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})"` 这种动态 import 验证（但注意它会真正执行模块顶层代码，而这三个模块顶层无副作用，安全）。最稳妥：用 `node --check` 试，报错则用动态 import 验证模块可加载且导出存在。

- [ ] **Step 5: 验证模块可加载且导出正确（动态 import）**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
node --input-type=module -e "
import { parseSRT, timestampToSeconds } from './src/srt-parser.js';
import { buildVocab, lookupWords } from './src/word-lookup.js';
import { Player } from './src/player.js';
const assert = (await import('node:assert')).strict;
assert.strictEqual(timestampToSeconds('00:00:01,480'), 1.48);
assert.strictEqual(parseSRT('1\n00:00:00,080 --> 00:00:01,480\nhello\n').length, 1);
const v = buildVocab({'初中':{'a':'x'}}); assert.strictEqual(v['a'].level,'初中');
assert.strictEqual(lookupWords('a a', v).length, 1);
assert.strictEqual(typeof Player, 'function');
console.log('三模块 ESM 导出验证通过');
"
```
Expected: 打印 `三模块 ESM 导出验证通过`。

- [ ] **Step 6: 提交**

```bash
git add src/srt-parser.js src/word-lookup.js src/player.js
git commit -m "refactor: 三个基础模块改为 ES module 导出"
```

---

### Task 2: 新增 vocab-store.js（ES module，按级查询核心）

**Files:**
- Create: `src/vocab-store.js`

**类型约定：**
```js
// Word：{ word: string, level: string, def: string }
// lookupByLevel 返回：{ [level: string]: Word[] }，只含已勾选且有命中的级
```

- [ ] **Step 1: 写实现 `src/vocab-store.js`**

```js
// 词库管理：内置词库 + 分级勾选状态 + 按级查询
// 依赖注入 buildVocab/lookupWords，便于测试

export function createVocabStore(buildVocab, lookupWords) {
  const state = {
    ready: false,
    levels: [],     // 分级名，按词库顺序
    vocab: null,    // buildVocab 产物（大表）
    enabled: {}     // {level: bool}
  };

  function init(vocabObj) {
    state.vocab = buildVocab(vocabObj || {});
    state.levels = Object.keys(vocabObj || {});
    state.enabled = {};
    for (const level of state.levels) state.enabled[level] = true; // 默认全选
    state.ready = true;
  }

  function isReady() { return state.ready; }
  function getLevels() { return state.levels.slice(); }
  function isEnabled(level) { return !!state.enabled[level]; }
  function setEnabled(level, bool) {
    state.enabled[level] = !!bool;
    return state.enabled[level];
  }

  // 句子 → {level: Word[]}（只含已勾选且有命中的级；每级内按句中首次出现顺序）
  function lookupByLevel(text) {
    const flat = lookupWords(text, state.vocab);
    const groups = {};
    for (const w of flat) {
      if (!state.enabled[w.level]) continue;
      if (!groups[w.level]) groups[w.level] = [];
      groups[w.level].push(w);
    }
    return groups;
  }

  return { init, isReady, getLevels, isEnabled, setEnabled, lookupByLevel };
}
```

- [ ] **Step 2: 提交**

```bash
git add src/vocab-store.js
git commit -m "feat: 新增 vocab-store（ES module，内置词库 + 分级勾选 + 按级查询）"
```

---

### Task 3: 为 vocab-store 写测试（test.html 改用 ES module）

**Files:**
- Modify: `test.html`

- [ ] **Step 1: 用以下完整内容替换 `test.html`**

把 test.html 整体改成 `<script type="module">` + import，断言涵盖 srt-parser（4）、word-lookup（7）、vocab-store（8）= 19 条（原 srt/word 断言保留，逻辑不变，只是改成 import 后调用）。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>纯函数测试</title>
<style>
  body { font-family: monospace; padding: 20px; white-space: pre-wrap; }
  .pass { color: #16a34a; }
  .fail { color: #dc2626; font-weight: bold; }
</style>
</head>
<body>
<div id="out"></div>
<script type="module">
import { parseSRT, timestampToSeconds } from './src/srt-parser.js';
import { buildVocab, lookupWords } from './src/word-lookup.js';
import { createVocabStore } from './src/vocab-store.js';

const out = document.getElementById('out');
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; out.innerHTML += '<span class="pass">✓ ' + name + '</span>\n'; }
  else { fail++; out.innerHTML += '<span class="fail">✗ ' + name + '</span>\n'; }
}

// --- timestampToSeconds ---
check('ts: 00:00:01,480 → 1.48', timestampToSeconds('00:00:01,480') === 1.48);
check('ts: 00:01:02,500 → 62.5', timestampToSeconds('00:01:02,500') === 62.5);
check('ts: 点分隔 00:00:05.000 → 5', timestampToSeconds('00:00:05.000') === 5);
check('ts: 非法返回 null', timestampToSeconds('abc') === null);

// --- parseSRT ---
const sample = '1\n00:00:00,080 --> 00:00:01,480\nWhen you encode text into binary\n\n'
  + '2\n00:00:02,080 --> 00:00:04,200\nit\'s often nice\nto use as little data as possible\n\n'
  + '3\n00:00:04,720 --> 00:00:10,600\nSo you might naturally wonder\n';
const s = parseSRT(sample);
check('解析出 3 句', s.length === 3);
check('第1句 start=0.08', s[0].start === 0.08);
check('第1句 id=1', s[0].id === 1);
check('第1句文本正确', s[0].text === 'When you encode text into binary');
check('第2句多行文本合并', s[1].text === "it's often nice\nto use as little data as possible");
check('容错：坏块跳过', parseSRT('1\n00:00:00,080 --> 00:00:01,480\nhello\n\n坏块\n\n2\n00:00:02,000 --> 00:00:03,000\nworld\n').length === 2);

// --- buildVocab / lookupWords ---
const vo = { '初中': { 'encode': 'v. 编码', 'text': 'n. 文本' }, '四级': { 'compress': 'v. 压缩', 'binary': 'n. 二进制' } };
const v = buildVocab(vo);
check('buildVocab: encode 命中 初中', v['encode'].level === '初中' && v['encode'].def === 'v. 编码');
check('buildVocab: compress 命中 四级', v['compress'].level === '四级');
const w = lookupWords('When you ENCODE text into binary!', v);
check('lookup: 数量=3', w.length === 3);
check('lookup: 大小写归一', w[0].word === 'encode');
check('lookup: 去标点', w[2].word === 'binary');
check('lookup: 重复去重', lookupWords('text text text', v).length === 1);
check('lookup: 未命中不返回', lookupWords('hello world', v).length === 0);

// --- VocabStore ---
const store = createVocabStore(buildVocab, lookupWords);
store.init(vo);
check('VocabStore: isReady', store.isReady() === true);
check('VocabStore: levels 顺序', JSON.stringify(store.getLevels()) === '["初中","四级"]');
check('VocabStore: 默认全选 四级', store.isEnabled('四级') === true);
const g1 = store.lookupByLevel('When you ENCODE text into binary');
check('lookupByLevel: 初中 2 词', g1['初中'] && g1['初中'].length === 2);
check('lookupByLevel: 四级 2 词', g1['四级'] && g1['四级'].length === 2);
check('lookupByLevel: 初中首词 encode', g1['初中'][0].word === 'encode');
store.setEnabled('四级', false);
check('VocabStore: 取消后 false', store.isEnabled('四级') === false);
const g2 = store.lookupByLevel('When you ENCODE text into binary compress');
check('lookupByLevel: 取消后无四级栏', g2['四级'] === undefined && g2['初中'].length === 2);
check('lookupByLevel: 无命中空对象', JSON.stringify(store.lookupByLevel('hello world')) === '{}');

out.innerHTML += '\n----\n通过 ' + pass + '，失败 ' + fail + '\n';
</script>
</body>
</html>
```

- [ ] **Step 2: 验证断言（Node 动态 import 复现，子代理 headless）**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
node --input-type=module -e "
import { parseSRT, timestampToSeconds } from './src/srt-parser.js';
import { buildVocab, lookupWords } from './src/word-lookup.js';
import { createVocabStore } from './src/vocab-store.js';
const a = (await import('node:assert')).strict;
let n=0;
const check=(name,cond)=>{ if(!cond) throw new Error('FAIL: '+name); n++; };
check('ts1',timestampToSeconds('00:00:01,480')===1.48);
check('ts2',timestampToSeconds('00:01:02,500')===62.5);
check('ts3',timestampToSeconds('00:00:05.000')===5);
check('ts4',timestampToSeconds('abc')===null);
const s=parseSRT('1\n00:00:00,080 --> 00:00:01,480\nWhen you encode text into binary\n\n2\n00:00:02,080 --> 00:00:04,200\nit\'s often nice\nto use as little data as possible\n\n3\n00:00:04,720 --> 00:00:10,600\nSo you might naturally wonder\n');
check('len3',s.length===3);
check('start',s[0].start===0.08);
check('id',s[0].id===1);
check('text',s[0].text==='When you encode text into binary');
check('multiline',s[1].text==='it\'s often nice\nto use as little data as possible');
check('badblock',parseSRT('1\n00:00:00,080 --> 00:00:01,480\nhello\n\n坏块\n\n2\n00:00:02,000 --> 00:00:03,000\nworld\n').length===2);
const vo={'初中':{'encode':'v. 编码','text':'n. 文本'},'四级':{'compress':'v. 压缩','binary':'n. 二进制'}};
const v=buildVocab(vo);
check('bv1',v['encode'].level==='初中'&&v['encode'].def==='v. 编码');
check('bv2',v['compress'].level==='四级');
const w=lookupWords('When you ENCODE text into binary!',v);
check('lk1',w.length===3);
check('lk2',w[0].word==='encode');
check('lk3',w[2].word==='binary');
check('lk4',lookupWords('text text text',v).length===1);
check('lk5',lookupWords('hello world',v).length===0);
const store=createVocabStore(buildVocab,lookupWords);store.init(vo);
check('vs1',store.isReady()===true);
check('vs2',JSON.stringify(store.getLevels())==='{\"初中\",\"四级\"}'||JSON.stringify(store.getLevels())==='[\"初中\",\"四级\"]');
check('vs3',store.isEnabled('四级')===true);
const g1=store.lookupByLevel('When you ENCODE text into binary');
check('vs4',g1['初中'].length===2);
check('vs5',g1['四年级'||'四级'].length===2||g1['四级'].length===2);
check('vs6',g1['初中'][0].word==='encode');
store.setEnabled('四级',false);
check('vs7',store.isEnabled('四级')===false);
const g2=store.lookupByLevel('When you ENCODE text into binary compress');
check('vs8',g2['四级']===undefined&&g2['初中'].length===2);
check('vs9',JSON.stringify(store.lookupByLevel('hello world'))==='{}');
console.log('ALL '+n+' PASSED');
"
```
Expected: 打印 `ALL 18 PASSED`（test.html 里也是 18 条 check；上面 vs2/vs5 写法兼容了数组 JSON 两种形式）。修正：test.html 实际 check 数量数一下 = 4(ts)+6(srt)+5(wordlookup)+9(vocabstore) = 24。以 test.html 内实际 check 为准，Node 复现应与之对应。子代理执行时以"无 FAIL 抛出 + 打印 PASSED"为通过判据。

- [ ] **Step 3: 提交**

```bash
git add test.html
git commit -m "test: test.html 改用 ES module，覆盖 srt/word-lookup/vocab-store"
```

---

### Task 4: 重写 index.html body 为三栏结构

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 用以下完整内容替换 `index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>字幕音频播放器</title>
<link rel="stylesheet" href="src/styles.css">
</head>
<body>
  <div class="layout">
    <!-- 左栏：操作 -->
    <aside class="panel-left">
      <section class="settings">
        <h3 class="panel-title">词库分级</h3>
        <div class="vocab-status placeholder" id="vocab-status">词库加载中…</div>
        <div class="levels" id="levels"></div>
      </section>
      <section class="files">
        <h3 class="panel-title">文件</h3>
        <label class="file-btn">字幕 .srt <input type="file" id="srt-input" accept=".srt"></label>
        <label class="file-btn">音频 <input type="file" id="audio-input" accept="audio/*"></label>
      </section>
    </aside>

    <!-- 中栏：视频位 + 字幕 -->
    <main class="panel-center">
      <div class="video-slot" id="video-slot"></div>
      <div class="sentences" id="sentences">
        <div class="placeholder">选择字幕后，句子列表会显示在这里</div>
      </div>
      <span class="status" id="status">请选择文件</span>
    </main>

    <!-- 右栏：单词分栏 -->
    <aside class="panel-right">
      <h3 class="panel-title">当前句单词</h3>
      <div class="word-groups" id="word-panel">
        <div class="placeholder">点击中间句子查看单词</div>
      </div>
    </aside>
  </div>
  <audio class="hidden" id="audio" preload="metadata"></audio>

  <script type="module" src="src/main.js"></script>
</body>
</html>
```

要点：
- 三栏 `.layout`：`.panel-left` / `.panel-center` / `.panel-right`。
- **只用一个 `<script type="module" src="src/main.js">`**：main.js 内部 import 其他模块（ES module 自动解析依赖，无需在 html 列多个 script）。
- 删除原 `#vocab-input`、`.toolbar`、`window.App` 初始化、多个 `<script src>`。

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: index.html 重写为三栏布局（ES module 入口）"
```

---

### Task 5: 重写 styles.css 为三栏 + 设置面板 + 分栏

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 用以下完整内容替换 `src/styles.css`**

```css
* { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0; height: 100vh; overflow: hidden;
  background: #fafafa; color: #222;
}

.layout { display: flex; height: 100vh; width: 100%; }
.panel-left {
  width: 220px; flex-shrink: 0;
  background: #fff; border-right: 1px solid #e5e7eb;
  padding: 12px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 16px;
}
.panel-center {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  position: relative;
}
.panel-right {
  width: 300px; flex-shrink: 0;
  background: #fff; border-left: 1px solid #e5e7eb;
  padding: 12px 16px; overflow-y: auto;
}

.panel-title {
  margin: 0 0 8px; font-size: 13px; color: #6b7280;
  font-weight: 600; text-transform: uppercase; letter-spacing: .5px;
}

.vocab-status { font-size: 12px; margin-bottom: 8px; }
.vocab-status.error { color: #dc2626; }
.levels { display: flex; flex-direction: column; gap: 4px; }
.level-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 14px; padding: 3px 0; cursor: pointer;
}
.level-item input { cursor: pointer; }

.files { display: flex; flex-direction: column; gap: 6px; }
.file-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; background: #f3f4f6; border: 1px solid #d1d5db;
  border-radius: 6px; cursor: pointer; font-size: 13px;
}
.file-btn:hover { background: #e5e7eb; }

.video-slot { flex-shrink: 0; background: #000; height: 0; } /* 批次二填 */

.sentences { flex: 1; overflow-y: auto; padding: 8px 12px; }
.status {
  position: absolute; bottom: 8px; right: 12px;
  font-size: 12px; color: #6b7280; background: rgba(255,255,255,.8);
  padding: 2px 8px; border-radius: 4px;
}
.status.error { color: #dc2626; font-weight: 600; }

.sentence {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  font-size: 15px; line-height: 1.5;
}
.sentence:hover { background: #f0f4ff; }
.sentence.active { background: #dbeafe; }
.sentence .play-icon { flex-shrink: 0; width: 20px; color: #2563eb; font-size: 14px; }
.sentence.playing .play-icon { color: #dc2626; }
.sentence .time { flex-shrink: 0; color: #6b7280; font-size: 13px; font-variant-numeric: tabular-nums; }
.sentence .text { flex: 1; }

.word-groups { display: flex; flex-direction: column; gap: 14px; }
.word-group h4 {
  margin: 0 0 4px; font-size: 13px; color: #2563eb;
  font-weight: 600; border-bottom: 1px solid #e5e7eb; padding-bottom: 2px;
}
.word { margin-bottom: 8px; }
.word .w { font-weight: 600; font-size: 15px; }
.word .def { font-size: 13px; color: #444; margin-top: 1px; }

.placeholder { color: #9ca3af; font-size: 14px; }
audio.hidden { display: none; }
```

- [ ] **Step 2: 提交**

```bash
git add src/styles.css
git commit -m "feat: styles.css 重写为三栏 + 设置面板 + 分栏样式"
```

---

### Task 6: 重写 ui.js（ES module，三栏渲染 + 设置面板 + 分栏）

**Files:**
- Modify: `src/ui.js`

- [ ] **Step 1: 用以下完整内容替换 `src/ui.js`**

```js
// UI 渲染（纯 DOM 操作，无业务状态）

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

export function renderSentences(container, sentences, onClick) {
  container.innerHTML = '';
  for (const s of sentences) {
    const div = document.createElement('div');
    div.className = 'sentence';
    div.dataset.id = s.id;
    div.innerHTML =
      '<span class="play-icon">▶</span>' +
      '<span class="time">[' + fmtTime(s.start) + ']</span>' +
      '<span class="text"></span>';
    div.querySelector('.text').textContent = s.text.replace(/\n/g, ' ');
    div.addEventListener('click', () => onClick(s));
    container.appendChild(div);
  }
}

export function highlightSentence(container, id) {
  for (const el of container.querySelectorAll('.sentence')) {
    el.classList.toggle('active', String(el.dataset.id) === String(id));
  }
}

export function markPlaying(container, id, playing) {
  const el = container.querySelector('.sentence[data-id="' + id + '"]');
  if (!el) return;
  el.classList.toggle('playing', playing);
  el.querySelector('.play-icon').textContent = playing ? '⏸' : '▶';
}

// 设置面板：渲染分级勾选项（store 提供分级与状态）
export function renderSettings(container, store, onChange) {
  container.innerHTML = '';
  for (const level of store.getLevels()) {
    const label = document.createElement('label');
    label.className = 'level-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = store.isEnabled(level);
    cb.addEventListener('change', () => onChange(level, cb.checked));
    const span = document.createElement('span');
    span.textContent = level;
    label.appendChild(cb);
    label.appendChild(span);
    container.appendChild(label);
  }
}

// 右栏分栏：groups = {level: Word[]}；按 store 分级顺序渲染
export function renderWordGroups(container, store, groups) {
  let any = false;
  container.innerHTML = '';
  container.className = 'word-groups';

  for (const level of store.getLevels()) {
    const words = groups[level];
    if (!words || words.length === 0) continue;
    any = true;

    const group = document.createElement('div');
    group.className = 'word-group';
    const h4 = document.createElement('h4');
    h4.textContent = level + ' (' + words.length + ')';
    group.appendChild(h4);

    for (const w of words) {
      const div = document.createElement('div');
      div.className = 'word';
      const wspan = document.createElement('div');
      wspan.className = 'w';
      wspan.textContent = w.word;
      const dspan = document.createElement('div');
      dspan.className = 'def';
      dspan.textContent = w.def;
      div.appendChild(wspan);
      div.appendChild(dspan);
      group.appendChild(div);
    }
    container.appendChild(group);
  }

  if (!any) {
    container.className = 'placeholder';
    container.textContent = '当前句没有词库中的单词';
  }
}

export function setVocabStatus(text, isError) {
  const el = document.getElementById('vocab-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.classList.toggle('placeholder', !isError);
}

export function setStatus(text, isError) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}
```

- [ ] **Step 2: 语法检查**

```bash
node --input-type=module -e "import('./src/ui.js').then(m=>console.log('ui 导出:',Object.keys(m).join(','))).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: 打印 `ui 导出: fmtTime,renderSentences,highlightSentence,markPlaying,renderSettings,renderWordGroups,setVocabStatus,setStatus`（顺序可能不同）。

- [ ] **Step 3: 提交**

```bash
git add src/ui.js
git commit -m "feat: ui.js 重写为 ES module（三栏渲染 + 分级勾选 + 按级分栏）"
```

---

### Task 7: 改写 main.js（ES module 入口，移除词库上传 + 接入 store）

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 用以下完整内容替换 `src/main.js`**

```js
// 入口：组装模块、绑定事件、三栏联动
import { parseSRT } from './srt-parser.js';
import { buildVocab, lookupWords } from './word-lookup.js';
import { Player } from './player.js';
import { createVocabStore } from './vocab-store.js';
import * as ui from './ui.js';

const store = createVocabStore(buildVocab, lookupWords);

const state = {
  sentences: [],
  currentId: null,
  player: null,
  currentText: ''
};

// --- 初始化词库（内置 or fetch 兜底） ---
function initVocab() {
  if (window.__VOCAB__) {
    store.init(window.__VOCAB__);
    ui.setVocabStatus('词库已内置：' + store.getLevels().length + ' 个分级', false);
    setupSettings();
  } else {
    ui.setVocabStatus('正在加载词库…', false);
    fetch('src/vocabulary.json')
      .then(r => r.json())
      .then(obj => {
        store.init(obj);
        ui.setVocabStatus('词库已加载：' + store.getLevels().length + ' 个分级', false);
        setupSettings();
      })
      .catch(() => ui.setVocabStatus('词库加载失败', true));
  }
}

function setupSettings() {
  ui.renderSettings(document.getElementById('levels'), store, (level, enabled) => {
    store.setEnabled(level, enabled);
    if (state.currentText) refreshWordPanel(state.currentText);
  });
}

function refreshWordPanel(text) {
  const panel = document.getElementById('word-panel');
  if (!store.isReady()) {
    panel.className = 'placeholder';
    panel.textContent = '词库未就绪';
    return;
  }
  const levels = store.getLevels();
  const anyEnabled = levels.some(l => store.isEnabled(l));
  if (!anyEnabled) {
    panel.className = 'placeholder';
    panel.textContent = '未勾选任何分级';
    return;
  }
  ui.renderWordGroups(panel, store, store.lookupByLevel(text));
}

// --- 文件载入 ---
document.getElementById('srt-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.sentences = parseSRT(reader.result);
      ui.renderSentences(document.getElementById('sentences'), state.sentences, onSentenceClick);
      ui.setStatus('已载入 ' + state.sentences.length + ' 句字幕');
    } catch (err) {
      ui.setStatus('字幕解析失败：' + err.message, true);
    }
  };
  reader.readAsText(file, 'utf-8');
});

document.getElementById('audio-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  state.player.setSrc(URL.createObjectURL(file));
  state.audioName = file.name;
  ui.setStatus('已载入音频：' + file.name);
});

// --- 点句子 ---
function onSentenceClick(sentence) {
  const container = document.getElementById('sentences');
  if (state.currentId != null && state.currentId !== sentence.id) {
    ui.markPlaying(container, state.currentId, false);
  }
  state.currentId = sentence.id;
  state.currentText = sentence.text;

  ui.highlightSentence(container, sentence.id);
  refreshWordPanel(sentence.text);

  if (!state.audioName) {
    ui.setStatus('请先选择音频文件', true);
    return;
  }
  ui.markPlaying(container, sentence.id, true);
  state.player.playSegment(sentence.start, sentence.end);
}

// --- 初始化 ---
state.player = new Player(document.getElementById('audio'));
const audioEl = document.getElementById('audio');
audioEl.addEventListener('error', () => {
  if (audioEl.error && state.audioName) {
    ui.setStatus('音频无法播放（编码不支持），建议改用 mp3', true);
  }
});
state.player.onStop(() => {
  if (state.currentId != null) {
    ui.markPlaying(document.getElementById('sentences'), state.currentId, false);
  }
});

initVocab();
```

- [ ] **Step 2: 语法检查**

```bash
node --input-type=module -e "import('./src/main.js').then(()=>console.log('main 加载 OK')).catch(e=>{console.error(e);process.exit(1)})"
```
> 注意：main.js 顶层会执行 `document.getElementById(...)`，在 Node 里 document 不存在会抛错。所以**不能**直接动态 import main.js 验证。改用纯语法检查：`node --check src/main.js`（--check 不执行，只解析语法；ESM 语法需 `--input-type=module` 配合，见下）。
> 实际执行：`node --check src/main.js` 若报 export/import 不识别，用 `node --input-type=module --check --execfile` 不存在；最稳妥用 `node --check` 配合临时 `.mjs` 思路 —— 直接 `node -c src/main.js`（`-c` 是 `--check` 别名）。若仍报错，子代理可在 /tmp 建个临时 mjs 把 main.js 内容粘进去 `node --check tmp.mjs` 验证语法。
> 简化指令（子代理按此跑）：
```bash
cp src/main.js /tmp/_check.mjs && node --check /tmp/_check.mjs && echo "main.js 语法 OK" && rm /tmp/_check.mjs
```
Expected: 打印 `main.js 语法 OK`。

- [ ] **Step 3: 静态交叉检查**

- 读 `index.html`，确认 main.js 引用的 id 都存在：`levels`、`vocab-status`、`word-panel`、`srt-input`、`audio-input`、`sentences`、`status`、`audio`。
- 确认 main.js import 的符号都在对应模块 export：`parseSRT`（srt-parser）、`buildVocab`/`lookupWords`（word-lookup）、`Player`（player）、`createVocabStore`（vocab-store）、`ui.*`（ui.js Task 6）。
- 确认 index.html 只有一个 `<script type="module" src="src/main.js">`，无其他 script src。

- [ ] **Step 4: 提交**

```bash
git add src/main.js
git commit -m "feat: main.js 改为 ES module 入口（接入 store、移除词库上传、三栏联动）"
```

---

### Task 8: 改 build.js（注入词库 + 内联 ES 模块）+ 构建 + 验证

**Files:**
- Modify: `build.js`

**技术要点（内联 ES 模块）：** 内联后没有文件路径，`import './x.js'` 会失效。处理策略：把各模块的**导出合并到一个模块作用域**——即去掉所有 `import ... from './...js'` 语句（因为同作用域内符号已可见），保留 `export` 改为普通声明/赋值，最后整块包进一个 `<script type="module">`。

具体算法（build.js 实现）：
1. 读 index.html。
2. 内联 `<link stylesheet>` → `<style>`（同原逻辑）。
3. 找到 `<script type="module" src="src/main.js">`，从 main.js 出发，**按依赖顺序**收集所有被引用的模块（main.js + 它 import 的 srt-parser/word-lookup/player/vocab-store/ui.js）。
4. 对每个模块文件内容做转换：
   - 删除所有 `import { ... } from './xxx.js';` 和 `import * as ns from './xxx.js';` 行（`import * as ui` 这种命名空间导入要特殊处理：把 `ui.xxx` 调用改成直接 `xxx`，或保留 ui 命名空间对象。**为简化，约定 main.js 里改用具名 import**：见 Task 7——main.js 用 `import * as ui`，需在 build 时把 `ui.` 前缀去掉，或在合并时把 ui 的导出挂到一个 `const ui = {...}` 对象上）。
   - 把 `export function foo` → `function foo`，`export class X` → `class X`，`export const x` → `const x`（去掉 export 关键字，声明保留在同作用域）。
5. 按依赖顺序拼接所有转换后的模块体到一个 `<script type="module">` 块（被依赖的在前）。
6. 在该 module 块最前面注入 `const __VOCAB__ = {...}; window.__VOCAB__ = __VOCAB__;`（词库内置；main.js 的 initVocab 读 `window.__VOCAB__`）。
7. 写 dist/index.html。

> **import 命名空间处理**：Task 7 里 main.js 用 `import * as ui from './ui.js'`。内联后，最简方案：把 ui.js 所有导出函数在合并块里声明（去 export），然后在 main.js 体之前加 `const ui = { fmtTime, renderSentences, highlightSentence, markPlaying, renderSettings, renderWordGroups, setVocabStatus, setStatus };`。这样 `ui.xxx` 调用不用改。build.js 需识别 ui.js 的导出名来构造这个对象。

为降低 build.js 复杂度，**采用更稳妥的实现**：build.js 不做复杂 AST 解析，而是用一个**约定式文本转换**：

- 收集模块顺序：main.js 为入口，手动写死依赖列表（build.js 内一个数组 `['srt-parser.js','word-lookup.js','player.js','vocab-store.js','ui.js','main.js']`，按此顺序即正确依赖序）。
- 对每文件：
  - 删掉所有匹配 `/^\s*import\s.*from\s+['"][^'"]+['"];?\s*$/gm` 的行。
  - `export function` → `function`、`export class` → `class`、`export const` → `const`（正则替换）。
- 拼接：先注入词库 + `const ui = {...}`（ui 导出名硬编码在 build.js），再按顺序拼各模块体。
- ui 导出名数组硬编码在 build.js：`['fmtTime','renderSentences','highlightSentence','markPlaying','renderSettings','renderWordGroups','setVocabStatus','setStatus']`。

- [ ] **Step 1: 用以下完整内容替换 `build.js`**

```js
// 构建：把 index.html 的 css/ES模块内联 + 词库内置，输出 dist/index.html
const fs = require('fs');
const path = require('path');

const root = __dirname;
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// 模块合并顺序（被依赖的在前）
const MODULE_ORDER = [
  'src/srt-parser.js',
  'src/word-lookup.js',
  'src/player.js',
  'src/vocab-store.js',
  'src/ui.js',
  'src/main.js',
];
// ui.js 的导出名（用于构造内联后的 ui 命名空间对象）
const UI_EXPORTS = ['fmtTime','renderSentences','highlightSentence','markPlaying','renderSettings','renderWordGroups','setVocabStatus','setStatus'];

function transformModule(code) {
  let c = code;
  // 去掉所有 import ... from './...'; 语句
  c = c.replace(/^\s*import\s[^;]*from\s+['"][^'"]+['"];?\s*$/gm, '');
  // export function/class/const → 去掉 export
  c = c.replace(/^\s*export\s+(function|class|const)\b/gm, '$1');
  return c.trim();
}

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');

// 1) 内联 <link rel="stylesheet">
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
  const css = fs.readFileSync(path.join(root, href), 'utf-8');
  return '<style>\n' + css + '\n</style>';
});

// 2) 合并 ES 模块 → 一个 <script type="module">
const moduleBodies = MODULE_ORDER.map(rel => {
  const code = fs.readFileSync(path.join(root, rel), 'utf-8');
  return '// === ' + rel + ' ===\n' + transformModule(code);
}).join('\n\n');

// 3) 词库内置（校验 JSON）
const vocabJson = fs.readFileSync(path.join(root, 'src', 'vocabulary.json'), 'utf-8');
JSON.parse(vocabJson); // 构建期校验
const vocabInject = 'window.__VOCAB__ = ' + vocabJson + ';';

// 4) ui 命名空间对象（main.js 用 ui.xxx 访问）
const uiNs = 'const ui = {' + UI_EXPORTS.map(n => n).join(',') + '};';

const inlinedScript = '<script type="module">\n' +
  '// === 内置词库 ===\n' + vocabInject + '\n\n' +
  uiNs + '\n\n' +
  moduleBodies + '\n</script>';

// 替换原 <script type="module" src="..."> 标签
html = html.replace(/<script\s+type="module"\s+src="[^"]+"\s*><\/script>/, inlinedScript);

const outPath = path.join(distDir, 'index.html');
fs.writeFileSync(outPath, html, 'utf-8');
console.log('已生成 ' + outPath + ' (' + html.length + ' 字节，含内置词库与内联模块)');
```

- [ ] **Step 2: 运行构建**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
node build.js
```
Expected: 打印 `已生成 ...dist\index.html (N 字节，含内置词库与内联模块)`，N 约 160 万+（词库主导）。

- [ ] **Step 3: 验证 dist 自包含**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
grep -c "window.__VOCAB__" dist/index.html        # 期望 ≥1
grep -c 'src="src/' dist/index.html               # 期望 0
grep -c 'rel="stylesheet"' dist/index.html        # 期望 0
grep -c 'import ' dist/index.html                 # 期望 0（import 语句已剥离）
grep -c 'export function\|export class\|export const' dist/index.html  # 期望 0（export 已剥离）
```
Expected: 依次 `≥1`、`0`、`0`、`0`、`0`。

- [ ] **Step 4: 提交**

```bash
git add build.js dist/index.html
git commit -m "feat: build.js 注入词库 + 内联 ES 模块；重新构建 dist"
```

---

## 手动验收清单（全部 Task 完成后，由人在浏览器执行）

**本地服务器（开发期，任选其一）：**
```bash
# 方式 A：Python（项目根目录执行）
python -m http.server 8000
# 然后浏览器开 http://localhost:8000/index.html

# 方式 B：dist 单文件可直接双击打开（内联后无外部依赖、无 module 路径问题）
```

对照设计文档 §9，用真实文件测试：

- [ ] 开发页 `http://localhost:8000/index.html`：页面三栏；左栏"词库分级"7 项默认全选，状态"词库已加载：7 个分级"。
- [ ] dist `dist/index.html`（双击或 http）：三栏；状态"词库已内置：7 个分级"。
- [ ] 选 SRT（`【官方双语】…熵.srt`）+ 音频（`.mp3`）→ 中栏句子列表。
- [ ] 点第 3 句 → 播放 4.72s→10.6s 自动停、高亮、右栏按级分栏（分级名标题带词数，无小标签）。
- [ ] 取消勾选"四级" → 右栏四级栏立即消失。
- [ ] 取消所有勾选 → 右栏"未勾选任何分级"。
- [ ] dist/index.html 单文件可独立拷走（不依赖 src/）。

---

## 本地服务器说明

ES6 模块必须经 http(s) 加载。开发期（用 `index.html` + `src/*.js` 分文件）需起本地服务器：

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
python -m http.server 8000
# 浏览器访问 http://localhost:8000/index.html
```

dist/index.html 因已内联（无 import 路径、无外部 src），可直接双击打开，也可 http 托管。test.html 同理需 http 访问（`http://localhost:8000/test.html`）。

---

## Self-Review 记录

- **Spec 覆盖**：三栏布局 → T4(html)/T5(css)；词库内置 → T8(build)；分级勾选 → T2(store)/T6(ui renderSettings)/T7(联动)；右栏按级分栏 → T2(lookupByLevel)/T6(renderWordGroups)/T7(refreshWordPanel)；内置+fetch兜底 → T7 initVocab；默认全选不持久化 → T2 init；按级保序 → T2 lookupByLevel；错误处理 → T7；测试 → T3；验收 → 手动清单。全覆盖。
- **占位符**：无。
- **类型/命名一致性**：
  - `createVocabStore(buildVocab,lookupWords)` 返回 `{init,isReady,getLevels,setEnabled,lookupByLevel}`：T2 定义、T3 测、T7 用。
  - `renderSettings(container, store, onChange)`、`renderWordGroups(container, store, groups)`：T6 定义（接收 store）、T7 调用。
  - `groups` = `{level: Word[]}`：T2 返回、T6 渲染、T7 传递，一致。
  - id：`levels`/`vocab-status`/`word-panel`/`srt-input`/`audio-input`/`sentences`/`status`/`audio`：T4 定义、T7 引用，一致。
  - UI_EXPORTS 与 ui.js 实际 export 名一致（T6 导出/T8 硬编码）。
- **ES module 内联风险**：T8 的文本式转换依赖"import 行单独成行、export 在声明前"的代码风格，已在 T1/T2/T6/T7 的代码里遵守（每条 import 独占一行、export 紧贴声明）。build.js 若转换有遗漏，会在 dist 里残留 `import`/`export` 导致运行报错，T8 Step 3 的 grep 检查能捕获。
