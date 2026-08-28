# MKV 内封字幕自动提取 — 设计

日期：2026-08-28

## 目标

载入 `.mkv` 媒体时，自动解析容器内封的文本字幕轨，替换中栏当前字幕（即使已载入外挂字幕文件也替换）。多轨时由用户选择。

## 背景结论（调研）

npm 无合适轮子：`matroska-subtitles` 功能对口但 node streams 架构带来 6 个 polyfill + 524KB 包装税；其余候选（`matroska`/`subtitle`/`mkv-subtitle-extractor`/`ebml-demuxer`）各自排除（见会话记录）。自写零依赖解析器，corner case 清单参照 matroska-subtitles 源码。

原型已验证：两遍扫描 EBML，143MB 文件 26ms，SRT/ASS 轨均与 ffmpeg 封装的原字幕 985 条逐条对上。

## 纯逻辑层：`src/logic/mkv-subtitles.js`

参照 `prototype-mkv-extract.mjs`（验证后吸收、删除），导出：

```js
extractMkvSubtitles(Uint8Array) -> Promise<{
  tracks: Array<{ no, lang, name, codec, compressed }>,   // 仅 S_TEXT/* 文本轨；compressed=有 ContentEncodings，载荷需 zlib 解压
  cuesByTrack: Map<no, Array<{ start, end, text }>>  // start/end 秒
}>
```

解析要点（= corner case 清单，逐条覆盖）：

1. **vint 解码**：size/track-number 清标记位；element id 保留标记位。
2. **两遍扫描**：第一遍下钻 EBML头/Segment/Tracks 找 `TrackEntry`（TrackType=0x11、CodecID 以 `S_TEXT` 开头才算文本轨，PGS/VobSub 位图轨忽略）；第二遍扫 Cluster。
3. **TimecodeScale**（Segment Info，默认 1e6 ns）：时间换算系数必须读取，不能硬编码 /1000。
4. **字幕块位置**：优先 BlockGroup(0xA0) 内 Block(0xA1)+BlockDuration(0x9B)（ffmpeg/mkvmerge 均此写法）；SimpleBlock(0xA3) 兜底（无时长，end 用下一条 start 补）。
5. **未知 size master**（Segment/Cluster 无限长写法）：遇保留值直接下钻继续扫。
6. **ContentCompression**（EBML 头压缩）：轨道声明压缩时用原生 `DecompressionStream('deflate')` 解压块载荷（异步，故整体返回 Promise；mdx.js 已用同款 API，单文件/PWA/file:// 三轨兼容）。
7. **载荷解析**：`S_TEXT/UTF8` 载荷即文本；`S_TEXT/ASS`/`S_TEXT/SSA` 载荷按逗号切字段取 `slice(8).join(',')` 当文本（文本可含逗号）。字段序 ReadOrder, Layer, Style, Name, MarginL/R/V, Effect, Text——matroska 官方规范明确 Layer 位对 SSA 保留（为空），故 ASS/SSA 同一处理（matroska-subtitles 里"SSA 跳一位"只是其字段标注差异，文本位置相同）；文本内 `\N` 换行替换为空格。
8. **无时长兜底**：cue 排序后 `end = min(下一轨 start, start + 5s)`，末条封顶媒体时长不强求。

自审约束：不做 lacing（字幕轨规范单帧）、不解析 AttachedFile 字体、不写通用 EBML schema 表——按 matroska-subtitles 同样裁剪。

## 组合层接线：`useLoader.js`

媒体文件载入路径上（File System Access handle 与 input 两条路汇合处）：

- 扩展名或 magic number（`1A 45 DF A3`）判定 MKV → `file.arrayBuffer()` → `extractMkvSubtitles`。
- **有文本轨即替换中栏字幕**（用户决定：外挂字幕也被替换）。
- 单轨：直接载入，toast「已提取内封字幕（语言/名称）」。
- 多轨：弹轨道选择（复用现有交互组件风格：toast/轻量面板，列出 `名称 · 语言 · 编码`），选定后载入；期间媒体照常载入播放，不阻塞。
- 无文本轨：不动作（PGS 位图轨 toast 提示一句「内封字幕为位图格式，无法提取」）。

提取的 cues 转成 `Sentence[]` 结构（复用 `parseSRT` 的输出形态），直接赋给 `sentences`，走现有渲染/播放/词库着色全管线。

## 测试

- `test.html` 加断言组：TimecodeScale 非默认、SimpleBlock 兜底、ASS 逗号文本、SSA 偏移、无时长补齐。
- 用 ffmpeg 造多组测试 mkv（默认参数 / `-timecode-scale` / 头压缩 / 双字幕轨 / mkvmerge 写法若有）放 `medias/` 验证，通过后删除或只留小的。
- UI 验收点交用户：载入 mkv 自动出字幕、多轨选择、替换外挂字幕。

## 清理

- 吸收后删除 `prototype-mkv-extract.mjs`、`prototype-mkv-extract.html`、`medias/prototype-mkv.*.mkv`。
