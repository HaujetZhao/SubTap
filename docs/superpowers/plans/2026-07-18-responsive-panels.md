# 双栏响应式（push / overlay）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左栏（设置）与右栏（词卡）支持响应式折叠——宽屏 push 常驻可手动收起，中屏（≤1100px）左栏转 overlay，窄屏（≤768px）右栏也转 overlay 且两栏互斥；配 FAB 唤出、scrim 遮罩、`[`/`]` 快捷键与 localStorage 持久化。

**Architecture:** 折叠状态（`leftCollapsed`/`rightCollapsed` 布尔）提升到 `App.vue` 并持久化；定位模式（push/overlay）纯由 CSS 媒体查询驱动；JS 仅维护 collapsed 布尔、窄档互斥、scrim 可见性（借 `matchMedia`）。push 模式用 `max-width` 动画收起，overlay 模式用 `transform` 滑出。

**Tech Stack:** Vue 3 `<script setup>`、手写 CSS（设计 token + 媒体查询）、Web Speech API（既有，不动）、localStorage。纯逻辑层零改动。

**对应 spec:** `docs/superpowers/specs/2026-07-18-responsive-panels-design.md`

**z-index 分层（全局约定，全程遵循）:**
- scrim = 30
- FAB = 35
- overlay 栏 = 40
- toast = 50（既有，不动，保证置顶）

**测试方式:** 本项目无 UI 单测框架（`test.html` 仅测纯函数层，本特性不触碰）。每个任务用浏览器手动验收（开发服务器 `npm run dev` → http://localhost:5173），必要时配合 Playwright MCP。每个 Task 末尾必须 commit。

---

## File Structure

| 文件 | 职责 | 本计划改动 |
|---|---|---|
| `src/App.vue` | 全局状态 + 三栏装配 | 加折叠状态、开合函数、matchMedia、scrim computed、快捷键、模板（FAB/scrim/class 绑定/props） |
| `src/components/SettingsPanel.vue` | 左栏 | 根 `aside` 加 `collapsed` class 绑定 + 顶部折叠按钮 + emit |
| `src/components/WordPanel.vue` | 右栏 | 同上（镜像） |
| `src/styles.css` | 样式 | 加 token、push 折叠、`.panel-inner`、overlay 媒体查询、FAB、scrim |

纯逻辑层（`srt-parser`/`word-lookup`/`lemmatize`/`vocab-store`/`player`/`subtitle-tweak`/`level-colors`）**零改动**。

---

### Task 1: CSS 基础——设计 token + push 模式折叠骨架

本任务只动 CSS，建立可折叠的样式骨架与变量。此时尚无 JS 触发 `.collapsed`，所以视觉暂无变化；Task 2 接通状态后即可见效果。

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 在 `:root` 内追加断点与栏宽变量**

打开 `src/styles.css`，在 `:root { ... }` 块内（现有 token 之后、`font-family` 之前）追加：

```css
  /* 响应式断点 + 栏宽 */
  --bp-medium: 1100px;     /* ≤此值:左栏转 overlay */
  --bp-narrow: 768px;      /* ≤此值:右栏也转 overlay + 互斥 */
  --panel-left-w: 230px;
  --panel-right-w: 280px;
  --ease-panel: cubic-bezier(.4, 0, .2, 1);
  --dur-panel: .3s;
  --shadow-overlay: 0 8px 32px rgba(60,50,40,.14);
```

- [ ] **Step 2: 改写 `.panel-left` / `.panel-right` 为可折叠（push 模式）**

把现有的 `.panel-left`（约 27-33 行）和 `.panel-right`（约 38-42 行）替换为：

```css
.panel-left {
  width: var(--panel-left-w);
  max-width: var(--panel-left-w);
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
  transition: max-width var(--dur-panel) var(--ease-panel);
  display: flex;
  flex-direction: column;
}
.panel-right {
  width: var(--panel-right-w);
  max-width: var(--panel-right-w);
  flex-shrink: 0;
  background: var(--panel);
  border-left: 1px solid var(--border);
  overflow: hidden;
  transition: max-width var(--dur-panel) var(--ease-panel);
  display: flex;
  flex-direction: column;
}
```

> 注意：原来 `.panel-left` 有 `padding: 16px 14px; overflow-y: auto; gap: 20px; user-select: none;`，`.panel-right` 有 `padding: 16px; overflow-y: auto;`。这些移到下一步的 `.panel-inner` 上，否则收起时 padding 会撑出非零宽度。

- [ ] **Step 3: 新增 `.panel-inner`（栏内容固定宽容器，承载滚动与 padding）**

紧跟上面两块之后追加：

```css
/* 栏内容固定宽容器:收起时外层 max-width→0 + overflow:hidden 把它裁掉,
   内部不重排。原 panel-left/right 的 padding/滚动/gap 都搬到这里。 */
.panel-left  > .panel-inner {
  width: var(--panel-left-w);
  padding: 16px 14px;
  gap: 20px;
  user-select: none;
}
.panel-right > .panel-inner {
  width: var(--panel-right-w);
  padding: 16px;
}
.panel-inner {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 4: 新增 `.collapsed` 折叠态（push 模式）**

追加：

```css
/* push 模式折叠:宽度归零。overlay 模式由媒体查询覆盖(见 Task 4)。 */
.panel-left.collapsed,
.panel-right.collapsed {
  max-width: 0;
  width: 0;
  border-right-color: transparent;
  border-left-color: transparent;
}
```

- [ ] **Step 5: 启动开发服务器，确认无样式破坏**

Run: `npm run dev`
打开 http://localhost:5173 ，确认：
- 三栏布局仍正常显示（因为还没有 `.collapsed` 类，栏宽不变）。
- 左右栏内容滚动、padding 正常（搬进 `.panel-inner` 后视觉应与之前一致）。

> **注意：此 Task 完成后，`.panel-inner` 还没在组件模板里使用**——所以现在 `.panel-left > .panel-inner` 选不到任何元素，左栏内容会直接贴边无 padding。这是预期的中间态，Task 2/3 会把内容包进 `.panel-inner`。**若想避免中间态破坏视觉**，可先做 Task 2/3 的模板包裹再回来看效果；本计划按「先骨架后接通」顺序写，验收以最终 Task 3 完成为准。

- [ ] **Step 6: Commit**

```bash
git add src/styles.css
git commit -m "feat(css): 响应式栏 token + push 模式折叠骨架与 .panel-inner"
```

---

### Task 2: App.vue 状态 + localStorage 持久化

加入折叠状态、持久化助手、开合函数（含窄档互斥占位）。本任务不接模板，纯逻辑增量。

**Files:**
- Modify: `src/App.vue`（`<script setup>` 内）

- [ ] **Step 1: 在 `<script setup>` 顶部（其他 ref 附近，约第 39 行 `mediaKind` 之后）加状态与持久化助手**

```js
// 双栏折叠状态(localStorage 持久化)。collapsed=true → 该栏不可见。
const LS_KEY = 'subtap-panels';
function loadPanels() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch { return {}; }
}
const _saved = loadPanels();
const leftCollapsed  = ref(_saved.leftCollapsed  ?? false);
const rightCollapsed = ref(_saved.rightCollapsed ?? false);
watch([leftCollapsed, rightCollapsed], ([l, r]) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ leftCollapsed: l, rightCollapsed: r })); }
  catch { /* 隐私模式等忽略 */ }
});
```

> 需要把 `watch` 加进顶部 Vue 导入：把 `import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';` 改为 `import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';`

- [ ] **Step 2: 加 matchMedia 引用（供互斥与 scrim 判断）**

紧接上面追加：

```js
// 断点感知:左栏 overlay(≤1100)、右栏 overlay(≤768)。change 时更新 ref 驱动模板。
const mqlLeft  = window.matchMedia(`(max-width: 1100px)`);
const mqlRight = window.matchMedia(`(max-width: 768px)`);
const leftOverlay  = ref(mqlLeft.matches);
const rightOverlay = ref(mqlRight.matches);
function onBpChange() {
  leftOverlay.value  = mqlLeft.matches;
  rightOverlay.value = mqlRight.matches;
}
```

- [ ] **Step 3: 加开合函数（窄档互斥）**

紧接上面追加：

```js
// 开合收口:折叠按钮 / FAB / 快捷键都走这里。
function openLeft() {
  leftCollapsed.value = false;
  if (rightOverlay.value) rightCollapsed.value = true;   // 窄档互斥
}
function openRight() {
  rightCollapsed.value = false;
  if (rightOverlay.value) leftCollapsed.value = true;    // 窄档互斥
}
function closeLeft()  { leftCollapsed.value = true; }
function closeRight() { rightCollapsed.value = true; }
function toggleLeft()  { leftCollapsed.value  ? openLeft()  : closeLeft(); }
function toggleRight() { rightCollapsed.value ? openRight() : closeRight(); }
```

- [ ] **Step 4: 在 `onMounted` 里挂 matchMedia change 监听，`onUnmounted` 里移除**

在 `onMounted(() => { ... })` 函数体末尾（`onvoiceschanged` 那行之后）追加：

```js
  mqlLeft.addEventListener('change', onBpChange);
  mqlRight.addEventListener('change', onBpChange);
```

在 `onUnmounted(() => { ... })` 函数体末尾追加：

```js
  mqlLeft.removeEventListener('change', onBpChange);
  mqlRight.removeEventListener('change', onBpChange);
```

- [ ] **Step 5: 确认无运行时报错**

开发服务器热重载后，打开浏览器控制台，确认无报错（`watch`/`matchMedia` 正常）。状态此时还没接模板，视觉无变化，正常。

- [ ] **Step 6: Commit**

```bash
git add src/App.vue
git commit -m "feat(state): 左右栏折叠状态 + localStorage 持久化 + 开合/互斥函数"
```

---

### Task 3: SettingsPanel + WordPanel 接通折叠（push 模式端到端）

把状态接到两个组件：根 `aside` 绑 `collapsed` class、内容包 `.panel-inner`、顶部加折叠按钮 emit。

**Files:**
- Modify: `src/components/SettingsPanel.vue`
- Modify: `src/components/WordPanel.vue`
- Modify: `src/App.vue`（模板：传 prop、监听 collapse）

- [ ] **Step 1: SettingsPanel.vue —— props/emits 加 `collapsed` / `collapse`**

在 `defineProps({ ... })` 末尾（`voices` 之后）加一项：

```js
  collapsed: { type: Boolean, default: false }
```

在 `defineEmits([...])` 数组里追加 `'collapse'`：

```js
const emit = defineEmits(['toggle-level', 'srt-file', 'media-file', 'tweak', 'toggle-highlight', 'toggle-tts', 'collapse']);
```

- [ ] **Step 2: SettingsPanel.vue —— 模板：根 class 绑定 + 折叠按钮 + 内容包 `.panel-inner`**

找到 `<template>` 根 `<aside class="panel-left">`，改为：

```html
<aside class="panel-left" :class="{ collapsed }">
  <div class="panel-inner">
    <div class="panel-head">
      <h3 class="panel-title">文件</h3>
      <button class="collapse-btn-panel" title="收起设置栏" @click="emit('collapse')">〈</button>
    </div>
```

然后**删除原 `<section class="files">` 内的 `<h3 class="panel-title">文件</h3>`**（已挪到 `.panel-head`）。原 `<section class="files">` 的其余内容（两个 `.file-btn` label）保留，但要在其前补一个 `.panel-inner` 的开始——上面已开 `</div class="panel-inner">`？不，`.panel-inner` 要包住整栏内容直到 `</aside>` 前。

具体做法：在 `<aside ...>` 之后立即插入 `<div class="panel-inner">` 与 `.panel-head`，然后在 `</aside>` 之前闭合 `</div>`（即 `.panel-inner`）。原 `<section class="files">` 里的 `<h3 class="panel-title">文件</h3>` 那一行删掉（因为标题已进 `.panel-head`）。

最终 SettingsPanel 模板结构应为：

```html
<aside class="panel-left" :class="{ collapsed }">
  <div class="panel-inner">
    <div class="panel-head">
      <h3 class="panel-title">文件</h3>
      <button class="collapse-btn-panel" title="收起设置栏" @click="emit('collapse')">〈</button>
    </div>
    <section class="files">
      <!-- 原两个 .file-btn label,不动 -->
      ...
    </section>
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      ...
    </section>
    <!-- 其余既有 section 不动 -->
    ...
  </div>
</aside>
```

- [ ] **Step 3: App.vue —— 给 `<SettingsPanel>` 传 prop 并监听 collapse**

找到模板里的 `<SettingsPanel ... />`，加 `:collapsed="leftCollapsed"` 和 `@collapse="closeLeft"`：

```html
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      :offset="offset"
      :end-mode="endMode"
      :end-offset="endOffset"
      :highlight-on="highlightOn"
      :tts-on="ttsOn"
      :tts-lang="ttsLang"
      :tts-rate="ttsRate"
      :tts-voice-uri="ttsVoiceURI"
      :voices="voices"
      :collapsed="leftCollapsed"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
      @tweak="onTweak"
      @toggle-highlight="val => highlightOn = val"
      @toggle-tts="onToggleTts"
      @collapse="closeLeft"
    />
```

- [ ] **Step 4: WordPanel.vue —— 镜像处理**

在 WordPanel `defineProps({ ... })` 末尾加 `collapsed: { type: Boolean, default: false }`；加 `const emit = defineEmits(['collapse']);`（WordPanel 原本没有 emits，新增即可）。

模板根改为：

```html
<aside class="panel-right" :class="{ collapsed }">
  <div class="panel-inner">
    <div class="panel-head">
      <h3 class="panel-title">生词</h3>
      <button class="collapse-btn-panel" title="收起词卡栏" @click="emit('collapse')">〉</button>
    </div>
    <div v-if="!currentText" class="placeholder">点击中间句子查看单词</div>
    <div v-else-if="!hasAnyEnabled" class="placeholder">未勾选任何分级</div>
    <div v-else-if="!visibleLevels.length" class="placeholder">当前句没有词库中的单词</div>
    <div v-else class="word-groups">
      <!-- 原内容不动 -->
      ...
    </div>
  </div>
</aside>
```

> 原模板从 `<div v-if="!currentText" ...>` 起的几个分支都包进 `.panel-inner`，并在顶部加 `.panel-head`。词卡栏原本无 `.panel-title`，这里新加一个「生词」标题以承载折叠按钮。

- [ ] **Step 5: App.vue —— 给 `<WordPanel>` 传 prop 并监听 collapse**

```html
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
      :colors="LEVEL_COLORS"
      :collapsed="rightCollapsed"
      @collapse="closeRight"
    />
```

- [ ] **Step 5b: styles.css —— 加 `.panel-head` 与折叠按钮样式**

追加（供两栏 `.panel-head` 共用）：

```css
/* 栏顶部标题行:标题 + 折叠按钮,两端对齐 */
.panel-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.panel-head .panel-title { margin: 0; }   /* 覆盖默认 .panel-title 的下边距 */
.collapse-btn-panel {
  flex-shrink: 0;
  width: 26px; height: 26px;
  border: none; background: transparent;
  color: var(--ink-3); cursor: pointer;
  border-radius: var(--r-sm);
  font-size: 14px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, color .15s;
}
.collapse-btn-panel:hover { background: rgba(60,50,40,.06); color: var(--ink); }
```

- [ ] **Step 6: 浏览器验收（push 模式，宽屏）**

确保窗口宽度 > 1100px。打开 http://localhost:5173 ：
1. 点左栏顶部「〈」按钮 → 左栏宽度动画归零，中栏扩展；刷新页面 → 左栏仍收起（localStorage 生效）。
2. 同理点右栏「〉」 → 右栏收起并持久化。
3. 临时验证：浏览器控制台执行 `localStorage.removeItem('subtap-panels')` 后刷新，两栏应回到展开。

> 此时还没有 FAB 唤回入口——收起后暂时只能靠 localStorage 清除或刷新 + 控制台改 `leftCollapsed` 才能恢复。FAB 在 Task 5 接入。验收本任务只需确认「能收」且持久化。

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsPanel.vue src/components/WordPanel.vue src/App.vue
git commit -m "feat(ui): 左右栏接通折叠按钮 + .panel-inner 包裹(push 模式端到端)"
```

---

### Task 4: FAB 悬浮唤出按钮（push 模式可用）

中栏加左右两个 FAB，收起时出现、点击唤回。`v-show` 由 collapsed 直接驱动。

**Files:**
- Modify: `src/App.vue`（模板：中栏内加两个 FAB）
- Modify: `src/styles.css`（`.fab-left/.fab-right`）

- [ ] **Step 1: App.vue 模板 —— 在 `<main class="panel-center">` 内顶部加两个 FAB**

找到 `<main class="panel-center">`，紧接其开标签后（在 `.video-slot` 之前）插入：

```html
    <button v-show="leftCollapsed" class="fab fab-left" title="展开设置栏（[）" @click="openLeft">☰</button>
    <button v-show="rightCollapsed" class="fab fab-right" title="展开词卡栏（]）" @click="openRight">☰</button>
```

> `.panel-center` 已是 `position: relative`（styles.css 第 34-36 行），FAB 用 absolute 定位即可相对它。用「☰」作占位图标（后续可换 SVG，但本计划用文字图标保持单文件简洁）。

- [ ] **Step 2: styles.css —— 加 FAB 样式**

在 Task 1 新增的折叠样式之后追加：

```css
/* 悬浮唤出按钮(FAB):栏收起时出现。左/右镜像。 */
.fab {
  position: absolute;
  top: 16px;
  width: 40px; height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  box-shadow: var(--shadow-soft);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--ink-2);
  font-size: 16px; line-height: 1;
  z-index: 35;
  transition: box-shadow .15s, transform .15s var(--ease-panel);
}
.fab:hover {
  box-shadow: 0 4px 14px rgba(60,50,40,.16);
  transform: translateY(-1px);
  color: var(--ink);
}
.fab-left  { left: 16px; }
.fab-right { right: 16px; }
```

- [ ] **Step 3: 浏览器验收（push 模式 + FAB）**

宽屏（>1100px）：
1. 点左栏「〈」收起 → 左上角出现圆形 FAB → 点 FAB → 左栏展开。
2. 右栏同理。
3. 同时收起两栏 → 两个 FAB 同时出现，分别可唤回。

- [ ] **Step 4: Commit**

```bash
git add src/App.vue src/styles.css
git commit -m "feat(ui): 左右栏悬浮唤出按钮 FAB(push 模式)"
```

---

### Task 5: overlay 模式媒体查询 + scrim 遮罩

加入中屏/窄屏的 overlay 定位、scrim 元素与显示逻辑。

**Files:**
- Modify: `src/styles.css`（overlay 媒体查询 + `.scrim`）
- Modify: `src/App.vue`（scrim 元素 + scrim 显示 computed）

- [ ] **Step 1: styles.css —— 加 overlay 媒体查询**

在文件末尾追加：

```css
/* ============ overlay 模式 ============ */
/* 中屏(≤1100):左栏转 overlay 抽屉 */
@media (max-width: 1100px) {
  .panel-left {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    max-width: none;                 /* 覆盖 push 的 max-width */
    width: var(--panel-left-w);
    z-index: 40;
    box-shadow: var(--shadow-overlay);
    transform: translateX(0);
    transition: transform var(--dur-panel) var(--ease-panel);
    border-right: 1px solid var(--border);
  }
  .panel-left.collapsed {
    transform: translateX(-100%);
    max-width: none;
    width: var(--panel-left-w);
    box-shadow: none;
    border-right-color: transparent;
  }
}

/* 窄屏(≤768):右栏也转 overlay(镜像) */
@media (max-width: 768px) {
  .panel-right {
    position: absolute;
    top: 0; right: 0; bottom: 0;
    max-width: none;
    width: var(--panel-right-w);
    z-index: 40;
    box-shadow: var(--shadow-overlay);
    transform: translateX(0);
    transition: transform var(--dur-panel) var(--ease-panel);
    border-left: 1px solid var(--border);
  }
  .panel-right.collapsed {
    transform: translateX(100%);
    max-width: none;
    width: var(--panel-right-w);
    box-shadow: none;
    border-left-color: transparent;
  }
}
```

> 关键：overlay 模式下 `.collapsed` 不再用 `max-width:0`（会推中栏），改用 `transform` 滑出；并把 `max-width`/`width` 复位成固定栏宽，保证展开时是正确宽度。

- [ ] **Step 2: styles.css —— 加 `.scrim` 样式**

紧接上面追加：

```css
/* 遮罩:任一 overlay 栏展开时显示,点它关两栏 */
.scrim {
  position: fixed; inset: 0;
  background: rgba(60,50,40,.3);
  opacity: 0; pointer-events: none;
  transition: opacity var(--dur-panel) var(--ease-panel);
  z-index: 30;
}
.scrim.show { opacity: 1; pointer-events: auto; }
```

- [ ] **Step 3: App.vue —— 加 scrim 显示 computed**

在 `<script setup>` 内（开合函数之后）加：

```js
// scrim 显示条件:任一栏处于 overlay 模式且未折叠。
const scrimShow = computed(() =>
  (leftOverlay.value  && !leftCollapsed.value) ||
  (rightOverlay.value && !rightCollapsed.value)
);
function closeBoth() { leftCollapsed.value = true; rightCollapsed.value = true; }
```

- [ ] **Step 4: App.vue 模板 —— 加 scrim 元素**

在 `<div class="layout"> ... </div>` 之后、`<div class="toast-container">` 之前插入：

```html
  <div class="scrim" :class="{ show: scrimShow }" @click="closeBoth"></div>
```

- [ ] **Step 5: 浏览器验收（overlay 模式 + scrim）**

慢慢拖窄浏览器窗口：
1. 跨过 1100px → 左栏应从 push 切到 overlay（绝对定位浮层）。若左栏此时未折叠，它会作为浮层盖在中栏左侧，scrim 出现；点 scrim → 左栏滑出 + scrim 消失。
2. 点左 FAB → 左栏滑入展开 + scrim 出现。
3. 继续拖到 ≤768px → 右栏也切 overlay。
4. 窄档下：点左 FAB 开左栏 → 右栏若原展开会被自动关掉（互斥，因 `openLeft` 里 `rightOverlay.value` 为 true）；反之亦然。
5. 宽度跨断点来回拖：无闪烁错位（max-width 与 transform 过渡顺滑）。

> 若左栏在跨入 1100px 时是 push 展开态，切到 overlay 会瞬间变成「展开的浮层」盖住内容——这是预期（spec「resize 行为」：不强制重置）。若实测难受，Task 7 的可选增强兜底。

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/App.vue
git commit -m "feat(ui): overlay 媒体查询(1100/768) + scrim 遮罩 + 窄档互斥接通"
```

---

### Task 6: 快捷键 `[` / `]`

**Files:**
- Modify: `src/App.vue`（`onKeydown` 内追加分支）

- [ ] **Step 1: 在 `onKeydown` 的 switch 内追加 `[` / `]` 分支**

找到 `onKeydown(e)` 函数（约 230 行）。在现有 `switch (e.key) { ... }` 的 `case 'ArrowRight': ... break;` 之后、闭合 `}` 之前追加：

```js
    case '[':
      e.preventDefault();
      toggleLeft();
      break;
    case ']':
      e.preventDefault();
      toggleRight();
      break;
```

> 焦点在 `input/textarea` 时函数开头已 `return`，不拦截——与既有约定一致，微调数字输入不受影响。

- [ ] **Step 2: 浏览器验收**

宽屏：
1. 焦点不在输入框时按 `[` → 左栏收起；再按 `[` → 展开。`]` 同理控右栏。
2. 焦点进左栏某个数字输入框（句首偏移），按 `[`/`]` → 不触发折叠（被 `return` 跳过），且不阻止正常输入。

- [ ] **Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat(ui): [ / ] 快捷键收展左右栏"
```

---

### Task 7: 整体回归 + toast z-index 核对

跨断点全流程验收，确认 toast 始终置顶、各模式无破绽。

**Files:** 无代码改动（除非核对发现问题需补）

- [ ] **Step 1: toast z-index 核对**

打开 `src/styles.css` 确认 `.toast-container` 的 `z-index: 50`（约 265 行）高于 overlay 栏（40）与 scrim（30）。**应无需改动**——若发现 toast 被 overlay 盖住，把 `.toast-container` 的 `z-index` 提到 `60`。

- [ ] **Step 2: 全断点回归清单**

逐项过（窗口从宽拖到窄，再拖回）：
- [ ] >1100px：两栏 push，折叠按钮 + FAB 双向工作；`[`/`]` 工作；刷新状态保持。
- [ ] 768–1100px：左栏 overlay，右栏仍 push；左 FAB 唤出左栏带 scrim；点 scrim 关左栏。
- [ ] ≤768px：两栏 overlay；开左关右、开右关左（互斥）；scrim 出现；两 FAB 都常驻可用。
- [ ] 跨断点拖拽：无闪烁、无错位、过渡顺滑（.3s 缓动）。
- [ ] toast 在任一模式下都浮在最上层。
- [ ] 载入字幕 + 视频，点句播放：键盘 ←→空格 播放控制不受折叠影响（焦点非输入框时）。
- [ ] 控制台无报错。

- [ ] **Step 3: 若 Step 1/2 发现问题，修补并 commit；否则跳过**

```bash
# 仅在有补丁时:
git add -A
git commit -m "fix(ui): 响应式回归修补(<具体问题>)"
```

---

## 完成标准

- 三种视口档（宽/中/窄）下双栏行为符合 spec 矩阵。
- push 折叠用 `max-width` 动画、overlay 用 `transform`，过渡顺滑。
- 窄档互斥、scrim、FAB、`[`/`]`、localStorage 持久化全部可用。
- toast 置顶、纯逻辑层零改动、控制台无报错。
- 每个 Task 各自 commit。
