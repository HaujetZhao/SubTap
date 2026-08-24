# VAD 入口收拢（方案 A）设计

日期：2026-08-24

## 问题

VAD 功能入口太散：中栏句子区顶部一个 CTA 行（运行按钮 + 进度），左栏设置面板一个「VAD 分段」小节（运行按钮 + 三个参数），两处都能触发，用户不知道该看哪。

## 方案

全部收进左栏「VAD 分段」小节，中栏恢复原样。纯 UI 收拢，`vad.js` 与 App 的状态逻辑（`vadGen`/`vadProbs`/参数持久化/`resegmentVad`）不动。

### 1. 中栏（SentenceList.vue）恢复原样

- 删掉 `<slot>`、`vad-cta` 整块模板与 `mediaLoaded` prop。
- 空载引导页恢复为 `v-else`（无条件显示）。
- 有媒体无字幕的引导：空载页文案区加一行静态小字「已有音频？在左侧「VAD 分段」一键生成字幕」，非按钮。需要 `mediaLoaded` prop（仅用于控制这一行小字是否显示）。

### 2. 左栏（SettingsPanel.vue）VAD 小节 = 唯一入口

- 新增 prop `vadGen`（进度对象 `{ doneSec, dur } | null`），App 传入。
- **按钮三态**（同一个按钮变脸）：
  - 空闲（`vadGen === null`）：文案 `推理分段`（无 probs）/ `重新分段`（有 probs，点击 = 用留存概率重切）。
  - 运行中（`vadGen !== null`）：禁用，内部显示进度——解码阶段（`dur === 0`）文案 `解码音频中…`；推理阶段文案 `N/Ms`，按钮背景按 `doneSec/dur` 比例填充 accent 色（内层绝对定位 div，width %，CSS transition）。
- 三个参数行（阈值/最短语音/最短静音）加 `disabled` 态：无 `vadHasProbs` 时半透明不可编辑（改参数只有重切才有意义，避免误导）。

### 3. App.vue

- 删掉模板里传给 `SentenceList` 的 `<slot>` 内容（`.vad-cta` 块）。
- `SentenceList` 绑定从 `:media-loaded="mediaKind !== null"` 保持，仅用于空载页小字。
- `SettingsPanel` 新增 `:vad-gen="vadGen"`。
- `styles.css`：删 `.vad-cta`/`.vad-progress` 样式，新增按钮进度填充样式与参数 disabled 态。

## 不在范围

- 清除字幕/媒体的 × 按钮：与入口散不散无关，保留不动。
- VAD 推理/后处理逻辑、参数持久化：不动。

## 验收

- 中栏无 VAD 元素；空载页在有媒体时多一行提示小字。
- 左栏按钮三态正常：空闲 → 运行中（进度填充）→ 完成变「重新分段」。
- 无 probs 时三个参数 input 半透明 disabled。
- 主观体验（三态观感、文案位置）由用户本人在浏览器验收。
