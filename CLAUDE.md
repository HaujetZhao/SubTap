# CLAUDE.md — 字幕音频播放器（英语主动点读工具）

> 本文件给协作的 AI 助手看，帮助新会话快速上手。用户全局偏好见 `~/.claude/CLAUDE.md`（中文、Windows、PowerShell/bash）。

## 项目是什么

一个纯前端网页工具，用于**主动点读学英语**：载入 SRT 字幕 + 音视频，点击任意句子播放对应片段，配合内置分级词库给句子里的单词按难度**着色高亮**。核心理念是"先主动阅读句子、再点听"，区别于被动听力（容易犯困）。

构建产物是**单文件 `dist/index.html`**（词库内置），可直接托管到 GitHub Pages。

## 开发命令

```bash
npm install          # 首次装依赖
npm run dev          # 开发服务器 http://localhost:5173
npm run build        # 构建单文件 → dist/index.html（vite-plugin-singlefile 内联）
```

- **ES module 需 http 加载**：开发页 `index.html` 和 `test.html` 不能 `file://` 直接双击，要用 `npm run dev` 或 `python -m http.server 8000`。
- `dist/index.html` 是内联单文件，可双击直接打开。
- Shell 是 bash（Windows 上），用正斜杠路径；中文文件名注意加引号。

## 架构

**纯逻辑层（框架无关的 ES module，可独立单测，放 `src/`）：**

| 文件 | 职责 |
|------|------|
| `srt-parser.js` | `parseSRT(text)`→`Sentence[]`、`timestampToSeconds(ts)` |
| `word-lookup.js` | `buildVocab`、`lookupWords`、`tokenizeForRender`（中栏渲染，保留标点+超纲）、`classifyWords`（右栏分组，去重+超纲）；内部 `resolve(tok,vocab)` 先查原词、未命中再试 `lemmatize` 候选，命中项 `word` 存**原形**；单字母 token（噪声）过滤 |
| `lemmatize.js` | `lemmatize(word)→string[]`：不规则动词表 + 后缀规则把变形（raises/running/studies/went）还原成原形候选（移植自 `分级单词提取.py`）；含撇号还原缩约（don't→do、it's→it）与所有格（letters'→letter）；单字母不处理 |
| `vocab-store.js` | `createVocabStore(buildVocab, classifyWords)` 工厂：词库+分级(含超纲)+勾选+`getVocab()`+`lookupByLevel` |
| `player.js` | `Player` 类：区间播放，**用 `requestAnimationFrame` 精准停播**（一帧精度，非 timeupdate 的 ~250ms） |
| `subtitle-tweak.js` | `computeEffectiveRanges(sentences,{offset,extend,linkNext})` 有效区间 |
| `level-colors.js` | `LEVEL_COLORS`（8 级 → hex，集中配色） |

**UI 层（Vue 3 `<script setup>`）：**

| 文件 | 职责 |
|------|------|
| `main.js` | `createApp(App).mount('#app')` |
| `App.vue` | 三栏布局 + 全局状态（store、enabled 镜像、highlightOn、mediaKind、微调参数、renderedSentences computed） |
| `components/SettingsPanel.vue` | 左栏：分级勾选（带颜色圆点）+ 背景色总开关 + 字幕微调 + 文件入口 |
| `components/SentenceList.vue` | 中栏：句子按 token 渲染 span，勾选级别的词背景着色；视频区(拖拽/收起) |
| `components/WordPanel.vue` | 右栏：命中词按级分栏，标题用级别色 |

**不变量：** 改 UI 时尽量不动纯逻辑层；纯逻辑层无 Vue/DOM 依赖（`player.js` 仅接收注入的 media 元素）。

## 关键约定（容易踩坑）

1. **响应式镜像模式**：`vocab-store` 内部状态非响应式；App 维护 `reactive(enabled)` 镜像，`onToggleLevel` **同时**更新镜像和 `store.setEnabled`。WordPanel 的 `groups` computed 用 `void props.enabled[lv]` 显式 touch 建立依赖，否则勾选变化不触发右栏刷新。
2. **renderedSentences 缓存**：computed 仅依赖 `sentences`（tokenize 结果缓存）；勾选/高亮开关变化只改 span 的 `:style`，不重建 token。597 句性能 OK。
3. **高亮跟随勾选**：`enabled` 同时驱动中栏背景（SentenceList `tokStyle`）和右栏显隐（WordPanel `visibleLevels`）。
4. **音视频收展**：`mediaKind==='video'` 才显示视频区；音频/无媒体时 `.video-slot.no-video{display:none}`（`<video>` 元素仍在 DOM，display:none 可继续播音频）。音频不可展开。
5. **超纲分级**：不在词库的词归"超纲"，`def` 为空，右栏只列词。
6. **词库内置**：`App.vue` 顶部 `import vocab from './vocabulary.json'`（Vite 原生 JSON 导入），无需用户上传。

## 数据

- `src/vocabulary.json`：两级结构 `{level: {word: 释义}}`，7 级（初中/高中/四级/六级/考研/托福/SAT），约 34000 词。**入库**（构建期内置）。
- 测试素材（`【官方双语】….{srt,mp3,m4a}`）**不入库**（`.gitignore` 忽略媒体/字幕），本地测试用。
- `分级单词提取.py`：生成 vocabulary.json 的脚本（独立工具链，与网页项目无关）。

## 测试

- `test.html`：纯函数浏览器测试页（srt-parser/word-lookup/vocab-store/subtitle-tweak 断言）。需 http 访问：开发时 `npm run dev` 后开 `http://localhost:5173/test.html`，或 `python -m http.server`。
- 纯函数也可用 Node 动态 import 验证（注意 Windows ESM 绝对路径要 `file://`，或用项目内临时 `.mjs` 跑相对路径，CJK 安全）。
- UI/交互靠手动浏览器验收。

## 开发流程（本项目沿用 superpowers 工作流）

迭代新功能时遵循：`brainstorming`（对齐需求）→ 写 spec 到 `docs/superpowers/specs/` → `writing-plans` 写计划到 `docs/superpowers/plans/` → `subagent-driven-development`（每 Task 派子代理 + spec/quality 双评审）→ 最终整体评审 + 真实数据验证。

已有三批文档在 `docs/superpowers/`：
- 批次一：三栏布局 + 词库内置 + 分级勾选
- 批次二：视频支持 + 字幕时间微调
- 批次三：颜色高亮系统 + 超纲分级 + 音视频收展

## 当前状态

- 分支 `feature/srt-audio-player`（**未合并 master**，未推送）。
- 三批功能完成、构建通过、真实数据验证通过。
- 待办（用户反馈驱动）：颜色深浅微调、超纲灰可能偏淡、可能的虚拟滚动（若字幕极大卡顿）。
