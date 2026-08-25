# CLAUDE.md — SubTap · 字幕点读器（英语学习助手）

> 给协作的 AI 助手看。用户全局偏好见 `~/.claude/CLAUDE.md`（中文、Windows、bash、优先用 subagent）。

## 项目是什么

纯前端网页工具，**主动点读学英语**：载入字幕 + 音视频，点句播放对应片段，内置分级词库给单词按难度着色高亮。无音视频时可用 TTS 朗读。仓库 `HaujetZhao/SubTap`；在线版 GitHub Pages（Actions 自动部署），离线单文件 `SubTap.html`（Release 资产）。

## 开发命令

```bash
npm run dev          # http://localhost:5173
npm run build        # 单文件 → dist/index.html（Release 用）
npm run build:pwa    # PWA → dist/ 多文件（GitHub Pages 用）
```

- **双轨构建**：PWA 的 SW/manifest 无法内联进单 HTML，故拆两套 vite 配置（`vite.config.js` 单文件 / `vite.config.pwa.js` PWA），不做参数化。PWA 只能 `build:pwa && npm run preview` 验，dev 不生成 SW。
- **VAD 仅 PWA 版可用**：onnx 模型 + ort wasm 体积过大不内联；运行时按需取（SW `CacheFirst` 到 `vad-assets`，取过即离线可用）。模型 `public/models/vad_full.onnx` 入库；wasm `public/ort/` 由 `sync-ort.mjs` 生成、不入库。
- ES module 需 http 加载，`index.html`/`test.html` 不能 `file://` 双击；`dist/index.html` 单文件可双击。
- `dist/`、测试素材不入库。

## 架构

**纯逻辑层（框架无关 ES module，`src/`，无 Vue/DOM 依赖）：**

| 文件 | 职责 |
|------|------|
| `srt-parser.js` | `parseSRT`→`Sentence[]`，经 subsrt 库解析多格式（SRT/VTT/ASS/SSA/SUB/SBV/SMI）；内部 LF→CRLF 预处理（规避 subsrt bug）；LRC 不支持（无逐句结束时间） |
| `word-lookup.js` | `buildVocab`、`tokenizeForRender`（中栏渲染，保留标点+超纲）、`classifyWords`（右栏分组，去重）；`resolve` 先查原词、未命中再试 lemmatize 候选 |
| `lemmatize.js` | 变形→原形候选（不规则动词表 + 后缀规则） |
| `vocab-store.js` | `createVocabStore`：词库+分级+勾选状态 |
| `player.js` | 区间播放；前台 rAF 精准停播，后台 tab 用 `timeupdate` 兜底（rAF 后台被暂停） |
| `subtitle-tweak.js` | `computeEffectiveRanges(sentences,{offset,extend,linkNext,linkNextOffset})`；linkNext 与 extend 互斥（linkNext 优先） |
| `level-colors.js` | `LEVEL_COLORS`（8 级配色） |
| `tts.js` | Web Speech API 封装：`speak`/`stopSpeech`/`loadVoices`/`ttsSupported` |
| `gestures.js` | `createTwoFingerRecognizer`：双指滑动/轻点纯几何识别 |
| `toast.js` | `createToasts()`：toast 队列（去重、自动消失、hover 暂停） |
| `vad.js` | FireRedVAD onnx 流式推理（session、流式分段、后处理、音频解码、资产预取） |

**UI 层（Vue 3 `<script setup>`）**：`App.vue`（三栏布局 + 全局状态 + toast/TTS/区间播放）、`SettingsPanel.vue`（左栏设置）、`SentenceList.vue`（中栏句子渲染 + 空载引导页 + 视频区）、`WordPanel.vue`（右栏分组词卡）。样式集中在 `styles.css` 的 `:root` 设计 token。改 UI 时尽量不动纯逻辑层。

## 关键约定（容易踩坑）

1. **subsrt 生产构建坑**：动态 `require` Rollup 无法静态解析 → 两套 vite 配置都必须配 `build.commonjsOptions.dynamicRequireTargets: ['node_modules/subsrt/lib/format/*.js']`，否则构建产物运行时抛 "Could not dynamically require"、整页空白（dev 用 esbuild 不暴露）。
2. **Vue prop 命名别用全大写缩写词**：`:tts-voice-uri` 会被 Vue 归并成驼峰 `ttsVoiceUri`，prop 声明成 `ttsVoiceURI` 则永远 `undefined`。子组件 `<select>` 用 `:value`+`@change`，别用 computed get/set 做 v-model 桥（`vModelSelect` 时序下显示会回退默认）。
3. **Chrome `getVoices()` 中途会返回空数组**：`loadVoices` 必须空结果不覆盖（`if (list.length)`），否则声音下拉被清空。
4. **Vue 模板不自动解包普通对象里的 ref**：工厂函数返回的对象里的 ref，模板里必须写 `.value`；只有 `<script setup>` 顶层 ref 才自动解包。
5. **响应式镜像**：`vocab-store` 内部状态非响应式；App 维护 `reactive(enabled)` 镜像，`onToggleLevel` 同时更新镜像和 `store.setEnabled`；WordPanel 用 `void props.enabled[lv]` 显式建立依赖。
6. **renderedSentences 缓存**：computed 仅依赖 `sentences`；勾选/高亮开关只改 span 的 `:style`，不重建 token。
7. **微调模型**：UI 用 `endMode`('extend'|'linkNext') + `endOffset`（共用），`effectiveRanges` computed 按模式映射成底层参数。
8. **VAD**：推理概率按媒体存 IndexedDB（`file-history.js`），复用免重推理；改后处理参数不自动重切，点重新推理才生效。两套 vite 配置均需 `resolve.conditions: ['onnxruntime-web-use-extern-wasm']`。session/tensor 用完必须 `release`/`dispose`（GPU 内存泄漏）。
9. 键盘：`↓/↑` 切句、`←` 重读、`→/空格` 停止；焦点在 input/textarea 时不拦截。

## 数据

- `src/vocabulary.json`：`{level: {word: 释义}}`，7 级约 34000 词，入库。生成脚本 `分级单词提取.py`（独立工具链）。

## CI / 部署

- `deploy.yml`：push `main` → `build:pwa` → GitHub Pages。
- `release.yml`：push `v*` 标签 → `build` 单文件 → Release 资产 `SubTap.html`。
- 两套 vite 配置均 `base:'./'` 适配 Pages 子路径。

## 测试

- `test.html`：纯函数断言页（需 http：dev 后开 `localhost:5173/test.html`）。UI 手动验收。
- 开发流程沿用 superpowers 工作流，spec/plan 在 `docs/superpowers/`。
