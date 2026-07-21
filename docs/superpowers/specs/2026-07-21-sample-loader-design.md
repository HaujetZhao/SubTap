# 空白页「载入示例」按钮 — 设计

## 目标

空载引导页加一个「载入示例」按钮，一键载入内置示例字幕 + 示例音频，
让用户无需自备素材即可体验「点句播放」核心流程。

示例素材随工具发布、入库，作为 PWA 内置 —— 装一次后离线可用，不再走网络。

## 素材

| 文件 | 规格 | 引入方式 |
|------|------|------|
| `src/assets/sample/sample.srt` | 40 条，止于 00:01:59 (2min 内) | `import sampleSrt from './assets/sample/sample.srt?raw'` —— `?raw` 构建期变纯文本字符串塞进 JS，零 base64 膨胀 |
| `src/assets/sample/sample.aac` | AAC / 44.1kHz / 96k / 2min，1.5 MB | `import sampleAudio from './assets/sample/sample.aac'` —— 走打包器当资源 URL |

素材源：`【官方双语】压缩即智能：Part1` mp4，ffmpeg `-t 120 -vn -c:a aac -b:a 96k` 抽音轨、`-t 120` 切字幕。

### 为什么放 `src/assets/` 而非 `public/`

- `public/` 文件原样拷贝、用 URL 引用，`vite-plugin-singlefile` **不内联** → 单文件构建产物 `SubTap.html` 还得带伴生 aac 才能播，破坏「双击单文件即用」。
- `src/assets/` import 走打包器：
  - **单文件构建**：`viteSingleFile` 把 `assetsInlineLimit` 设到 ~100MB，aac 自动内联成 data URI 进 JS → 真单文件。
  - **PWA 构建**：aac 作为独立哈希文件发到 `dist/assets/`，加进 workbox 预缓存 → 装一次后离线可用。
  - 同一行 `import` 两套构建各得其所，Vite 自动处理。

## 配置改动

1. **`.gitignore`**：`*.srt` 被忽略，给示例 srt 取反（`*.aac` 本就未被忽略，不用加）：
   ```
   !src/assets/sample/sample.srt
   ```
2. **`vite.config.pwa.js`**：workbox 预缓存 glob 加 `aac`，否则 PWA 版的独立 aac 文件不缓存、变在线专属：
   ```js
   globPatterns: ['**/*.{js,css,html,svg,png,json,wasm,aac}'],
   ```

## 代码改动（3 处）

### (a) `src/App.vue`

引入素材；把现有 `onSrtFile` / `onMediaFile` 的「应用」逻辑抽成两个共用函数，文件按钮和示例按钮共用；新增 `loadSample()`。

```js
import sampleSrt from './assets/sample/sample.srt?raw';
import sampleAudio from './assets/sample/sample.aac';

function applySubtitle(text, name) { /* parseSRT + 重置 current/play + stopSpeech + notify */ }
function applyMediaSrc(url, name, kind) { /* player.setSrc + mediaName + mediaKind + notify */ }

function loadSample() {
  applySubtitle(sampleSrt, '示例字幕');
  applyMediaSrc(sampleAudio, '示例音频', 'audio');
}
```

- `onSrtFile` 改为读 File 文本后调 `applySubtitle(reader.result, file.name)`。
- `onMediaFile` 改为 `applyMediaSrc(URL.createObjectURL(file), file.name, kind)`。
- `<SentenceList>` 加 `@sample="loadSample"`。

### (b) `src/components/SentenceList.vue`

引导页 `.empty` 内加按钮，emit `sample`：

```html
<button class="empty-sample-btn" @click="emit('sample')">▶ 载入示例</button>
```

`defineEmits` 加 `'sample'`。按钮只在空载页（`sentences.length === 0`）出现；载入后列表填充、引导页消失。

### (c) `src/styles.css`

给 `.empty-sample-btn` 主色实心按钮样式，与设置面板文件按钮风格一致。

## 行为

- 点「载入示例」→ 字幕进中栏、音频就绪，直接点句播放；与手动载入等价。
- 之后换自己的素材 → 照常用左栏文件按钮载入，替换掉示例。
- 示例字幕须 subsrt 可解析（SRT 即可）。

## 不做（YAGNI）

- 不做「载入示例后再次显示按钮」—— 只在空载页出现。
- 不做示例素材的多语言/多选切换 —— 单一示例。
- 不引入「从 URL 载入媒体」通用能力 —— 示例用打包器 import 即可，不为它开新代码路径。

## 测试

- `npm run build` → 单文件构建，验证 aac 内联进 `dist/index.html`（grep 不到外链 `sample.aac`，或文件大小含 ~2MB data URI）。
- `npm run build:pwa` → 验证 `dist/assets/` 下有哈希 aac 文件。
- `npm run dev` 手动验收：空载页点「载入示例」→ 字幕音频就绪 → 点句播放正常（用户本人在浏览器上手验收）。
