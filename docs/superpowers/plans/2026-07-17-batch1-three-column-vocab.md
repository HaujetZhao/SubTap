# 批次一实施计划：三栏布局 + 词库内置 + 分级勾选（Vue 3 + Vite）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把第一版重构为三栏布局（左设置/中字幕/右单词）、词库内置、左栏分级勾选、右栏按级分栏——用 **Vue 3 + Vite** 实现。

**Architecture:** Vue 3（`<script setup>` Composition API）+ Vite（dev server + `vite build` + `vite-plugin-singlefile` 内联单文件）。纯逻辑模块（srt-parser/word-lookup/player/vocab-store，已完成、框架无关）直接 import 复用；UI 层用 Vue 组件（App.vue + SettingsPanel/SentenceList/WordPanel）。词库 `import vocab from './vocabulary.json'`（Vite 原生 JSON 导入）。交付物 `dist/index.html` 单文件。

**Tech Stack:** Vue 3、Vite 5、vite-plugin-singlefile、原生 ES module（纯逻辑层）。

**运行环境:** 开发 `npm run dev`（Vite dev server，默认 http://localhost:5173）；构建 `npm run build` → `dist/index.html`。需 Node + npm。

**当前状态:** 分支 `feature/srt-audio-player`。Task 1-7（ES module 化）已完成：srt-parser.js/word-lookup.js/player.js/vocab-store.js 是可复用纯模块；styles.css 三栏样式已就绪；test.html 纯函数测试（26 断言）已就绪。本计划废弃旧 ui.js/main.js/build.js/index.html，新建 Vue 工程。

**关键约束（所有子代理必须遵守）：**
- 用户偏好：注释/总结用中文。Windows 10，bash shell（正斜杠、Unix 语法）。
- **不改动**纯逻辑模块：`src/srt-parser.js`、`src/word-lookup.js`、`src/player.js`、`src/vocab-store.js`、`test.html`。它们已完成且框架无关，直接 import。
- Vue 用 `<script setup>` + Composition API（`ref`/`reactive`/`computed`）。
- 现有可复用接口：
  - `parseSRT(text)` → `Sentence[]`（`{id,start,end,text}`）、`timestampToSeconds(ts)`（src/srt-parser.js）
  - `buildVocab(vocabObj)`、`lookupWords(text, vocab)`（src/word-lookup.js）
  - `Player` 类：`new Player(audioEl)`、`setSrc(url)`、`onStop(cb)`、`playSegment(start,end)`、`stop()`（src/player.js）
  - `createVocabStore(buildVocab, lookupWords)` → `{init,isReady,getLevels,isEnabled,setEnabled,lookupByLevel}`（src/vocab-store.js）

---

## 文件结构总览

```
（项目根目录）
├── package.json            # 【新】vue + vite + plugin-vue + singlefile
├── vite.config.js          # 【新】Vue 插件 + singlefile + base:'./'
├── index.html              # 【重写】Vite 入口：<div id="app"> + /src/main.js
├── src/
│   ├── main.js             # 【重写】createApp(App).mount('#app')
│   ├── App.vue             # 【新】三栏布局 + 全局状态
│   ├── components/
│   │   ├── SettingsPanel.vue   # 【新】左栏：分级勾选 + 文件入口
│   │   ├── SentenceList.vue    # 【新】中栏：句子列表 + 视频占位
│   │   └── WordPanel.vue       # 【新】右栏：按级分栏单词
│   ├── styles.css          # 【微调】沿用三栏样式（Task 加 #app 高度等）
│   ├── vocabulary.json     # 不变（App.vue import）
│   ├── srt-parser.js       # 不变
│   ├── word-lookup.js      # 不变
│   ├── player.js           # 不变
│   └── vocab-store.js      # 不变
├── test.html               # 不变（纯函数测试）
└── dist/index.html         # vite build 产物（singlefile 内联）
```

**废弃（本计划删除）：** `build.js`、`src/ui.js`、旧 `src/main.js`（被新 main.js 覆盖）。

**状态模型（App.vue 全局状态，响应式）：**
```js
// store：vocab-store 实例（非响应式，但方法纯）
// enabled：reactive 对象 {level: bool}，勾选的响应式镜像（驱动 UI 重算）
// sentences: ref(Sentence[])
// currentId: ref(number|null)   当前选中句（高亮）
// currentText: ref(string)       当前句文本（供 WordPanel 查词）
// isPlaying: ref(bool)           player 是否在播
// audioName: ref(string)
// statusText/statusError: ref
// audioEl: template ref（<audio>），onMounted 后 new Player(audioEl)
```

**播放态模型（避免竞态）：** HTMLMediaElement 的 `seek`（设 currentTime）不触发 `pause` 事件，只有到 end 的 timeupdate→pause 才触发 onStop。故：
- 点句子 → `isPlaying=true` + `playSegment`。
- 到 end 自动 pause → onStop → `isPlaying=false`。
- 切句：新 playSegment 覆盖旧 `_endHandler`，旧段不会到 end，无 onStop 误触发。✓ 无竞态。

---

### Task 1: 引入 Vite + Vue 脚手架

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Modify (full rewrite): `index.html`
- Modify (full rewrite): `src/main.js`
- Create: `src/App.vue`（最小占位，验证脚手架）
- Delete: `build.js`、`src/ui.js`

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "srt-audio-player",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "vite": "^5.0.0",
    "vite-plugin-singlefile": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 `vite.config.js`**

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: './',
});
```

- [ ] **Step 3: 重写 `index.html`（Vite 入口）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>字幕音频播放器</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: 重写 `src/main.js`（Vue 挂载）**

```js
import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');
```

- [ ] **Step 5: 创建最小 `src/App.vue`（验证脚手架）**

```vue
<script setup>
// 占位：后续 Task 填充三栏与状态
</script>

<template>
  <div class="layout">
    <div style="padding:20px">脚手架验证中…</div>
  </div>
</template>
```

- [ ] **Step 6: 删除废弃文件**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git rm build.js src/ui.js
```

> 注意：`src/styles.css` 此时仍是三栏样式（Task 5 产物），但 App.vue 占位只用了 `.layout`，无妨。`src/main.js` import 了 styles.css，三栏 CSS 会全局生效。

- [ ] **Step 7: 安装依赖**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm install
```
Expected: 生成 `node_modules/` 和 `package-lock.json`，无报错（可能有 warn，无妨）。

> `.gitignore` 需确认忽略 `node_modules/`。当前 `.gitignore` 未含，**Step 8 前先加**。

- [ ] **Step 8: 确保 node_modules 不进 git**

读 `.gitignore`，若不含 `node_modules/` 则追加一行 `node_modules/`（用 Edit 或追加）。同时建议加 `dist/`（构建产物，可选——dist 要不要进 git 由用户定；本计划保留 dist 进 git 以便直接托管，故**不忽略 dist**）。最少追加 `node_modules/`。

- [ ] **Step 9: 验证 dev server 可起（后台启动 + curl 探测）**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run dev &
sleep 3
curl -s http://localhost:5173/ | head -20
# 确认返回含 <div id="app"> 的 html
curl -s http://localhost:5173/src/main.js | head -5
# 确认返回 main.js 内容（Vite 编译后）
kill %1 2>/dev/null
```
Expected: 第一个 curl 返回含 `<div id="app">` 的 HTML；第二个返回 main.js 转译内容。若无 curl，用 `wget -qO-` 或 Node fetch 替代。关键：dev server 能起、能 serve 入口与模块。

> 子代理 headless 无法看浏览器渲染，但能通过 HTTP 响应确认 dev server 正常 serve。真正的渲染验证在后续 Task 由人完成，或子代理用 `npm run build` + 检查 dist 来间接验证。

- [ ] **Step 10: 提交**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
git add package.json package-lock.json vite.config.js index.html src/main.js src/App.vue .gitignore
git commit -m "feat: 引入 Vite + Vue 脚手架（替换手写 build.js）"
```

---

### Task 2: App.vue 三栏骨架 + 三子组件占位

**Files:**
- Modify: `src/App.vue`（三栏布局，引入三子组件，状态先占位）
- Create: `src/components/SettingsPanel.vue`
- Create: `src/components/SentenceList.vue`
- Create: `src/components/WordPanel.vue`
- Modify: `src/styles.css`（确保 `#app` 撑满；沿用三栏）

- [ ] **Step 1: 确认/微调 `src/styles.css` 顶部**

读 `src/styles.css`。确认 body 有 `height:100vh; overflow:hidden`，`.layout` 有 `display:flex; height:100vh`。在文件**开头** `* { box-sizing... }` 之后、`body` 之前，加一条确保 `#app` 撑满：

```css
#app { height: 100vh; }
```
（若已存在则跳过。）其余三栏样式不动。

- [ ] **Step 2: 创建 `src/components/SettingsPanel.vue`（占位）**

```vue
<script setup>
// 占位：Task 3 填分级勾选 + 文件入口
</script>

<template>
  <aside class="panel-left">
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      <div class="vocab-status placeholder">（待实现）</div>
    </section>
    <section class="files">
      <h3 class="panel-title">文件</h3>
    </section>
  </aside>
</template>
```

- [ ] **Step 3: 创建 `src/components/SentenceList.vue`（占位）**

```vue
<script setup>
// 占位：Task 4 填句子列表
</script>

<template>
  <div class="sentences">
    <div class="placeholder">（待实现）</div>
  </div>
</template>
```

- [ ] **Step 4: 创建 `src/components/WordPanel.vue`（占位）**

```vue
<script setup>
// 占位：Task 5 填分栏单词
</script>

<template>
  <aside class="panel-right">
    <h3 class="panel-title">当前句单词</h3>
    <div class="placeholder">（待实现）</div>
  </aside>
</template>
```

- [ ] **Step 5: 重写 `src/App.vue`（三栏组装）**

```vue
<script setup>
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';
</script>

<template>
  <div class="layout">
    <SettingsPanel />
    <main class="panel-center">
      <div class="video-slot"></div>
      <SentenceList />
      <span class="status">请选择文件</span>
    </main>
    <WordPanel />
  </div>
  <audio class="hidden" preload="metadata"></audio>
</template>
```

- [ ] **Step 6: 构建 + 验证产物结构**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build
ls -la dist/
grep -c "panel-left\|panel-center\|panel-right" dist/index.html
```
Expected: `dist/index.html` 生成；grep 计数 ≥1（CSS 内联后含三栏类名）。singlefile 应产出单文件（若 dist 下还有 assets/ 目录，说明 singlefile 未生效，检查 vite.config.js）。

- [ ] **Step 7: 提交**

```bash
git add src/App.vue src/components/ vite.config.js 2>/dev/null; git add src/styles.css dist/index.html
git commit -m "feat: App.vue 三栏骨架 + 三子组件占位"
```

---

### Task 3: 词库内置 + SettingsPanel 分级勾选（响应式）

**Files:**
- Modify: `src/App.vue`（import vocab + store + 响应式 enabled）
- Modify: `src/components/SettingsPanel.vue`（分级勾选 + 文件入口）

- [ ] **Step 1: 重写 `src/App.vue`（接入词库与状态）**

```vue
<script setup>
import { ref, reactive, onMounted } from 'vue';
import vocab from './vocabulary.json';
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
const audioName = ref('');
const statusText = ref('请选择文件');
const statusError = ref(false);

const audioEl = ref(null);
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
      statusText.value = '已载入 ' + sentences.value.length + ' 句字幕';
      statusError.value = false;
    } catch (e) {
      statusText.value = '字幕解析失败：' + e.message;
      statusError.value = true;
    }
  };
  reader.readAsText(file, 'utf-8');
}

function onAudioFile(file) {
  if (!file) return;
  player.setSrc(URL.createObjectURL(file));
  audioName.value = file.name;
  statusText.value = '已载入音频：' + file.name;
  statusError.value = false;
}

onMounted(() => {
  player = new Player(audioEl.value);
  player.onStop(() => { isPlaying.value = false; });
});
</script>

<template>
  <div class="layout">
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @audio-file="onAudioFile"
    />
    <main class="panel-center">
      <div class="video-slot"></div>
      <SentenceList
        :sentences="sentences"
        :current-id="currentId"
        :is-playing="isPlaying"
      />
      <span class="status" :class="{ error: statusError }">{{ statusText }}</span>
    </main>
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
    />
  </div>
  <audio ref="audioEl" class="hidden" preload="metadata"></audio>
</template>
```

> 注意：`parseSRT` 此处被 onSrtFile 使用但尚未 import——**Step 1 末尾补 import**：在 `import { Player } from './player.js';` 之后加 `import { parseSRT } from './srt-parser.js';`。（实现时直接写进 import 块，勿漏。）

修正后的 import 块顺序：
```js
import { ref, reactive, onMounted } from 'vue';
import vocab from './vocabulary.json';
import { parseSRT } from './srt-parser.js';
import { buildVocab, lookupWords } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';
```

- [ ] **Step 2: 重写 `src/components/SettingsPanel.vue`**

```vue
<script setup>
defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'audio-file']);

function onSrtChange(e) {
  const f = e.target.files[0];
  if (f) emit('srt-file', f);
}
function onAudioChange(e) {
  const f = e.target.files[0];
  if (f) emit('audio-file', f);
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
      <label class="file-btn">音频
        <input type="file" accept="audio/*" @change="onAudioChange" />
      </label>
    </section>
  </aside>
</template>
```

- [ ] **Step 3: 构建 + 静态验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build
grep -c "初中" dist/index.html   # 词库已内置（期望 ≥1，实际很多）
grep -c "level-item" dist/index.html  # 期望 ≥1（模板/样式）
```
Expected: 词库内置进 dist；构建无 Vue 编译错误。

> 子代理 headless：构建成功即说明 Vue 模板编译通过、import 解析正确。分级勾选的实际交互由人在 dev/build 后验收。

- [ ] **Step 4: 提交**

```bash
git add src/App.vue src/components/SettingsPanel.vue dist/index.html
git commit -m "feat: 词库内置 + SettingsPanel 分级勾选（响应式）"
```

---

### Task 4: SentenceList 渲染 + 句子点击骨架

**Files:**
- Modify: `src/App.vue`（加 onSentenceClick，传给 SentenceList；接 emit）
- Modify: `src/components/SentenceList.vue`（渲染列表 + 点击 emit）

- [ ] **Step 1: 重写 `src/components/SentenceList.vue`**

```vue
<script setup>
defineProps({
  sentences: { type: Array, required: true },
  currentId: { type: [Number, null], default: null },
  isPlaying: { type: Boolean, default: false }
});
const emit = defineEmits(['click']);

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
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
      <span class="text">{{ s.text.replace(/\n/g, ' ') }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 在 `src/App.vue` 补 onSentenceClick 并接入 SentenceList**

在 `<script setup>` 的 `onAudioFile` 函数之后，加：

```js
function onSentenceClick(sentence) {
  currentId.value = sentence.id;
  currentText.value = sentence.text;
  if (!audioName.value) {
    statusText.value = '请先选择音频文件';
    statusError.value = true;
    return;
  }
  isPlaying.value = true;
  player.playSegment(sentence.start, sentence.end);
}
```

在模板的 `<SentenceList ... />` 上加 `@click="onSentenceClick"`：
```vue
<SentenceList
  :sentences="sentences"
  :current-id="currentId"
  :is-playing="isPlaying"
  @click="onSentenceClick"
/>
```

- [ ] **Step 3: 构建 + 验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build
grep -c "play-icon" dist/index.html   # 期望 ≥1
```
Expected: 构建无错。

- [ ] **Step 4: 提交**

```bash
git add src/App.vue src/components/SentenceList.vue dist/index.html
git commit -m "feat: SentenceList 渲染句子 + 点击播放骨架"
```

---

### Task 5: WordPanel 按级分栏 + 响应式勾选刷新

**Files:**
- Modify: `src/components/WordPanel.vue`（computed 分组 + 分栏渲染）

- [ ] **Step 1: 重写 `src/components/WordPanel.vue`**

```vue
<script setup>
import { computed } from 'vue';

const props = defineProps({
  store: { type: Object, required: true },
  enabled: { type: Object, required: true },
  currentText: { type: String, default: '' }
});

// 命中单词分组（按级）。显式读取 enabled 各属性以建立响应式依赖，
// 使勾选变化时（store 内部状态非响应式，靠 enabled 镜像触发重算）。
const groups = computed(() => {
  for (const lv of props.store.getLevels()) {
    void props.enabled[lv]; // touch 响应式属性
  }
  return props.store.lookupByLevel(props.currentText);
});

// 是否有任何分级被勾选
const hasAnyEnabled = computed(() =>
  props.store.getLevels().some(lv => props.enabled[lv])
);

// 按 store 分级顺序，只列出已勾选且有命中的级
const visibleLevels = computed(() =>
  props.store.getLevels().filter(lv =>
    props.enabled[lv] && groups.value[lv] && groups.value[lv].length > 0
  )
);
</script>

<template>
  <aside class="panel-right">
    <h3 class="panel-title">当前句单词</h3>
    <div v-if="!currentText" class="placeholder">点击中间句子查看单词</div>
    <div v-else-if="!hasAnyEnabled" class="placeholder">未勾选任何分级</div>
    <div v-else-if="!visibleLevels.length" class="placeholder">当前句没有词库中的单词</div>
    <div v-else class="word-groups">
      <div v-for="lv in visibleLevels" :key="lv" class="word-group">
        <h4>{{ lv }} ({{ groups[lv].length }})</h4>
        <div v-for="w in groups[lv]" :key="w.word" class="word">
          <div class="w">{{ w.word }}</div>
          <div class="def">{{ w.def }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>
```

> 响应式说明：`groups` computed 内遍历 `props.enabled[lv]` 建立依赖；勾选变化 → enabled 变 → groups 重算 → lookupByLevel 读 store 内部（onToggleLevel 已同步）→ 新分组。`currentText` 变（切句）同样触发重算。

- [ ] **Step 2: 构建 + 验证**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run build
grep -c "word-group" dist/index.html   # 期望 ≥1
```
Expected: 构建无错。

- [ ] **Step 3: 提交**

```bash
git add src/components/WordPanel.vue dist/index.html
git commit -m "feat: WordPanel 按级分栏 + 响应式勾选刷新"
```

---

### Task 6: 构建单文件 + 端到端验证

**Files:**
- 主要为验证；可能微调 `vite.config.js` 若 singlefile 未生效。

- [ ] **Step 1: 干净构建**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
rm -rf dist
npm run build
```
Expected: 输出 `dist/index.html`；**singlefile 应使其为单文件**（dist 下不应有 `assets/` 目录，或 assets 已内联）。检查：
```bash
ls dist/
cat dist/index.html | wc -c    # 字节数应约 170 万+（含 1.6MB 词库）
```

- [ ] **Step 2: 验证 dist 自包含**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
grep -c "src=\"/" dist/index.html       # 期望 0（无外部 JS 引用）
grep -c "href=\"/" dist/index.html      # 期望 0（无外部 CSS 引用）
grep -c "初中" dist/index.html          # 期望 ≥1（词库内置）
grep -c "createVocabStore\|lookupByLevel" dist/index.html  # 期望 ≥1（逻辑内联，可能被压缩改名，故 ≥0 也可能；主要看前两条）
```
Expected: 前两条为 0（关键）；词库内置存在。

> 若 dist 下仍有 assets/ 目录（singlefile 未生效），检查 vite.config.js 是否正确导入 `viteSingleFile` 并放入 plugins。修正后重 build。

- [ ] **Step 3: 静态语法/编译最终确认**

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
# 确认纯逻辑模块仍可独立加载（未被 Vue 改动）
node --input-type=module -e "import('./src/vocab-store.js').then(m=>console.log('vocab-store ok:', typeof m.createVocabStore)).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: 打印 `vocab-store ok: function`。

- [ ] **Step 4: 提交**

```bash
git add dist/
git commit -m "feat: 构建单文件 dist（vite-plugin-singlefile 内联）"
```
（若 dist 无变化则跳过 commit，仅记录验证通过。）

---

## 手动验收清单（全部 Task 完成后，由人在浏览器执行）

```bash
cd "D:\Users\Haujet\Desktop\英语学习"
npm run dev    # 开 http://localhost:5173
```

对照设计文档 §9：

- [ ] 页面三栏；左栏"词库分级"7 项（初中/高中/四级/六级/考研/托福/SAT）默认全选；显示"共 7 个分级"。
- [ ] 选 SRT（`【官方双语】…熵.srt`）→ 中栏出句子列表（597 句），每条 `[mm:ss] 文本`。
- [ ] 选音频（`.mp3`）→ 状态"已载入音频：…"。
- [ ] 点第 3 句 → 从 4.72s 播到 10.6s 自动停；该句高亮、图标变 ⏸；播完图标回 ▶。
- [ ] 右栏按级分栏显示命中词（分级名标题带词数，无小标签）。
- [ ] 左栏取消勾选"四级" → 右栏四级栏立即消失（无需重新点句）。
- [ ] 取消所有勾选 → 右栏"未勾选任何分级"。
- [ ] 切句：上一句图标复位、当前句高亮、右栏刷新。
- [ ] 未选音频点句子 → 红字"请先选择音频文件"。
- [ ] `npm run build` → `dist/index.html` 单文件，双击可独立运行（不依赖 src/、node_modules/）。

---

## Self-Review 记录

- **Spec 覆盖**：
  - 三栏布局 → T1(index)+T2(App/子组件骨架)+styles 沿用。
  - 词库内置 → T3(`import vocab`)。
  - 分级勾选 → T3(SettingsPanel + enabled 响应式 + onToggleLevel)。
  - 右栏按级分栏 → T5(WordPanel computed + lookupByLevel)。
  - 响应式勾选刷新 → T5(groups computed 依赖 enabled)。
  - 点句播放/高亮/自动停 → T3(onMounted Player)+T4(onSentenceClick/isPlaying)+player.onStop。
  - 错误处理（未选音频/全未勾选/无命中）→ T3+T5。
  - 单文件交付 → T1(vite.config singlefile)+T6(验证)。
  - 验收 → 手动清单。全覆盖。

- **占位符**：无 TBD/TODO；每步含完整代码。

- **类型/命名一致性**：
  - store 方法（init/getLevels/isEnabled/setEnabled/lookupByLevel）：vocab-store.js 已定义，App/WordPanel 调用一致。
  - Player 方法（setSrc/onStop/playSegment）：player.js 已定义，App 调用一致。
  - props 名：App 传 `:levels/:enabled` 给 SettingsPanel；`:sentences/:current-id/:is-playing` 给 SentenceList；`:store/:enabled/:current-text` 给 WordPanel。组件 defineProps 名一致。
  - emit 名：`toggle-level`/`srt-file`/`audio-file`（SettingsPanel）、`click`（SentenceList）；App `@toggle-level/@srt-file/@audio-file/@click` 一致。

- **风险点**：
  - vite-plugin-singlefile 版本/配置：T6 Step 1-2 验证 dist 无 assets/、无外部引用，能捕获未生效。
  - 响应式 enabled 镜像与 store 内部同步：onToggleLevel 同时更新两者；WordPanel computed 显式 touch enabled 建依赖。T5 注释说明。
  - 词库 1.6MB import：Vite 打包进 bundle，singlefile 内联进 dist，体积约 1.7MB+，T6 Step 1 验证字节数。
