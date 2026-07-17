# 字幕音频播放器 批次一设计文档（三栏布局 + 词库内置 + 分级勾选）

> 日期：2026-07-17
> 状态：待审阅（技术栈调整为 Vue + Vite）
> 基线：`docs/superpowers/specs/2026-07-17-srt-audio-player-design.md`（第一版）

> **2026-07-17 技术栈调整**：实现栈从「纯原生 ES module + 手写 build.js」改为 **Vue 3 + Vite**。
> 理由：(1) Vite 的 `vite build` 天然打包 ES 模块，消灭原计划 Task 8 手写"内联模块"的脆弱文本转换；
> (2) 词库内置从 `window.__VOCAB__` 注入 + fetch 兜底，简化为 `import vocab from './vocabulary.json'`（Vite 原生 JSON 导入）；
> (3) Vue 响应式让"分级勾选 → 右栏刷新"核心交互声明式化，后续批次（视频/字幕微调）扩展更轻松。
> 纯逻辑模块（srt-parser/word-lookup/player/vocab-store）框架无关，已完成的不动；废弃的仅 ui.js/main.js 这层 UI 胶水与未写的 build.js。交付物仍为单文件 `dist/index.html`（经 `vite-plugin-singlefile` 内联）。

## 1. 背景

第一版（已交付，分支 `feature/srt-audio-player`）实现了：上传 SRT + 音频 + 词库 → 点句子播放对应片段 + 右栏显示命中单词。

用户实测后发现核心价值在于**主动点读**（先读句再听），而非被动听力。本次迭代（批次一）聚焦**布局重构 + 词库内置 + 分级控制**，为后续托管到 GitHub Pages 做准备。批次二（媒体支持 + 字幕微调）另起设计。

## 2. 目标（批次一范围）

1. **三栏布局**：左操作栏 / 中字幕栏 / 右单词栏。撤掉原顶部按钮栏。
2. **词库内置**：构建时把 `vocabulary.json` 打进 `dist/index.html`，用户无需再选词库文件。
3. **分级勾选**：左栏设置面板里可勾选启用哪些分级（默认全选）。
4. **右栏按级分栏**：命中单词按分级聚集显示，每级一个标题 + 单词列表；不显示分级小标签了；未命中或未勾选的分级不显示该栏。

## 3. 非目标（YAGNI，本批不做）

- 视频支持（批次二）。
- 字幕时间戳微调（批次二）。
- 文件管理功能（左栏预留，本批只放设置）。
- 词库云端更新、用户自定义词库（内置即固定，更新靠重新构建）。
- 词库分级的新增/编辑（只读勾选）。

## 4. 架构变更

**Vue 3 + Vite**。开发用 Vite dev server（热更新），构建用 `vite build` + `vite-plugin-singlefile` 内联成单文件 dist。

文件结构：

```
（项目根目录）
├── package.json            # 依赖：vue, vite, @vitejs/plugin-vue, vite-plugin-singlefile
├── vite.config.js          # Vite 配置：Vue 插件 + singlefile 内联
├── index.html              # Vite 入口：<div id="app"> + <script type="module" src="/src/main.js">
├── src/
│   ├── main.js             # createApp(App).mount('#app')
│   ├── App.vue             # 三栏布局主组件 + 全局状态（reactive/ref）
│   ├── components/
│   │   ├── SettingsPanel.vue   # 左栏：分级勾选 + 文件入口
│   │   ├── SentenceList.vue    # 中栏：句子列表（含视频区占位）
│   │   └── WordPanel.vue       # 右栏：按级分栏单词
│   ├── styles.css          # 三栏 + 面板 + 分栏样式（第一版 CSS 基本沿用）
│   ├── vocabulary.json     # 词库（App.vue 内 import 内置）
│   ├── srt-parser.js       # 不变（纯函数 ES module）
│   ├── word-lookup.js      # 不变（纯函数 ES module）
│   ├── player.js           # 不变（Player 类，框架无关）
│   └── vocab-store.js      # 不变（createVocabStore，框架无关）
└── dist/
    └── index.html          # vite build 产物（singlefile 内联，含词库）
```

### 模块职责

**纯逻辑层（框架无关，已完成、不动）：**
- `srt-parser.js`：`parseSRT`/`timestampToSeconds`
- `word-lookup.js`：`buildVocab`/`lookupWords`
- `player.js`：`Player` 类（操作 `<audio>` 元素，由 Vue 模板的 ref 提供）
- `vocab-store.js`：`createVocabStore(buildVocab, lookupWords)` 管词库 + 分级勾选 + 按级查询

**UI 层（Vue，新建）：**
- `App.vue`：三栏布局；持有全局响应式状态（store 实例、当前句、音频名等）；组合三个子组件。
- `SettingsPanel.vue`：渲染分级勾选（从 store.getLevels()/isEnabled），勾选变更写回 store 并触发响应式刷新；文件入口（字幕/音频，视频批次二）。
- `SentenceList.vue`：渲染句子列表，点击触发播放 + 高亮；顶部留视频区占位（批次二填）。
- `WordPanel.vue`：按 store 分级顺序渲染命中单词分栏（分级名标题 + 词数，无小标签）。

**废弃**：原 `ui.js`（手写 DOM 渲染）、原 `main.js`（手写事件装配）、`build.js`（手写内联）。

### 数据流

1. `App.vue` 加载时 `import vocab` → `createVocabStore(buildVocab, lookupWords)` → `store.init(vocab)`。store 作为响应式状态供组件用。
2. SettingsPanel 选 SRT → `parseSRT` → sentences 响应式更新 → SentenceList 自动渲染。
3. 选音频 → `URL.createObjectURL` → Player.setSrc。
4. 点句子 → 设当前句（响应式）→ SentenceList 高亮（computed）+ WordPanel 内容（computed: store.lookupByLevel）+ Player.playSegment。
5. 勾选分级变化 → 写回 store → WordPanel 的 computed 自动重算刷新（Vue 响应式，无需手动调 refresh）。

## 5. 关键实现要点

### 5.1 词库内置（Vite JSON 导入）

`App.vue` 顶部 `import vocab from './vocabulary.json'`（Vite 原生支持 JSON 导入，默认全量打包进 bundle）。开发与构建同源，不再需要 `window.__VOCAB__` 注入 + fetch 兜底的双轨方案。`store.init(vocab)` 直接用。

### 5.2 分级勾选状态（vocab-store + Vue 响应式）

- 分级顺序固定：`初中 / 高中 / 四级 / 六级 / 考研 / 托福 / SAT`（取自词库 key 顺序）。
- 默认全选。
- vocab-store 本身是普通对象（非响应式）；App.vue 用 `reactive` 包裹勾选状态或用一个 `ref` 镜像，使勾选变化能触发 Vue 重渲染。勾选变化时调 `store.setEnabled`，WordPanel 的 computed 依赖该响应式源，自动重算。
- 本批不持久化到 localStorage（刷新即重置）；持久化留待后续。

### 5.3 按级查询（vocab-store.lookupByLevel）

复用 `lookupWords` 得到扁平 `Word[]`，再按 `word.level` 分组成 `{level: Word[]}`，**只保留已勾选的分级**，且**保留句中出现的顺序**（每级内按单词在句中首次出现排序）。

### 5.4 右栏分栏渲染（WordPanel.vue）

- 用 computed：`groups = store.lookupByLevel(currentSentence.text)`。
- 遍历 `store.getLevels()` 顺序，对该级有命中单词的，渲染一个分栏：标题（分级名 + 该级词数）+ 单词列表（单词 + 释义，无小标签）。
- 无命中的分级不渲染该栏。
- 句中无任何命中词时显示占位"当前句没有词库中的单词"。
- 勾选/切句变化 → computed 自动重算 → DOM 自动更新（无需手动 refresh）。

### 5.5 三栏布局（styles）

- 沿用第一版三栏 CSS（已在 Task 5 完成的 `src/styles.css`，Vue 项目里作全局样式 import）。
- 整页 `display:flex`，横向三栏。左栏 220px（设置+文件）；中栏 `flex:1`（上方视频占位 + 下方句子）；右栏 300px（分栏单词）。
- 窄屏（<900px）本批不做专门适配，桌面优先。

### 5.6 构建为单文件（vite + vite-plugin-singlefile）

- `vite.config.js` 启用 `vite-plugin-singlefile`：`build` 时把所有 JS/CSS 内联进 `dist/index.html`，产出真正的单文件。
- `base` 配置：默认 `'/'`；若部署到 GitHub Pages 子路径（`user.github.io/repo/`）需设 `base: '/repo/'`。本批先用默认，部署时再调。
- 词库 JSON（~1.6MB）经 import 打包后内联进 dist，单文件体积约 1.7MB+。

## 6. UI / 布局

```
┌─────────┬───────────────────────┬─────────────┐
│ 操作栏   │   中栏                 │  单词栏      │
│         │ ┌───────────────────┐ │             │
│ ⚙ 设置   │ │ [视频区占位·批次二] │ │ 四级 (3)    │
│ □ 初中   │ │                   │ │  compress   │
│ □ 高中   │ └───────────────────┘ │   v. 压缩    │
│ ☑ 四级   │ 句子列表（可滚动）      │  naturally  │
│ ☑ 六级   │ [00:00] ▶ 句1         │   adv. 当然  │
│ □ 考研   │ [00:05]   句2         │             │
│ □ 托福   │ [00:12]   句3 ◀ 高亮  │ 初中 (5)    │
│ □ SAT   │ [00:20]   句4         │  encode      │
│         │ ...                  │   v. 编码    │
│ ───文件──│                      │  wonder      │
│ 字幕▢   │                      │   v. 想知道   │
│ 音频/视频▢                    │             │
└─────────┴───────────────────────┴─────────────┘
```

- 左栏分两块：上方"设置"（分级勾选），下方"文件"（选字幕 + 选音频；视频入口批次二加，本批先留位）。
- 当前句：中栏浅蓝高亮；播放中图标红 ⏸，其余 ▶。
- 设置勾选变更：实时影响右栏（若已有选中句）。

## 7. 错误处理

| 情况 | 处理 |
|------|------|
| 词库 JSON 导入/解析异常 | 构建期 Vite 报错（开发时即发现）；运行期不会缺词库 |
| SRT/音频解析失败 | 沿用第一版：状态条红字提示，不崩 |
| 全部分级被取消勾选 | 右栏占位"未勾选任何分级" |

## 8. 测试

- **纯函数**（srt-parser / word-lookup / vocab-store）：沿用已有 `test.html`（26 断言，已完成），不重测。框架无关模块继续用此测试页。
- **Vue 组件**：以手动浏览器验收为主（§9）；不引入组件单测框架（YAGNI，本批组件简单）。
- **构建产物**：验证 dist 自包含（见 §9 第 8 条）。

## 9. 验收标准（手动，用真实文件）

1. `npm run dev` 起开发服务器；页面三栏。
2. 左栏有 7 个分级勾选项（默认全选）。
3. 选 SRT + 音频 → 中栏出句子列表。
4. 点句子 → 播放 + 高亮 + 右栏按级分栏显示命中词（无分级小标签，分级名作栏标题）。
5. 在左栏取消勾选"四级" → 右栏立即不再显示四级那栏（若当前句有四级词）。
6. 取消所有勾选 → 右栏显示"未勾选任何分级"。
7. `npm run build` → 产出 `dist/index.html`。
8. dist/index.html 单文件可独立拷走使用（不依赖 vocabulary.json、不依赖 node_modules）；体积约 1.7MB+（词库主导）。

## 10. 文件产出

- 新增：`package.json`、`vite.config.js`、`src/App.vue`、`src/components/{SettingsPanel,SentenceList,WordPanel}.vue`
- 改：`index.html`（改 Vite 入口）、`src/main.js`（改 createApp）、`src/styles.css`（基本沿用，按 Vue 挂载点微调）
- 废弃：`build.js`、原 `src/ui.js`（手写 DOM 版）
- 不变：`src/srt-parser.js`、`src/word-lookup.js`、`src/player.js`、`src/vocab-store.js`、`test.html`
- 构建产物：`dist/index.html`（singlefile 内联，含词库）

## 11. 构建与使用

- 开发：`npm install`（首次）→ `npm run dev` → 浏览器开 Vite 给的地址（默认 http://localhost:5173）。
- 构建：`npm run build` → `dist/index.html`（单文件，含词库与内联 JS/CSS）。
- 日常/托管：用 `dist/index.html`，单文件可托管到 GitHub Pages（子路径部署时调 `vite.config.js` 的 `base`）。

## 12. 与批次二的衔接

本批在中栏顶部预留"视频区占位"div；批次二填充视频元素与控制。左栏"文件"区本批只放字幕+音频入口，批次二加视频入口和字幕微调参数。三栏布局结构本批即定型，批次二不动骨架。
