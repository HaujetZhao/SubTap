# 响应式行为增强（批次五）

> 日期:2026-07-18 · 主题:在已落地的双栏响应式基础上,增加四项行为增强——① 按视窗宽度自动收/展左右栏(仿 DeepSeek);② push 模式下拖拽调左右栏宽度;③ 视频双击收起;④ FAB 钉视窗 + 淡入淡出。对应前置实现见 `2026-07-18-responsive-panels-design.md`。

## 背景与动机

批次四/前序已完成双栏响应式骨架(push/overlay、FAB、scrim、快捷键、持久化)。使用中发现:
- 栏的收/展全靠手动,拖动视窗宽度时不会自适应,缺少 DeepSeek 那种「随宽变化」的灵动感。
- push 模式栏宽固定(230/280),不能按需调整。
- 视频上「收起」按钮略多余,双击更顺手。
- FAB 当前 `position:absolute` 钉在中栏,左栏收起时 FAB 会随中栏左边缘向左滑动,观感生硬;DeepSeek 的 FAB 钉在视窗固定位置、与栏滑动同步淡入淡出,更顺滑。

## 设计方向(已对齐)

- **自动收/展**:4 个临界点 1280/1100/950/768;模式(push/overlay)继续 CSS 驱动,折叠态改 JS 驱动;手动操作=临时覆盖,跨临界点重置为自动。
- **拖拽调宽**:180–480px,push 模式下拖两栏内侧边缘,宽度持久化;overlay 抽屉复用该宽。
- **双击收起视频**:删「收起」按钮,视频双击收起;保留高度手柄与「展开视频」按钮。
- **FAB 钉视窗**:`position:fixed`,opacity 淡入淡出,与栏滑动同步。
- 纯 CSS + 少量 JS,不引入框架;纯逻辑层零改动。

---

## 一、按宽度自动收/展

### 状态机(收窄过程;展宽反向)

| 视口宽度 | 左栏 | 右栏 |
|---|---|---|
| > 1280 | push · 展开 | push · 展开 |
| 1100–1280 | push · 收起 | push · 展开 |
| 950–1100 | overlay · 收起 | push · 展开 |
| 768–950 | overlay · 收起 | push · 收起 |
| < 768 | overlay · 收起 | overlay · 收起 |

四个临界点:
- `W_LEFT_COLLAPSE = 1280`(左栏折叠)
- `1100`(左栏转 overlay,CSS 媒体查询,既有)
- `W_RIGHT_COLLAPSE = 950`(右栏折叠)
- `768`(右栏转 overlay,CSS 媒体查询,既有)

### 机制:matchMedia change = 跨临界点重置

模式(push/overlay)继续由 CSS 媒体查询(1100/768)驱动,不动。折叠态改 JS 驱动:

```js
const mqlLeftCollapse  = window.matchMedia('(max-width: 1280px)');
const mqlRightCollapse = window.matchMedia('(max-width: 950px)');
// change 一触发 = 跨过 1280/950 = 把对应栏重置为自动态
mqlLeftCollapse .addEventListener('change', () => { leftCollapsed.value  = mqlLeftCollapse .matches; });
mqlRightCollapse.addEventListener('change', () => { rightCollapsed.value = mqlRightCollapse.matches; });
```

- **初始加载**:`leftCollapsed = mqlLeftCollapse.matches`、`rightCollapsed = mqlRightCollapse.matches`(auto 驱动)。
- **临界点之间**(无 change):手动折叠按钮 / FAB / `[`/`]` 设的值自然保留 = 临时覆盖。**无需覆盖标志位**,matchMedia 的 change 事件天然就是边界检测器。
- 既有 `openLeft/openRight`(窄档互斥)、`closeLeft/closeRight`、`toggleLeft/toggleRight` 全部保留,语义不变(它们现在就是「临时覆盖」的入口)。
- 既有 `mqlLeft/mqlRight`(1100/768 → `leftOverlay/rightOverlay`,供 scrim computed)保留。

### 持久化调整

- **折叠态不再持久化**(viewport 驱动,刷新按当前宽度 auto;手动覆盖本就不跨刷新)。删除现有 `subtap-panels` localStorage 读写。
- 改为**持久化拖拽宽度**(见第二节),新 key `subtap-widths`。

---

## 二、拖拽调宽(仅 push 模式)

### 状态

```js
const LS_W = 'subtap-widths';
function loadWidths() { try { return JSON.parse(localStorage.getItem(LS_W) || '{}'); } catch { return {}; } }
const _w = loadWidths();
const leftWidth  = ref(_w.leftWidth  ?? 230);
const rightWidth = ref(_w.rightWidth ?? 280);
watch([leftWidth, rightWidth], ([l, r]) => {
  try { localStorage.setItem(LS_W, JSON.stringify({ leftWidth: l, rightWidth: r })); } catch {}
});
// 应用到 :root,覆盖 CSS 默认的 --panel-left-w / --panel-right-w
watch([leftWidth, rightWidth], ([l, r]) => {
  document.documentElement.style.setProperty('--panel-left-w',  l + 'px');
  document.documentElement.style.setProperty('--panel-right-w', r + 'px');
}, { immediate: true });
```

> overlay 模式 `.panel-right/.panel-left` 的 `width: var(--panel-*-w)` 已接该 var,自动复用拖拽宽。**为防拖到宽值(最大 480)超过窄屏视口,给两个 overlay 规则各加 `max-width: 86vw`**(实现时在 Task 5 既有的 overlay 媒体查询块里补)。

### 拖拽手柄(UI)

- 每个栏内侧加一条 6px 竖条:`.side-resize-handle`。
  - 左栏手柄贴 `.panel-left` 右缘(`right:-3px`),右栏手柄贴 `.panel-right` 左缘(`left:-3px`)。
  - `.panel-left/.panel-right` 加 `position: relative`(供手柄绝对定位)。
  - `cursor: col-resize`,`z-index: 5`,hover 加深底色提示。
- **overlay 模式隐藏**:`@media(max-width:1100px){ .panel-left .side-resize-handle{display:none} }`、`@media(max-width:768px){ .panel-right ... display:none}`。

### 拖拽逻辑(App.vue)

```js
let sideDrag = null; // { panel: 'left'|'right', startX, startW }
function startSideResize(panel, e) {
  sideDrag = { panel, startX: e.clientX, startW: panel === 'left' ? leftWidth.value : rightWidth.value };
  document.addEventListener('mousemove', onSideResize);
  document.addEventListener('mouseup', stopSideResize);
  e.preventDefault();
}
function onSideResize(e) {
  if (!sideDrag) return;
  const dx = e.clientX - sideDrag.startX;
  let w;
  if (sideDrag.panel === 'left')  w = sideDrag.startW + dx;      // 拖右 → 变宽
  else                            w = sideDrag.startW - dx;      // 右栏拖左 → 变宽
  w = Math.min(480, Math.max(180, w));
  if (sideDrag.panel === 'left') leftWidth.value = w; else rightWidth.value = w;
}
function stopSideResize() {
  sideDrag = null;
  document.removeEventListener('mousemove', onSideResize);
  document.removeEventListener('mouseup', stopSideResize);
}
```

模板(在 `.panel-left`/`.panel-right` 内,作为 `.panel-inner` 的兄弟、`.panel-left` 直接子):
```html
<div class="side-resize-handle" @mousedown="startSideResize('left', $event)"></div>
```
(右栏镜像 `'right'`。)

> 手柄放在 `<aside>` 内、与 `.panel-inner` 并列(都是 aside 直接子),绝对定位到内侧边缘。

---

## 三、双击收起视频

- 模板:`<video ... @dblclick.prevent="toggleCollapse">`。
- **删除**`<button v-show="!videoCollapsed" class="collapse-btn" @click="toggleCollapse">收起</button>`。
- **保留**:视频高度拖拽手柄(`.resize-handle` + `startResize`)、收起后的 `<button class="expand-btn">▸ 展开视频</button>`。
- styles.css:删除 `.collapse-btn` / `.collapse-btn:hover` 两条规则(清理无引用样式)。`.expand-btn`、`.resize-handle` 不动。

---

## 四、FAB 钉视窗 + 淡入淡出

### 模板(App.vue)

两个 FAB 去掉 `v-show`,改为始终渲染 + `.visible` class 驱动:
```html
<button class="fab fab-left"  :class="{ visible: leftCollapsed }"  title="展开设置栏（[）" @click="openLeft">☰</button>
<button class="fab fab-right" :class="{ visible: rightCollapsed }" title="展开词卡栏（]）"  @click="openRight">☰</button>
```

> 位置从 `.panel-center` 内移到 `.layout` 直接子(或保持原位也行,因为改 fixed 后相对视窗,父级容器无关紧要;为语义清晰移到 `.layout` 顶层,与 `.scrim` 同级)。

### 样式(styles.css)

改写 `.fab`:
```css
.fab {
  position: fixed;                 /* 钉视窗,不再随中栏边缘跑 */
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
  opacity: 0; pointer-events: none;           /* 默认不可见 */
  transition: opacity var(--dur-panel) var(--ease-panel),
              box-shadow .15s, transform .15s var(--ease-panel);
}
.fab.visible { opacity: 1; pointer-events: auto; }
.fab:hover { box-shadow: 0 4px 14px rgba(60,50,40,.16); transform: translateY(-1px); color: var(--ink); }
.fab-left  { left: 16px; }
.fab-right { right: 16px; }
```

### 编排时序

- 收起左栏:`leftCollapsed=true` → 左栏 push 模式 `max-width` 0..230 动画滑出(或 overlay `transform` 滑出),**同时**左 FAB `opacity 0→1` 淡入。两者同 `.3s` 缓动,天然同步。FAB 在视窗 `left:16` 固定,不随中栏边缘移动。
- 展开左栏:`leftCollapsed=false` → FAB `opacity→0` 淡出 + `pointer-events:none`,左栏从左盖过来。
- 展开(push)态下 FAB 落在栏内容上方但 opacity:0 不可见、不可点;overlay 态栏 z40 > FAB z35,栏展开时盖住 FAB。

---

## 涉及文件汇总

| 文件 | 改动 |
|---|---|
| `App.vue` | 折叠态改 auto(matchMedia 1280/950 + change 重置;删 `subtap-panels` 持久化);`leftWidth/rightWidth` + `subtap-widths` 持久化 + `:root` CSS var watch;`startSideResize/onSideResize/stopSideResize`;video `@dblclick`;模板:左右 `.side-resize-handle`、FAB 去 v-show 加 `.visible` class、删视频收起按钮 |
| `styles.css` | `.panel-left/.panel-right` 加 `position:relative`;`.side-resize-handle`(+overlay 隐藏);`.fab` 改 fixed + opacity 过渡 + `.visible`;删 `.collapse-btn` 规则;核对 overlay 抽屉 `max-width:86vw` |
| `SettingsPanel.vue` / `WordPanel.vue` | **无需改**(宽度走 CSS var;折叠按钮 emit 不变) |

纯逻辑层(`srt-parser`/`word-lookup`/`lemmatize`/`vocab-store`/`player`/`subtitle-tweak`/`level-colors`)**零改动**。

---

## 边界与不变量

- **既有互斥逻辑**(`openLeft/openRight` 在 `rightOverlay` 时关另一栏)保留,语义不变。
- **scrim**(`scrimShow` computed 依赖 `leftOverlay/rightOverlay` + collapsed)保留,不受影响。
- **`[`/`]` 快捷键**(空载也能用)保留,现作为「临时覆盖」入口。
- **`--content-max:880px`** 中栏限宽居中(上一批已加)保留;FAB 钉视窗后更不会与居中内容重叠。
- **拖拽与自动收/展共存**:拖拽只改宽度(180–480),不碰 collapsed;自动收/展只碰 collapsed,不碰宽度。两者正交。
- **matchMedia change 时机**:浏览器在跨过查询边界时触发,无需手动比较 prevWidth;resize 不抖动地停在临界点之间不会误触发。
- **视频双击 vs 全屏**:部分浏览器双击 video 默认触发全屏;`@dblclick.prevent` 阻止默认,确保只收起。若个别浏览器仍全屏,验收时观察,必要时改用单击之外的方案(本 spec 先用 dblclick.prevent)。

## 测试与验收(用户手动)

1. **自动收/展**:拖动视窗宽度跨 1280/1100/950/768,左右栏按状态机表自动收/展、push↔overlay 切换;反向展宽对称。
2. **手动=临时**:中途手动折叠某栏 → 跨下一个临界点(1280 或 950)后被重置回自动态。
3. **拖拽调宽**:push 模式拖两栏内侧边缘 180–480;刷新保持;overlay 抽屉用同宽。
4. **双击视频**:双击收起;「▸ 展开视频」恢复;高度手柄仍可调。
5. **FAB 编排**:收起栏时 FAB 在视窗固定位置淡入(不随中栏边缘跑);展开时淡出、栏盖过来。
6. 控制台无报错;既有播放/字幕/高亮/TTS 功能不受影响。

## 不做(YAGNI)

- 折叠态持久化(已改 viewport 驱动,不需要)。
- 拖拽宽度的实时数值提示/输入框。
- FAB 出现的额外 delay/弹性动画(简单 opacity 同步即可)。
- 临界点值可配置化(写死 1280/950,与 CSS 1100/768 同步登记到 CLAUDE.md)。
