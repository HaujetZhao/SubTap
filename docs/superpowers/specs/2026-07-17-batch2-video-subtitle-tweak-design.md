# 字幕音频播放器 批次二设计文档（视频支持 + 字幕时间微调）

> 日期：2026-07-17
> 状态：待审阅
> 基线：批次一（三栏 + 词库内置 + 分级勾选，Vue 3 + Vite，已交付）

## 1. 背景

批次一完成后，本批补齐批次一设计 §12 预告的两块：**视频/音视频统一播放**与**字幕时间微调**。

- 视频：用户除音频外可选视频，点句子跳转播放对应区间，视频画面在中栏上方固定显示，可拖拽调高度、可收起。
- 字幕微调：修正 SRT 时间戳不准的问题——全局起始偏移、末尾延长、句末连接到下一句开头（解决英文长词被提前切断）。

## 2. 目标（批次二范围）

1. **音视频统一播放**：媒体入口接受音频或视频；用 `<video>` 元素通吃；视频画面在中栏上方显示，可拖拽调高度、可收起。
2. **字幕时间微调**：左栏设置面板新增"字幕微调"一节，含起始偏移、末尾延长、句末连接开关；点句子按有效区间播放。

## 3. 非目标（YAGNI）

- 视频画面尺寸的自由缩放（仅高度，宽度跟随容器）。
- 逐句微调（仅全局偏移 + 全局延长 + 全局连接开关）。
- 微调参数持久化（刷新即重置，与批次一约定一致）。
- 视频画中画、倍速、字幕轨叠加等播放器增强。
- 文件管理功能（左栏未来扩展，本批不动）。

## 4. 架构变更

延续批次一的 Vue 3 + Vite 架构，仅改动 UI 层与 App 状态；纯逻辑模块（srt-parser/word-lookup/player/vocab-store）不动。

文件改动：

```
src/
├── App.vue              # 改：<audio>→<video>；视频高度/收起 ref + 拖拽；微调参数 + 有效区间 computed；onSentenceClick 用有效区间
├── components/
│   └── SettingsPanel.vue # 改：音频入口→音/视频入口（media-file）；新增"字幕微调"区块
└── styles.css           # 改：视频区/拖拽手柄/收起按钮/微调区块样式
```

不变：player.js（HTMLMediaElement 通用 API，`<video>` 同样适用）、vocab-store.js、srt-parser.js、word-lookup.js、SentenceList.vue、WordPanel.vue、test.html。

### 关键决策：统一用 `<video>` 元素

`<video>` 元素既能播视频（显示画面）也能播音频（无画面，仅声音）。player.js 全部基于 HTMLMediaElement 通用 API（currentTime/play/pause/timeupdate/loadedmetadata/readyState），与元素类型无关。故把 App.vue 的 `<audio>` 换成 `<video>` 即可同时支持音视频，player.js 零改动。

## 5. 关键实现要点

### 5.1 音视频入口与媒体元素

- SettingsPanel 的"音频"按钮改为"音/视频"，`<input accept="audio/*,video/*">`，emit `media-file`（替代原 `audio-file`）。
- App.vue：`<audio ref="audioEl">` → `<video ref="mediaEl">`，放进 `video-slot`。`new Player(mediaEl)`。
- 选媒体文件：`URL.createObjectURL(file)` → `player.setSrc(url)`。记录媒体名（含扩展名，用于判断是否有画面——可选）。
- 选新媒体时若在播则 `player.stop()` + `isPlaying=false`。

### 5.2 视频区显示与拖拽调高度

状态（App.vue ref）：
- `videoHeight`：number，视频区像素高度，默认 240。
- `videoCollapsed`：bool，是否收起，默认 false。

DOM 结构（中栏 `.video-slot` 内）：
```
.video-slot
  .video-header  (含"展开/收起"按钮；收起时此条仍在)
    video (ref=mediaEl, :style height = collapsed ? 0 : videoHeight)
    .resize-handle (拖拽手柄，仅未收起时显示)
```
- 收起（`videoCollapsed=true`）：video 高度设 0、`display:none`；手柄隐藏；视频区塌缩为一条 header（含"展开视频"按钮）。声音继续播（纯听模式）。
- 展开恢复 `videoHeight`。
- **拖拽**：手柄 `@mousedown` 开始 → document 上 `mousemove` 算新高度（`初始高度 - (e.clientY - 起点Y)`，向上拖增大）→ clamp [100, window.innerHeight*0.7] → `mouseup` 解绑。用 `onMounted/onUnmounted` 管理全局监听器，或拖拽期间临时 add/removeEventListener。

### 5.3 字幕微调参数（App.vue ref）

```
offset: ref(0)        // 起始偏移（秒），-10~10，步进 0.1
extend: ref(0)        // 末尾延长（秒），0~5，步进 0.1
linkNext: ref(false)  // 句末连接开关，默认关
```

### 5.4 有效区间 computed

依赖 `sentences` + 三参数，返回每句的有效 `{effStart, effEnd}`（或一个按 id 查的 Map）：

```
对第 i 句：
  effStart = sentences[i].start + offset
  若 linkNext 为 true 且 i 不是最后一句：
    effEnd = sentences[i+1].start + offset   // 连到下一句的有效开头（连接优先，忽略 extend）
  否则（linkNext 关，或最后一句）：
    effEnd = sentences[i].end + extend
```

> 连接优先：`linkNext` 开时本句 end 用下一句 effStart，不叠加 extend；最后一句无下一句，退化为 `end + extend`。

### 5.5 点句用有效区间

`onSentenceClick(sentence)` 改为：从有效区间 Map 取该句 `{effStart, effEnd}`，调 `player.playSegment(effStart, effEnd)`。其余（高亮、右栏、守卫）不变。

**实时性**：改微调参数 → computed 重算 → **下次点句生效**。正在播放的段不中途改 end（已传入 playSegment 的是旧值，播完即止），避免中途跳跃。

### 5.6 SettingsPanel 微调区块

新增一节（在"词库分级"与"文件"之间，或"文件"下方）"字幕微调"：
- 起始偏移：`<input type="number" min="-10" max="10" step="0.1">`，双向（emit 或 v-model via prop+emit）。
- 末尾延长：`<input type="number" min="0" max="5" step="0.1">`。
- 句末连接：`<input type="checkbox">`。
- 用与分级勾选相同的受控模式（:value/:checked + @input/@change emit）。App 接收后更新对应 ref。

## 6. UI / 布局

中栏变化（其余两栏不变）：

```
┌─操作─┬───────────────────────┬─单词─┐
│ 词库  │ ┌──视频区（可拖拽调高）──┐│      │
│ 分级  │ │ ▶ [video 画面]      〔收起〕││ 四级 │
│ ───  │ └────── 拖拽手柄 ────────┘│      │
│ 字幕  │ 句子列表（可滚动）       │ 初中 │
│ 微调  │ [00:00] ▶ 句1          │  ... │
│ 偏移  │ [00:05]   句2          │      │
│ 延长  │ [00:12]   句3 ◀        │      │
│ 连接  │ ...                    │      │
│ ───  │                        │      │
│ 文件  │                        │      │
│ 字幕  │                        │      │
│ 音视频│                        │      │
└─────┴───────────────────────┴─────┘
```

收起态：视频区塌缩为一条"〔展开视频〕"，字幕区扩大。

## 7. 错误处理

| 情况 | 处理 |
|------|------|
| 选了不支持的视频编码 | 沿用批次一 audio.onerror 提示"音频/视频无法播放，建议改用 mp4/mp3" |
| offset/extend 输入非法（空/超范围） | input 的 min/max/step 约束 + Number 转换兜底，非法值回退 0 |
| 无媒体源点句 | 沿用"请先选择音/视频文件"提示 |
| 微调使 effEnd ≤ effStart（极端 offset） | computed 里 `effEnd = Math.max(effEnd, effStart + 0.05)`，保证最小 50ms 段，避免播放器异常 |

## 8. 测试

- 纯逻辑层（有效区间计算）可提取为一个小的纯函数（如 `computeEffectiveRanges(sentences, {offset, extend, linkNext})`），用 test.html 加断言：
  - offset=0/extend=0/linkNext=false → effStart=start, effEnd=end（不变）
  - offset=1 → effStart=start+1
  - extend=0.5 → effEnd=end+0.5
  - linkNext=true → 第 i 句 effEnd = 第 i+1 句 (start+offset)
  - linkNext=true 最后一句 → effEnd = end+extend
  - effEnd ≤ effStart 时夹到 effStart+0.05
- 其余（视频拖拽、收起、微调 UI）手动浏览器验收。

> 设计取舍：把有效区间计算抽成纯函数（放哪见下），便于测试且让 App.vue 的 computed 更薄。建议放 `src/subtitle-tweak.js`（新文件，纯函数 ES module），与 srt-parser 等同级。

## 9. 验收标准（手动）

1. `npm run dev` → 三栏；左栏多出"字幕微调"一节（偏移/延长/连接）。
2. 选 SRT + 选视频（mp4）→ 中栏上方显示视频画面；点句子 → 视频跳到对应区间播放、画面随之、到点自动停。
3. 选音频（mp3）→ 视频区无画面（或保持上次高度但空白），点句子纯听播放。
4. 拖拽视频区手柄 → 高度随之变化（有上下限）；收起按钮 → 视频区塌缩、字幕区扩大、声音继续；展开恢复。
5. 起始偏移设 +1s → 点句子比原 start 晚 1 秒开始。
6. 末尾延长设 +0.5s → 句子比原 end 多播 0.5 秒。
7. 句末连接开 → 句子播到下一句开头（验证长词不再被提前切断）。
8. 改微调参数时正在播放的段不跳；下次点句按新参数。
9. `npm run build` → dist/index.html 单文件自包含。

## 10. 文件产出

- 改：`src/App.vue`、`src/components/SettingsPanel.vue`、`src/styles.css`
- 新增：`src/subtitle-tweak.js`（有效区间纯函数）+ test.html 扩展（可选，加该函数断言）
- 不变：player.js、vocab-store.js、srt-parser.js、word-lookup.js、SentenceList.vue、WordPanel.vue
- 构建产物：`dist/index.html`

## 11. 与后续的衔接

左栏"文件"区未来可扩展为文件管理（批次一 §12 预告）。视频区控件未来可加倍速/画中画。微调参数未来可持久化到 localStorage。本批均不做。
