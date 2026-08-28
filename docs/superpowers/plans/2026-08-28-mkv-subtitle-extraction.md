# MKV 内封字幕自动提取 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 载入 `.mkv` 媒体时自动提取内封文本字幕轨并替换中栏字幕（外挂字幕也替换），多轨时弹窗让用户选。

**Architecture:** 新增纯逻辑层 `src/logic/mkv-subtitles.js`（零依赖两遍 EBML 扫描，参照 matroska-subtitles 的 corner case 清单），`useLoader.js` 载入媒体时按 magic number 触发提取，`App.vue` 加原生 `<dialog>` 轨道选择。提取产物直接构造 `Sentence[]`（`{id, start, end, text}`，秒）走现有管线。

**Tech Stack:** 原生 JS（EBML 手写解析）、原生 `DecompressionStream('deflate')`（ContentCompression，mdx.js 已用同款）、Vue 3 `<dialog>`。

**Spec:** `docs/superpowers/specs/2026-08-28-mkv-subtitle-extraction-design.md`（corner case 清单以 spec 第 1–8 条为准，本计划逐条对应）

---

### Task 1: `src/logic/mkv-subtitles.js` 解析器（TDD）

**Files:**
- Create: `src/logic/mkv-subtitles.js`
- Modify: `test.html`（加断言组）

- [ ] **Step 1: 在 test.html 写失败断言（含合成 EBML 夹具）**

在 test.html 的 `import` 区加：

```js
import { extractMkvSubtitles, isMkv } from './src/logic/mkv-subtitles.js';
```

在文件末尾（`</script>` 前）加测试块。夹具用辅助函数现场拼最小 EBML，覆盖 spec 的 8 条 corner case：

```js
// --- MKV 内封字幕提取 ---
// 合成最小 MKV 的辅助：vint 编码 + element 拼接
function vintEnc(v){ let n=1; while (v >= (1 << (7*n))) n++; const a=new Uint8Array(n); let x=v; for(let i=n-1;i>=0;i--){a[i]=x&0x7f; x>>=7;} a[0]|=1<<(8-n); return a; }
function el(idBytes, payload){ const out=new Uint8Array(idBytes.length+payload.length); out.set(idBytes); out.set(payload, idBytes.length); return out; }
function uintBytes(v){ const a=[]; do{ a.unshift(v&0xff); v=Math.floor(v/256);}while(v); return Uint8Array.from(a); }
function str(s){ return new TextEncoder().encode(s); }
function mkMkv({ timecodeScale = null, trackCodec = 'S_TEXT/UTF8', useSimpleBlock = false, assText = null, compress = false, twoSubs = false }) {
  // 拼一个 Cluster 一条字幕（或两条），外加轨道表
  const ID = { EBML:Uint8Array.of(0x1A,0x45,0xDF,0xA3), SEG:Uint8Array.of(0x18,0x53,0x80,0x67),
    INFO:Uint8Array.of(0x15,0x49,0xA9,0x66), TCS:Uint8Array.of(0x2A,0xD7,0xB1),
    TRACKS:Uint8Array.of(0x16,0x54,0xAE,0x6B), TRACKENTRY:Uint8Array.of(0xAE),
    TN:Uint8Array.of(0xD7), TT:Uint8Array.of(0x83), CID:Uint8Array.of(0x86), LANG:Uint8Array.of(0x22,0xB59C),
    CLUSTER:Uint8Array.of(0x1F,0x43,0xB6,0x75), TC:Uint8Array.of(0xE7),
    SIMPLE:Uint8Array.of(0xA3), BG:Uint8Array.of(0xA0), BLOCK:Uint8Array.of(0xA1), DUR:Uint8Array.of(0x9B) };
  let info = el(ID.INFO, timecodeScale ? el(ID.TCS, uintBytes(timecodeScale)) : new Uint8Array());
  let te = el(ID.TRACKENTRY, [].concat(
    el(ID.TN, vintEnc(1)), el(ID.TT, uintBytes(0x11)), el(ID.CID, str(trackCodec)),
    (twoSubs ? [] : [])).reduce((a,b)=>{const o=new Uint8Array(a.length+b.length);o.set(a);o.set(b,a.length);return o;}, new Uint8Array()));
  // 注意：twoSubs 时再拼一个 TrackEntry（trackNo=2），见下方完整实现
  const mkBlock = (tno, relMs, payload) => {
    const head = new Uint8Array(4); head.set(vintEnc(tno)); head[tno===1?1:0]=(relMs>>8)&0xff; head[tno===1?2:1]=relMs&0xff;
    // 上行索引易错，实现时改用显式拼接：[vint(tno), relHi, relLo, flags=0] + payload
    return payload;
  };
  // ……（完整夹具实现见 Step 3，此处为意图说明）
}
```

**注意：上面 `mkMkv` 的逐字节拼接容易写错，实际实现按下面 Step 3 的辅助函数为准。** 测试断言（这部分是稳定的，先写死）：

```js
// 基础：SRT 轨（S_TEXT/UTF8），BlockGroup + BlockDuration
// 期望 cues: [{start:0.08, end:2.4, text:"hello world"}]
// TimecodeScale=500000 时 start/end 减半
// SimpleBlock（无时长）时 end=min(下一条start, start+5)
// ASS 轨：载荷 "5,0,Default,,0,0,0,,hello, world" → text:"hello, world"（逗号保留）
// SSA 轨（S_TEXT/SSA）：载荷 "5,0,Default,0,0,0,0,Effect,hello" → 偏移一位后取 text
// isMkv：头 4 字节 1A 45 DF A3 → true；其它 false
// 位图轨（S_HDMV/PGS）不在 tracks 里返回
```

- [ ] **Step 2: 跑 test.html 确认新断言失败**

dev server 已由用户运行，直接 `curl -s http://localhost:5173/test.html >/dev/null` 确认可达；断言结果用 node 直接跑同一套逻辑验证：把 `src/logic/mkv-subtitles.js` 的断言抽成 node 可跑形式（见 Step 4），预期 `import` 报模块不存在 / 断言全红。

- [ ] **Step 3: 实现 `src/logic/mkv-subtitles.js`**

以 `prototype-mkv-extract.mjs`（已验证 985/985 对上 ffmpeg 产物）为基底，吸收 corner case。完整实现：

```js
// MKV 内封文本字幕提取：两遍 EBML 扫描。
// 参照 matroska-subtitles 的 corner case 清单（spec 2026-08-28）。
// 只处理 S_TEXT/* 文本轨；位图轨（PGS/VobSub）忽略；不做 lacing（字幕轨规范单帧）。

export function isMkv(buf) {
  return buf.length >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
}

export async function extractMkvSubtitles(buf) {
  // --- 基础读取原语 ---
  const vint = (i) => {  // [值, 长度]，清标记位（size / track number 用）
    const b = buf[i]; let len = 1;
    for (let m = 0x80; m; m >>= 1) { if (b & m) break; len++; }
    let v = b & ((0x100 >> len) - 1);
    for (let k = 1; k < len; k++) v = v * 256 + buf[i + k];
    return [v, len];
  };
  const elId = (i) => {  // element id：保留标记位
    const b = buf[i]; let len = 1;
    for (let m = 0x80; m; m >>= 1) { if (b & m) break; len++; }
    let v = b;
    for (let k = 1; k < len; k++) v = v * 256 + buf[i + k];
    return [v, len];
  };
  const uint = (i, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + buf[i + k]; return v; };
  const text = (a, b) => new TextDecoder().decode(buf.subarray(a, b));
  const UNKNOWN = 0x0FFFFFFF + 1;  // ≥ 此值即未知 size 的保留前缀（8 字节全 1 为最大）

  // --- 第一遍：轨道元数据（EBML头/Segment/Tracks/Info 下钻）---
  const tracks = [];
  let timecodeScale = 1e6;  // ns，默认值
  let i = 0;
  while (i < buf.length) {
    const [id, idLen] = elId(i);
    const [size, sizeLen] = vint(i + idLen);
    const body = i + idLen + sizeLen, end = body + size;
    if (id === 0x1A45DFA3 || id === 0x18538067 || id === 0x1654AE6B || id === 0x1549A966) { i = body; continue; } // EBML/Segment/Tracks/Info 下钻
    if (id === 0x2AD7B1) timecodeScale = uint(body, size);                       // TimecodeScale
    if (id === 0xAE) {                                                            // TrackEntry
      let j = body, t = { compressed: false };
      while (j < end) {
        const [sid, sl] = elId(j), [ss, ssl] = vint(j + sl), sb = j + sl + ssl, se = sb + ss;
        if (sid === 0xD7) t.no = uint(sb, ss);                                    // TrackNumber
        if (sid === 0x83) t.type = uint(sb, ss);                                  // TrackType
        if (sid === 0x86) t.codec = text(sb, se);                                 // CodecID
        if (sid === 0x22B59C) t.lang = text(sb, se);                              // Language
        if (sid === 0x536E) t.name = text(sb, se);                                // Name
        if (sid === 0x6D80) t.compressed = true;                                  // ContentEncodings → 按压缩处理
        j = se;
      }
      if (t.type === 0x11 && t.codec && t.codec.startsWith('S_TEXT')) tracks.push(t);
    }
    if (id === 0x1F43B675) break;  // 到第一个 Cluster，元数据阶段结束
    i = end;
  }
  if (!tracks.length) return { tracks: [], cuesByTrack: new Map() };

  // --- 第二遍：扫 Cluster 收块 ---
  const scale = timecodeScale / 1e6;  // block 时间单位 → ms
  const raw = new Map(tracks.map(t => [t.no, []]));  // no -> [{ms, durMs|null, text}]
  let clusterMs = 0;
  i = 0;
  while (i < buf.length) {
    const [id, idLen] = elId(i);
    const [size, sizeLen] = vint(i + idLen);
    if (id === 0x18538067) { i += idLen + sizeLen; continue; }                    // Segment：只下钻不跳（可能含未知 size）
    const body = i + idLen + sizeLen, end = body + size;
    if (id === 0x1F43B675) {                                                      // Cluster
      if (size >= UNKNOWN) { i = body; continue; }                                // 未知 size：直接扫子元素
      let j = body;
      while (j < end) {
        const [cid, cl] = elId(j), [cs, csl] = vint(j + cl), cb = j + cl + csl, ce = cb + cs;
        if (cid === 0xE7) clusterMs = uint(cb, cs) * scale;                       // Cluster Timecode
        if (cid === 0xA3) collectBlock(cb, ce, null);                             // SimpleBlock（无时长）
        if (cid === 0xA0) {                                                       // BlockGroup：Block + BlockDuration
          let k = cb, block = null, dur = null;
          while (k < ce) {
            const [bid, bl] = elId(k), [bs, bsl] = vint(k + bl), bb = k + bl + bsl, be = bb + bs;
            if (bid === 0xA1) block = [bb, be];
            if (bid === 0x9B) dur = uint(bb, bs) * scale;
            k = be;
          }
          if (block) collectBlock(block[0], block[1], dur);
        }
        j = ce;
      }
    }
    i = end;
  }

  function collectBlock(bb, be, durMs) {
    const [tno, tl] = vint(bb);
    if (!raw.has(tno)) return;
    const rel = ((buf[bb + tl] << 8) | buf[bb + tl + 1]) * scale;
    raw.get(tno).push({ ms: clusterMs + rel, durMs, payload: buf.subarray(bb + tl + 3, be) });
  }

  // --- 载荷解析：解码 + 按 codec 取文本 ---
  const decode = async (u8) => {
    if (!u8.compressed) return new TextDecoder().decode(u8.payload);
    const ds = new DecompressionStream('deflate');   // zlib 头格式，与 mdx.js 同款
    const stream = new Blob([u8.payload]).stream().pipeThrough(ds);
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  };
  const parseText = (codec, s) => {
    s = s.replace(/\r/g, '');
    if (codec === 'S_TEXT/UTF8') return s.replace(/\n/g, ' ');
    // ASS/SSA Dialogue 尾字段：readOrder,layer,style,name,marginL,marginR,marginV,effect,text
    // SSA 无 layer（样式段以 Format 行为准，按 matroska-subtitles 惯例 SSA 从第 2 位起跳）
    const v = s.split(',');
    return (codec === 'S_TEXT/SSA' ? v.slice(8).join(',') : v.slice(8).join(','))
      .replace(/\\N/g, ' ').replace(/\\n/g, ' ').trim();
  };

  const cuesByTrack = new Map();
  for (const t of tracks) {
    const items = raw.get(t.no).sort((a, b) => a.ms - b.ms);
    const cues = [];
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const s = parseText(t.codec, await decode({ ...it, compressed: t.compressed }));
      if (!s) continue;
      const start = it.ms / 1000;
      const next = items[k + 1];
      const end = it.durMs != null ? (it.ms + it.durMs) / 1000
        : Math.min(next ? next.ms / 1000 : start + 5, start + 5);
      cues.push({ start, end: Math.max(end, start + 0.001), text: s });
    }
    cuesByTrack.set(t.no, cues);
  }
  return { tracks, cuesByTrack };
}
```

注意实现时自审：上面 SSA/ASS 的 slice 分支当前相同（matroska-subtitles 对 SSA 是跳 layer 一位——若合成 SSA 夹具断言失败，SSA 分支改为 `v.slice(8)` 起点前移一位，以断言为准修正）。

- [ ] **Step 4: node 侧快速验证 + 浏览器断言**

夹具在 test.html 里是浏览器跑的；同时用真实文件验证（node 直接 import 模块）：

```bash
cd d:/repos/SubTap && node -e "
import('./src/logic/mkv-subtitles.js').then(async m => {
  const fs = await import('node:fs');
  for (const f of ['medias/prototype-mkv.srt-test.mkv', 'medias/prototype-mkv.ass-test.mkv']) {
    const r = await m.extractMkvSubtitles(new Uint8Array(fs.readFileSync(f)));
    const cues = [...r.cuesByTrack.values()][0];
    console.log(f, 'tracks:', r.tracks.length, 'cues:', cues.length, cues[0], cues.at(-1));
    console.assert(cues.length === 985, '应为 985 条');
  }
})"
```

预期：两个文件都 985 条，SRT 轨首条 `{start:0.08, text:"There's a kind of wild paper from 2002"}`、末条 `[music]`。

然后浏览器开 `http://localhost:5173/test.html`（让用户开或用 CDP 机械读取输出），确认新增断言全绿、原有断言不红。

- [ ] **Step 5: 提交**

```bash
git add src/logic/mkv-subtitles.js test.html
git commit -m "feat: MKV 内封文本字幕提取纯逻辑层（两遍 EBML 扫描，覆盖 TimecodeScale/压缩/ASS 逗号等 corner case）"
```

---

### Task 2: `useLoader.js` 接线——载入 mkv 自动提取

**Files:**
- Modify: `src/composables/useLoader.js:56-72`（`onMediaFile`）
- Modify: `src/App.vue`（loader 工厂入参 + 轨道选择状态）

- [ ] **Step 1: `useLoader.js` 加提取逻辑**

顶部 import：

```js
import { isMkv, extractMkvSubtitles } from '../logic/mkv-subtitles.js';
```

`createLoader` 依赖注入多收一个 `pickMkvTrack`（App 传入，返回 `Promise<track|null>`，弹轨道选择；单轨时 App 直接 resolve 不弹窗）。

`onMediaFile` 中，`applyMediaSrc(...)` 之后追加（媒体照常载入播放，提取异步不阻塞）：

```js
  // MKV：提取内封文本字幕轨，强制替换当前字幕（外挂字幕也替换，用户决定）
  extractMkv(file);
  function extractMkv(file) {
    file.arrayBuffer().then(async ab => {
      if (mediaBlob !== file) return;   // 用户已换媒体，丢弃过期结果
      const u8 = new Uint8Array(ab);
      if (!isMkv(u8)) return;
      const { tracks, cuesByTrack } = await extractMkvSubtitles(u8);
      if (mediaBlob !== file) return;
      if (!tracks.length) { notify('MKV 无内封文本字幕（位图轨不可提取）', 'error'); return; }
      const track = tracks.length === 1 ? tracks[0] : await pickMkvTrack(tracks);
      if (!track) return;   // 用户取消选择
      const cues = cuesByTrack.get(track.no);
      if (!cues.length) return;
      applySubtitle('');   // 复用清理：srtFromFile/stopAll/currentId 置位
      sentences.value = cues.map((c, i) => ({ id: i + 1, ...c }));
      srtFromFile.value = true;
      currentId.value = null; currentText.value = '';
      notify(`已提取内封字幕（${track.name || track.lang || track.codec}，${cues.length} 句）`);
    }).catch(() => notify('MKV 字幕提取失败', 'error'));
  }
```

（`applySubtitle('')` 会把 `sentences` 设为 `parseSRT('')` 即空数组，随后覆盖赋值——两步合一，直接手动置位即可，不必调 `applySubtitle`。实现时按上面最终形态写：不调 `applySubtitle`，显式 `stopAll()` + 置状态，与 `restoreLast` 的 VAD 分支同风格。）

`return` 列表不变（新能力挂在 `onMediaFile` 内部）。

- [ ] **Step 2: `App.vue` 接 `pickMkvTrack`**

在 App.vue 中（`createLoader` 调用处附近）加原生 `<dialog>` 状态与方法：

```js
// MKV 多字幕轨选择：原生 dialog，单轨/取消不弹
const mkvTrackDialog = ref(null);
const mkvTracks = ref([]);
let resolveTrack = null;
function pickMkvTrack(tracks) {
  if (tracks.length === 1) return Promise.resolve(tracks[0]);
  mkvTracks.value = tracks;
  mkvTrackDialog.value.showModal();
  return new Promise(r => { resolveTrack = r; });
}
function chooseMkvTrack(t) { mkvTrackDialog.value.close(); resolveTrack?.(t); }
function cancelMkvTrack() { resolveTrack?.(null); }
```

`createLoader({ ..., pickMkvTrack })`。模板（App.vue 三栏之后）：

```html
<dialog ref="mkvTrackDialog" class="mkv-track-dialog" @close="cancelMkvTrack">
  <h3>选择字幕轨道</h3>
  <button v-for="t in mkvTracks" :key="t.no" @click="chooseMkvTrack(t)">
    {{ [t.name, t.lang, t.codec].filter(Boolean).join(' · ') }}
  </button>
</dialog>
```

样式加进 `styles.css`（`.mkv-track-dialog`：居中、按钮纵排，对齐现有 `:root` token 风格——背景 `var(--panel-bg, #fff)` 圆角，简单即可）。

- [ ] **Step 3: 手动验证路径（node 层面无浏览器逻辑，直接构建验证）**

```bash
cd d:/repos/SubTap && npm run build 2>&1 | tail -3
```

预期：单文件构建成功无报错（`DecompressionStream` 为原生 API，三轨无需 polyfill）。

- [ ] **Step 4: 提交**

```bash
git add src/composables/useLoader.js src/App.vue styles.css
git commit -m "feat: 载入 MKV 媒体自动提取内封字幕替换中栏，多轨弹原生 dialog 选择"
```

---

### Task 3: 真实文件矩阵验证 + 清理

**Files:**
- Create: `medias/`（临时测试 mkv，验证后删）
- Delete: `prototype-mkv-extract.mjs`、`prototype-mkv-extract.html`、`medias/prototype-mkv.*.mkv`

- [ ] **Step 1: 造测试矩阵并跑**

```bash
cd d:/repos/SubTap/medias
FF="D:/Portable_library/ffmpeg/bin/ffmpeg.exe"
SRC_V="-i 'But what is cross-entropy.mp4'"
# 双字幕轨（SRT+ASS）
eval "$FF -y $SRC_V -i 'But what is cross-entropy.srt' -i 'output.srt' -c copy -c:s srt -map 0:v -map 0:a -map 1:0 -map 2:0 /d/tmp/two-tracks.mkv"
# TimecodeScale 非默认
eval "$FF -y $SRC_V -i 'But what is cross-entropy.srt' -c copy -c:s srt -map 0:v -map 0:a -map 1:0 -timecode_scale 0.5 /d/tmp/tcs.mkv" 2>&1 | head -2 || echo "ffmpeg 无此选项则跳过该格"
```

node 验证脚本对每个文件跑 `extractMkvSubtitles`，断言：双轨 → `tracks.length===2` 且两轨 cue 数各与源 srt 的 ` --> ` 行数一致；TCS 格 → 若造出则首条 start 为基准的一半。

- [ ] **Step 2: 浏览器全量断言 + 构建双轨**

`test.html` 全绿（含原有断言）；`npm run build && npm run build:pwa` 均成功。

- [ ] **Step 3: 清理并提交**

```bash
cd d:/repos/SubTap && rm prototype-mkv-extract.mjs prototype-mkv-extract.html medias/prototype-mkv.srt-test.mkv medias/prototype-mkv.ass-test.mkv /d/tmp/two-tracks.mkv /d/tmp/tcs.mkv
rm -rf /d/tmp/mkv-lib-test
git add -A && git commit -m "chore: MKV 字幕提取原型与测试文件清理（结论已吸收进 src/logic/mkv-subtitles.js）"
```

---

### Task 4: 用户验收清单（交接，不派子代理）

给用户的验收点（浏览器 `localhost:5173`，用户自己跑 dev）：

1. 载入 `medias/` 任一 mkv（需自造或重新封装）→ 中栏自动出现字幕，级别着色正常，点句播放区间正确
2. 先载入外挂 srt 再载入 mkv → 字幕被内封轨**替换**
3. 双轨 mkv → 弹轨道选择，选不同轨字幕切换；Esc/关闭 = 取消不改
4. 无字幕轨/纯 PGS 轨 mkv → toast 提示、中栏不动
5. `npm run build` 产物 `dist/index.html` 双击打开重复 1–3（file:// 下 DecompressionStream 可用）
