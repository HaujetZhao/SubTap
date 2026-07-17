# 批次二实施计划：视频支持 + 字幕时间微调

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在批次一基础上增加：音视频统一播放（`<video>` 元素 + 拖拽调高度 + 收起）与字幕时间微调（起始偏移、末尾延长、句末连接开关）。

**Architecture:** Vue 3 + Vite（延续批次一）。`<audio>` 换成 `<video>` 通吃音视频，player.js 零改动；有效区间计算抽成纯函数 `src/subtitle-tweak.js`（可单测）；视频控件（拖拽/收起）与微调参数都在 App.vue/SettingsPanel.vue。

**Tech Stack:** Vue 3（`<script setup>`）、Vite、原生 ES module 纯函数。

**当前状态:** 分支 `feature/srt-audio-player`。批次一已交付（三栏 + 词库内置 + 分级勾选，Vue+Vite）。App.vue 现有 `<audio ref="audioEl">` + 空 `.video-slot`；SettingsPanel 有"音频"入口；player.js 用 HTMLMediaElement 通用 API。

**关键约束（所有子代理必须遵守）：**
- 用户偏好：注释/总结用中文。Windows 10，bash shell（正斜杠、Unix 语法）。
- **不改动**：player.js、vocab-store.js、srt-parser.js、word-lookup.js、SentenceList.vue、WordPanel.vue、vocabulary.json。
- Vue 用 `<script setup>` + Composition API。

---

## 文件结构总览

```
src/
├── subtitle-tweak.js      # 【新】computeEffectiveRanges 纯函数
├── App.vue                # 改：<audio>→<video>；视频拖拽/收起；微调参数+有效区间
├── components/
│   └── SettingsPanel.vue  # 改：音频入口→音/视频；新增"字幕微调"区块
└── styles.css             # 改：视频区/拖拽手柄/收起按钮/微调区块
test.html                  # 改：加 subtitle-tweak 断言
```

**纯函数接口（subtitle-tweak.js）：**
```js
// computeEffectiveRanges(sentences, {offset, extend, linkNext}) → Map<id, {effStart, effEnd}>
//   effStart = s.start + offset
//   linkNext 且非末句 → effEnd = next.start + offset（连接优先，忽略 extend）
//   否则 → effEnd = s.end + extend
//   effEnd <= effStart 时夹到 effStart + 0.05
```

---

### Task 1: subtitle-tweak.js 纯函数 + 测试

**Files:**
- Create: `src/subtitle-tweak.js`
- Modify: `test.html`

- [ ] **Step 1: 创建 `src/subtitle-tweak.js`**

```js
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
```

- [ ] **Step 2: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/subtitle-tweak.js
git commit -m "feat: 新增 subtitle-tweak 纯函数（有效播放区间计算）"
```

- [ ] **Step 3: 在 test.html 引入模块 + 加断言**

读 `test.html`。在 `<script type="module">` 的 import 块（现有 `import { createVocabStore } from './src/vocab-store.js';`）之后加一行：

```js
import { computeEffectiveRanges } from './src/subtitle-tweak.js';
```

在测试 IIFE 末尾的 `out.innerHTML += '\n----\n...` 汇总行**之前**，追加断言：

```js
  // --- subtitle-tweak ---
  const ss = [{ id: 1, start: 0, end: 1 }, { id: 2, start: 2, end: 3 }, { id: 3, start: 5, end: 6 }];
  const m0 = computeEffectiveRanges(ss, {});
  check('tweak: 默认 effStart=start/effEnd=end', m0.get(1).effStart === 0 && m0.get(1).effEnd === 1);
  const mo = computeEffectiveRanges(ss, { offset: 1 });
  check('tweak: offset 影响 start', mo.get(1).effStart === 1);
  const me = computeEffectiveRanges(ss, { extend: 0.5 });
  check('tweak: extend 影响 end', me.get(1).effEnd === 1.5);
  const ml = computeEffectiveRanges(ss, { linkNext: true });
  check('tweak: linkNext 连下一句 start', ml.get(1).effEnd === 2);
  check('tweak: linkNext 末句用 end', ml.get(3).effEnd === 6);
  const ml2 = computeEffectiveRanges(ss, { linkNext: true, extend: 0.5 });
  check('tweak: linkNext 末句 end+extend', ml2.get(3).effEnd === 6.5);
  const mc = computeEffectiveRanges([{ id: 1, start: 5, end: 6 }], { offset: 10 });
  check('tweak: effEnd<=effStart 夹到 +0.05', mc.get(1).effStart === 15 && mc.get(1).effEnd === 15.05);
```

- [ ] **Step 4: 验证（Node 复现，子代理 headless）**

用项目内临时 .mjs（CJK 安全，勿用内联 `node -e`）：

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
cat > _tweak_tmp.mjs <<'EOF'
import { computeEffectiveRanges } from './src/subtitle-tweak.js';
let pass=0, fail=0;
function check(n,c){ if(c) pass++; else { fail++; console.log('FAIL '+n); } }
const ss=[{id:1,start:0,end:1},{id:2,start:2,end:3},{id:3,start:5,end:6}];
const m0=computeEffectiveRanges(ss,{}); check('默认',m0.get(1).effStart===0&&m0.get(1).effEnd===1);
const mo=computeEffectiveRanges(ss,{offset:1}); check('offset',mo.get(1).effStart===1);
const me=computeEffectiveRanges(ss,{extend:0.5}); check('extend',me.get(1).effEnd===1.5);
const ml=computeEffectiveRanges(ss,{linkNext:true}); check('linkNext连下句',ml.get(1).effEnd===2);
check('linkNext末句',ml.get(3).effEnd===6);
const ml2=computeEffectiveRanges(ss,{linkNext:true,extend:0.5}); check('linkNext末句延长',ml2.get(3).effEnd===6.5);
const mc=computeEffectiveRanges([{id:1,start:5,end:6}],{offset:10}); check('夹值',mc.get(1).effStart===15&&mc.get(1).effEnd===15.05);
console.log('通过 '+pass+', 失败 '+fail);
EOF
node _tweak_tmp.mjs ; rm -f _tweak_tmp.mjs
```
Expected: `通过 7, 失败 0`。

- [ ] **Step 5: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add test.html
git commit -m "test: 补充 subtitle-tweak 的浏览器测试"
```

---

### Task 2: audio→video 统一媒体元素 + 音视频入口

**Files:**
- Modify (full rewrite): `src/App.vue`
- Modify (full rewrite): `src/components/SettingsPanel.vue`
- Modify: `src/styles.css`

- [ ] **Step 1: 重写 `src/App.vue`（完整）**

```vue
<script setup>
import { ref, reactive, onMounted } from 'vue';
import vocab from './vocabulary.json';
import { parseSRT } from './srt-parser.js';
import { buildVocab, lookupWords } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';

// 词库 store（框架无关，非响应式）
const store = createVocabStore(buildVocab, lookupWords);
store.init(vocab);

// 响应式勾选镜像：驱动 UI 重算
const enabled = reactive({});
for (const lv of store.getLevels()) enabled[lv] = true;

// 全局状态
const sentences = ref([]);
const currentId = ref(null);
const currentText = ref('');
const isPlaying = ref(false);
const mediaName = ref('');
const statusText = ref('请选择文件');
const statusError = ref(false);

const mediaEl = ref(null);
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
  isPlaying.value = true;
  player.playSegment(sentence.start, sentence.end);
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
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
    />
    <main class="panel-center">
      <div class="video-slot" :class="{ empty: !mediaName }">
        <video ref="mediaEl" class="media-video" preload="metadata" controls></video>
      </div>
      <SentenceList
        :sentences="sentences"
        :current-id="currentId"
        :is-playing="isPlaying"
        @click="onSentenceClick"
      />
      <span class="status" :class="{ error: statusError }">{{ statusText }}</span>
    </main>
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
    />
  </div>
</template>
```

要点：`audioName`→`mediaName`；`onAudioFile`→`onMediaFile`（选新媒体先 stop）；`<audio>`→`<video>`（带 controls）；`.video-slot` 无媒体时加 `empty` class；事件名 `audio-file`→`media-file`。

- [ ] **Step 2: 重写 `src/components/SettingsPanel.vue`（完整）**

```vue
<script setup>
defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'media-file']);

function onSrtChange(e) {
  const f = e.target.files[0];
  if (f) emit('srt-file', f);
}
function onMediaChange(e) {
  const f = e.target.files[0];
  if (f) emit('media-file', f);
}
</script>

<template>
  <aside class="panel-left">
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      <div class="vocab-status">共 {{ levels.length }} 个分级</div>
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-item">
          <input type="checkbox" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span>{{ lv }}</span>
        </label>
      </div>
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

要点：emit `audio-file`→`media-file`；"音频"按钮→"音/视频"（accept `audio/*,video/*`）。

- [ ] **Step 3: 改 `src/styles.css` 视频区段**

把现有这行：
```css
.video-slot { flex-shrink: 0; background: #000; height: 0; } /* 批次二填 */
```
替换为：
```css
.video-slot { flex-shrink: 0; background: #000; }
.video-slot.empty { display: none; }
.media-video { display: block; width: 100%; max-height: 40vh; background: #000; }
```

- [ ] **Step 4: 构建 + 验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build 2>&1 | tail -3
grep -c "media-video" dist/index.html   # 期望 ≥1
grep -c "音/视频" dist/index.html        # 期望 ≥1
```
Expected: 构建无错。

- [ ] **Step 5: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/App.vue src/components/SettingsPanel.vue src/styles.css dist/index.html
git commit -m "feat: audio→video 统一媒体元素 + 音视频入口"
```

---

### Task 3: 视频区拖拽调高度 + 收起按钮

**Files:**
- Modify: `src/App.vue`（加拖拽/收起状态与函数 + 模板控件）
- Modify: `src/styles.css`（追加控件样式）

- [ ] **Step 1: 在 `src/App.vue` 的 `<script setup>` 加状态与函数**

在 `const mediaEl = ref(null);` 这行之后、`let player = null;` 之前，插入：

```js
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
  const delta = dragStartY - e.clientY; // 向上拖增大高度
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
```

- [ ] **Step 2: 改 `src/App.vue` 模板的 `.video-slot` 块**

把：
```html
      <div class="video-slot" :class="{ empty: !mediaName }">
        <video ref="mediaEl" class="media-video" preload="metadata" controls></video>
      </div>
```
替换为：
```html
      <div class="video-slot" :class="{ empty: !mediaName }">
        <div class="video-bar">
          <button class="collapse-btn" @click="toggleCollapse">
            {{ videoCollapsed ? '展开视频' : '收起视频' }}
          </button>
        </div>
        <video v-show="!videoCollapsed" ref="mediaEl" class="media-video"
               preload="metadata" controls :style="{ height: videoHeight + 'px' }"></video>
        <div v-show="!videoCollapsed" class="resize-handle" @mousedown="startResize"></div>
      </div>
```

- [ ] **Step 3: 在 `src/styles.css` 追加控件样式**

在文件末尾追加：
```css

/* 视频区控件 */
.video-bar { display: flex; justify-content: flex-end; padding: 2px 6px; background: #1f2937; }
.collapse-btn { background: none; border: none; color: #d1d5db; font-size: 12px; cursor: pointer; padding: 2px 6px; }
.collapse-btn:hover { color: #fff; }
.resize-handle { height: 6px; cursor: ns-resize; background: #374151; }
.resize-handle:hover { background: #4b5563; }
```

并把 `.media-video` 那行的 `max-height: 40vh;` 去掉（高度改由 videoHeight 控制）：
```css
.media-video { display: block; width: 100%; background: #000; }
```

- [ ] **Step 4: 构建 + 验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build 2>&1 | tail -3
grep -c "resize-handle" dist/index.html   # 期望 ≥1
grep -c "collapse-btn" dist/index.html    # 期望 ≥1
```
Expected: 构建无错。

- [ ] **Step 5: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/App.vue src/styles.css dist/index.html
git commit -m "feat: 视频区拖拽调高度 + 收起按钮"
```

---

### Task 4: 字幕时间微调（SettingsPanel 区块 + 有效区间）

**Files:**
- Modify (full rewrite): `src/components/SettingsPanel.vue`（加微调区块）
- Modify: `src/App.vue`（加参数 ref + computed + onTweak + onSentenceClick 用有效区间）
- Modify: `src/styles.css`（追加微调样式）

- [ ] **Step 1: 重写 `src/components/SettingsPanel.vue`（完整，加微调区块）**

```vue
<script setup>
const props = defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true },
  offset: { type: Number, default: 0 },
  extend: { type: Number, default: 0 },
  linkNext: { type: Boolean, default: false }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'media-file', 'tweak']);

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
      <div class="vocab-status">共 {{ levels.length }} 个分级</div>
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-item">
          <input type="checkbox" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span>{{ lv }}</span>
        </label>
      </div>
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

- [ ] **Step 2: 在 `src/App.vue` 加 import、参数、computed、onTweak**

把第一行 import：
```js
import { ref, reactive, onMounted } from 'vue';
```
改为：
```js
import { ref, reactive, computed, onMounted } from 'vue';
```

在 `import { Player } from './player.js';` 之后加一行：
```js
import { computeEffectiveRanges } from './subtitle-tweak.js';
```

在 `const mediaEl = ref(null);` 之前（即 `const statusError = ref(false);` 之后）加微调参数：
```js
// 字幕微调参数
const offset = ref(0);
const extend = ref(0);
const linkNext = ref(false);
```

在 Task 3 新增的 `function toggleCollapse()` 之后，加 computed 与 onTweak：
```js
const effectiveRanges = computed(() => computeEffectiveRanges(sentences.value, {
  offset: offset.value,
  extend: extend.value,
  linkNext: linkNext.value
}));

function onTweak(key, val) {
  if (key === 'offset') offset.value = val;
  else if (key === 'extend') extend.value = val;
  else if (key === 'linkNext') linkNext.value = val;
}
```

- [ ] **Step 3: 改 `src/App.vue` 的 onSentenceClick 用有效区间**

把 `onSentenceClick` 里这两行：
```js
  isPlaying.value = true;
  player.playSegment(sentence.start, sentence.end);
```
替换为：
```js
  const r = effectiveRanges.value.get(sentence.id) || { effStart: sentence.start, effEnd: sentence.end };
  isPlaying.value = true;
  player.playSegment(r.effStart, r.effEnd);
```

- [ ] **Step 4: 改 `src/App.vue` 模板的 `<SettingsPanel>` 加 props/事件**

把：
```html
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
    />
```
替换为：
```html
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      :offset="offset"
      :extend="extend"
      :link-next="linkNext"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
      @tweak="onTweak"
    />
```

- [ ] **Step 5: 在 `src/styles.css` 追加微调样式**

文件末尾追加：
```css

/* 字幕微调 */
.tweak { display: flex; flex-direction: column; gap: 6px; }
.tweak-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; gap: 8px;
}
.tweak-row input { width: 70px; padding: 2px 4px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
```

- [ ] **Step 6: 构建 + 验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build 2>&1 | tail -3
grep -c "字幕微调" dist/index.html      # 期望 ≥1
grep -c "computeEffectiveRanges\|effectiveRanges" dist/index.html  # 期望 ≥1（可能被压缩，≥0 也接受）
```
Expected: 构建无错。

- [ ] **Step 7: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add src/components/SettingsPanel.vue src/App.vue src/styles.css dist/index.html
git commit -m "feat: 字幕时间微调（起始偏移/末尾延长/句末连接）"
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
Expected: dist/ 仅 index.html（singlefile）；体积与批次一量级（含词库 ~1MB+）。

- [ ] **Step 2: 验证 dist 自包含 + 新功能在内联产物中**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
grep -c 'src="/' dist/index.html      # 期望 0
grep -c "字幕微调" dist/index.html     # 期望 ≥1
grep -c "resize-handle" dist/index.html  # 期望 ≥1
node --input-type=module -e "import('./src/subtitle-tweak.js').then(m=>console.log('tweak ok:', typeof m.computeEffectiveRanges)).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: 第一个 0；其余 ≥1 / `tweak ok: function`。

- [ ] **Step 3: 提交（若 dist 有变化）**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add dist/
git commit -m "chore: 批次二构建产物" 2>&1 | tail -2 || echo "dist 无变化"
```

---

## 手动验收清单（全部 Task 完成后，人在浏览器执行）

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run dev    # 开 http://localhost:5173
```

对照设计文档 §9：

- [ ] 左栏多出"字幕微调"节（起始偏移/末尾延长/句末连接），默认 0/0/关。
- [ ] 选 SRT + 选视频（mp4）→ 中栏上方显示视频画面；点句子 → 视频跳转播放、画面随之、到点自动停。
- [ ] 选音频（mp3）→ 视频区无画面但占位高度；点句子纯听播放。
- [ ] 拖拽视频区底部手柄 → 高度随之变化（上下限有效）；"收起视频"→ 视频区塌缩、字幕区扩大、声音继续；"展开视频"恢复。
- [ ] 起始偏移设 +1 → 点句比原 start 晚 1 秒开始；设 -1 → 早 1 秒。
- [ ] 末尾延长设 +0.5 → 句子比原 end 多播 0.5 秒。
- [ ] 句末连接开 → 句子播到下一句开头（长词不再被提前切断）。
- [ ] 改微调参数时正在播放的段不跳；下次点句按新参数。
- [ ] 无媒体源点句 → "请先选择音/视频文件"。
- [ ] `npm run build` → `dist/index.html` 单文件自包含。

---

## Self-Review 记录

- **Spec 覆盖**：
  - 音视频统一（`<video>` + 入口）→ T2。
  - 拖拽调高度 + 收起 → T3。
  - 起始偏移/末尾延长/句末连接 → T1（纯函数）+ T4（UI + 接入）。
  - 有效区间 computed（连接优先、末句退化、夹值）→ T1 函数 + T4 computed。
  - 改参数下次点句生效 → T4（onSentenceClick 读 effectiveRanges.value，computed 响应式但播放段不中途改）。
  - 错误处理（无媒体提示、解码失败、effEnd 夹值）→ T2 + T1。
  - 单文件构建 → T5。
  - 验收 → 手动清单。全覆盖。

- **占位符**：无。

- **类型/命名一致性**：
  - `computeEffectiveRanges(sentences, {offset, extend, linkNext})` → `Map<id,{effStart,effEnd}>`：T1 定义、T1 测、T4 用。
  - App 状态 `mediaName`（T2，替代 audioName）、`videoHeight/videoCollapsed`（T3）、`offset/extend/linkNext/effectiveRanges/onTweak`（T4）—— 各 Task 间命名一致。
  - SettingsPanel props：T2（levels/enabled）→ T4 加（offset/extend/linkNext）；emits：T2（toggle-level/srt-file/media-file）→ T4 加（tweak）。App 模板绑定一致。
  - 事件名 `media-file`（T2 App + SettingsPanel 一致）、`tweak`（T4 一致）。
  - T3/T4 的 Edit old_string 均取自 T2 写入的已知内容，精确可匹配。
