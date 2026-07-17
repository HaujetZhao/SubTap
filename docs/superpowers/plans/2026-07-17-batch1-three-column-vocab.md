# 批次一实施计划：三栏布局 + 词库内置 + 分级勾选

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把第一版（顶部按钮栏 + 用户选词库 + 右栏扁平单词）重构为三栏布局（左设置/中字幕/右单词）、词库构建期内置、左栏分级勾选、右栏按级分栏显示。

**Architecture:** 沿用第一版"多文件开发 + build.js 内联成 dist/index.html"。新增 `src/vocab-store.js` 管内置词库 + 勾选状态 + 按级查询；重写 `index.html` body、`styles.css`、`ui.js`；调整 `main.js`（移除词库上传、接入 store）和 `build.js`（注入词库）。`srt-parser.js`、`word-lookup.js`、`player.js` 不动。纯函数（按级分组）扩展 test.html 验证。

**Tech Stack:** 原生 HTML/CSS/JS（无框架）、Node（构建脚本）、浏览器测试页。

**当前状态:** 在 `feature/srt-audio-player` 分支。目录已扁平化（无 player/ 层级）。第一版功能完整可用。

**关键约束（所有子代理必须遵守）：**
- 用户偏好：注释/总结用中文。Windows 10，但 shell 是 bash（正斜杠、Unix 语法）。
- 模块用 IIFE 挂 `window.App` 命名空间，ES5 语法（与现有代码一致，`var`、`function`，不用 ES6 模块/import）。
- 现有 `App.lookupWords(text, vocab大表)` 返回扁平 `Word[]`（每项 `{word, level, def}`）；现有 `App.buildVocab(vocabObj)` 把两级词库 `{level:{word:def}}` 合并成大表 `{word:{level,def}}`。这俩在 `src/word-lookup.js`，**本批不动，直接复用**。

---

## 文件结构总览

```
（项目根目录）
├── index.html              # 重写 body：三栏结构
├── build.js                # 改：注入词库
├── test.html               # 扩展：vocab-store 断言
├── src/
│   ├── vocabulary.json     # 已存在（构建期内置）
│   ├── styles.css          # 大改：三栏 + 设置面板 + 分栏
│   ├── srt-parser.js       # 不变
│   ├── word-lookup.js      # 不变
│   ├── player.js           # 不变
│   ├── vocab-store.js      # 【新增】
│   ├── ui.js               # 大改：三栏渲染 + 设置面板 + 分栏
│   └── main.js             # 改：移除词库上传、接入 store
└── dist/index.html         # 构建产物（含内置词库）
```

**新增模块接口约定（vocab-store.js，挂在 window.App）：**
```js
// App.VocabStore.init(vocabObj)     —— 用两级词库初始化（内部 buildVocab + 记录分级顺序 + 默认全选）
// App.VocabStore.getLevels()        —— 返回分级名数组，按词库顺序（如 ['初中','高中','四级',...]）
// App.VocabStore.isEnabled(level)   —— 某分级是否勾选
// App.VocabStore.setEnabled(level, bool) —— 勾选/取消，返回新状态
// App.VocabStore.lookupByLevel(text) —— 返回 {level: Word[]}，只含已勾选且有命中的分级，每级内按句中首次出现顺序
// App.VocabStore.isReady()          —— 词库是否已加载
```

**ui.js 新增/改动接口（挂 window.App）：**
```js
// App.renderSettings(container, onChange)  —— 渲染分级勾选面板；勾选变更调 onChange(level, bool)
// App.renderWordGroups(container, groups)  —— groups = {level: Word[]}；按级分栏渲染；空则占位
// App.setVocabStatus(text, isError)        —— 左栏词库状态（替代部分 setStatus 用途）
// （沿用）App.renderSentences / highlightSentence / markPlaying / fmtTime / setStatus
```

---

### Task 1: 新增 vocab-store.js（按级查询核心）

**Files:**
- Create: `src/vocab-store.js`

**类型约定：**
```js
// Word（来自 word-lookup.js）：{ word: string, level: string, def: string }
// lookupByLevel 返回：{ [level: string]: Word[] }，只含已勾选且有命中的级
```

- [ ] **Step 1: 写实现 `src/vocab-store.js`**

```js
(function (App) {
  'use strict';

  var state = {
    ready: false,
    levels: [],      // 分级名，按词库顺序
    vocab: null,     // buildVocab 产物（大表 {word:{level,def}}）
    enabled: {}      // {level: bool}
  };

  function init(vocabObj) {
    state.vocab = App.buildVocab(vocabObj || {});
    // 分级顺序取自词库 key 顺序
    state.levels = Object.keys(vocabObj || {});
    state.enabled = {};
    for (var i = 0; i < state.levels.length; i++) {
      state.enabled[state.levels[i]] = true; // 默认全选
    }
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
    var flat = App.lookupWords(text, state.vocab); // 扁平 Word[]，已按句中顺序、去重
    var groups = {};
    for (var i = 0; i < flat.length; i++) {
      var w = flat[i];
      if (!state.enabled[w.level]) continue;
      if (!groups[w.level]) groups[w.level] = [];
      groups[w.level].push(w);
    }
    return groups;
  }

  App.VocabStore = {
    init: init,
    isReady: isReady,
    getLevels: getLevels,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    lookupByLevel: lookupByLevel
  };
})(window.App);
```

- [ ] **Step 2: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/vocab-store.js
git commit -m "feat: 新增 vocab-store（内置词库管理 + 分级勾选 + 按级查询）"
```

> 说明：此模块依赖 `App.buildVocab`/`App.lookupWords`（word-lookup.js）和 `window.App` 命名空间，加载顺序在 word-lookup.js 之后即可。

---

### Task 2: 为 vocab-store 写测试并验证

**Files:**
- Modify: `test.html`

- [ ] **Step 1: 在 test.html 引入 vocab-store.js**

test.html 现有脚本顺序（读 test.html 确认）：
```html
<script>window.App = window.App || {};</script>
<script src="src/srt-parser.js"></script>
<script src="src/word-lookup.js"></script>
```
在 `src/word-lookup.js` 那行**之后**加一行：
```html
<script src="src/vocab-store.js"></script>
```

- [ ] **Step 2: 在 test.html 测试 IIFE 末尾（`out.innerHTML += '\n----\n'` 之前）追加 VocabStore 断言**

在汇总行之前插入：

```js
  // --- VocabStore ---
  var vsVocab = {
    '初中': { 'encode': 'v. 编码', 'text': 'n. 文本' },
    '四级': { 'compress': 'v. 压缩', 'binary': 'n. 二进制' }
  };
  App.VocabStore.init(vsVocab);
  check('VocabStore: init 后 isReady', App.VocabStore.isReady() === true);
  check('VocabStore: getLevels 顺序', JSON.stringify(App.VocabStore.getLevels()) === JSON.stringify(['初中', '四级']));
  check('VocabStore: 默认全选 四级', App.VocabStore.isEnabled('四级') === true);

  // 勾选全开：encode/text→初中，compress/binary→四级
  var g1 = App.VocabStore.lookupByLevel('When you ENCODE text into binary');
  check('lookupByLevel: 初中有 2 词', g1['初中'] && g1['初中'].length === 2);
  check('lookupByLevel: 四级有 2 词', g1['四级'] && g1['四级'].length === 2);
  check('lookupByLevel: 初中首词 encode', g1['初中'][0].word === 'encode');

  // 取消四级
  App.VocabStore.setEnabled('四级', false);
  check('VocabStore: 取消后 isEnabled=false', App.VocabStore.isEnabled('四级') === false);
  var g2 = App.VocabStore.lookupByLevel('When you ENCODE text into binary compress');
  check('lookupByLevel: 取消四级后无四级栏', g2['四级'] === undefined);
  check('lookupByLevel: 初中仍 2 词', g2['初中'] && g2['初中'].length === 2);

  // 未命中词不出现
  var g3 = App.VocabStore.lookupByLevel('hello world nothing here');
  check('lookupByLevel: 无命中返回空对象', JSON.stringify(g3) === '{}');
```

- [ ] **Step 3: 运行测试（headless 用 Node 复现断言）**

子代理无法开浏览器，用 Node shim 跑全部断言（含原有 19 条 + 新增 VocabStore）。注意 vocab-store.js 依赖 word-lookup.js，需先 require 它。

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
node -e "global.window=global;global.App={};require('./src/srt-parser.js');require('./src/word-lookup.js');require('./src/vocab-store.js');var a=require('assert');// 原 12 srt
a.strictEqual(App.timestampToSeconds('00:00:01,480'),1.48);a.strictEqual(App.timestampToSeconds('00:01:02,500'),62.5);a.strictEqual(App.timestampToSeconds('00:00:05.000'),5);a.strictEqual(App.timestampToSeconds('abc'),null);var s=App.parseSRT('1\n00:00:00,080 --> 00:00:01,480\nWhen you encode text into binary\n\n2\n00:00:02,080 --> 00:00:04,200\nit\'s often nice\nto use as little data as possible\n\n3\n00:00:04,720 --> 00:00:10,600\nSo you might naturally wonder\n');a.strictEqual(s.length,3);a.strictEqual(s[0].start,0.08);a.strictEqual(s[0].end,1.48);a.strictEqual(s[0].id,1);a.strictEqual(s[0].text,'When you encode text into binary');a.strictEqual(s[1].text,\"it's often nice\nto use as little data as possible\");a.strictEqual(s[2].text,'So you might naturally wonder');a.strictEqual(App.parseSRT('1\n00:00:00,080 --> 00:00:01,480\nhello\n\n坏块没有时间轴\n\n2\n00:00:02,000 --> 00:00:03,000\nworld\n').length,2);// 原 7 word-lookup
var vo={'初中':{'encode':'v. 编码','text':'n. 文本'},'四级':{'compress':'v. 压缩','binary':'n. 二进制'}};var v=App.buildVocab(vo);a.ok(v['encode']&&v['encode'].level==='初中'&&v['encode'].def==='v. 编码');a.ok(v['compress']&&v['compress'].level==='四级');var w=App.lookupWords('When you ENCODE text into binary!',v);a.strictEqual(w.length,3);a.strictEqual(w[0].word,'encode');a.strictEqual(w[2].word,'binary');a.strictEqual(App.lookupWords('text text text',v).length,1);a.strictEqual(App.lookupWords('hello world',v).length,0);// VocabStore
App.VocabStore.init(vo);a.strictEqual(App.VocabStore.isReady(),true);a.deepStrictEqual(App.VocabStore.getLevels(),['初中','四级']);a.strictEqual(App.VocabStore.isEnabled('四级'),true);var g1=App.VocabStore.lookupByLevel('When you ENCODE text into binary');a.strictEqual(g1['初中'].length,2);a.strictEqual(g1['四级'].length,2);a.strictEqual(g1['初中'][0].word,'encode');App.VocabStore.setEnabled('四级',false);a.strictEqual(App.VocabStore.isEnabled('四级'),false);var g2=App.VocabStore.lookupByLevel('When you ENCODE text into binary compress');a.strictEqual(g2['四级'],undefined);a.strictEqual(g2['初中'].length,2);var g3=App.VocabStore.lookupByLevel('hello world nothing here');a.deepStrictEqual(g3,{});console.log('ALL 27 PASSED');"
```
Expected: 打印 `ALL 27 PASSED`（19 原 + 8 VocabStore）。

- [ ] **Step 4: 提交**

```bash
git add test.html
git commit -m "test: 补充 vocab-store 的浏览器测试"
```

---

### Task 3: 重写 index.html body 为三栏结构

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
        <div class="levels" id="levels"><!-- 分级勾选项由 ui.js 渲染 --></div>
      </section>
      <section class="files">
        <h3 class="panel-title">文件</h3>
        <label class="file-btn">字幕 .srt <input type="file" id="srt-input" accept=".srt"></label>
        <label class="file-btn">音频 <input type="file" id="audio-input" accept="audio/*"></label>
      </section>
    </aside>

    <!-- 中栏：视频位 + 字幕 -->
    <main class="panel-center">
      <div class="video-slot" id="video-slot"><!-- 批次二填充视频元素 --></div>
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

  <script>window.App = window.App || {};</script>
  <script src="src/srt-parser.js"></script>
  <script src="src/word-lookup.js"></script>
  <script src="src/vocab-store.js"></script>
  <script src="src/player.js"></script>
  <script src="src/ui.js"></script>
  <script src="src/main.js"></script>
</body>
</html>
```

要点：
- 三栏 `.layout`：`.panel-left` / `.panel-center` / `.panel-right`。
- 左栏分 `.settings`（分级勾选 + `#vocab-status`）和 `.files`（字幕/音频入口，视频入口批次二加）。
- 中栏：`#video-slot`（空占位，批次二填）+ `#sentences` + `#status`。
- 右栏：`#word-panel`（单词分栏）。
- **删除原 `#vocab-input`（词库不再上传）和原 `.toolbar`**。
- 脚本顺序：word-lookup → vocab-store → player → ui → main。

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: index.html 重写为三栏布局结构"
```

> 说明：此步后页面样式会乱（styles.css 还是旧的），属正常，Task 4 修样式。脚本加载顺序已对（vocab-store 在 ui/main 之前）。

---

### Task 4: 重写 styles.css 为三栏 + 设置面板 + 分栏

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

/* 三栏布局 */
.layout {
  display: flex; height: 100vh; width: 100%;
}
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

/* 设置区 */
.vocab-status { font-size: 12px; margin-bottom: 8px; }
.levels { display: flex; flex-direction: column; gap: 4px; }
.level-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 14px; padding: 3px 0; cursor: pointer;
}
.level-item input { cursor: pointer; }

/* 文件区 */
.files { display: flex; flex-direction: column; gap: 6px; }
.file-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; background: #f3f4f6; border: 1px solid #d1d5db;
  border-radius: 6px; cursor: pointer; font-size: 13px;
}
.file-btn:hover { background: #e5e7eb; }

/* 中栏 */
.video-slot {
  flex-shrink: 0; background: #000; min-height: 0; height: 0;
  /* 批次二会设高度显示视频；本批收起为 0 */
}
.sentences {
  flex: 1; overflow-y: auto; padding: 8px 12px;
}
.status {
  position: absolute; bottom: 8px; right: 12px;
  font-size: 12px; color: #6b7280; background: rgba(255,255,255,.8);
  padding: 2px 8px; border-radius: 4px;
}
.status.error { color: #dc2626; font-weight: 600; }

/* 句子项 */
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

/* 右栏：分栏单词 */
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

### Task 5: 重写 ui.js（三栏渲染 + 设置面板 + 分栏）

**Files:**
- Modify: `src/ui.js`

- [ ] **Step 1: 用以下完整内容替换 `src/ui.js`**

```js
(function (App) {
  'use strict';

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // 句子列表（沿用第一版）
  function renderSentences(container, sentences, onClick) {
    container.innerHTML = '';
    for (var i = 0; i < sentences.length; i++) {
      (function (s) {
        var div = document.createElement('div');
        div.className = 'sentence';
        div.dataset.id = s.id;
        div.innerHTML =
          '<span class="play-icon">▶</span>' +
          '<span class="time">[' + fmtTime(s.start) + ']</span>' +
          '<span class="text"></span>';
        div.querySelector('.text').textContent = s.text.replace(/\n/g, ' ');
        div.addEventListener('click', function () { onClick(s); });
        container.appendChild(div);
      })(sentences[i]);
    }
  }

  function highlightSentence(container, id) {
    var all = container.querySelectorAll('.sentence');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('active', String(all[i].dataset.id) === String(id));
    }
  }

  function markPlaying(container, id, playing) {
    var el = container.querySelector('.sentence[data-id="' + id + '"]');
    if (!el) return;
    el.classList.toggle('playing', playing);
    el.querySelector('.play-icon').textContent = playing ? '⏸' : '▶';
  }

  // 【新增】设置面板：渲染分级勾选项
  function renderSettings(container, onChange) {
    container.innerHTML = '';
    var levels = App.VocabStore.getLevels();
    for (var i = 0; i < levels.length; i++) {
      (function (level) {
        var label = document.createElement('label');
        label.className = 'level-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = App.VocabStore.isEnabled(level);
        cb.addEventListener('change', function () {
          onChange(level, cb.checked);
        });
        var span = document.createElement('span');
        span.textContent = level;
        label.appendChild(cb);
        label.appendChild(span);
        container.appendChild(label);
      })(levels[i]);
    }
  }

  // 【新增】右栏分栏：groups = {level: Word[]}
  function renderWordGroups(container, groups) {
    var levels = App.VocabStore.getLevels();
    var any = false;
    container.innerHTML = '';
    container.className = 'word-groups';

    for (var i = 0; i < levels.length; i++) {
      var level = levels[i];
      var words = groups[level];
      if (!words || words.length === 0) continue;
      any = true;

      var group = document.createElement('div');
      group.className = 'word-group';
      var h4 = document.createElement('h4');
      h4.textContent = level + ' (' + words.length + ')';
      group.appendChild(h4);

      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        var div = document.createElement('div');
        div.className = 'word';
        var wspan = document.createElement('div');
        wspan.className = 'w';
        wspan.textContent = w.word;
        var dspan = document.createElement('div');
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

  function setVocabStatus(text, isError) {
    var el = document.getElementById('vocab-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!isError);
    el.classList.toggle('placeholder', !isError);
  }

  function setStatus(text, isError) {
    var el = document.getElementById('status');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  App.fmtTime = fmtTime;
  App.renderSentences = renderSentences;
  App.highlightSentence = highlightSentence;
  App.markPlaying = markPlaying;
  App.renderSettings = renderSettings;
  App.renderWordGroups = renderWordGroups;
  App.setVocabStatus = setVocabStatus;
  App.setStatus = setStatus;
})(window.App);
```

> 注意：本版**移除**了第一版的 `renderWordPanel`（扁平版）和 `clearSentences`，改为 `renderWordGroups`（分栏版）。main.js 在 Task 6 同步改用新接口。

- [ ] **Step 2: 语法检查**

```bash
node --check src/ui.js
```
Expected: 无输出（语法 OK）。

- [ ] **Step 3: 提交**

```bash
git add src/ui.js
git commit -m "feat: ui.js 重写（三栏渲染 + 分级勾选面板 + 按级分栏单词）"
```

---

### Task 6: 改写 main.js（移除词库上传 + 接入 VocabStore + 三栏联动）

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 用以下完整内容替换 `src/main.js`**

```js
(function (App) {
  'use strict';

  var state = {
    sentences: [],
    currentId: null,
    player: null,
    currentText: ''   // 当前选中句文本，供分级勾选变化时重刷右栏
  };

  // --- 初始化词库（内置 or fetch 兜底） ---
  function initVocab() {
    if (window.__VOCAB__) {
      // dist 内置
      App.VocabStore.init(window.__VOCAB__);
      App.setVocabStatus('词库已内置：' + App.VocabStore.getLevels().length + ' 个分级', false);
      setupSettings();
    } else {
      // 开发页：fetch 本地 vocabulary.json 兜底
      App.setVocabStatus('正在加载词库…', false);
      fetch('src/vocabulary.json')
        .then(function (r) { return r.json(); })
        .then(function (obj) {
          App.VocabStore.init(obj);
          App.setVocabStatus('词库已加载：' + App.VocabStore.getLevels().length + ' 个分级', false);
          setupSettings();
        })
        .catch(function () {
          App.setVocabStatus('词库加载失败', true);
        });
    }
  }

  // --- 渲染分级勾选面板 ---
  function setupSettings() {
    App.renderSettings(document.getElementById('levels'), function (level, enabled) {
      App.VocabStore.setEnabled(level, enabled);
      // 若有选中句，立即按新勾选重刷右栏
      if (state.currentText) {
        refreshWordPanel(state.currentText);
      }
    });
  }

  // --- 刷新右栏（按级分栏） ---
  function refreshWordPanel(text) {
    var panel = document.getElementById('word-panel');
    if (!App.VocabStore.isReady()) {
      panel.className = 'placeholder';
      panel.textContent = '词库未就绪';
      return;
    }
    // 全部取消勾选时给提示
    var anyEnabled = false;
    var levels = App.VocabStore.getLevels();
    for (var i = 0; i < levels.length; i++) {
      if (App.VocabStore.isEnabled(levels[i])) { anyEnabled = true; break; }
    }
    if (!anyEnabled) {
      panel.className = 'placeholder';
      panel.textContent = '未勾选任何分级';
      return;
    }
    App.renderWordGroups(panel, App.VocabStore.lookupByLevel(text));
  }

  // --- 文件载入 ---
  document.getElementById('srt-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state.sentences = App.parseSRT(reader.result);
        App.renderSentences(document.getElementById('sentences'), state.sentences, onSentenceClick);
        App.setStatus('已载入 ' + state.sentences.length + ' 句字幕');
      } catch (err) {
        App.setStatus('字幕解析失败：' + err.message, true);
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  document.getElementById('audio-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var url = URL.createObjectURL(file);
    state.player.setSrc(url);
    state.audioName = file.name;
    App.setStatus('已载入音频：' + file.name);
  });

  // --- 点句子 ---
  function onSentenceClick(sentence) {
    var container = document.getElementById('sentences');

    if (state.currentId != null && state.currentId !== sentence.id) {
      App.markPlaying(container, state.currentId, false);
    }
    state.currentId = sentence.id;
    state.currentText = sentence.text;

    App.highlightSentence(container, sentence.id);
    refreshWordPanel(sentence.text);

    if (!state.audioName) {
      App.setStatus('请先选择音频文件', true);
      return;
    }
    App.markPlaying(container, sentence.id, true);
    state.player.playSegment(sentence.start, sentence.end);
  }

  // --- 初始化 ---
  state.player = new App.Player(document.getElementById('audio'));
  var audioEl = document.getElementById('audio');
  audioEl.addEventListener('error', function () {
    if (audioEl.error && state.audioName) {
      App.setStatus('音频无法播放（编码不支持），建议改用 mp3', true);
    }
  });
  state.player.onStop(function () {
    if (state.currentId != null) {
      App.markPlaying(document.getElementById('sentences'), state.currentId, false);
    }
  });

  initVocab();
})(window.App);
```

要点：
- 移除 `vocab-input` 处理；新增 `initVocab()`：dist 用 `window.__VOCAB__`，开发页 fetch `src/vocabulary.json` 兜底。
- `setupSettings()` 渲染分级勾选，变更时调 `setEnabled` 并重刷右栏。
- `refreshWordPanel(text)` 用 `VocabStore.lookupByLevel` + `renderWordGroups`；处理"未就绪/全未勾选"占位。
- 点句子：记 `currentText`（供勾选变化重刷），其余沿用第一版（清上一句播放态、高亮、播放）。
- `initVocab()` 在末尾调用。

- [ ] **Step 2: 语法检查**

```bash
node --check src/main.js
```
Expected: 无输出（语法 OK）。

- [ ] **Step 3: 静态交叉检查**

子代理 headless，无法开浏览器。做静态验证：
- 读 `index.html`，确认 main.js 引用的所有 id 都存在：`levels`、`vocab-status`、`word-panel`、`srt-input`、`audio-input`、`sentences`、`status`、`audio`。
- 确认 main.js 调用的 `App.*` 都有定义：`VocabStore.*`（vocab-store.js）、`setVocabStatus`/`renderSettings`/`renderWordGroups`（ui.js，Task 5）、`parseSRT`（srt-parser.js）、`renderSentences`/`setStatus`/`highlightSentence`/`markPlaying`（ui.js）、`Player`（player.js）。
- 确认 index.html 脚本加载顺序：vocab-store 在 ui、main 之前（已在 Task 3 设好）。

- [ ] **Step 4: 提交**

```bash
git add src/main.js
git commit -m "feat: main.js 接入 VocabStore 与三栏联动（移除词库上传）"
```

---

### Task 7: 改 build.js（注入词库）+ 构建 + 验证

**Files:**
- Modify: `build.js`

- [ ] **Step 1: 用以下完整内容替换 `build.js`**

```js
// 把 index.html 引用的 styles.css 和 src/*.js 内联；并把 vocabulary.json 内置，输出 dist/index.html
const fs = require('fs');
const path = require('path');

const root = __dirname;
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');

// 1) 内联 <link rel="stylesheet" href="...">
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
  const css = fs.readFileSync(path.join(root, href), 'utf-8');
  return '<style>\n' + css + '\n</style>';
});

// 2) 内联 <script src="...">（仅本地相对路径，不含 http）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  if (/^https?:/.test(src)) return m;
  const code = fs.readFileSync(path.join(root, src), 'utf-8');
  return '<script>\n' + code + '\n</script>';
});

// 3) 内置词库：在第一个 <script> 之前注入 window.__VOCAB__
const vocabPath = path.join(root, 'src', 'vocabulary.json');
const vocabJson = fs.readFileSync(vocabPath, 'utf-8');
// 校验 JSON 合法（构建期失败好过运行期）
JSON.parse(vocabJson);
const vocabInject = '<script>window.__VOCAB__ = ' + vocabJson + ';</script>\n';
html = html.replace(/<script>/, vocabInject + '<script>');

const outPath = path.join(distDir, 'index.html');
fs.writeFileSync(outPath, html, 'utf-8');
console.log('已生成 ' + outPath + ' (' + html.length + ' 字节，含内置词库)');
```

要点：
- 步骤 3 新增：读 `src/vocabulary.json`，`JSON.parse` 校验，注入 `window.__VOCAB__ = {...}` 到第一个 `<script>` 之前。
- 注入位置在所有模块脚本之前，保证 main.js 的 `initVocab()` 能读到 `window.__VOCAB__`。

- [ ] **Step 2: 运行构建**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
node build.js
```
Expected: 打印 `已生成 ...dist\index.html (N 字节，含内置词库)`，N 应明显大于之前（词库 ~1.6MB，故 N 约 160 万+）。

- [ ] **Step 3: 验证 dist 自包含且词库已注入**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
# 确认 dist 内有 __VOCAB__ 注入
grep -c "window.__VOCAB__" dist/index.html   # 期望 1
# 确认 dist 无外部 src 引用
grep -c 'src="src/' dist/index.html          # 期望 0
# 确认 dist 无 stylesheet link
grep -c 'rel="stylesheet"' dist/index.html   # 期望 0
```
Expected: 三条分别输出 `1`、`0`、`0`。

- [ ] **Step 4: 提交**

```bash
git add build.js dist/index.html
git commit -m "feat: build.js 注入词库内置；重新构建 dist"
```

---

## 手动验收清单（全部 Task 完成后，由人在浏览器执行）

对照设计文档 §9，用真实文件测试：

- [ ] 打开 `dist/index.html`（无需选词库——已内置）。页面三栏。
- [ ] 左栏"词库分级"显示 7 项（初中/高中/四级/六级/考研/托福/SAT），默认全选；状态显示"词库已内置：7 个分级"。
- [ ] 选 SRT（`【官方双语】…熵.srt`）+ 音频（`.mp3`）→ 中栏出句子列表。
- [ ] 点第 3 句 → 播放 4.72s→10.6s 自动停、高亮、右栏按级分栏显示命中词（分级名作标题带词数，无小标签）。
- [ ] 左栏取消勾选"四级" → 右栏四级那栏立即消失。
- [ ] 取消所有勾选 → 右栏显示"未勾选任何分级"。
- [ ] 重新勾回 → 右栏恢复。
- [ ] 开发页 `index.html`（未内置）能 fetch 加载词库，功能一致。
- [ ] dist/index.html 单文件可独立拷走（不依赖 vocabulary.json）。

---

## Self-Review 记录

（实施前由计划作者填写，确认已对照 spec 检查。）

- **Spec 覆盖**：
  - §2.1 三栏布局 → Task 3（html）+ Task 4（css）。
  - §2.2 词库内置 → Task 7（build.js 注入）。
  - §2.3 分级勾选 → Task 1（store 状态）+ Task 5（renderSettings）+ Task 6（联动）。
  - §2.4 右栏按级分栏 → Task 1（lookupByLevel）+ Task 5（renderWordGroups）+ Task 6（refreshWordPanel）。
  - §5.1 内置 + fetch 兜底 → Task 6 initVocab。
  - §5.2 默认全选 + 不持久化 → Task 1 init。
  - §5.3 按级分组保序 → Task 1 lookupByLevel（复用 lookupWords 的顺序）。
  - §7 错误处理（fetch 失败 / 全未勾选）→ Task 6。
  - §8 测试 → Task 2（test.html 27 断言）。
  - §9 验收 → 手动清单。
  全覆盖。

- **占位符**：无 TBD/TODO，每步含完整代码。

- **类型/命名一致性**：
  - `App.VocabStore.{init,isReady,getLevels,setEnabled,lookupByLevel}` 在 Task 1 定义，Task 2 测，Task 5/6 用 —— 一致。
  - `App.renderSettings(container, onChange)`、`App.renderWordGroups(container, groups)`、`App.setVocabStatus` 在 Task 5 定义，Task 6 用 —— 一致。
  - `groups` 形状 `{level: Word[]}` 在 Task 1（lookupByLevel 返回）、Task 5（renderWordGroups 入参）、Task 6（refreshWordPanel 传递）一致。
  - id：`levels`/`vocab-status`/`word-panel`/`srt-input`/`audio-input`/`sentences`/`status`/`audio` 在 Task 3（html 定义）与 Task 6（main.js 引用）一致。
