# 空白页「载入示例」按钮 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐个实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 空载引导页加「载入示例」按钮，一键载入内置示例字幕 + 音频。

**Architecture:** 示例素材放 `src/assets/sample/`（走打包器 import，单文件构建内联成 data URI、PWA 构建独立文件并预缓存）。把现有 `onSrtFile`/`onMediaFile` 的应用逻辑抽成 `applySubtitle`/`applyMediaSrc` 两个共用函数，示例按钮与文件按钮共用。无新增纯逻辑，故无单测（YAGNI）；验证靠两版构建 + 手动浏览器验收。

**Tech Stack:** Vue 3 `<script setup>`、Vite、vite-plugin-singlefile、vite-plugin-pwa。素材已就位：`src/assets/sample/sample.srt`（40 条）、`src/assets/sample/sample.aac`（AAC 96k 2min，1.5MB）。

**Spec:** `docs/superpowers/specs/2026-07-21-sample-loader-design.md`

---

## File Structure

- 改 `src/App.vue`：引入素材；抽 `applySubtitle`/`applyMediaSrc`；新增 `loadSample`；`<SentenceList>` 绑 `@sample`。
- 改 `src/components/SentenceList.vue`：引导页加按钮，`defineEmits` 加 `'sample'`。
- 改 `src/styles.css`：`.empty-sample-btn` 样式。
- 改 `.gitignore`：给示例 srt 取反。
- 改 `vite.config.pwa.js`：workbox glob 加 `aac`。

---

### Task 1: 配置 — gitignore 取反 + PWA 预缓存 aac

**Files:**
- Modify: `.gitignore`
- Modify: `vite.config.pwa.js:31`

- [ ] **Step 1: `.gitignore` 加取反，让示例 srt 入库**

在 `.gitignore` 顶部「媒体与字幕素材」段末尾（第 5 行 `【官方*` 之后）追加：

```
# 示例素材(随工具发布,入库 — 见 src/assets/sample/)
!src/assets/sample/sample.srt
!src/assets/sample/sample.aac
```

注：`*.aac` 本未被忽略，加取反仅为显式声明意图、防日后规则变动误伤。

- [ ] **Step 2: `vite.config.pwa.js` workbox glob 加 aac**

把 `vite.config.pwa.js` 第 31 行：
```js
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm}'],
```
改为：
```js
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm,aac}'],
```

- [ ] **Step 3: 确认示例素材能被 git 追踪**

Run: `git status --short src/assets/sample/`
Expected: 两个文件都出现（`?? src/assets/sample/sample.aac` 和 `?? src/assets/sample/sample.srt`），不被忽略。若 srt 不出现，说明取反规则没生效，检查路径拼写。

- [ ] **Step 4: Commit**

```bash
git add .gitignore vite.config.pwa.js src/assets/sample/sample.srt src/assets/sample/sample.aac
git commit -m "chore(sample): 示例素材入库 + PWA 预缓存 aac"
```

---

### Task 2: App.vue — 引入素材、抽共用函数、loadSample、模板绑定

**Files:**
- Modify: `src/App.vue`（import 区 ~L4-12；`onSrtFile` L230-247；`onMediaFile` L249-263；模板 `<SentenceList>` L425-434）

- [ ] **Step 1: 顶部 import 区引入示例素材**

在 `src/App.vue` 第 12 行（`import WordPanel ...` 之后）追加：

```js
import sampleSrt from './assets/sample/sample.srt?raw';
import sampleAudio from './assets/sample/sample.aac';
```

- [ ] **Step 2: 把 `onSrtFile`/`onMediaFile` 的应用逻辑抽成共用函数**

把现有 `onSrtFile`（L230-247）和 `onMediaFile`（L249-263）**整体替换**为下面这段（逻辑等价，仅提取 + 新增 `loadSample`）：

```js
// 应用字幕文本(不含提示,由调用方决定文案)。文件按钮与示例按钮共用。
function applySubtitle(text) {
  sentences.value = parseSRT(text);
  if (player) player.stop();
  stopSpeech();
  currentId.value = null;
  currentText.value = '';
  isPlaying.value = false;
}

// 应用媒体源 URL + 显示名 + 类型。文件按钮与示例按钮共用。
function applyMediaSrc(url, name, kind) {
  if (player) player.stop();
  stopSpeech();
  isPlaying.value = false;
  player.setSrc(url);
  mediaName.value = name;
  mediaKind.value = kind;
  if (kind === 'video') videoCollapsed.value = false;
}

function onSrtFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applySubtitle(reader.result);
      notify('已载入 ' + sentences.value.length + ' 句字幕');
    } catch (e) {
      notify('字幕解析失败：' + e.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function onMediaFile(file) {
  if (!file) return;
  const isVideo = (file.type || '').startsWith('video/');
  applyMediaSrc(URL.createObjectURL(file), file.name, isVideo ? 'video' : 'audio');
  notify('已载入：' + file.name);
}

// 一键载入内置示例(空载引导页按钮触发):字幕 + 音频,单条成功提示。
function loadSample() {
  try {
    applySubtitle(sampleSrt);
  } catch (e) {
    notify('示例字幕解析失败：' + e.message, 'error');
    return;
  }
  applyMediaSrc(sampleAudio, '示例音频', 'audio');
  notify('已载入示例');
}
```

注：文件按钮的 toast 文案与原行为完全一致；`loadSample` 只弹一条「已载入示例」。

- [ ] **Step 3: 模板里给 `<SentenceList>` 绑 `@sample`**

把 `src/App.vue` 里 `<SentenceList ... />`（L425-434）的属性末尾、`@click="onSentenceClick"` 之后加一行：

```html
        @sample="loadSample"
```

改后该标签的末尾几行应为：
```html
        :colors="LEVEL_COLORS"
        @click="onSentenceClick"
        @sample="loadSample"
      />
```

- [ ] **Step 4: 构建冒烟 — 确认 import 路径无误**

Run: `npm run build 2>&1 | tail -8`
Expected: 构建成功，无 "Could not resolve ./assets/sample/sample.srt?raw" 之类报错；`dist/index.html` 生成。

- [ ] **Step 5: Commit**

```bash
git add src/App.vue
git commit -m "feat(sample): App 引入示例素材 + loadSample 入口"
```

---

### Task 3: SentenceList.vue — 引导页按钮 + emit

**Files:**
- Modify: `src/components/SentenceList.vue`（`defineEmits` L13；模板 `.empty` 内 L108）

- [ ] **Step 1: `defineEmits` 加 `'sample'`**

把第 13 行：
```js
const emit = defineEmits(['click']);
```
改为：
```js
const emit = defineEmits(['click', 'sample']);
```

- [ ] **Step 2: 引导页加按钮**

在 `src/components/SentenceList.vue` 模板里，`.empty-footer` 那个 `<a>`（L108）**之前**插入按钮。即把：
```html
      </div>
      <a class="empty-footer" href="https://github.com/HaujetZhao/SubTap" target="_blank" rel="noopener">GitHub · HaujetZhao/SubTap</a>
```
改为：
```html
      </div>
      <button class="empty-sample-btn" @click="emit('sample')">▶ 载入示例</button>
      <a class="empty-footer" href="https://github.com/HaujetZhao/SubTap" target="_blank" rel="noopener">GitHub · HaujetZhao/SubTap</a>
```

（按钮在 `.empty-grid` 的闭合 `</div>` 之后、`.empty-footer` 之前，居中显示在卡片与页脚之间。）

- [ ] **Step 3: Commit**

```bash
git add src/components/SentenceList.vue
git commit -m "feat(sample): 引导页加「载入示例」按钮"
```

---

### Task 4: styles.css — 按钮样式

**Files:**
- Modify: `src/styles.css`（在 `.empty-footer` 规则块 L244-249 之后追加）

- [ ] **Step 1: 加 `.empty-sample-btn` 样式**

在 `src/styles.css` 第 249 行（`.empty-footer:hover { ... }`）之后追加：

```css
.empty-sample-btn {
  margin-top: 18px;
  padding: 9px 22px;
  border: none;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(90, 140, 106, .2);
  transition: background .15s;
}
.empty-sample-btn:hover { background: #517a5f; }
```

风格与设置面板 `.file-btn`（主色 `--accent`、hover `#517a5f`）一致。

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style(sample): 引导页示例按钮样式"
```

---

### Task 5: 双轨构建验证 + 手动验收

**Files:** 无（仅验证）

- [ ] **Step 1: 单文件构建 — 验证 aac 被内联**

Run: `npm run build 2>&1 | tail -5`
Expected: 构建成功。

Run: `ls -lh dist/index.html`
Expected: 文件明显增大（含 vocab.json + 内联 aac data URI，预计数 MB）。

Run: `grep -c "sample.aac" dist/index.html`
Expected: `0`（aac 已内联为 data URI，不存在外链 `sample.aac` 引用）。

- [ ] **Step 2: PWA 构建 — 验证 aac 作为独立文件输出**

Run: `npm run build:pwa 2>&1 | tail -5`
Expected: 构建成功。

Run: `ls dist/assets/*.aac`
Expected: 列出一个哈希命名的 `.aac` 文件（如 `sample-xxxxx.aac`）。

- [ ] **Step 3: 手动浏览器验收（交由用户本人）**

启动 `npm run dev`，开 `http://localhost:5173/`，验收清单交用户：
- 空载页可见「▶ 载入示例」按钮，主色，居中。
- 点按钮 → 中栏出现 40 条字幕，toast「已载入示例」。
- 点任一句 → 该句音频区间播放（左下视频区为音频态，无画面，正常）。
- 点别的句、用 ↑↓ 切句、← 重读、→/空格 停止，均正常。
- 之后用左栏文件按钮载入自己的字幕/音频，能正常替换示例。
- 视觉：按钮与卡片、页脚间距协调，hover 有反馈。

（主观体验由用户本人在浏览器上手判断；子代理只做上面的客观构建断言。）

- [ ] **Step 4: 收尾 commit（如有手动调整）**

若验收中发现小问题并修改，相应 commit；否则跳过。

---

## Self-Review

**Spec 覆盖：**
- 素材存放 `src/assets/sample/` + import 方式 → Task 2 Step 1 ✅
- `?raw` 字幕、aac 走打包器 → Task 2 Step 1 ✅
- `.gitignore` 取反 → Task 1 Step 1 ✅
- PWA glob 加 aac → Task 1 Step 2 ✅
- App 抽共用函数 + loadSample + 模板绑定 → Task 2 ✅
- SentenceList 按钮 + emit → Task 3 ✅
- styles.css 按钮 → Task 4 ✅
- 双轨构建验证 → Task 5 Step 1-2 ✅
- 手动验收 → Task 5 Step 3 ✅

无遗漏。

**Placeholder 扫描：** 无 TBD/TODO；所有代码步骤都给了完整代码；命令给了期望输出。

**类型/命名一致：** `applySubtitle(text)`、`applyMediaSrc(url, name, kind)`、`loadSample()`、emit 事件名 `'sample'`、类名 `.empty-sample-btn`、import 名 `sampleSrt`/`sampleAudio` —— 全程一致。`@sample="loadSample"` 与 `emit('sample')` 对齐。
