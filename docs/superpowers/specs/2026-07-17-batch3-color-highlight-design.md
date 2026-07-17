# 字幕音频播放器 批次三设计文档（颜色高亮系统 + 超纲分级 + 音视频收展）

> 日期：2026-07-17
> 状态：待审阅
> 基线：批次二（视频支持 + 字幕微调，已交付）

## 1. 背景与目标

批次二完成后，本批增强"主动阅读"体验：用颜色把句子里的词按难度分级**视觉化**，让用户一眼看到哪些词该关注。

四项目标：
1. **超纲分级**：句子中不在词库的词归为"超纲"，与 7 个库级并列，共 8 级。
2. **颜色高亮**：每级一色；中栏字幕里**勾选级别**的词背景填该色；右栏分级标题用该色。
3. **高亮跟随勾选**：取消勾选某级 → 该级词中栏不高亮、右栏不显示（一致的"关注"控制）。
4. **音视频默认收展**：音频默认收起且**不可展开**；视频默认展开，高度为视窗一半。

## 2. 非目标（YAGNI）

- 颜色自定义/编辑（先用固定配色，后续微调）。
- 虚拟滚动（本批不做；若超大字幕卡顿再加）。
- 超纲词的释义（超纲不在词库，无释义；右栏超纲栏只列词）。
- 高亮开关持久化（刷新即重置）。

## 3. 颜色系统

新增 `src/level-colors.js`，导出 `LEVEL_COLORS`（level → hex）：

| 级别 | 色 | 级别 | 色 |
|------|------|------|------|
| 初中 | `#16a34a` 绿 | 考研 | `#ea580c` 橙 |
| 高中 | `#0891b2` 青 | 托福 | `#dc2626` 红 |
| 四级 | `#2563eb` 蓝 | SAT | `#db2777` 粉 |
| 六级 | `#7c3aed` 紫 | 超纲 | `#6b7280` 灰 |

- 词背景：`hex + '26'`（约 15% 透明）。
- 分级标题：纯 hex。
- 颜色后续可微调，集中在该文件。

## 4. 架构变更

延续 Vue 3 + Vite。新增颜色映射与两个 tokenize 纯函数；扩展 vocab-store（加超纲级 + 暴露 vocab）；UI 层渲染高亮。

文件改动：

```
src/
├── level-colors.js        # 【新】LEVEL_COLORS 常量
├── word-lookup.js         # 改：新增 tokenizeForRender + classifyWords（保留 lookupWords/buildVocab）
├── vocab-store.js         # 改：levels 加超纲；默认值；getVocab()；lookupByLevel 用 classifyWords 含超纲
├── App.vue                # 改：默认勾选值；高亮开关 ref；音视频收展；renderedSentences computed；传 props
├── components/
│   ├── SentenceList.vue   # 改：句子按片段渲染 span + 背景色
│   ├── SettingsPanel.vue  # 改：新增"背景色突出"开关
│   └── WordPanel.vue      # 改：分级标题用颜色
└── styles.css             # 改：词高亮 span 样式（可选，主要用内联 style）
```

不变：player.js、subtitle-tweak.js、srt-parser.js、vocabulary.json、test.html（word-lookup 新增函数可补测）。

### 新增纯函数（word-lookup.js）

```js
// 中栏渲染用：句子 → 片段数组（按位置，保留标点/空格，不去重）
// 每片段 { text, level }；level = 命中级 / '超纲' / null（非词）
export function tokenizeForRender(text, vocab) { ... }

// 右栏分组用：句子 → {level: Word[]}（去重，含超纲组；超纲词 def=''）
export function classifyWords(text, vocab) { ... }
```

两者都依赖 vocab 大表。lookupWords/buildVocab 保留不动（test.html 仍用）。

### vocab-store 扩展

- `getLevels()` 返回 7 库级 + `'超纲'`（超纲在末尾）。
- `init` 默认勾选：初中/高中/四级 = **false**；六级/考研/托福/SAT/超纲 = **true**。
- `getVocab()`：返回内部大表（供 App 的 tokenize 使用）。
- `lookupByLevel(text)`：改用 `classifyWords`，返回含超纲组，过滤未勾选级。

## 5. 关键实现要点

### 5.1 中栏高亮渲染

- App 新增 `renderedSentences = computed(...)`：`sentences.value.map(s => ({ ...s, tokens: tokenizeForRender(s.text, vocab) }))`。仅依赖 sentences（vocab 不变），tokenize 结果缓存；勾选/高亮开关变化不重算 tokens。
- SentenceList 接收 `renderedSentences` + `enabled` + `highlightOn` + `colors`。
- 句子文本从单个 `<span>{{text}}</span>` 改为：`v-for tok in s.tokens` → 每个 token 一个 span，`:style` 背景 = `(highlightOn && tok.level && enabled[tok.level]) ? colors[tok.level] + '26' : 'transparent'`。
- XSS 安全：token 文本用 `{{ tok.text }}`（Vue 转义）。

### 5.2 高亮跟随勾选

- 勾选状态 `enabled`（reactive 镜像）同时驱动：中栏 span 背景显隐 + 右栏分组显隐。
- 总开关 `highlightOn`（ref，默认 true）只控中栏：关 → 所有 span 背景透明（纯文本观感）；右栏不受影响。

### 5.3 右栏分级标题颜色

- WordPanel 的 `<h4>` 加 `:style="{ color: colors[level] }"`。

### 5.4 音视频默认收展（App.onMediaFile）

- 判断 `file.type.startsWith('video/')` → 视频；否则音频。
- **视频**：`mediaKind='video'`、`videoCollapsed=false`、`videoHeight=window.innerHeight/2`。
- **音频**：`mediaKind='audio'`、`videoCollapsed=true`（slot 整体隐藏，见下）。
- video-slot 显示条件：`mediaKind === 'video'`（音频/无媒体时 slot `display:none`，video 元素仍在 DOM 可播音频）。**音频时 slot 隐藏 ⇒ 收起/展开/拖拽控件都不存在 ⇒ 无法展开**，符合"音频不可展开"。

### 5.5 默认勾选状态

App 初始化 `enabled` 镜像时与 store 默认值一致（初中/高中/四级=false，其余=true）。store.init 已设默认；App 镜像从 store.isEnabled 读取（不再写死全 true）。

## 6. UI / 布局

```
┌─操作─┬───────────────────────┬─单词─┐
│ 词库  │ ┌──视频（视频时才显示）──┐│      │
│ 分级  │ │ ▶ [画面]         〔收起〕││ 四级 │← 标题蓝色
│ ☐初中│ │ ───拖拽手柄───          ││ ... │
│ ☐高中│ └───────────────────────┘│      │
│ ☐四级│ 句子列表（词按级着色背景）  │ 超纲 │← 标题灰色
│ ☑六级│ [00:00] ▶ encode text...  │  ... │
│ ☑考研│   (六级词紫底/超纲词灰底) │      │
│ ☑托福│ [00:05]   ...             │      │
│ ☑SAT │                           │      │
│ ☑超纲│                           │      │
│ ───  │                           │      │
│ ☑背景色突出│                     │      │
│ ───  │                           │      │
│ 字幕微调│                        │      │
│ 文件  │                           │      │
└─────┴───────────────────────┴─────┘
```

- 音频时：视频区不显示（无收起/展开控件），中栏字幕占满。
- 视频时：视频区显示，可拖拽/收展。

## 7. 错误处理

| 情况 | 处理 |
|------|------|
| 颜色映射缺某级 | 渲染时 `colors[level]` 为 undefined → 背景透明（不崩）；标题色默认继承 |
| 超纲无释义 | 右栏超纲词 `def` 为空，只显示词 |
| tokenize 空文本 | 返回空片段数组，句子渲染为空 |

## 8. 测试

- **纯函数**（word-lookup 新增）：扩展 test.html，对 `tokenizeForRender`（保留标点/位置、命中/超纲/null）、`classifyWords`（去重、含超纲组）加断言；Node 复现验证。
- vocab-store：超纲加入 levels、默认值、lookupByLevel 含超纲——可补断言。
- 颜色/UI/音视频收展：手动浏览器验收。

## 9. 验收标准（手动）

1. `npm run dev` → 左栏 8 个级别（含超纲），初中/高中/四级默认未勾选，其余勾选；新增"背景色突出"开关（默认开）。
2. 选 SRT → 中栏句子里，**勾选级别**的词有对应色背景（如六级紫、超纲灰）；未勾选级别（初中等）的词无背景。
3. 取消勾选"超纲" → 中栏超纲词背景消失、右栏超纲栏消失。
4. 关"背景色突出" → 中栏全部词无背景（纯文本）；右栏不变。
5. 右栏每个分级标题用对应颜色。
6. 选**音频** → 视频区不显示、无法展开；中栏字幕占满。
7. 选**视频** → 视频区显示、默认高度=视窗一半、可拖拽/收展。
8. `npm run build` → dist/index.html 单文件。

## 10. 文件产出

- 新增：`src/level-colors.js`
- 改：`src/word-lookup.js`、`src/vocab-store.js`、`src/App.vue`、`src/components/{SentenceList,SettingsPanel,WordPanel}.vue`、`src/styles.css`、`test.html`
- 不变：player.js、subtitle-tweak.js、srt-parser.js、vocabulary.json
- 构建产物：`dist/index.html`
