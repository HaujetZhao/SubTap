# CLAUDE.md — SubTap · 字幕点读器（英语学习助手）

> 本文件给协作的 AI 助手看，帮助新会话快速上手。用户全局偏好见 `~/.claude/CLAUDE.md`（中文、Windows、PowerShell/bash、优先用 subagent）。

## 项目是什么

一个纯前端网页工具，用于**主动点读学英语**：载入字幕 + 音视频，点击任意句子播放对应片段，配合内置分级词库给句子里的单词按难度**着色高亮**。核心理念是"先主动阅读句子、再点听"，区别于被动听力（容易犯困）。没有音视频时，可选「语音朗读」让浏览器朗读点选的句子。

- 中文名 **字幕点读器**，英文名 **SubTap**（GitHub 仓库 `HaujetZhao/SubTap`，小写）。
- 在线：<https://haujetzhao.github.io/SubTap/>（GitHub Actions 自动构建部署）。
- 离线单文件：Release 资产 `SubTap.html`（由 release 工作流生成）。

## 开发命令

```bash
npm install          # 首次装依赖
npm run dev          # 开发服务器 http://localhost:5173
npm run build        # 构建单文件 → dist/index.html（vite-plugin-singlefile 内联）
```

- **ES module 需 http 加载**：开发页 `index.html` 和 `test.html` 不能 `file://` 直接双击，要用 `npm run dev` 或 `python -m http.server 8000`。`dist/index.html` 是内联单文件，可双击直接打开。
- **`dist/` 不入库**（`.gitignore` 忽略），由 GitHub Actions 构建并部署/发布。本地 `npm run build` 仅用于自测。
- Shell 是 bash（Windows 上），用正斜杠路径；中文文件名注意加引号。

## 架构

**纯逻辑层（框架无关的 ES module，可独立单测，放 `src/`）：**

| 文件 | 职责 |
|------|------|
| `srt-parser.js` | `parseSRT(text)`→`Sentence[]`：**经第三方库 [subsrt](https://github.com/papnkukn/subsrt) 解析**，自动识别 SRT/VTT/ASS/SSA/SUB/SBV/SMI；内部做 LF→CRLF 预处理（规避 subsrt 对 LF 换行的解析 bug）；**LRC 不支持**（`detect` 命中即返回 `[]`，因其无逐句结束时间）。仍导出 `timestampToSeconds(ts)`（test.html 用） |
| `word-lookup.js` | `buildVocab`、`tokenizeForRender`（中栏渲染，保留标点+超纲）、`classifyWords`（右栏分组，去重+超纲）；内部 `resolve` 先查原词、未命中再试 `lemmatize` 候选，命中项 `word` 存**原形**；单字母 token 过滤 |
| `lemmatize.js` | `lemmatize(word)→string[]`：不规则动词表 + 后缀规则把变形还原成原形候选（移植自 `分级单词提取.py`）；含缩约/所有格还原；单字母不处理 |
| `vocab-store.js` | `createVocabStore` 工厂：词库+分级(含超纲)+勾选+`getVocab()`+`lookupByLevel` |
| `player.js` | `Player` 类：区间播放，**前台 `requestAnimationFrame` 精准停播**（~16ms），**后台 tab 用 `timeupdate` 兜底**（rAF 后台被浏览器暂停，故媒体自身时钟兜底到点停，~250ms） |
| `subtitle-tweak.js` | `computeEffectiveRanges(sentences,{offset,extend,linkNext,linkNextOffset})`：linkNext 与 extend 互斥（linkNext 优先） |
| `level-colors.js` | `LEVEL_COLORS`（8 级 → hex，集中配色） |

**UI 层（Vue 3 `<script setup>`）：**

| 文件 | 职责 |
|------|------|
| `main.js` | `createApp(App).mount('#app')` |
| `App.vue` | 三栏布局 + 全局状态（store、`enabled` 镜像、`highlightOn`、`tts*`、`offset/endMode/endOffset`、`mediaKind`、`toasts`；`renderedSentences`/`effectiveRanges` computed；toast、TTS、区间播放逻辑） |
| `components/SettingsPanel.vue` | 左栏：**文件置顶**（打开字幕 / 打开音/视频，主色实心按钮）→ **词库分级**（药丸开关 + 彩色圆点）→ **功能开关**（词汇提示 / 语音朗读，后者展开 语言/声音/语速 子选项）→ **字幕微调**（句首偏移 + 句末模式可点切换 句末偏移↔句末衔接，共用偏移） |
| `components/SentenceList.vue` | 中栏：句子按 token 渲染 span、勾选级别的词背景着色、选中句描边；**空载时显示引导页**（品牌/三步上手/快捷键/仓库链接）；视频区(拖拽/收起) |
| `components/WordPanel.vue` | 右栏：命中词按级分栏、词卡 + 数量药丸 |

**不变量：** 改 UI 时尽量不动纯逻辑层；纯逻辑层无 Vue/DOM 依赖（`player.js` 仅接收注入的 media 元素）。样式集中在 `styles.css` 的 `:root` 设计 token（配色/圆角/阴影）。

## 关键约定（容易踩坑）

1. **响应式镜像模式**：`vocab-store` 内部状态非响应式；App 维护 `reactive(enabled)` 镜像，`onToggleLevel` **同时**更新镜像和 `store.setEnabled`。WordPanel 的 `groups` computed 用 `void props.enabled[lv]` 显式 touch 建立依赖。
2. **renderedSentences 缓存**：computed 仅依赖 `sentences`；勾选/高亮开关变化只改 span 的 `:style`，不重建 token。
3. **微调模型**：UI 用 `endMode`('extend'|'linkNext') + `endOffset`（两者共用）；`effectiveRanges` computed 按模式映射成底层 `{extend}` 或 `{linkNext, linkNextOffset}`。subtitle-tweak.js 本身未改。
4. **toast**：`notify(msg, type)` 先**同文案去重**（关旧弹新，避免连点堆叠）；成功/错误均 2.5s 自动消失；hover 暂停（JS timer + CSS `animation-play-state`）；点击/× 立即关。
5. **语音朗读 (TTS)**：`ttsOn` 开启且**无媒体**时，点句用 `speechSynthesis` 朗读（取双语首行英文）；`voices` 异步加载（`onvoiceschanged`）；设置 `lang/rate/voice`。`→/空格`、切句、载入字幕/媒体、关 tts 均会 `cancel()`。
6. **键盘播放控制**：全局 `keydown`（焦点在 `input/textarea` 时不拦截）——`↓/↑` 下/上一句、`←` 重读当前句、`→/空格` 结束（同时停 media 和 speech）。`playSentence()` 是点击与键盘共用入口。
7. **按需滚动**：`SentenceList.ensureVisible()` 仅当当前选中句不在视窗内才滚到顶部；只在键盘 ↑↓ 切换后调用。
8. **自定义 tooltip**：`.tip` 深色药丸（`mode-toggle` 与 `level-pill` 共用），hover 即时出现 + 淡入；关闭态淡化只作用于圆点/文字，不影响 tooltip。
9. **subsrt 生产构建坑**：subsrt 用动态 `require('./format/'+名+'.js')`，Rollup 无法静态解析 → 必须在 `vite.config.js` 配 `build.commonjsOptions.dynamicRequireTargets: ['node_modules/subsrt/lib/format/*.js']`，否则构建产物运行时抛 "Could not dynamically require"、整页空白（dev 用 esbuild 不暴露此问题）。

## 数据

- `src/vocabulary.json`：两级结构 `{level: {word: 释义}}`，7 级（初中/高中/四级/六级/考研/托福/SAT），约 34000 词。**入库**（构建期内置）。
- `分级单词提取.py`：生成 vocabulary.json 的脚本（独立工具链，与网页项目无关）。
- 测试素材（`【官方双语】….{srt,mp3,m4a}`）与各格式测试文件（`*.vtt/*.ass/...`）**不入库**（`.gitignore` 忽略）。

## CI / 部署

- `.github/workflows/deploy.yml`：push 到 `main` → `npm ci && npm run build` → 部署到 GitHub Pages（<https://haujetzhao.github.io/SubTap/>）。仓库 Settings → Pages → Source = "GitHub Actions"。
- `.github/workflows/release.yml`：push `v*` 标签 → 构建 → 把 `dist/index.html` 重命名为 `SubTap.html` 附到对应 Release。README 离线链接指向 `releases/latest/download/SubTap.html`。
- `vite.config.js`：`base:'./'`（适配子路径）+ `commonjsOptions.dynamicRequireTargets`（见上 #9）。

## 测试

- `test.html`：纯函数浏览器测试页（srt-parser/word-lookup/vocab-store/subtitle-tweak 断言）。需 http 访问：`npm run dev` 后开 `http://localhost:5173/test.html`。
- UI/交互靠手动浏览器验收（可配合 Playwright MCP）。

## 开发流程（本项目沿用 superpowers 工作流）

`brainstorming` → 写 spec 到 `docs/superpowers/specs/` → `writing-plans` → `subagent-driven-development`（每 Task 派子代理 + spec/quality 双评审）→ 整体评审 + 真实数据验证。

`docs/superpowers/` 现有四批：
- 批次一：三栏布局 + 词库内置 + 分级勾选
- 批次二：视频支持 + 字幕时间微调
- 批次三：颜色高亮系统 + 超纲分级 + 音视频收展
- 批次四：UI 现代化重设计（Notion/Stripe 风 + 设计 token + toast + 空载引导页）

## 当前状态

- 分支 `main`，已推送到公开仓库 `github.com/HaujetZhao/SubTap`。
- 四批功能完成；多格式字幕(subsrt)、语音朗读(TTS)、toast、CI 自动构建部署均已落地。
- 在线版由 GitHub Actions 自动重建。
