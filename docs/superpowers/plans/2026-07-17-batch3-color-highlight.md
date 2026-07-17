# 批次三实施计划：颜色高亮系统 + 超纲分级 + 音视频收展

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superagents:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给字幕里的词按难度分级着色（8 级含超纲），高亮跟随勾选；音频默认收起不可展开，视频默认展开高度为视窗一半。

**Architecture:** Vue 3 + Vite。新增颜色常量 + 两个 tokenize 纯函数（中栏渲染/右栏分组）；vocab-store 加超纲级与默认值；App 预算 renderedSentences（缓存 tokenize）；SentenceList 按片段渲染 span 着色；WordPanel 标题着色；SettingsPanel 加总开关；音视频收展由 mediaKind 控制。

**Tech Stack:** Vue 3（`<script setup>`）、Vite、原生 ES module 纯函数。

**当前状态:** 分支 `feature/srt-audio-player`。批次一二已交付。

**关键约束（所有子代理必须遵守）：**
- 用户偏好：注释/总结用中文。Windows 10，bash shell。
- **不改动**：player.js、subtitle-tweak.js、srt-parser.js、vocabulary.json。
- Vue 用 `<script setup>`。

---

## 文件结构总览

```
src/
├── level-colors.js        # 【新】LEVEL_COLORS（8 级 hex）
├── word-lookup.js         # 改：+ tokenizeForRender + classifyWords（保留 buildVocab/lookupWords）
├── vocab-store.js         # 改：levels 加超纲；默认值；getVocab；lookupByLevel 用 classifyWords
├── App.vue                # 改：默认勾选；highlightOn；mediaKind/收展；renderedSentences；传 props
├── components/
│   ├── SettingsPanel.vue  # 改：+ 总开关（背景色突出）
│   ├── SentenceList.vue   # 改：句子按片段渲染 span + 背景色
│   └── WordPanel.vue      # 改：分级标题用颜色
└── styles.css             # 改：词 span 圆角（背景用内联 style）
test.html                  # 改：+ tokenize/classify 断言；store 改用 classifyWords
```

**新增纯函数（word-lookup.js）：**
```js
// tokenizeForRender(text, vocab) → [{text, level}]  按位置，保留标点，不去重；level=命中级/'超纲'/null
// classifyWords(text, vocab) → {level: Word[]}  去重，含超纲组（超纲 def=''）
```

**颜色（level-colors.js）：**
```js
export const LEVEL_COLORS = {
  '初中':'#16a34a','高中':'#0891b2','四级':'#2563eb','六级':'#7c3aed',
  '考研':'#ea580c','托福':'#dc2626','SAT':'#db2777','超纲':'#6b7280'
};
```

---

### Task 1: level-colors.js + word-lookup 两纯函数 + 测试

**Files:**
- Create: `src/level-colors.js`
- Modify: `src/word-lookup.js`（追加两个 export，保留原有）
- Modify: `test.html`

- [ ] **Step 1: 创建 `src/level-colors.js`**

```js
// 分级颜色映射（level → hex）。词背景用 hex+'26'（~15% 透明）；标题用纯 hex。
// 配色后续可在此集中微调。
export const LEVEL_COLORS = {
  '初中': '#16a34a',
  '高中': '#0891b2',
  '四级': '#2563eb',
  '六级': '#7c3aed',
  '考研': '#ea580c',
  '托福': '#dc2626',
  'SAT': '#db2777',
  '超纲': '#6b7280'
};
```

- [ ] **Step 2: 在 `src/word-lookup.js` 末尾追加两个函数**

读 `src/word-lookup.js`（现有 buildVocab + lookupWords）。在文件**末尾**追加（不改动原有）：

```js

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
```

- [ ] **Step 3: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/level-colors.js src/word-lookup.js
git commit -m "feat: 新增 level-colors + tokenizeForRender/classifyWords 纯函数"
```

- [ ] **Step 4: 在 test.html 加 import + 断言**

读 `test.html`。在 import 块（现有 `import { computeEffectiveRanges } from './src/subtitle-tweak.js';` 之后）加：

```js
import { tokenizeForRender, classifyWords } from './src/word-lookup.js';
```

在汇总行 `out.innerHTML += '\n----\n...` **之前**追加断言：

```js
  // --- tokenizeForRender / classifyWords ---
  const tv = { 'hello': { level: '初中', def: 'x' } };  // vocab 大表形态
  const toks = tokenizeForRender('Hello, world!', tv);
  check('tokenize: 片段数=4', toks.length === 4);
  check('tokenize: 词片段带级别', toks[0].text === 'Hello' && toks[0].level === '初中');
  check('tokenize: 非词片段 level=null', toks[1].text === ', ' && toks[1].level === null);
  check('tokenize: 未命中词=超纲', toks[2].text === 'world' && toks[2].level === '超纲');
  check('tokenize: 末尾标点', toks[3].text === '!' && toks[3].level === null);

  const grps = classifyWords('Hello hello world', tv);
  check('classify: 初中去重=1', grps['初中'] && grps['初中'].length === 1);
  check('classify: 超纲=1', grps['超纲'] && grps['超纲'].length === 1);
  check('classify: 超纲 def 空', grps['超纲'][0].def === '');
```

- [ ] **Step 5: 验证（Node 复现）**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
cat > _t3_tmp.mjs <<'EOF'
import { tokenizeForRender, classifyWords } from './src/word-lookup.js';
let p=0,f=0; function ck(n,c){if(c)p++;else{f++;console.log('FAIL '+n);}}
const tv={'hello':{level:'初中',def:'x'}};
const toks=tokenizeForRender('Hello, world!',tv);
ck('片段数',toks.length===4);
ck('词级别',toks[0].text==='Hello'&&toks[0].level==='初中');
ck('非词null',toks[1].text===', '&&toks[1].level===null);
ck('超纲',toks[2].text==='world'&&toks[2].level==='超纲');
ck('末尾',toks[3].text==='!'&&toks[3].level===null);
const g=classifyWords('Hello hello world',tv);
ck('初中去重',g['初中'].length===1);
ck('超纲',g['超纲'].length===1);
ck('超纲def空',g['超纲'][0].def==='');
console.log('通过 '+p+', 失败 '+f);
EOF
node _t3_tmp.mjs ; rm -f _t3_tmp.mjs
```
Expected: `通过 9, 失败 0`。

- [ ] **Step 6: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add test.html
git commit -m "test: 补充 tokenizeForRender/classifyWords 断言"
```

---

### Task 2: vocab-store 扩展（超纲 + 默认值 + getVocab + classifyWords）

**Files:**
- Modify (full rewrite): `src/vocab-store.js`
- Modify: `test.html`（store 测试改用 classifyWords + 加超纲断言）

- [ ] **Step 1: 重写 `src/vocab-store.js`（完整）**

```js
// 词库管理：内置词库 + 分级勾选状态 + 按级查询
// 依赖注入 buildVocab/classifyWords，便于测试

export function createVocabStore(buildVocab, classifyWords) {
  const state = {
    ready: false,
    levels: [],     // 分级名（库级 + '超纲'）
    vocab: null,    // buildVocab 产物（大表）
    enabled: {}     // {level: bool}
  };
  // 默认不勾选的基础级别
  const DEFAULT_OFF = new Set(['初中', '高中', '四级']);

  function init(vocabObj) {
    state.vocab = buildVocab(vocabObj || {});
    state.levels = Object.keys(vocabObj || {}).concat(['超纲']);
    state.enabled = {};
    for (const level of state.levels) {
      state.enabled[level] = !DEFAULT_OFF.has(level);
    }
    state.ready = true;
  }

  function isReady() { return state.ready; }
  function getLevels() { return state.levels.slice(); }
  function getVocab() { return state.vocab; }
  function isEnabled(level) { return !!state.enabled[level]; }
  function setEnabled(level, bool) {
    state.enabled[level] = !!bool;
    return state.enabled[level];
  }

  // 句子 → {level: Word[]}（按 levels 顺序，只含已勾选且有命中的级；含超纲组）
  function lookupByLevel(text) {
    const all = classifyWords(text, state.vocab);
    const result = {};
    for (const level of state.levels) {
      if (!state.enabled[level]) continue;
      if (all[level] && all[level].length) result[level] = all[level];
    }
    return result;
  }

  return { init, isReady, getLevels, getVocab, isEnabled, setEnabled, lookupByLevel };
}
```

要点：第二参数 `lookupWords`→`classifyWords`；levels 末尾加 `'超纲'`；默认初中/高中/四级=false；新增 `getVocab()`；lookupByLevel 按 levels 顺序遍历、含超纲组。

- [ ] **Step 2: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/vocab-store.js
git commit -m "feat: vocab-store 加超纲级/默认值/getVocab，lookupByLevel 用 classifyWords"
```

- [ ] **Step 3: 改 test.html 的 store 部分（改用 classifyWords + 加超纲断言）**

读 `test.html`。当前 store 测试里有：
```js
const store = createVocabStore(buildVocab, lookupWords);
```
改为：
```js
const store = createVocabStore(buildVocab, classifyWords);
```
（`classifyWords` 已在 Task 1 Step 4 import。）

在 store 相关断言里，原 `getLevels()` 期望 `["初中","四级"]`，现在末尾多了"超纲"。找到：
```js
check('VocabStore: levels 顺序', JSON.stringify(store.getLevels()) === '["初中","四级"]');
```
改为：
```js
check('VocabStore: levels 顺序(含超纲)', JSON.stringify(store.getLevels()) === '["初中","四级","超纲"]');
```

`lookupByLevel` 的超纲行为：在 store 断言块末尾（`JSON.stringify(store.lookupByLevel('hello world'))==='{}'` 那条之后，汇总行之前）追加：
```js
  // 超纲分级
  const sg = store.lookupByLevel('encode compress zzz'); // encode/text→初中, compress→四级, zzz→超纲
  check('VocabStore: 超纲组存在', !!sg['超纲'] && sg['超纲'].length === 1);
  store.setEnabled('超纲', false);
  check('VocabStore: 取消超纲后无超纲栏', store.lookupByLevel('encode zzz')['超纲'] === undefined);
  store.setEnabled('超纲', true);
  // 默认勾选状态
  const s2 = createVocabStore(buildVocab, classifyWords);
  s2.init(vo);
  check('VocabStore: 初中默认不勾选', s2.isEnabled('初中') === false);
  check('VocabStore: 超纲默认勾选', s2.isEnabled('超纲') === true);
```

- [ ] **Step 4: 验证（Node 复现 store 全部断言）**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
cat > _vs_tmp.mjs <<'EOF'
import { buildVocab, classifyWords } from './src/word-lookup.js';
import { createVocabStore } from './src/vocab-store.js';
let p=0,f=0; function ck(n,c){if(c)p++;else{f++;console.log('FAIL '+n);}}
const vo={'初中':{'encode':'v. 编码','text':'n. 文本'},'四级':{'compress':'v. 压缩','binary':'n. 二进制'}};
const store=createVocabStore(buildVocab,classifyWords); store.init(vo);
ck('levels含超纲', JSON.stringify(store.getLevels())==='["初中","四级","超纲"]');
ck('初中默认off', store.isEnabled('初中')===false);
ck('超纲默认on', store.isEnabled('超纲')===true);
ck('getVocab有encode', !!store.getVocab()['encode']);
store.setEnabled('初中',true); store.setEnabled('四级',true);
const sg=store.lookupByLevel('encode compress zzz');
ck('超纲组', !!sg['超纲']&&sg['超纲'].length===1);
store.setEnabled('超纲',false);
ck('取消超纲', store.lookupByLevel('encode zzz')['超纲']===undefined);
console.log('通过 '+p+', 失败 '+f);
EOF
node _vs_tmp.mjs ; rm -f _vs_tmp.mjs
```
Expected: `通过 7, 失败 0`。

- [ ] **Step 5: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add test.html
git commit -m "test: store 测试改用 classifyWords + 超纲/默认值断言"
```

---

### Task 3: App.vue 数据层 + SettingsPanel 总开关 + 音视频收展

**Files:**
- Modify (full rewrite): `src/App.vue`
- Modify (full rewrite): `src/components/SettingsPanel.vue`

- [ ] **Step 1: 重写 `src/App.vue`（完整）**

```vue
<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import vocab from './vocabulary.json';
import { parseSRT } from './srt-parser.js';
import { buildVocab, classifyWords, tokenizeForRender } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import { computeEffectiveRanges } from './subtitle-tweak.js';
import { LEVEL_COLORS } from './level-colors.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';

// 词库 store（框架无关，非响应式）
const store = createVocabStore(buildVocab, classifyWords);
store.init(vocab);
const vocabTable = store.getVocab();

// 响应式勾选镜像：从 store 默认值读取（初中/高中/四级=false，其余=true）
const enabled = reactive({});
for (const lv of store.getLevels()) enabled[lv] = store.isEnabled(lv);

// 高亮总开关（默认开，只控中栏）
const highlightOn = ref(true);

// 全局状态
const sentences = ref([]);
const currentId = ref(null);
const currentText = ref('');
const isPlaying = ref(false);
const mediaName = ref('');
const mediaKind = ref(null); // 'video' | 'audio' | null
const statusText = ref('请选择文件');
const statusError = ref(false);

// 字幕微调参数
const offset = ref(0);
const extend = ref(0);
const linkNext = ref(false);

const mediaEl = ref(null);
const videoHeight = ref(240);
const videoCollapsed = ref(false);
let dragging = false, dragStartY = 0, dragStartH = 0;

function startResize(e) {
  dragging = true;
  dragStartY = e.clientY;
  dragStartH = videoHeight.value;
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  e.preventDefault();
}
function onResize(e) {
  if (!dragging) return;
  const delta = e.clientY - dragStartY; // 鼠标向下→手柄向下→视频变高
  const maxH = window.innerHeight * 0.7;
  let h = dragStartH + delta;
  if (h < 100) h = 100;
  if (h > maxH) h = maxH;
  videoHeight.value = h;
}
function stopResize() {
  dragging = false;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}
function toggleCollapse() {
  videoCollapsed.value = !videoCollapsed.value;
}

// 中栏渲染用：每句附加 tokens（仅依赖 sentences，缓存）
const renderedSentences = computed(() =>
  sentences.value.map(s => ({ ...s, tokens: tokenizeForRender(s.text, vocabTable) }))
);

const effectiveRanges = computed(() => computeEffectiveRanges(sentences.value, {
  offset: offset.value,
  extend: extend.value,
  linkNext: linkNext.value
}));

function onTweak(key, val) {
  if (key === 'offset') offset.value = val;
  else if (key === 'extend') extend.value = val;
  else if (key === 'linkNext') linkNext.value = val;
  else console.warn('未知微调参数：', key);
}
let player = null;

function onToggleLevel(level, val) {
  enabled[level] = val;
  store.setEnabled(level, val);
}

function onSrtFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      sentences.value = parseSRT(reader.result);
      if (player) player.stop();
      currentId.value = null;
      currentText.value = '';
      isPlaying.value = false;
      statusText.value = '已载入 ' + sentences.value.length + ' 句字幕';
      statusError.value = false;
    } catch (e) {
      statusText.value = '字幕解析失败：' + e.message;
      statusError.value = true;
    }
  };
  reader.readAsText(file, 'utf-8');
}

function onMediaFile(file) {
  if (!file) return;
  if (player) player.stop();
  isPlaying.value = false;
  player.setSrc(URL.createObjectURL(file));
  mediaName.value = file.name;
  const isVideo = (file.type || '').startsWith('video/');
  mediaKind.value = isVideo ? 'video' : 'audio';
  if (isVideo) {
    videoCollapsed.value = false;
    videoHeight.value = Math.round(window.innerHeight / 2);
  }
  statusText.value = '已载入：' + file.name;
  statusError.value = false;
}

function onSentenceClick(sentence) {
  currentId.value = sentence.id;
  currentText.value = sentence.text;
  if (!mediaName.value) {
    statusText.value = '请先选择音/视频文件';
    statusError.value = true;
    return;
  }
  const r = effectiveRanges.value.get(sentence.id) || { effStart: sentence.start, effEnd: sentence.end };
  isPlaying.value = true;
  player.playSegment(r.effStart, r.effEnd);
}

onMounted(() => {
  player = new Player(mediaEl.value);
  player.onStop(() => { isPlaying.value = false; });
  mediaEl.value.addEventListener('error', () => {
    if (mediaEl.value.error && mediaName.value) {
      isPlaying.value = false;
      statusText.value = '音/视频无法播放（编码不支持），建议改用 mp4/mp3';
      statusError.value = true;
    }
  });
});
</script>

<template>
  <div class="layout">
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      :offset="offset"
      :extend="extend"
      :link-next="linkNext"
      :highlight-on="highlightOn"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
      @tweak="onTweak"
      @toggle-highlight="val => highlightOn = val"
    />
    <main class="panel-center">
      <div class="video-slot" :class="{ 'no-video': mediaKind !== 'video', collapsed: videoCollapsed }">
        <video v-show="!videoCollapsed" ref="mediaEl" class="media-video"
               preload="metadata" :style="{ height: videoHeight + 'px' }"></video>
        <button v-show="!videoCollapsed" class="collapse-btn" @click="toggleCollapse">收起</button>
        <div v-show="!videoCollapsed" class="resize-handle" @mousedown="startResize"></div>
        <button v-if="videoCollapsed" class="expand-btn" @click="toggleCollapse">▸ 展开视频</button>
      </div>
      <SentenceList
        :sentences="renderedSentences"
        :current-id="currentId"
        :is-playing="isPlaying"
        :enabled="enabled"
        :highlight-on="highlightOn"
        :colors="LEVEL_COLORS"
        @click="onSentenceClick"
      />
      <span class="status" :class="{ error: statusError }">{{ statusText }}</span>
    </main>
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
      :colors="LEVEL_COLORS"
    />
  </div>
</template>
```

要点：import 加 classifyWords/tokenizeForRender/LEVEL_COLORS；store 用 classifyWords；enabled 从 store 默认值读；highlightOn ref；mediaKind + onMediaFile 判断音视频；renderedSentences computed；video-slot 用 `no-video` class（音频/无媒体隐藏）；SentenceList 传 renderedSentences/enabled/highlightOn/colors；WordPanel 传 colors；SettingsPanel 传 highlight-on + @toggle-highlight。

- [ ] **Step 2: 重写 `src/components/SettingsPanel.vue`（单一 `<script setup>`，加圆点 + 总开关）**

```vue
<script setup>
import { LEVEL_COLORS } from '../level-colors.js';

const props = defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true },
  offset: { type: Number, default: 0 },
  extend: { type: Number, default: 0 },
  linkNext: { type: Boolean, default: false },
  highlightOn: { type: Boolean, default: true }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'media-file', 'tweak', 'toggle-highlight']);

function dotColor(lv) { return LEVEL_COLORS[lv] || '#9ca3af'; }

function onSrtChange(e) {
  const f = e.target.files[0];
  if (f) emit('srt-file', f);
}
function onMediaChange(e) {
  const f = e.target.files[0];
  if (f) emit('media-file', f);
}
function onTweak(key, val) {
  emit('tweak', key, val);
}
</script>

<template>
  <aside class="panel-left">
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-item">
          <input type="checkbox" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span class="level-dot" :style="{ background: dotColor(lv) }"></span>
          <span>{{ lv }}</span>
        </label>
      </div>
      <label class="level-item highlight-toggle">
        <input type="checkbox" :checked="highlightOn"
               @change="emit('toggle-highlight', $event.target.checked)" />
        <span>用背景色突出单词</span>
      </label>
    </section>

    <section class="tweak">
      <h3 class="panel-title">字幕微调</h3>
      <label class="tweak-row">起始偏移(秒)
        <input type="number" min="-10" max="10" step="0.1" :value="offset"
               @change="onTweak('offset', parseFloat($event.target.value) || 0)" />
      </label>
      <label class="tweak-row">末尾延长(秒)
        <input type="number" min="0" max="5" step="0.1" :value="extend"
               @change="onTweak('extend', parseFloat($event.target.value) || 0)" />
      </label>
      <label class="level-item">
        <input type="checkbox" :checked="linkNext"
               @change="onTweak('linkNext', $event.target.checked)" />
        <span>句末连接(播到下一句开头)</span>
      </label>
    </section>

    <section class="files">
      <h3 class="panel-title">文件</h3>
      <label class="file-btn">字幕 .srt
        <input type="file" accept=".srt" @change="onSrtChange" />
      </label>
      <label class="file-btn">音/视频
        <input type="file" accept="audio/*,video/*" @change="onMediaChange" />
      </label>
    </section>
  </aside>
</template>
```

要点：单一 `<script setup>`（import LEVEL_COLORS + 定义 dotColor）；每个级别名前加小圆点 `.level-dot` 显示该级颜色；新增"用背景色突出单词"总开关（emit `toggle-highlight`）；去掉了原 `.vocab-status`（改用圆点直观显示分级与颜色）。

> 保留 Step 4/5/6 编号不变（styles 追加、构建、提交）。

- [ ] **Step 4: 在 `src/styles.css` 追加样式**

文件末尾追加：
```css

/* 分级圆点 + 高亮开关 */
.level-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.highlight-toggle { margin-top: 6px; padding-top: 6px; border-top: 1px solid #e5e7eb; }

/* 视频区：非视频时隐藏（audio 元素仍在 DOM 可播声音） */
.video-slot.no-video { display: none; }

/* 中栏词 span 圆角（背景色由内联 style 设） */
.sentence .text span { border-radius: 2px; }
```

- [ ] **Step 5: 构建 + 验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build 2>&1 | tail -3
grep -c "用背景色突出单词" dist/index.html   # 期望 ≥1
grep -c "超纲" dist/index.html               # 期望 ≥1
```
Expected: 构建无错。

- [ ] **Step 6: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/App.vue src/components/SettingsPanel.vue src/styles.css dist/index.html
git commit -m "feat: 高亮数据层 + 总开关 + 音视频默认收展 + 分级圆点"
```

---

### Task 4: SentenceList 高亮渲染 + WordPanel 标题色

**Files:**
- Modify (full rewrite): `src/components/SentenceList.vue`
- Modify (full rewrite): `src/components/WordPanel.vue`

- [ ] **Step 1: 重写 `src/components/SentenceList.vue`（按片段渲染 + 背景色）**

```vue
<script setup>
const props = defineProps({
  sentences: { type: Array, required: true },   // 含 tokens 的 renderedSentences
  currentId: { type: [Number, null], default: null },
  isPlaying: { type: Boolean, default: false },
  enabled: { type: Object, required: true },
  highlightOn: { type: Boolean, default: true },
  colors: { type: Object, required: true }
});
const emit = defineEmits(['click']);

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// 片段背景：高亮开 + 片段有级别 + 该级勾选 → 该级色半透明；否则无
function tokStyle(tok) {
  if (!props.highlightOn || !tok.level || !props.enabled[tok.level]) return {};
  const c = props.colors[tok.level];
  return c ? { backgroundColor: c + '26' } : {};
}
</script>

<template>
  <div class="sentences">
    <div v-if="!sentences.length" class="placeholder">选择字幕后，句子列表会显示在这里</div>
    <div
      v-for="s in sentences"
      :key="s.id"
      class="sentence"
      :class="{ active: s.id === currentId, playing: s.id === currentId && isPlaying }"
      @click="emit('click', s)"
    >
      <span class="play-icon">{{ (s.id === currentId && isPlaying) ? '⏸' : '▶' }}</span>
      <span class="time">[{{ fmt(s.start) }}]</span>
      <span class="text">
        <span v-for="(tok, i) in s.tokens" :key="i" :style="tokStyle(tok)">{{ tok.text }}</span>
      </span>
    </div>
  </div>
</template>
```

> 注：props.sentences 实际是 App 传入的 renderedSentences（每项含 tokens）。onSentenceClick 接收的 s 仍带原字段（id/start/end/text，因为 renderedSentences 用 ...s 展开），playSegment 用 effectiveRanges 取区间，不受 tokens 影响。

- [ ] **Step 2: 重写 `src/components/WordPanel.vue`（标题着色）**

```vue
<script setup>
import { computed } from 'vue';

const props = defineProps({
  store: { type: Object, required: true },
  enabled: { type: Object, required: true },
  currentText: { type: String, default: '' },
  colors: { type: Object, required: true }
});

// 命中单词分组（按级）。显式读取 enabled 各属性以建立响应式依赖。
const groups = computed(() => {
  for (const lv of props.store.getLevels()) {
    void props.enabled[lv];
  }
  return props.store.lookupByLevel(props.currentText);
});

const hasAnyEnabled = computed(() =>
  props.store.getLevels().some(lv => props.enabled[lv])
);

const visibleLevels = computed(() =>
  props.store.getLevels().filter(lv =>
    props.enabled[lv] && groups.value[lv] && groups.value[lv].length > 0
  )
);

function titleColor(lv) { return props.colors[lv] || '#2563eb'; }
</script>

<template>
  <aside class="panel-right">
    <h3 class="panel-title">当前句单词</h3>
    <div v-if="!currentText" class="placeholder">点击中间句子查看单词</div>
    <div v-else-if="!hasAnyEnabled" class="placeholder">未勾选任何分级</div>
    <div v-else-if="!visibleLevels.length" class="placeholder">当前句没有词库中的单词</div>
    <div v-else class="word-groups">
      <div v-for="lv in visibleLevels" :key="lv" class="word-group">
        <h4 :style="{ color: titleColor(lv) }">{{ lv }} ({{ groups[lv].length }})</h4>
        <div v-for="w in groups[lv]" :key="w.word" class="word">
          <div class="w">{{ w.word }}</div>
          <div v-if="w.def" class="def">{{ w.def }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>
```

要点：props 加 `colors`；`<h4>` 加 `:style="{ color: titleColor(lv) }"`；超纲词 def 为空时不渲染 def 行（`v-if="w.def"`）。

- [ ] **Step 3: 构建 + 验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build 2>&1 | tail -3
grep -c "tokStyle\|tok.level" dist/index.html   # 期望 ≥1（可能压缩，≥0 也接受）
```
Expected: 构建无错。

- [ ] **Step 4: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/components/SentenceList.vue src/components/WordPanel.vue dist/index.html
git commit -m "feat: 中栏词背景色高亮 + 右栏分级标题着色"
```

---

### Task 5: 构建 + 端到端验证

**Files:** 仅验证。

- [ ] **Step 1: 干净构建**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
rm -rf dist
npm run build
ls dist/
wc -c dist/index.html
```
Expected: dist/ 仅 index.html。

- [ ] **Step 2: 验证 dist 自包含 + 新功能在内联产物中**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
grep -c 'src="/' dist/index.html               # 期望 0
grep -c "超纲" dist/index.html                  # 期望 ≥1
grep -c "用背景色突出单词" dist/index.html       # 期望 ≥1
grep -c "16a34a" dist/index.html                # 期望 ≥1（颜色常量内联）
node --input-type=module -e "import('./src/word-lookup.js').then(m=>console.log('lookup ok:', typeof m.tokenizeForRender, typeof m.classifyWords)).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: src="/=0；其余 ≥1 / `lookup ok: function function`。

- [ ] **Step 3: 真实数据逻辑验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
cat > _e2e3_tmp.mjs <<'EOF'
import fs from 'fs';
import { parseSRT } from './src/srt-parser.js';
import { buildVocab, classifyWords, tokenizeForRender } from './src/word-lookup.js';
import { createVocabStore } from './src/vocab-store.js';
const srt = fs.readFileSync('【官方双语】压缩即智能：Part1，重新发明熵.srt', 'utf-8');
const sentences = parseSRT(srt);
const vocab = JSON.parse(fs.readFileSync('src/vocabulary.json', 'utf-8'));
const store = createVocabStore(buildVocab, classifyWords);
store.init(vocab);
console.log('SRT 句数:', sentences.length);
console.log('分级:', store.getLevels().join(' / '));
console.log('初中默认:', store.isEnabled('初中'), '超纲默认:', store.isEnabled('超纲'));
const s3 = sentences[2];
const g = classifyWords(s3.text, store.getVocab());
console.log('第3句各级词数:', Object.keys(g).map(k=>k+'('+g[k].length+')').join(', '));
const toks = tokenizeForRender(s3.text, store.getVocab());
console.log('第3句片段数:', toks.length);
EOF
node _e2e3_tmp.mjs ; rm -f _e2e3_tmp.mjs
```
Expected: 分级含"超纲"；初中默认 false、超纲默认 true；第3句有超纲组。

- [ ] **Step 4: 提交（若 dist 有变化）**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add dist/
git commit -m "chore: 批次三构建产物" 2>&1 | tail -2 || echo "dist 无变化"
```

---

## 手动验收清单（人在浏览器）

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run dev
```

- [ ] 左栏 8 个级别（含超纲），每级名前一个对应色小圆点；初中/高中/四级默认未勾选，其余勾选。
- [ ] 新增"用背景色突出单词"开关（默认开）。
- [ ] 选 SRT → 中栏句子里，勾选级别的词有对应色背景（六级紫、超纲灰等）；未勾选级别（初中等）的词无背景。
- [ ] 取消勾选某级 → 中栏该级词背景消失 + 右栏该栏消失。
- [ ] 关"背景色突出" → 中栏全部词无背景（纯文本）；右栏不变。
- [ ] 右栏每个分级标题用对应颜色；超纲栏只列词（无释义）。
- [ ] 选**音频** → 视频区不显示、无法展开；中栏占满。
- [ ] 选**视频** → 视频区显示、默认高度≈视窗一半、可拖拽/收展。
- [ ] `npm run build` → dist/index.html 单文件。

---

## Self-Review 记录

- **Spec 覆盖**：超纲分级 → T1(classifyWords)+T2(store levels/默认)+T4(右栏超纲栏)；颜色 → T1(level-colors)+T3(圆点)+T4(中栏背景/右栏标题)；高亮跟随勾选 → T4(tokStyle 判 enabled)；总开关 → T3(highlightOn/SettingsPanel)+T4(用之)；音视频收展 → T3(mediaKind/onMediaFile/no-video class)；默认勾选 → T2(DEFAULT_OFF)+T3(enabled 从 store 读)。全覆盖。
- **占位符**：无。
- **一致性**：
  - `createVocabStore(buildVocab, classifyWords)`：T2 定义、test/App 用。
  - `tokenizeForRender`/`classifyWords`：T1 定义、T3/T4 用。
  - `LEVEL_COLORS`：T1 定义、T3(SettingsPanel 圆点)/T4(WordPanel/SentenceList 经 props) 用。
  - props 名：App 传 renderedSentences(=sentences prop)/enabled/highlightOn/colors 给 SentenceList；colors 给 WordPanel；highlight-on 给 SettingsPanel——各组件 defineProps 一致。
  - SettingsPanel：T3 Step 2（setup+options 混用，作废）→ Step 3（单一 setup，正确）。实现以 Step 3 为准。
