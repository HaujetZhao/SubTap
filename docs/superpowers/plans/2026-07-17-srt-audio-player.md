# 字幕音频句段播放器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个网页，上传 SRT 字幕 + 音频 + 词库 JSON 后，点击句子播放对应音频片段，右侧自动显示该句单词的词库释义。

**Architecture:** 多文件开发（HTML/CSS/JS 按模块拆分）+ Node 构建脚本内联成单文件 `dist/index.html`。JS 分 6 个职责单一的模块：FileLoader、SrtParser（纯函数）、SentenceList、Player、WordLookup（纯函数）、PanelRenderer。纯函数模块用浏览器测试页验证。

**Tech Stack:** 原生 HTML/CSS/JavaScript（无前端框架）、Node（仅用于构建脚本内联文件）、浏览器测试页（无测试框架，手写断言）。

**测试约定：** 纯函数模块（SrtParser、WordLookup）用 `player/test.html` 做断言页——打开后用 `console.assert` + 页面绿/红字显示结果。其余靠手动验收（计划末尾）。

---

## 文件结构总览

```
player/
├── index.html              # 开发页面，<script> 引入各 src（Task 1 起逐步添加）
├── test.html               # 纯函数测试页（Task 3、Task 5 用）
├── build.js                # 构建脚本：内联 → dist/index.html（Task 8）
├── src/
│   ├── styles.css          # 样式（Task 1）
│   ├── srt-parser.js       # SRT 解析 纯函数（Task 2-3）
│   ├── word-lookup.js      # 单词查询 纯函数（Task 4-5）
│   ├── player.js           # 播放器（Task 6）
│   ├── ui.js               # FileLoader + SentenceList + PanelRenderer（Task 7）
│   └── main.js             # 入口：组装模块、绑定事件（Task 7）
└── dist/
    └── index.html          # 构建产物（Task 8）
```

**模块导出约定**（每个 src 文件挂在全局 `window.App` 命名空间下，开发页和测试页都能直接用）：
- `srt-parser.js` → `window.App.parseSRT(text)` 返回 `Sentence[]`
- `word-lookup.js` → `window.App.buildVocab(vocabObj)` 返回大表；`window.App.lookupWords(text, vocab)` 返回 `Word[]`
- `player.js` → `window.App.Player`（构造函数，`playSegment(start,end)`、`stop()`）
- `ui.js` → `window.App.renderSentences(...)`、`window.App.renderWordPanel(...)` 等
- `main.js` → 入口，绑定事件

---

### Task 1: 搭建开发页面骨架与样式

**Files:**
- Create: `player/index.html`
- Create: `player/src/styles.css`

- [ ] **Step 1: 创建样式文件 `player/src/styles.css`**

```css
* { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0; height: 100vh; display: flex; flex-direction: column;
  background: #fafafa; color: #222;
}

/* 顶部上传区 */
.toolbar {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e7eb;
}
.toolbar label {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: #f3f4f6; border: 1px solid #d1d5db;
  border-radius: 6px; cursor: pointer; font-size: 14px;
}
.toolbar label:hover { background: #e5e7eb; }
.toolbar .status { margin-left: auto; font-size: 13px; color: #6b7280; }
.toolbar .status.error { color: #dc2626; font-weight: 600; }

/* 主体两栏 */
.main { flex: 1; display: flex; min-height: 0; }
.sentences {
  flex: 1; overflow-y: auto; padding: 8px;
}
.sidebar {
  width: 280px; border-left: 1px solid #e5e7eb; background: #fff;
  padding: 12px 16px; overflow-y: auto;
}

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

/* 单词面板 */
.sidebar h3 { margin: 0 0 8px; font-size: 14px; color: #6b7280; font-weight: 600; }
.word { margin-bottom: 12px; }
.word .head { display: flex; align-items: baseline; gap: 6px; }
.word .w { font-weight: 600; font-size: 15px; }
.word .level { font-size: 11px; color: #fff; background: #2563eb; padding: 1px 6px; border-radius: 999px; }
.word .def { font-size: 13px; color: #444; margin-top: 2px; }
.placeholder { color: #9ca3af; font-size: 14px; }

audio.hidden { display: none; }
```

- [ ] **Step 2: 创建开发页面 `player/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>字幕音频句段播放器</title>
<link rel="stylesheet" href="src/styles.css">
</head>
<body>
  <div class="toolbar">
    <label>字幕 .srt <input type="file" id="srt-input" accept=".srt"></label>
    <label>音频 <input type="file" id="audio-input" accept="audio/*"></label>
    <label>词库 .json <input type="file" id="vocab-input" accept=".json"></label>
    <span class="status" id="status">请选择文件</span>
  </div>
  <div class="main">
    <div class="sentences" id="sentences">
      <div class="placeholder">选择字幕后，句子列表会显示在这里</div>
    </div>
    <div class="sidebar" id="sidebar">
      <h3>当前句单词</h3>
      <div class="placeholder" id="word-panel">点击左侧句子查看单词</div>
    </div>
  </div>
  <audio class="hidden" id="audio" preload="metadata"></audio>

  <!-- 模块按依赖顺序引入（后续 Task 逐步添加） -->
  <script>window.App = window.App || {};</script>
  <script src="src/srt-parser.js"></script>
  <script src="src/word-lookup.js"></script>
  <script src="src/player.js"></script>
  <script src="src/ui.js"></script>
  <script src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add player/index.html player/src/styles.css
git commit -m "feat: 搭建播放器页面骨架与样式"
```

> 说明：此时浏览器打开 index.html 会因 src 文件不存在而报 404，属正常，后续 Task 补齐。

---

### Task 2: 实现 SRT 解析模块

**Files:**
- Create: `player/src/srt-parser.js`

**`Sentence` 类型约定**（后续所有模块都按此用）：
```js
// Sentence: { id: number, start: number, end: number, text: string }
// start/end 单位：秒（浮点）。id 从 1 开始。
```

- [ ] **Step 1: 写实现 `player/src/srt-parser.js`**

```js
(function (App) {
  'use strict';

  // 把 "HH:MM:SS,mmm" 或 "HH:MM:SS.mmm" 转成秒（浮点）
  function timestampToSeconds(ts) {
    var m = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(ts.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10), s = parseInt(m[3], 10), ms = parseInt(m[4], 10);
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  // SRT 文本 → Sentence[]
  function parseSRT(text) {
    // 统一换行，按空行分块
    var normalized = text.replace(/\r\n?/g, '\n').trim();
    var blocks = normalized.split(/\n\s*\n/);
    var sentences = [];

    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i].trim();
      if (!block) continue;

      var lines = block.split('\n');

      // 第一行若是纯数字（序号），跳过
      var idx = 0;
      if (/^\d+$/.test(lines[0].trim())) idx = 1;

      // 找时间轴行
      var timeLine = lines[idx];
      var tm = /^([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(timeLine.trim());
      if (!tm) continue; // 容错：格式不对的块跳过，不整体崩

      var start = timestampToSeconds(tm[1]);
      var end = timestampToSeconds(tm[2]);
      if (start === null || end === null) continue;

      // 文本部分（可能多行）
      var textLines = lines.slice(idx + 1);
      var text = textLines.join('\n').trim();

      sentences.push({ id: sentences.length + 1, start: start, end: end, text: text });
    }
    return sentences;
  }

  App.timestampToSeconds = timestampToSeconds;
  App.parseSRT = parseSRT;
})(window.App);
```

- [ ] **Step 2: 提交**

```bash
git add player/src/srt-parser.js
git commit -m "feat: 实现 SRT 解析模块"
```

---

### Task 3: 为 SRT 解析写测试页并验证

**Files:**
- Create: `player/test.html`

- [ ] **Step 1: 创建测试页 `player/test.html`**

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
<script>window.App = window.App || {};</script>
<script src="src/srt-parser.js"></script>
<script src="src/word-lookup.js"></script>
<script>
(function () {
  var out = document.getElementById('out');
  var pass = 0, fail = 0;
  function check(name, cond) {
    if (cond) { pass++; out.innerHTML += '<span class="pass">✓ ' + name + '</span>\n'; }
    else { fail++; out.innerHTML += '<span class="fail">✗ ' + name + '</span>\n'; }
  }

  // --- timestampToSeconds ---
  check('ts: 00:00:01,480 → 1.48', App.timestampToSeconds('00:00:01,480') === 1.48);
  check('ts: 00:01:02,500 → 62.5', App.timestampToSeconds('00:01:02,500') === 62.5);
  check('ts: 点分隔 00:00:05.000 → 5', App.timestampToSeconds('00:00:05.000') === 5);
  check('ts: 非法返回 null', App.timestampToSeconds('abc') === null);

  // --- parseSRT ---
  var sample = '1\n00:00:00,080 --> 00:00:01,480\nWhen you encode text into binary\n\n'
    + '2\n00:00:02,080 --> 00:00:04,200\nit\'s often nice\nto use as little data as possible\n\n'
    + '3\n00:00:04,720 --> 00:00:10,600\nSo you might naturally wonder\n';
  var s = App.parseSRT(sample);

  check('解析出 3 句', s.length === 3);
  check('第1句 start=0.08', s[0].start === 0.08);
  check('第1句 end=1.48', s[0].end === 1.48);
  check('第1句 id=1', s[0].id === 1);
  check('第1句文本正确', s[0].text === 'When you encode text into binary');
  check('第2句多行文本合并', s[1].text === "it's often nice\nto use as little data as possible");
  check('序号行被跳过（第3句文本不含"3"）', s[2].text === 'So you might naturally wonder');

  // 容错：混入一个坏块
  var withBad = '1\n00:00:00,080 --> 00:00:01,480\nhello\n\n'
    + '坏块没有时间轴\n\n'
    + '2\n00:00:02,000 --> 00:00:03,000\nworld\n';
  var sb = App.parseSRT(withBad);
  check('容错：坏块跳过，得 2 句', sb.length === 2);

  out.innerHTML += '\n----\n通过 ' + pass + '，失败 ' + fail + '\n';
})();
</script>
</body>
</html>
```

- [ ] **Step 2: 运行测试**

用浏览器打开 `player/test.html`（或 VS Code Live Server / 直接双击）。
Expected: 页面底部显示 "通过 12，失败 0"（SRT 相关共 12 条；word-lookup 的测试在 Task 5 加，此时 word-lookup.js 还不存在——见 Step 3）。

- [ ] **Step 3: 让测试页能在 Task 5 前正常运行**

Task 5 之前 `word-lookup.js` 不存在，test.html 引用它会 404 但不阻塞脚本执行。
为避免混淆，**此时暂时删掉 test.html 里对 word-lookup.js 的引用**：

把
```html
<script src="src/word-lookup.js"></script>
```
这一行注释或删除。Task 5 实现后再加回来。

- [ ] **Step 4: 提交**

```bash
git add player/test.html
git commit -m "test: 添加 SRT 解析的浏览器测试页"
```

---

### Task 4: 实现单词查询模块

**Files:**
- Create: `player/src/word-lookup.js`

**类型约定：**
```js
// Vocab 大表：{ 单词: { level: string, def: string } }
// Word: { word: string, level: string, def: string }
```

- [ ] **Step 1: 写实现 `player/src/word-lookup.js`**

```js
(function (App) {
  'use strict';

  // 词库（两级 {level: {word: def}}）→ 合并大表 {word: {level, def}}
  function buildVocab(vocabObj) {
    var table = {};
    var levels = Object.keys(vocabObj || {});
    for (var i = 0; i < levels.length; i++) {
      var level = levels[i];
      var dict = vocabObj[level] || {};
      var words = Object.keys(dict);
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        // 已存在则保留首个出现的分级（通常更基础），可按需改
        if (!table[w]) {
          table[w] = { level: level, def: dict[w] };
        }
      }
    }
    return table;
  }

  // 句子文本 + 大表 → Word[]（按出现顺序、去重、只返回命中的）
  function lookupWords(text, vocab) {
    var lower = (text || '').toLowerCase();
    // 拆词：非字母（撇号除外）都当分隔符
    var tokens = lower.split(/[^a-z']+/).filter(Boolean);
    var seen = {};
    var result = [];
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (seen[tok]) continue;
      var entry = vocab[tok];
      if (entry) {
        seen[tok] = true;
        result.push({ word: tok, level: entry.level, def: entry.def });
      }
    }
    return result;
  }

  App.buildVocab = buildVocab;
  App.lookupWords = lookupWords;
})(window.App);
```

- [ ] **Step 2: 提交**

```bash
git add player/src/word-lookup.js
git commit -m "feat: 实现单词查询模块（词库合并 + 分词查词）"
```

---

### Task 5: 为单词查询补充测试并验证

**Files:**
- Modify: `player/test.html`

- [ ] **Step 1: 恢复 test.html 对 word-lookup.js 的引用**

在 test.html 的 `<script src="src/srt-parser.js"></script>` 之后加回：
```html
<script src="src/word-lookup.js"></script>
```
（Task 3 Step 3 删掉的那行加回来。）

- [ ] **Step 2: 在 test.html 的测试脚本末尾（"----" 之前）追加 WordLookup 断言**

在 `out.innerHTML += '\n----\n'` 这行**之前**插入：

```js
  // --- WordLookup ---
  var vocabObj = {
    '初中': { 'encode': 'v. 编码', 'text': 'n. 文本' },
    '四级': { 'compress': 'v. 压缩', 'binary': 'n. 二进制' }
  };
  var v = App.buildVocab(vocabObj);
  check('buildVocab: encode 命中', v['encode'] && v['encode'].level === '初中' && v['encode'].def === 'v. 编码');
  check('buildVocab: compress 命中', v['compress'] && v['compress'].level === '四级');

  var words = App.lookupWords('When you ENCODE text into binary!', v);
  check('lookup: 数量=3 (encode/text/binary)', words.length === 3);
  check('lookup: 大小写归一化（encode）', words[0].word === 'encode');
  check('lookup: 去标点（binary 不带!）', words[2].word === 'binary');
  check('lookup: 重复词去重', App.lookupWords('text text text', v).length === 1);
  check('lookup: 未命中词不返回', App.lookupWords('hello world', v).length === 0);
```

- [ ] **Step 3: 运行测试**

浏览器打开（刷新）`player/test.html`。
Expected: 底部 "通过 19，失败 0"（12 SRT + 7 WordLookup）。

- [ ] **Step 4: 提交**

```bash
git add player/test.html
git commit -m "test: 补充单词查询的浏览器测试"
```

---

### Task 6: 实现播放器模块

**Files:**
- Create: `player/src/player.js`

**接口约定：**
```js
// new App.Player(audioEl)  —— 传入页面里的 <audio> 元素
// .setSrc(url)             —— 设置音频源
// .playSegment(start, end) —— 从 start 秒播到 end 秒自动停
// .stop()                  —— 停止并清除回调
// .onStop(cb)              —— 注册"播到 end 自动停/手动停"回调（UI 用来复位按钮）
```

- [ ] **Step 1: 写实现 `player/src/player.js`**

```js
(function (App) {
  'use strict';

  function Player(audioEl) {
    this.audio = audioEl;
    this._endHandler = null;
    this._stopCb = null;
    var self = this;

    // 复用：到 end 自动停
    this.audio.addEventListener('timeupdate', function () {
      if (self._endHandler && self.audio.currentTime >= self._endHandler.end) {
        self.audio.pause();
      }
    });
  }

  Player.prototype.setSrc = function (url) {
    this.audio.src = url;
  };

  Player.prototype.onStop = function (cb) {
    this._stopCb = cb;
    var self = this;
    // 只绑一次 pause 转发
    if (!this._pauseBound) {
      this.audio.addEventListener('pause', function () {
        if (self._stopCb) self._stopCb();
      });
      this._pauseBound = true;
    }
  };

  Player.prototype.playSegment = function (start, end) {
    var self = this;
    this._endHandler = { end: end };

    var go = function () {
      self.audio.currentTime = start;
      self.audio.play().catch(function () {}); // 忽略自动播放策略报错
    };

    // 首次需等 metadata 才能 seek
    if (this.audio.readyState >= 1) {
      go();
    } else {
      this.audio.addEventListener('loadedmetadata', function onReady() {
        self.audio.removeEventListener('loadedmetadata', onReady);
        go();
      });
    }
  };

  Player.prototype.stop = function () {
    this._endHandler = null;
    this.audio.pause();
  };

  App.Player = Player;
})(window.App);
```

- [ ] **Step 2: 提交**

```bash
git add player/src/player.js
git commit -m "feat: 实现播放器模块（区间播放 + 自动停）"
```

---

### Task 7: 实现UI模块与入口，完成端到端功能

**Files:**
- Create: `player/src/ui.js`
- Create: `player/src/main.js`

**接口约定（ui.js 暴露）：**
```js
// App.renderSentences(container, sentences, onClick)
//   渲染句子列表；点句子调 onClick(sentence)
// App.clearSentences(container)
// App.renderWordPanel(panelEl, words)
//   words=[] 时显示占位
// App.setStatus(text, isError)
// App.highlightSentence(container, sentenceId)
// App.markPlaying(container, sentenceId, playing)
```

- [ ] **Step 1: 写 `player/src/ui.js`**

```js
(function (App) {
  'use strict';

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

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

  function clearSentences(container) {
    container.innerHTML = '<div class="placeholder">选择字幕后，句子列表会显示在这里</div>';
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

  function renderWordPanel(panelEl, words) {
    if (!words || words.length === 0) {
      panelEl.className = 'placeholder';
      panelEl.textContent = '当前句没有词库中的单词';
      return;
    }
    panelEl.className = '';
    panelEl.innerHTML = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var div = document.createElement('div');
      div.className = 'word';
      div.innerHTML =
        '<div class="head"><span class="w"></span><span class="level"></span></div>' +
        '<div class="def"></div>';
      div.querySelector('.w').textContent = w.word;
      div.querySelector('.level').textContent = w.level;
      div.querySelector('.def').textContent = w.def;
      panelEl.appendChild(div);
    }
  }

  function setStatus(text, isError) {
    var el = document.getElementById('status');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  App.fmtTime = fmtTime;
  App.renderSentences = renderSentences;
  App.clearSentences = clearSentences;
  App.highlightSentence = highlightSentence;
  App.markPlaying = markPlaying;
  App.renderWordPanel = renderWordPanel;
  App.setStatus = setStatus;
})(window.App);
```

- [ ] **Step 2: 写入口 `player/src/main.js`**

```js
(function (App) {
  'use strict';

  var state = {
    sentences: [],
    vocab: null,        // 合并后的大表
    currentId: null,
    player: null
  };

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

  document.getElementById('vocab-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        state.vocab = App.buildVocab(obj);
        App.setStatus('已载入词库：' + Object.keys(obj).length + ' 个分级');
      } catch (err) {
        App.setStatus('词库解析失败：' + err.message, true);
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  // --- 点句子 ---
  function onSentenceClick(sentence) {
    state.currentId = sentence.id;

    // 高亮
    var container = document.getElementById('sentences');
    App.highlightSentence(container, sentence.id);

    // 刷右栏
    var panel = document.getElementById('word-panel');
    if (state.vocab) {
      App.renderWordPanel(panel, App.lookupWords(sentence.text, state.vocab));
    } else {
      panel.className = 'placeholder';
      panel.textContent = '请先上传词库 .json';
    }

    // 播放
    if (!state.audioName) {
      App.setStatus('请先选择音频文件', true);
      return;
    }
    App.markPlaying(container, sentence.id, true);
    state.player.playSegment(sentence.start, sentence.end);
  }

  // --- 初始化播放器 ---
  state.player = new App.Player(document.getElementById('audio'));
  state.player.onStop(function () {
    if (state.currentId != null) {
      App.markPlaying(document.getElementById('sentences'), state.currentId, false);
    }
  });
})(window.App);
```

- [ ] **Step 3: 手动端到端验证**

用浏览器打开 `player/index.html`，依次：
1. 选 `【官方双语】压缩即智能：Part1，重新发明熵.srt`
2. 选 `【官方双语】压缩即智能：Part1，重新发明熵.mp3`
3. 选 `vocabulary.json`

Expected：
- 左侧出现句子列表，每条 `[mm:ss] 文本`。
- 点第 3 句（"So you might naturally wonder..."）→ 从 4.72 秒播到 10.6 秒自动停，该行高亮、左侧图标变红。
- 右栏显示该句命中的单词 + 分级 + 释义（如 `wonder` 等若在词库中）。
- 点别的句子 → 上一句停、当前句高亮、右栏刷新。
- 状态条无红字报错。

- [ ] **Step 4: 提交**

```bash
git add player/src/ui.js player/src/main.js
git commit -m "feat: 实现UI模块与入口，完成端到端播放功能"
```

---

### Task 8: 实现构建脚本，产出单文件 dist/index.html

**Files:**
- Create: `player/build.js`

- [ ] **Step 1: 确认 Node 可用**

```bash
node --version
```
Expected: 输出版本号（如 v20.x）。若未装 Node，提示用户安装或跳过此 Task（开发页 index.html 本身已可用）。

- [ ] **Step 2: 写构建脚本 `player/build.js`**

```js
// 把 index.html 引用的 styles.css 和 src/*.js 内联，输出 dist/index.html
const fs = require('fs');
const path = require('path');

const root = __dirname;
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');

// 内联 <link rel="stylesheet" href="...">
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
  const css = fs.readFileSync(path.join(root, href), 'utf-8');
  return '<style>\n' + css + '\n</style>';
});

// 内联 <script src="...">（仅本地相对路径，不含 http）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  if (/^https?:/.test(src)) return m;
  const code = fs.readFileSync(path.join(root, src), 'utf-8');
  return '<script>\n' + code + '\n</script>';
});

const outPath = path.join(distDir, 'index.html');
fs.writeFileSync(outPath, html, 'utf-8');
console.log('已生成 ' + outPath + ' (' + html.length + ' 字节)');
```

- [ ] **Step 3: 运行构建**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
node player/build.js
```
Expected: 输出 "已生成 ...dist\index.html (N 字节)"。

- [ ] **Step 4: 验证单文件可用**

用浏览器打开 `player/dist/index.html`，重复 Task 7 Step 3 的端到端测试（选 3 个文件 → 点句子播放）。
Expected: 与开发页表现一致；dist/index.html 不依赖 src/ 目录（可单独拷走使用）。

- [ ] **Step 5: 提交**

```bash
git add player/build.js player/dist/index.html
git commit -m "feat: 添加构建脚本，产出单文件 dist/index.html"
```

---

## 手动验收清单（全部 Task 完成后）

对照设计文档 §9，用真实文件测试：

- [ ] 打开 `player/dist/index.html`，选 srt + mp3 + vocabulary.json。
- [ ] 左侧出现带 `[mm:ss]` 前缀的句子列表。
- [ ] 点第 1 句 → 从第 0 秒附近开始播，到该句结束自动停。
- [ ] 点中间某句 → 跳到对应时间播，到结束自动停；当前句高亮。
- [ ] 右侧单词面板显示命中单词 + 分级 + 释义。
- [ ] 切换句子：上一句停、当前句高亮、右栏刷新。
- [ ] 状态条无报错；缺音频时点句子提示"请先选择音频"。

---

## Self-Review 记录

（实施前由计划作者填写，确认已对照 spec 检查。）

- **Spec 覆盖**：§3 输入格式（SRT/音频/词库）→ Task 2/4/7；§5.1 播放区间 → Task 6；§5.2 SRT 容错 → Task 2+3 测；§5.3 词库合并查词 → Task 4+5 测；§5.4 时间戳 → Task 7 fmtTime；§6 布局 → Task 1；§7 错误处理 → Task 7 try/catch + audio error；§8 测试 → Task 3/5 浏览器测试页 + 各 Task 手动验收；§10/§11 产出与构建 → Task 8。全覆盖。
- **占位符**：无 TBD/TODO，每个代码步骤都给了完整代码。
- **类型一致性**：`Sentence{id,start,end,text}` 在 Task 2 定义、Task 3 测、Task 7 用；`Player.playSegment(start,end)` 在 Task 6 定义、Task 7 调用；`Word{word,level,def}` 在 Task 4 定义、Task 5 测、Task 7 渲染。命名一致。
