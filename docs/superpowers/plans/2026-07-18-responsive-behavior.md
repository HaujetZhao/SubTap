# 响应式行为增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 superpowers:executing-plans。步骤用 `- [ ]` 跟踪。
> **Ponytail 提示:** 本批以 CSS/小 JS 为主,走精简路线——粗粒度 Task、UI 手动验收(无单测框架)、每个 Task 一次 commit。能用平台特性(CSS var、matchMedia、`:style` 绑定)就不写 JS。

**Goal:** 给双栏响应式加四项行为——自动收/展、拖拽调宽、双击收起视频、FAB 钉视窗淡入淡出。

**对应 spec:** `docs/superpowers/specs/2026-07-18-responsive-behavior-design.md`

**测试方式:** 无 UI 单测;每个 Task 用 `npm run build` 确认编译,主观体验由用户手动验收。

---

### Task 1: 按宽度自动收/展

**Files:** `src/App.vue`

- [ ] **Step 1: 删旧折叠持久化,改 auto**

在 `<script setup>` 找到现有折叠持久化块(`LS_KEY = 'subtap-panels'`/`loadPanels`/`_saved`/`leftCollapsed`/`rightCollapsed`/`watch([leftCollapsed,rightCollapsed]...)`)。替换为:

```js
// 折叠态由视窗宽度自动驱动(1280/950),不持久化。手动操作=临时覆盖,
// 跨临界点由下方 matchMedia change 重置(无需覆盖标志位)。
const mqlLeftCollapse  = window.matchMedia('(max-width: 1280px)');
const mqlRightCollapse = window.matchMedia('(max-width: 950px)');
const leftCollapsed  = ref(mqlLeftCollapse.matches);
const rightCollapsed = ref(mqlRightCollapse.matches);
mqlLeftCollapse .addEventListener('change', () => { leftCollapsed.value  = mqlLeftCollapse.matches; });
mqlRightCollapse.addEventListener('change', () => { rightCollapsed.value = mqlRightCollapse.matches; });
```

> 删掉 `LS_KEY='subtap-panels'`、`loadPanels`、`_saved`、原 `watch`(持久化折叠)。`watch` 仍需保留在 Vue 导入(Task 2 宽度持久化还要用)。

- [ ] **Step 2: onMounted/onUnmounted 不需改**

`mqlLeftCollapse/mqlRightCollapse` 的 change 监听是模块级注册,页面生命周期内常驻(SPA),不随组件卸载——本项目 App 是根组件,不卸载,无需 add/remove 配对。(`mqlLeft/mqlRight` 1100/768 的既有监听保留不动。)

> ponytail: 不加 onUnmounted removeEventListener,App 根组件永不卸载,加了是死代码。

- [ ] **Step 3: build 确认 + commit**

```bash
cd "D:/Users/Haujet/Desktop/英语学习" && npm run build 2>&1 | tail -2
git add src/App.vue && git commit -m "feat(ui): 左右栏按宽度自动收展(1280/950 matchMedia change 重置)"
```

---

### Task 2: 拖拽调宽(push 模式)

**Files:** `src/App.vue`, `src/styles.css`

- [ ] **Step 1: App.vue 加宽度状态 + 持久化**

在 Task 1 折叠状态块之后加:

```js
// push 模式拖拽调宽(180–480),持久化。应用走模板 :style 绑定 CSS var(见 .layout)。
const LS_W = 'subtap-widths';
const _w = (() => { try { return JSON.parse(localStorage.getItem(LS_W) || '{}'); } catch { return {}; } })();
const leftWidth  = ref(_w.leftWidth  ?? 230);
const rightWidth = ref(_w.rightWidth ?? 280);
watch([leftWidth, rightWidth], ([l, r]) => {
  try { localStorage.setItem(LS_W, JSON.stringify({ leftWidth: l, rightWidth: r })); } catch {}
});
let sideDrag = null;
function startSideResize(panel, e) {
  sideDrag = { panel, x: e.clientX, w: panel === 'left' ? leftWidth.value : rightWidth.value };
  document.addEventListener('mousemove', onSideResize);
  document.addEventListener('mouseup', stopSideResize);
  e.preventDefault();
}
function onSideResize(e) {
  if (!sideDrag) return;
  const w = Math.min(480, Math.max(180, sideDrag.w + (sideDrag.panel === 'left' ? e.clientX - sideDrag.x : sideDrag.x - e.clientX)));
  (sideDrag.panel === 'left' ? leftWidth : rightWidth).value = w;
}
function stopSideResize() {
  sideDrag = null;
  document.removeEventListener('mousemove', onSideResize);
  document.removeEventListener('mouseup', stopSideResize);
}
```

- [ ] **Step 2: App.vue 模板 —— `.layout` 绑 CSS var + 加两个拖拽手柄**

`.layout` 开标签改为:
```html
<div class="layout" :style="{ '--panel-left-w': leftWidth + 'px', '--panel-right-w': rightWidth + 'px' }">
```

在 `<SettingsPanel ... />` 之后(左栏之后)加左栏手柄;在 `<WordPanel ... />` 之前(右栏之前)加右栏手柄——即手柄作为 `.layout` 直接子、贴在对应栏内侧。但手柄需绝对定位到栏边缘,而栏是 `.layout` 的子,手柄放 `.layout` 层定位麻烦。**更简单:手柄放进各栏组件根 aside 内**(作为 `.panel-inner` 的兄弟、aside 直接子)。

所以改 `SettingsPanel.vue` 根 aside 内、`.panel-inner` 之后加:
```html
<div class="side-resize-handle" @mousedown="$emit('resizestart', $event)"></div>
```
SettingsPanel `defineEmits` 加 `'resizestart'`;App.vue `<SettingsPanel @resizestart="startSideResize('left', $event)">`。

WordPanel.vue 同理(emit `resizestart`,App `@resizestart="startSideResize('right', $event)"`),手柄在 `.panel-inner` 之后。

> ponytail: 手柄放进栏组件、用 emit 上报 mousedown,避免在 App 里跨组件定位;一招对称复用。

- [ ] **Step 3: styles.css —— 栏 relative + 手柄 + overlay 隐藏 + overlay max-width**

`.panel-left`/`.panel-right`(push 块)各加 `position: relative;`(供手柄绝对定位)。追加:

```css
.side-resize-handle {
  position: absolute; top: 0; bottom: 0; width: 6px;
  cursor: col-resize; z-index: 5;
}
.panel-left  > .side-resize-handle { right: -3px; }
.panel-right > .side-resize-handle { left:  -3px; }
.side-resize-handle:hover { background: rgba(60,50,40,.12); }
/* overlay 模式不显示手柄 */
@media (max-width: 1100px) { .panel-left  > .side-resize-handle { display: none; } }
@media (max-width: 768px)  { .panel-right > .side-resize-handle { display: none; } }
```

并在 Task 5 既有的两块 overlay 媒体查询(`.panel-left` 1100 块、`.panel-right` 768 块)的展开态规则里各加一行 `max-width: 86vw;`(防拖到 480 超过窄屏视口)。

- [ ] **Step 4: build + commit**

```bash
npm run build 2>&1 | tail -2
git add src/App.vue src/components/SettingsPanel.vue src/components/WordPanel.vue src/styles.css
git commit -m "feat(ui): push 模式拖拽调左右栏宽(180-480,持久化,overlay 复用)"
```

---

### Task 3: 双击收起视频

**Files:** `src/App.vue`, `src/styles.css`

- [ ] **Step 1: App.vue 模板**

`<video>` 加 `@dblclick.prevent="toggleCollapse"`。**删除**「收起」按钮那一行:
```html
<button v-show="!videoCollapsed" class="collapse-btn" @click="toggleCollapse">收起</button>
```
保留 `.resize-handle`(高度手柄)和 `.expand-btn`(展开视频)。

- [ ] **Step 2: styles.css 删 `.collapse-btn` 规则**

删除 `.collapse-btn { ... }` 与 `.collapse-btn:hover { ... }` 两块(已无引用)。`.expand-btn`/`.resize-handle` 不动。

- [ ] **Step 3: build + commit**

```bash
npm run build 2>&1 | tail -2
git add src/App.vue src/styles.css && git commit -m "feat(ui): 视频双击收起(删收起按钮,清 .collapse-btn 样式)"
```

---

### Task 4: FAB 钉视窗 + 淡入淡出

**Files:** `src/App.vue`, `src/styles.css`

- [ ] **Step 1: App.vue 模板 —— FAB 去 v-show,加 .visible class**

两个 FAB 的 `v-show="leftCollapsed"`/`v-show="rightCollapsed"` 改为 `:class="{ visible: leftCollapsed }"`/`:class="{ visible: rightCollapsed }"`。位置可保持在 `.panel-center` 内(fixed 后相对视窗,父级无关),或移到 `.layout` 顶层——保持原位改动最小。

- [ ] **Step 2: styles.css 改写 `.fab`**

把 `.fab` 规则的 `position: absolute` 改 `position: fixed`;加 `opacity: 0; pointer-events: none;`,transition 加 `opacity`;新增 `.fab.visible`:

```css
.fab {
  position: fixed;
  top: 16px;
  /* 其余(width/height/border/box-shadow/cursor/display/color/z-index)不动 */
  opacity: 0; pointer-events: none;
  transition: opacity var(--dur-panel) var(--ease-panel),
              box-shadow .15s, transform .15s var(--ease-panel);
}
.fab.visible { opacity: 1; pointer-events: auto; }
```

> 删掉原 `.fab` 里若有 `display:none`/基于 v-show 的假设(原本无,display:flex 保留)。`.fab-left/.fab-right/.fab:hover` 不动。

- [ ] **Step 3: build + commit**

```bash
npm run build 2>&1 | tail -2
git add src/App.vue src/styles.css && git commit -m "feat(ui): FAB 钉视窗 + opacity 淡入淡出(与栏滑动同步)"
```

---

### Task 5: 用户回归验收(无代码改动,除非发现问题)

- [ ] 用户手动验收(spec「测试与验收」6 项):自动收/展状态机、手动=临时覆盖、拖拽调宽+持久化、双击视频、FAB 编排、控制台无报错。
- [ ] 若发现问题 → 针对性修补 + commit;否则本批完成。

---

## 完成标准
4 项行为落地、每 Task 各自 commit、`npm run build` 通过、用户手动验收通过。
