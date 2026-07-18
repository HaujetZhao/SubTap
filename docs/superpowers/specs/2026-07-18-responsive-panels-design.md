# 双栏响应式（DeepSeek 式 push / overlay）

> 日期:2026-07-18 · 主题:把左栏(设置)与右栏(词卡)改造为可折叠的响应式栏——宽屏常驻 push、中/窄屏渐进式转 overlay 浮层抽屉,并配悬浮唤出按钮(FAB)、遮罩、快捷键与状态持久化。

## 背景与动机

当前 `.layout` 是固定三栏 flex 布局:`.panel-left`(230px, `flex-shrink:0`) / `.panel-center`(`flex:1`) / `.panel-right`(280px, `flex-shrink:0`)。窄屏(平板/手机)下三栏硬挤,中栏阅读区被严重压缩,基本不可用。

经对 DeepSeek(chat.deepseek.com)侧栏机制的实测复刻(见 `D:/tmp/deepseek-mock.html`),确认其手法可平滑迁移到本项目双栏:折叠用 `max-width` 动画(push 模式)或 `transform` 滑出(overlay 模式),配悬浮按钮唤出。本项目比 DeepSeek 多一个右栏,需对称处理并增加窄屏互斥约束。

## 设计方向(已对齐)

- **渐进式断点**:中屏(≤1100px)先把**左栏**(设置)转 overlay;更窄(≤768px)再把**右栏**(词卡)也转 overlay。词卡在阅读时比设置更常用,故左栏先收。
- **桌面保留手动折叠**:宽屏下两栏也能随时手动收起,给中栏让位。
- **窄档互斥**:≤768px 两栏都在 overlay 模式时,开一个自动关另一个,避免遮罩堆叠。
- **纯 CSS 驱动定位模式**:push vs overlay 完全由媒体查询决定,JS 只维护 collapsed 布尔与互斥;与 mock 一致。
- **手写现代 CSS**:不引入任何框架/库(沿用批次四决策),复用现有设计 token。

## 状态模型(App.vue)

新增两个折叠状态,与 `enabled`/`highlightOn` 等同级:

```js
const leftCollapsed  = ref(false);
const rightCollapsed = ref(false);
```

- **collapsed** = 该栏不可见(视觉上收起)。push 模式下宽度归零;overlay 模式下滑出视口。
- **定位模式(push/overlay)由 CSS 媒体查询决定**,JS 不判断。唯一需要 JS 感知断点处是窄档互斥逻辑(见下)。

### 状态持久化(localStorage)

折叠状态写入 localStorage,刷新后恢复:

```js
const LS_KEY = 'subtap-panels';
function loadPanels() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch { return {}; }
}
// 初始值:leftCollapsed  = loadPanels().leftCollapsed  ?? false;
//        rightCollapsed = loadPanels().rightCollapsed ?? false;
// 变化时 watch 写回 { leftCollapsed, rightCollapsed }
```

## 断点与模式矩阵

| 视口 | 左栏(设置) | 右栏(词卡) | 互斥 |
|---|---|---|---|
| > 1100px | push(占 230px) | push(占 280px) | 否(都在文档流) |
| 768–1100px | **overlay**(默认收起) | push | 否(右仍 push) |
| ≤ 768px | overlay | **overlay**(默认收起) | **是** |

断点值用 `:root` CSS 变量,便于后续微调:

```css
--bp-medium: 1100px;   /* 左栏转 overlay */
--bp-narrow: 768px;    /* 右栏也转 overlay + 互斥生效 */
--panel-left-w: 230px;
--panel-right-w: 280px;
```

> 「默认收起」仅指**首次进入该断点档时**的初始观感;一旦用户手动展开,状态由 collapsed 布尔(已持久化)决定,跨断点 resize 不强制重置。详见「resize 行为」一节。

## CSS 机制

### push 模式(默认,宽屏)

```css
.panel-left {
  flex-shrink: 0;
  width: var(--panel-left-w);
  max-width: var(--panel-left-w);
  overflow: hidden;
  transition: max-width .3s cubic-bezier(.4,0,.2,1);
}
.panel-left.collapsed { max-width: 0; width: 0; }
/* 右栏镜像,用 var(--panel-right-w) */
```

栏内容包一层固定宽 `.panel-inner`,内部 `width: var(--panel-left-w)`,避免收起时内容被压缩重排(mock 的 `.side-inner` 做法)。

### overlay 模式(媒体查询内覆盖)

```css
/* 中屏:左栏转 overlay */
@media (max-width: 1100px) {
  .panel-left {
    position: absolute; top: 0; left: 0; bottom: 0;
    z-index: 50;
    box-shadow: 0 8px 32px rgba(60,50,40,.14);
    transform: translateX(0);
    transition: transform .3s cubic-bezier(.4,0,.2,1);
  }
  .panel-left.collapsed {
    transform: translateX(-100%);
    box-shadow: none;
  }
}
/* 窄屏:右栏也转 overlay(镜像 translateX(100%)) */
@media (max-width: 768px) {
  .panel-right {
    position: absolute; top: 0; right: 0; bottom: 0;
    z-index: 50;
    box-shadow: 0 8px 32px rgba(60,50,40,.14);
    transition: transform .3s cubic-bezier(.4,0,.2,1);
  }
  .panel-right.collapsed { transform: translateX(100%); box-shadow: none; }
}
```

> overlay 模式下不再用 `max-width`(否则会推动中栏),改用 `transform` 滑出。`overflow:hidden` 在 overlay 下保留,防止内容溢出栏外。

## UI 控件

### 折叠按钮(各栏顶部)

每个栏 `.panel-title` 区域加一个小图标按钮(chevron 指外):

- 左栏折叠按钮 → emit `collapse` → App 设 `leftCollapsed = true`
- 右栏折叠按钮 → emit `collapse` → App 设 `rightCollapsed = true`

overlay 模式下该按钮同样可用(栏展开时可见)。

### 悬浮唤出按钮(FAB)

无顶部标题栏(沿用现有布局,中栏顶部是视频区,不设标题栏):

- **左 FAB**:`.fab-left`,定位在中栏 `top:16px; left:16px`,40px 圆形,带细边框 + 轻投影,hover 上浮。当 `leftCollapsed === true` 时显示。
- **右 FAB**:`.fab-right`,镜像 `right:16px`。当 `rightCollapsed === true` 时显示。

窄屏 overlay 模式下,FAB 是常驻唤出入口(因为栏默认收起)。FAB 始终可见性由 collapsed 布尔直接决定(`v-show` 或 CSS `[data-collapsed]`),与模式无关——push 模式手动折叠后 FAB 也出现,与 mock 一致。

### 遮罩(scrim)

```css
.scrim {
  position: fixed; inset: 0;
  background: rgba(60,50,40,.3);
  opacity: 0; pointer-events: none;
  transition: opacity .3s cubic-bezier(.4,0,.2,1);
  z-index: 40;   /* 低于 overlay 栏(50),高于中栏内容 */
}
.scrim.show { opacity: 1; pointer-events: auto; }
```

显示条件:**至少一栏处于 overlay 模式且未折叠**。由于「是否 overlay」是纯 CSS 概念,JS 用 `matchMedia` 感知:

```js
const mqlLeft  = window.matchMedia('(max-width: 1100px)');
const mqlRight = window.matchMedia('(max-width: 768px)');
// scrim 显示 = (mqlLeft.matches  && !leftCollapsed.value) ||
//             (mqlRight.matches && !rightCollapsed.value)
```

点 scrim → 关两栏(`leftCollapsed = rightCollapsed = true`)。

## 互斥逻辑(仅 ≤768px)

App.vue 开合函数集中收口,所有折叠按钮 / FAB / 快捷键都走这里:

```js
function openLeft() {
  leftCollapsed.value = false;
  if (mqlRight.matches) rightCollapsed.value = true;  // 窄档互斥
}
function openRight() {
  rightCollapsed.value = false;
  if (mqlRight.matches) leftCollapsed.value = true;
}
// collapse 直接置位即可,无副作用
function closeLeft()  { leftCollapsed.value = true; }
function closeRight() { rightCollapsed.value = true; }
```

> 中屏档(768–1100px)只有左栏 overlay,右栏仍 push,故不互斥——`mqlRight.matches` 为 false,`openLeft` 不会动右栏。

## resize 行为

- **不强制重置**:用户手动展开/收起的状态(collapsed 布尔)在 resize 跨断点时保留。例如用户在中屏展开了左 overlay,拖到窄屏,左栏仍是展开的 overlay;右栏此时进入 overlay 但默认 collapsed(若之前是 push 展开态,进入 overlay 的瞬间维持其 collapsed 值,即未折叠 → 会显示为 overlay 展开态)。
- **避免双 overlay 同时展开遮挡**:窄档下若两栏同时未折叠(例如从宽屏一路缩到窄屏,两栏都还展开),互斥不自动触发(互斥只在**主动 open** 时生效)。此时 scrim 覆盖、两 overlay 并存可被手动关。可接受;若实测体验差,再追加「进入窄档时强制右栏收起」的 resize 钩子(列为可选增强,不在首版)。
- **`matchMedia` 监听**:`mqlLeft`/`mqlRight` 各挂 `change` 监听,触发 scrim 显示性的重算(响应式 ref 已能驱动模板,这里只需保证 scrim 的 computed 重新求值——用 `ref(mql.matches)` + change 时赋值即可)。

## 快捷键

在现有 `onKeydown`(焦点在 `input/textarea` 时不拦截)中追加:

| 键 | 动作 |
|---|---|
| `[` | 切换左栏折叠(`openLeft` ↔ `closeLeft`) |
| `]` | 切换右栏折叠(`openRight` ↔ `closeRight`) |

不与现有 `↓/↑/←/→/空格` 冲突。

## 组件改动

| 文件 | 改动 |
|---|---|
| `App.vue` | 新增 `leftCollapsed`/`rightCollapsed` ref(localStorage 持久化);`openLeft/openRight/closeLeft/closeRight`;两个 `matchMedia` + scrim computed;`onKeydown` 加 `[`/`]`;模板:`<aside :class="{collapsed:leftCollapsed}">`、加 `.scrim`、两个 FAB、把 props/emit 接到两栏 |
| `SettingsPanel.vue` | 根 `aside` 接收并应用 `collapsed` class;顶部 `.panel-title` 旁加折叠按钮,`@click` emit `collapse` |
| `WordPanel.vue` | 同上(镜像);内部内容包 `.panel-inner` |
| `styles.css` | `:root` 加 `--bp-medium/--bp-narrow/--panel-*-w`;`.panel-left/.panel-right` 改为可折叠(max-width 动画 + `.panel-inner` 固定宽);加 overlay 媒体查询(1100/768);加 `.fab-left/.fab-right/.scrim` 样式 |

**纯逻辑层(`srt-parser`/`word-lookup`/`lemmatize`/`vocab-store`/`player`/`subtitle-tweak`/`level-colors`)完全不动。**

## 边界与不变量

- **词卡栏内容依赖选中句**(`currentText`),收起时 `currentText` 照常更新,展开即最新——无需特殊处理。
- **视频区**在中栏顶部,不受栏折叠影响;overlay 栏 `z-index:50` 高于视频区,展开时覆盖视频区边缘(可接受,因 overlay 是临时查看)。
- **renderedSentences 缓存**不受影响(纯中栏渲染)。
- **toast** `z-index` 需高于 overlay 栏(50)与 scrim(40),保持置顶(现有 toast 样式应已够高,实现时核对)。
- **响应式镜像模式不变量**:`enabled` 镜像、`renderedSentences` 缓存等既有约定均不触碰。

## 测试与验收

- 浏览器手动验收(可配 Playwright MCP):
  1. 宽屏(>1100):两栏 push,各自折叠按钮可收,FAB 出现可唤回。
  2. 中屏(768–1100):左栏 overlay(默认收起,左 FAB 唤出),右栏仍 push。
  3. 窄屏(≤768):两栏 overlay,默认收起;开左则右关(互斥),反之亦然;点 scrim 关两栏。
  4. `[`/`]` 快捷键在焦点非输入框时切换两栏。
  5. 刷新后折叠状态恢复(localStorage)。
  6. 跨断点拖拽窗口:折叠状态保留、无闪烁错位、过渡顺滑。
- 纯函数层无新增,无需补 test.html 单测。

## 不做(YAGNI)

- 深色模式 / 主题切换。
- 拖拽改栏宽(栏宽固定)。
- resize 进入窄档时强制重置右栏(列为可选增强,视实测而定)。
- 动画时长/缓动可配置化(直接写死,沿用 mock 的 `.3s cubic-bezier(.4,0,.2,1)`)。
