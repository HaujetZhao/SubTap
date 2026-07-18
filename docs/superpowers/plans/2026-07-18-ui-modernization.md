# UI 现代化重设计 实现计划 (批次四)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把三栏界面从「原生控件 + 冷灰纯色」升级为 Notion/Stripe 风的柔和圆润现代界面,并将常驻状态条改为自动消失的 toast。

**Architecture:** 纯样式重写为主(集中在 `styles.css` 的设计 token + 组件样式),`SettingsPanel.vue` 调整模板结构顺序与开关形态(契约不变),`App.vue` 用 reactive toast 列表替换 `statusText/statusError`。不引入任何第三方库,不动纯逻辑层。

**Tech Stack:** Vue 3 `<script setup>`、原生 CSS(设计 token via `:root` 自定义属性)、Vite + vite-plugin-singlefile。

**测试约定:** 本批次无可单测的纯函数。每个任务以 `npm run build` 通过 + 浏览器手动验收为完成标准(spec「验收」节列了检查清单)。纯逻辑层(test.html 覆盖的部分)不改动,无需重跑断言。

**参考 spec:** `docs/superpowers/specs/2026-07-18-ui-modernization-design.md`
**视觉参考(mockup):** `.superpowers/brainstorm/3492-1784334450/content/full-mockup-v2.html` 与 `toast.html`

---

## 文件结构

| 文件 | 改动 | 职责 |
|---|---|---|
| `src/styles.css` | 重写 | 设计 token(`:root`)+ 全部组件样式(含 toast) |
| `src/components/SettingsPanel.vue` | 改 template 结构 + class | 左栏:文件置顶、按钮改名+主色、药丸开关、微调样式(props/emit 契约不变) |
| `src/components/SentenceList.vue` | 仅删模板里多余的 `.status` 引用(实际无,见 Task 3 说明) | 中栏样式由 styles.css 驱动 |
| `src/components/WordPanel.vue` | 改 template class | 右栏:词卡 + 数量药丸(样式由 styles.css 驱动) |
| `src/App.vue` | 删 `statusText/statusError`、加 toast 状态与渲染 | toast 系统 + 调用点改写 |

---

## Task 1: 设计 token 与基础布局样式

**Files:**
- Modify: `src/styles.css` (整文件重写基础部分)

- [ ] **Step 1: 重写 `src/styles.css` 顶部(去掉旧 reset,加 token + 基础布局)**

把 `src/styles.css` **第 1–24 行**(`* {}` 到 `.panel-right {...}` 结束)替换为:

```css
:root {
  --canvas: #fbfaf9;
  --panel: #ffffff;
  --border: #f0eee9;
  --border-strong: #e3dfd7;
  --ink: #3b3934;
  --ink-2: #6b6862;
  --ink-3: #9b9a93;
  --accent: #5a8c6a;
  --accent-2: #5b8fb9;
  --r-sm: 5px;
  --r-md: 9px;
  --r-lg: 14px;
  --shadow-soft: 0 2px 6px rgba(60,50,40,.06);
  --shadow-toast: 0 8px 24px -6px rgba(60,50,40,.25), 0 2px 6px rgba(60,50,40,.1);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

* { box-sizing: border-box; }
#app { height: 100vh; }
body {
  margin: 0; height: 100vh; overflow: hidden;
  background: var(--canvas); color: var(--ink);
}

.layout { display: flex; height: 100vh; width: 100%; }
.panel-left {
  width: 230px; flex-shrink: 0;
  background: var(--panel); border-right: 1px solid var(--border);
  padding: 16px 14px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 20px;
}
.panel-center {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  position: relative; background: var(--canvas);
}
.panel-right {
  width: 280px; flex-shrink: 0;
  background: var(--panel); border-left: 1px solid var(--border);
  padding: 16px; overflow-y: auto;
}

.panel-title {
  margin: 0 0 10px; font-size: 11px; color: var(--ink-3);
  font-weight: 600; text-transform: uppercase; letter-spacing: .08em;
}

/* 可访问性隐藏(保留 checkbox 键盘可达) */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建成功(此时页面会更素,因为后续组件样式还没改,属正常)。

- [ ] **Step 3: 提交**

```bash
git add src/styles.css
git commit -m "feat(ui): 设计 token 与基础布局(批次四基底)"
```

---

## Task 2: 左栏 SettingsPanel — 文件置顶 + 主色按钮 + 药丸开关

**Files:**
- Modify: `src/components/SettingsPanel.vue` (template)
- Modify: `src/styles.css` (追加左栏组件样式)

- [ ] **Step 1: 改 `SettingsPanel.vue` 的 `<template>`**

把整个 `<template>`(原第 30–80 行)替换为下面这段。**注意顺序变为 文件 → 词库分级 → 字幕微调**;`<script setup>` 不动(props/emit 全不变)。

```html
<template>
  <aside class="panel-left">
    <!-- 文件(置顶) -->
    <section class="files">
      <h3 class="panel-title">文件</h3>
      <label class="file-btn primary">
        <span class="file-ico">S</span>
        打开字幕
        <input type="file" accept=".srt" @change="onSrtChange" />
      </label>
      <label class="file-btn primary alt">
        <span class="file-ico">♪</span>
        打开音/视频
        <input type="file" accept="audio/*,video/*" @change="onMediaChange" />
      </label>
    </section>

    <!-- 词库分级 -->
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-pill" :class="{ off: !enabled[lv] }">
          <input type="checkbox" class="sr-only" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span class="dot" :style="{ background: dotColor(lv) }"></span>
          <span class="label-text">{{ lv }}</span>
          <span class="switch" aria-hidden="true"></span>
        </label>
      </div>
      <label class="level-pill sub" :class="{ off: !highlightOn }">
        <input type="checkbox" class="sr-only" :checked="highlightOn"
               @change="emit('toggle-highlight', $event.target.checked)" />
        <span class="dot muted"></span>
        <span class="label-text">用背景色突出单词</span>
        <span class="switch" aria-hidden="true"></span>
      </label>
    </section>

    <!-- 字幕微调 -->
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
      <label class="level-pill sub" :class="{ off: !linkNext }">
        <input type="checkbox" class="sr-only" :checked="linkNext"
               @change="onTweak('linkNext', $event.target.checked)" />
        <span class="dot muted"></span>
        <span class="label-text">句末连接(播到下一句开头)</span>
        <span class="switch" aria-hidden="true"></span>
      </label>
      <label v-show="linkNext" class="tweak-row">句末连接偏移(秒)
        <input type="number" min="-5" max="5" step="0.1" :value="linkNextOffset"
               @change="onTweak('linkNextOffset', parseFloat($event.target.value) || 0)" />
      </label>
    </section>
  </aside>
</template>
```

- [ ] **Step 2: 在 `src/styles.css` 末尾追加左栏样式**

```css
/* ===== 左栏组件 ===== */
.levels { display: flex; flex-direction: column; gap: 6px; }
.level-pill {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: var(--r-md);
  background: #f7f5f1; font-size: 13px; color: var(--ink);
  cursor: pointer; transition: background .15s;
}
.level-pill:hover { background: #f1ede6; }
.level-pill.sub { background: transparent; padding: 6px 4px; font-size: 12.5px; color: var(--ink-2); }
.level-pill.sub:hover { background: #f7f5f1; }
.level-pill.off { opacity: .5; }
.level-pill .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.level-pill .dot.muted { background: var(--ink-3); }
.level-pill .label-text { flex: 1; }

/* 药丸开关(纯 CSS,随 .off 切换) */
.level-pill .switch {
  width: 26px; height: 15px; border-radius: 8px; background: var(--accent);
  position: relative; flex-shrink: 0; transition: background .15s;
}
.level-pill .switch::after {
  content: ''; position: absolute; right: 2px; top: 2px;
  width: 11px; height: 11px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,.15); transition: left/right .15s;
}
.level-pill.off .switch { background: #d6d3cd; }
.level-pill.off .switch::after { right: auto; left: 2px; }

/* 文件按钮(主色实心) */
.files { display: flex; flex-direction: column; gap: 7px; }
.file-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: var(--r-md);
  font-size: 13px; font-weight: 500; cursor: pointer;
  color: #fff; background: var(--accent); box-shadow: 0 1px 2px rgba(90,140,106,.2);
  transition: background .15s; position: relative;
}
.file-btn:hover { background: #517a5f; }
.file-btn.alt { background: var(--accent-2); box-shadow: 0 1px 2px rgba(91,143,185,.2); }
.file-btn.alt:hover { background: #4d7ba2; }
.file-btn .file-ico {
  width: 20px; height: 20px; border-radius: 6px;
  background: rgba(255,255,255,.22);
  display: flex; align-items: center; justify-content: center; font-size: 12px;
}
.file-btn input[type="file"] { display: none; }

/* 字幕微调 */
.tweak { display: flex; flex-direction: column; gap: 8px; }
.tweak-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12.5px; color: var(--ink-2); gap: 8px;
}
.tweak-row input[type="number"] {
  width: 64px; padding: 4px 8px; border: 1px solid var(--border-strong);
  border-radius: 7px; background: #fff; font-size: 12.5px; text-align: right;
  color: var(--ink);
}
.tweak-row input[type="number"]:focus { outline: none; border-color: var(--accent-2); }
```

> 同时**删除** `styles.css` 里旧的 `.levels` / `.level-item` / `.file-btn`(旧灰底版) / `.tweak` / `.tweak-row` / `.level-dot` / `.highlight-toggle` 这些被取代的规则,避免冲突(Task 1 之后的旧规则仍在文件中)。搜索这些选择器逐个删除。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: 浏览器手动验收**

`npm run dev` → 打开 `http://localhost:5173`:
- 左栏顺序:文件 → 词库分级 → 字幕微调。
- 两个文件按钮为绿/蓝实心,文字「打开字幕」「打开音/视频」。
- 词库分级为药丸行,开关随勾选在绿/灰间切换。
- 勾掉某级 → 该行变淡(opacity .5)、开关变灰。

- [ ] **Step 5: 提交**

```bash
git add src/components/SettingsPanel.vue src/styles.css
git commit -m "feat(ui): 左栏文件置顶+主色按钮+药丸开关"
```

---

## Task 3: 中栏句子样式

**Files:**
- Modify: `src/styles.css` (改 `.sentence*` / `.status` 相关规则)

> 说明:`.status` 的 DOM 在 `App.vue`(Task 5 会删除),本任务先把句子样式改好。`SentenceList.vue` 模板**无需改动**(class 名沿用)。

- [ ] **Step 1: 替换 `styles.css` 里 `.sentences` / `.sentence*` 旧规则**

找到原 `.sentences {...}` 到 `.sentence .text {...}` 一段(约第 49–67 行),替换为:

```css
.sentences { flex: 1; overflow-y: auto; padding: 14px 18px; scroll-behavior: smooth; }

.sentence {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px; border-radius: var(--r-md); margin-bottom: 3px;
  cursor: pointer; font-size: 14.5px; line-height: 1.65;
  transition: background .12s;
}
.sentence:hover { background: #f3efe8; }
.sentence.active { background: #eef4f8; box-shadow: inset 3px 0 0 var(--accent-2); }
.sentence .play-icon { flex-shrink: 0; width: 16px; color: var(--accent-2); font-size: 11px; padding-top: 3px; }
.sentence.playing .play-icon { color: #dc2626; }
.sentence .time { flex-shrink: 0; color: #a8a59f; font-size: 12px; font-variant-numeric: tabular-nums; padding-top: 2px; }
.sentence .text { flex: 1; white-space: pre-line; }
.sentence .text span { border-radius: var(--r-sm); }
```

- [ ] **Step 2: 暂时保留 `.status` 样式**

`.status` / `.status.error` 规则**先不动**(Task 5 删 DOM 时一并清样式),避免本任务中栏无状态提示。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: 浏览器手动验收**

载入测试 srt + 音频,点句子:
- 句子项圆角;选中句左侧蓝色立柱 + 浅蓝底。
- 播放中图标变红。
- 词高亮为圆角底色。

- [ ] **Step 5: 提交**

```bash
git add src/styles.css
git commit -m "feat(ui): 中栏句子圆角卡片+选中立柱"
```

---

## Task 4: 右栏词卡样式

**Files:**
- Modify: `src/components/WordPanel.vue` (template class 微调)
- Modify: `src/styles.css` (改 `.word-groups` / `.word*`)

- [ ] **Step 1: 改 `WordPanel.vue` 模板,加数量药丸**

把原模板里 `<h4 :style="...">{{ lv }} ({{ groups[lv].length }})</h4>` 那行替换为(其余结构不变):

```html
<h4 :style="{ color: titleColor(lv) }">
  {{ lv }}
  <span class="count-pill" :style="{ background: titleColor(lv) }">{{ groups[lv].length }}</span>
</h4>
```

- [ ] **Step 2: 替换 `styles.css` 里 `.word-groups` / `.word*` 旧规则**

替换为:

```css
.word-groups { display: flex; flex-direction: column; gap: 18px; }
.word-group h4 {
  margin: 0 0 8px; font-size: 12px; font-weight: 600;
  border-bottom: 1px solid var(--border); padding-bottom: 5px;
  display: flex; align-items: center; gap: 6px;
}
.word-group .count-pill {
  font-size: 10px; font-weight: 500; color: #fff;
  padding: 1px 6px; border-radius: 8px; opacity: .85;
}
.word { background: #f7f5f1; border-radius: var(--r-md); padding: 8px 11px; margin-bottom: 6px; }
.word .w { font-weight: 600; font-size: 14px; }
.word .def { font-size: 12.5px; color: var(--ink-2); margin-top: 2px; line-height: 1.5; }

.placeholder { color: var(--ink-3); font-size: 14px; }
```

> 删除被取代的旧 `.word-groups` / `.word-group h4` / `.word` / `.word .w` / `.word .def` / `.placeholder` 规则。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: 浏览器手动验收**

选中一句含词库单词的句子:
- 右栏单词为圆角卡片;分级标题带颜色 + 数量药丸。
- 三种占位(未选句 / 未勾选 / 无命中)文字为浅灰。

- [ ] **Step 5: 提交**

```bash
git add src/components/WordPanel.vue src/styles.css
git commit -m "feat(ui): 右栏词卡+数量药丸"
```

---

## Task 5: Toast 系统(替换常驻状态条)

**Files:**
- Modify: `src/App.vue` (script + template)
- Modify: `src/styles.css` (追加 toast 样式,删除旧 `.status`)

- [ ] **Step 1: `App.vue` script — 删 status,加 toast**

在 `App.vue` `<script setup>` 中:

a) **删除**这两个声明:
```js
const statusText = ref('请选择文件');
const statusError = ref(false);
```

b) 在原位置加 toast 状态:
```js
// toast:自动消失的状态消息(成功/错误均 2.5s)
const toasts = reactive([]);
let toastSeq = 0;
function notify(message, type = 'success') {
  const t = { id: ++toastSeq, message, type, key: 0, hover: false };
  toasts.push(t);
  t.key++;                        // 触发进度条动画重启
  t.timer = setTimeout(() => dismiss(t.id), 2500);
}
function dismiss(id) {
  const i = toasts.findIndex(x => x.id === id);
  if (i < 0) return;
  clearTimeout(toasts[i].timer);
  toasts.splice(i, 1);
}
function pauseToast(t) {
  clearTimeout(t.timer);
}
function resumeToast(t) {
  t.key++;                        // 重启进度条动画
  t.timer = setTimeout(() => dismiss(t.id), 2500);
}
```

c) **替换所有 status 赋值点**(搜索 `statusText` 与 `statusError`):

- `onSrtFile` 成功分支:`statusText.value = '已载入 ' + sentences.value.length + ' 句字幕';` 和 `statusError.value = false;` →
```js
notify('已载入 ' + sentences.value.length + ' 句字幕');
```
- `onSrtFile` catch 分支:`statusText.value = '字幕解析失败:' + e.message;` 和 `statusError.value = true;` →
```js
notify('字幕解析失败:' + e.message, 'error');
```
- `onMediaFile` 末尾:`statusText.value = '已载入：' + file.name;` 和 `statusError.value = false;` →
```js
notify('已载入：' + file.name);
```
- `playSentence` 无媒体分支:`statusText.value = '请先选择音/视频文件';` 和 `statusError.value = true;` →
```js
notify('请先选择音/视频文件', 'error');
```
- `onMounted` 里 video `error` 事件回调:`statusText.value = '音/视频无法播放（编码不支持），建议改用 mp4/mp3';` 和 `statusError.value = true;` →
```js
notify('音/视频无法播放（编码不支持），建议改用 mp4/mp3', 'error');
```

- [ ] **Step 2: `App.vue` template — 删 status,加 toast 容器**

a) 删除中栏末尾的:`<span class="status" :class="{ error: statusError }">{{ statusText }}</span>`

b) 在 `</div>`(`.layout` 闭合)之前、即模板最外层 `<div class="layout"> ... </div>` 之后追加(与 layout 同级,在 root 内):

```html
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type"
         @click="dismiss(t.id)"
         @mouseenter="pauseToast(t)" @mouseleave="resumeToast(t)">
      <span class="ico">{{ t.type === 'error' ? '!' : '✓' }}</span>
      <span class="msg">{{ t.message }}</span>
      <span class="dismiss">×</span>
      <span :key="t.key" class="bar"></span>
    </div>
  </div>
```

> 模板根节点现为多根片段(Vue 3 支持)。如担心,可把 `.layout` 与 `.toast-container` 一并包进一个 `<div>`。当前 `#app` 仅挂载本组件,多根片段可正常工作。

- [ ] **Step 3: `styles.css` — 删旧 `.status`,加 toast 样式**

a) **删除** `.status { ... }` 与 `.status.error { ... }` 两条规则。

b) 在文件末尾追加:

```css
/* ===== Toast ===== */
.toast-container {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  z-index: 50; pointer-events: none;
}
.toast {
  position: relative; pointer-events: auto;
  display: flex; align-items: center; gap: 9px;
  padding: 11px 18px; padding-right: 14px;
  border-radius: var(--r-lg); font-size: 13.5px; font-weight: 500;
  background: rgba(255,255,255,.96); color: var(--ink);
  box-shadow: var(--shadow-toast);
  animation: toastIn .35s cubic-bezier(.2,.8,.2,1);
  cursor: pointer; overflow: hidden;
}
.toast.error { color: #9a2b2b; }
.toast .ico {
  width: 18px; height: 18px; border-radius: 50%; color: #fff; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 11px;
  background: var(--accent);
}
.toast.error .ico { background: #dc2626; }
.toast .msg { max-width: 60vw; }
.toast .dismiss { margin-left: 10px; padding-left: 10px; border-left: 1px solid var(--border); color: var(--ink-3); }
.toast .bar {
  position: absolute; left: 0; bottom: 0; height: 3px; width: 100%;
  background: var(--accent); transform-origin: left;
  animation: toastBar 2.5s linear forwards;
}
.toast.error .bar { background: #dc2626; }
.toast:hover .bar { animation-play-state: paused; }

@keyframes toastIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes toastBar { from { transform: scaleX(1); } to { transform: scaleX(0); } }
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 5: 浏览器手动验收**

`npm run dev`:
- 载入 srt → 底部居中弹出「已载入 N 句字幕」,带绿色进度条,2.5s 淡出。
- 载入音频 → 弹「已载入:文件名」。
- 未载媒体时点句子 → 弹红色错误 toast,同样 2.5s 自动消失。
- 鼠标悬停 toast → 进度条暂停;移开 → 恢复(从满条重新走)。
- 点 toast 或 × → 立即消失。
- 中栏右下角不再有常驻状态条。

- [ ] **Step 6: 提交**

```bash
git add src/App.vue src/styles.css
git commit -m "feat(ui): toast 替换常驻状态条(2.5s 自动消失+悬停暂停)"
```

---

## Task 6: 收尾构建 + 整体回归

**Files:** 无(仅验证)

- [ ] **Step 1: 完整构建**

Run: `npm run build`
Expected: 成功生成 `dist/index.html`(单文件)。

- [ ] **Step 2: 双击打开 `dist/index.html` 验证单文件可用**

确认离线单文件能正常显示三栏新样式、toast 工作。

- [ ] **Step 3: 回归检查清单(对照 spec「验收」)**

载入测试素材 `【官方双语】….{srt,mp3}`:
- [ ] 三栏视觉符合 mockup(暖白底、圆角、柔影)。
- [ ] 左栏药丸开关勾选 → 中栏词高亮显隐 + 右栏分组显隐(响应式镜像不变量)。
- [ ] 文件按钮载入字幕/音视频 → toast。
- [ ] 字幕微调:起始偏移 / 末尾延长 / 句末连接(+偏移)生效。
- [ ] 键盘 ↑↓←→ 与空格播放控制正常;↑↓ 触发按需滚动。
- [ ] 视频可收起/展开/拖拽改高。
- [ ] toast 2.5s 消失、hover 暂停、错误也消失。

- [ ] **Step 4: 提交构建产物(若项目惯例提交 dist)**

```bash
git add dist/index.html
git commit -m "build: 重新构建单文件(UI 现代化批次四)"
```

> 若 `dist/` 不入库则跳过本步(按 `.gitignore` 与既有惯例;当前 git status 显示 `dist/index.html` 有改动且在跟踪中,故提交)。

---

## Self-Review 记录

- **Spec 覆盖**:token(Task1)✓、左栏顺序/按钮/开关/微调(Task2)✓、中栏(Task3)✓、右栏(Task4)✓、toast 全部行为(Task5)✓、构建+回归(Task6)✓。
- **占位符**:无 TBD/TODO,所有 code 步骤给了完整代码。
- **一致性**:`notify(message, type)` 签名、`toasts` 项字段(`id/message/type/key/timer`)、class 名(`level-pill/switch/file-btn/count-pill/toast/bar`)跨任务一致。`statusText/statusError` 全部替换点已列出。
