# App.vue 编排化瘦身实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App.vue 从 735 行缩到 300 行以内，只负责"状态声明 + 模块接线 + 三栏模板"，其余按功能抽成 composable / 子组件。**纯搬移重构，零行为变化。**

**Architecture:** 沿用 `useLayout.js` 的既有模式——工厂函数接收依赖（refs/回调）、返回 API，App.vue 显式接线。共享核心状态（`sentences/currentId/isPlaying/player/mediaBlob`）留在 App.vue，不做 provide/inject、不做全局 store。不新增纯逻辑，只搬移"响应式桥"代码。

**Tech Stack:** Vue 3 `<script setup>` + 现有纯逻辑层（不动）。

---

## 总体结构

新文件 7 个，App.vue 重写一次：

| 文件 | 职责 | 来源（App.vue 行号） |
|------|------|---------------------|
| `src/pill-drag.js` | 药丸拖拽纯机制 + `loadJson`/`loadPos` | 29-36, 406-450 |
| `src/useSettings.js` | 设置持久化、勾选镜像、onTweak/onToggle* | 28, 38-68, 105-107, 160-194 |
| `src/useVad.js` | VAD 状态与生成/重切流程 | 79-93, 273-330 |
| `src/usePlayback.js` | 播放命令（点句/键盘/手势/线控） | 370-379, 382-396, 526-616 |
| `src/useLoader.js` | 文件载入/示例/恢复上次 | 199-270, 332-359 |
| `src/components/VideoStage.vue` | 视频区模板 + 拖高/折叠/全屏/全屏药丸 | 109-145, 400-404, 452-466(部分), 512-524, 663-689 |
| `src/components/Toasts.vue` | toast 列表模板 | 725-734 |
| App.vue 重写 | 状态 + 接线 + 三栏模板 + 底部控制条药丸 | 其余 |

留在 App.vue 的：核心状态 refs、`renderedSentences/effectiveRanges/hasContent` computed、底部控制条药丸（依赖中栏 DOM 与布局互作用）、`selectSentenceById`、进度 watch、onMounted 播放器创建。

**接线顺序**（依赖方向）：settings → 核心状态 → computeds → vad → playback → loader → VideoStage（模板层）。`mediaBlob` 以 `let` + getter/setter 回调留在 App 打破 vad↔loader 循环依赖。

**验证方式**：每个 Task 后 `npm run build` 通过（新文件未被引用前不破坏构建）。最终 `npm run build && npm run build:pwa` 双轨通过 + test.html 断言页通过（纯逻辑层未动，应原样绿）+ 用户浏览器手动验收。行为零变化，不新增测试。

---

### Task 1: pill-drag.js + Toasts.vue

**Files:**
- Create: `src/pill-drag.js`
- Create: `src/components/Toasts.vue`

- [ ] **Step 1: 写 `src/pill-drag.js`**（原 App.vue:29-36 的 loadJson/loadPos + 406-450 的拖拽机制，原样搬移；两处药丸原来共享一个 suppress 标志，现按药丸各建一套——同一药丸内自吞 click 语义不变）

```js
// 可拖药丸共用机制(全屏播控药丸/底部控制条):纯逻辑,无 Vue 依赖。
// 位移 <5px 视为点按钮;拖动中把"期望中心点"交给调用方的 clamp 写入自己的 pos;抬起时持久化并吞掉紧随的 click。
// getEl 在 down 时调用一次,调用方可在此缓存拖动期间不变的 rect(热路径零 DOM 读取)。
export function createPillSystem() {
  let suppressClick = false;

  function makePillDrag({ getEl, clamp, persist }) {
    let d = null;
    function down(e) {
      suppressClick = false;  // 上一轮拖动若无 click 派发,标志会残留,新按下时清掉
      const pl = getEl().getBoundingClientRect();
      d = {
        sx: e.clientX, sy: e.clientY,
        grabDX: e.clientX - (pl.left + pl.width / 2),
        grabDY: e.clientY - (pl.top + pl.height / 2),
        halfX: pl.width / 2, halfY: pl.height / 2,   // 拖动中尺寸不变,down 时量一次
        moved: false,
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    }
    function move(e) {
      if (!d) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
        d.moved = true;
      }
      clamp(e.clientX - d.grabDX, e.clientY - d.grabDY, d.halfX, d.halfY);
    }
    function up() {
      if (d?.moved) {
        persist();
        suppressClick = true;   // 拖完后吞掉紧随的 click,避免误触按钮
        // 若 click 落在无处理器的药丸背景上,guard 不会执行,标志残留会误吞下一次点按钮;
        // 故本轮 click 派发结束后(bubble 到 window)自行清除。
        window.addEventListener('click', () => { suppressClick = false; }, { once: true });
      }
      d = null;
      window.removeEventListener('pointermove', move);
    }
    return { down, cancel: () => window.removeEventListener('pointermove', move) };
  }

  // 拖完的 click 吞掉;正常点击 blur 焦点(空格时按钮不显焦点环)后执行
  function guard(fn, e) {
    if (suppressClick) { suppressClick = false; return; }
    e?.currentTarget.blur();
    fn();
  }
  return { makePillDrag, guard };
}

// localStorage JSON 读取统一入口(解析失败/为空返回 fallback)
export function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
// 药丸位置(0..1 比例坐标)读取:越界/缺字段作废用默认值
export function loadPos(key, def) {
  const p = loadJson(key, null);
  return (p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) ? p : def;
}
```

- [ ] **Step 2: 写 `src/components/Toasts.vue`**（原 App.vue:725-734 模板原样搬移，改成 props/emits）

```vue
<script setup>
defineProps({ toasts: { type: Array, required: true } });
defineEmits(['dismiss', 'pause', 'resume']);
</script>
<template>
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type"
         @click="$emit('dismiss', t.id)"
         @mouseenter="$emit('pause', t)" @mouseleave="$emit('resume', t)">
      <span class="ico"><i :class="t.type === 'error' ? 'fas fa-xmark' : 'fas fa-check'"></i></span>
      <span class="msg">{{ t.message }}</span>
      <span class="dismiss"><i class="fas fa-xmark"></i></span>
      <span :key="t.key" class="bar"></span>
    </div>
  </div>
</template>
```

- [ ] **Step 3: 验证构建**

Run: `npm run build`
Expected: 成功（新文件未被引用，不影响现有构建）

- [ ] **Step 4: Commit**

```bash
git add src/pill-drag.js src/components/Toasts.vue
git commit -m "refactor: 抽出药丸拖拽纯机制 pill-drag.js 与 Toasts 组件"
```

---

### Task 2: useSettings.js

**Files:**
- Create: `src/useSettings.js`

- [ ] **Step 1: 写 `src/useSettings.js`**（原 App.vue:38-68, 105-107, 160-194 原样搬移收拢）

```js
import { ref, reactive, watch } from 'vue';
import { stopSpeech } from './tts.js';
import { loadJson } from './pill-drag.js';

// ponytail: 侧栏参数持久化（分级勾选/高亮/TTS/字幕微调/VAD 后处理），单 key 存 localStorage
const LS_S = 'subtap-settings';

// 设置层:全部持久化字段的 ref + 勾选镜像 + 写回 watch。store 为框架无关词库 store。
export function createSettings(store) {
  const _s = loadJson(LS_S, {});

  // 响应式勾选镜像：从 store 默认值读取（初中/高中/四级=false，其余=true），再用存档覆盖
  const enabled = reactive({});
  for (const lv of store.getLevels()) enabled[lv] = store.isEnabled(lv);
  if (_s.enabled) {
    for (const lv of store.getLevels()) {
      if (lv in _s.enabled) { enabled[lv] = !!_s.enabled[lv]; store.setEnabled(lv, !!_s.enabled[lv]); }
    }
  }

  // 高亮总开关（默认开，只控中栏）
  const highlightOn = ref(_s.highlightOn ?? true);
  // 底部药丸控制条开关(非全屏;全屏播控药丸不受此控)
  const controlBarOn = ref(_s.controlBarOn ?? true);
  // 主题:'light' | 'dark'(以后可加第三种),写 html[data-theme],CSS 按 data-theme 覆盖 token
  const theme = ref(_s.theme ?? 'light');
  watch(theme, v => document.documentElement.dataset.theme = v, { immediate: true });

  // 语音朗读参数(Web Speech API,无媒体时的播放替代)
  const ttsOn = ref(_s.ttsOn ?? false);
  const ttsLang = ref(_s.ttsLang ?? 'en-US');
  const ttsRate = ref(_s.ttsRate ?? 1);
  const ttsVoiceURI = ref(_s.ttsVoiceURI ?? '');   // 空 = 用语言默认声音

  // 字幕微调:endMode 为末尾处理模式(延长/衔接),endOffset 为共用偏移(秒)
  const offset = ref(_s.offset ?? 0);
  const endMode = ref(_s.endMode ?? 'extend');   // 'extend' | 'linkNext'
  const endOffset = ref(_s.endOffset ?? 0);

  // VAD 后处理参数(持久化,秒 → postprocess 的帧数 = 秒/0.01)
  const vadThreshold = ref(_s.vadThreshold ?? 0.6);
  const vadMinSpeech = ref(_s.vadMinSpeech ?? 0.2);
  const vadMinSilence = ref(_s.vadMinSilence ?? 0.1);

  // 持久化字段清单(单一来源):onTweak 分发与存档写回都从这里取
  const cfgRefs = {
    highlightOn, controlBarOn, theme,
    ttsOn, ttsLang, ttsRate, ttsVoiceURI,
    offset, endMode, endOffset,
    vadThreshold, vadMinSpeech, vadMinSilence,
  };
  function onTweak(key, val) { cfgRefs[key].value = val; }
  // 语音朗读开关:关闭时停止正在进行的朗读
  function onToggleTts(val) { ttsOn.value = val; if (!val) stopSpeech(); }
  function onToggleLevel(level, val) { enabled[level] = val; store.setEnabled(level, val); }

  // 写回存档（分级勾选 + cfgRefs 全部字段）
  watch(
    [enabled, ...Object.values(cfgRefs)],
    () => {
      try {
        const data = { enabled: { ...enabled } };
        for (const [k, r] of Object.entries(cfgRefs)) data[k] = r.value;
        localStorage.setItem(LS_S, JSON.stringify(data));
      } catch {}
    },
    { deep: true }
  );

  return { enabled, ...cfgRefs, onTweak, onToggleTts, onToggleLevel };
}
```

- [ ] **Step 2: 验证构建**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: Commit**

```bash
git add src/useSettings.js
git commit -m "refactor: 抽出设置持久化 useSettings.js"
```

---

### Task 3: useVad.js

**Files:**
- Create: `src/useVad.js`

- [ ] **Step 1: 写 `src/useVad.js`**（原 App.vue:79-93, 273-330 原样搬移；`mediaBlob` 改为注入的 `getMediaBlob()`，后处理参数改注入 `cfg` 三个 ref）

```js
import { ref } from 'vue';
import { saveVadSegs, getCachedProbs, putCachedProbs } from './file-history.js';
import { FireRedVadStream, createSession, decodeAudio16k, postprocess, FRAME_SHIFT_S, prefetchVadAssets } from './vad.js';

// VAD 分段转句子(空文本);base 为起始编号(恢复上次/批量追加共用)
export const toSentences = (segs, base = 0) => segs.map(([s, e], i) => ({ id: base + i + 1, start: s, end: e, text: '' }));

// VAD 分段生成的全部状态与流程。依赖注入:
//   sentences/currentId:字幕列表(分段结果直接写入)
//   getMediaBlob:当前媒体的原始 File/Blob(推理解码用)
//   cfg:{ threshold, minSpeech, minSilence } 三个 ref(后处理参数)
//   notify:toast
export function createVad({ sentences, currentId, getMediaBlob, cfg, notify }) {
  const vadGen = ref(null);    // { doneSec, dur } 生成进度(null = 未在生成)
  // 推理结果留存:帧概率 + 时长。改后处理参数时直接重切,不用重新推理。
  const vadProbs = ref(null);  // { probs: number[], dur }
  // 解码后的 16k PCM 只在一次生成期间存在(2h 约 460MB,跑完即释放;重新推理重新解码 ~8s,换内存常驻)
  let vadWav = null;

  const vadCfg = () => ({
    threshold: cfg.threshold.value,
    minSpeech: Math.round(cfg.minSpeech.value / FRAME_SHIFT_S),
    minSilence: Math.round(cfg.minSilence.value / FRAME_SHIFT_S),
  });

  // 一次 push 整批:逐条 push 会每条触发一次全表 computed 重算
  function appendVadSegments(segs) {
    sentences.value.push(...toSentences(segs, sentences.value.length));
  }
  const segsSnapshot = () => sentences.value.map(({ start, end }) => [start, end]);

  // 用 VAD 把音频切成空白字幕分段:先一次性解码成 16k 单声道,
  // 再 30s 一片投喂流式推理,确定的分段即时追加进字幕列表;帧概率留存供改参重切。
  async function generateVadSrt() {
    const mediaBlob = getMediaBlob();
    if (!mediaBlob || vadGen.value) return;
    vadGen.value = { doneSec: 0, dur: 0, ready: false, dlDone: 0, dlTotal: 0 };
    // 点击即预取 wasm+onnx(带下载进度),与音频解码并行;createSession 命中 HTTP 缓存
    prefetchVadAssets(p => {
      if (!vadGen.value) return;
      vadGen.value.dlDone = p.done; vadGen.value.dlTotal = p.total;
    }).then(() => { if (vadGen.value) vadGen.value.dlReady = true; }).catch(() => {});
    sentences.value = [];
    currentId.value = null;
    let session = null;
    try {
      // 解码结果留存,重新推理不重复解码
      if (!vadWav) vadWav = await decodeAudio16k(mediaBlob);
      const wav = vadWav;
      vadGen.value.dur = wav.length / 16000;
      session = await createSession();
      vadGen.value.ready = true;   // session 就绪前可能在下载 wasm/onnx,UI 提示"下载推理组件"
      const vad = new FireRedVadStream(session, vadCfg());
      const STEP = 30 * 16000;
      for (let off = 0; off < wav.length; off += STEP) {
        appendVadSegments(await vad.push(wav.subarray(off, Math.min(off + STEP, wav.length))));
        vadGen.value.doneSec = Math.min(off + STEP, wav.length) / 16000;
        await new Promise(r => setTimeout(r));   // 让 UI 有机会渲染
      }
      appendVadSegments(await vad.flush(vadGen.value.dur));
      vadProbs.value = { probs: vad.probs, dur: vadGen.value.dur };
      // 两笔写同一条记录,必须串行(并发读-改-写会把先写的一方整体覆盖掉)
      await putCachedProbs(new Float32Array(vad.probs), vadGen.value.dur).catch(() => {});
      saveVadSegs(segsSnapshot()).catch(() => {});
      notify('VAD 分段完成：' + sentences.value.length + ' 句');
    } catch (e) {
      notify('VAD 生成失败：' + (e.message || e), 'error');
    } finally {
      session?.release?.();   // webgpu 下 session 不释放会在 GPU 进程累积,拖慢后续所有页面的 webgpu 推理
      vadGen.value = null;
      vadWav = null;   // 及时释放解码 PCM(几百 MB 量级);再推理时重新解码
    }
  }

  // 改后处理参数重切:直接用留存的帧概率,毫秒级
  function resegmentVad() {
    const p = vadProbs.value;
    if (!p) return;
    sentences.value = toSentences(postprocess(p.probs, p.dur, vadCfg()));
    currentId.value = null;
    saveVadSegs(segsSnapshot()).catch(() => {});
  }
  // vad-run 入口:有留存概率 = 改参重切,否则推理
  function runVad() {
    vadProbs.value ? resegmentVad() : generateVadSrt();
  }

  return {
    vadGen, vadProbs, runVad,
    reset: () => { vadProbs.value = null; vadWav = null; },   // 换媒体时旧概率作废
    setProbs: (probs, dur) => { vadProbs.value = { probs, dur }; },   // 命中缓存免推理
  };
}
```

注：`getCachedProbs` 的导入留在 useLoader.js（缓存命中注入在载入媒体时做），本文件不导入。

- [ ] **Step 2: 验证构建**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: Commit**

```bash
git add src/useVad.js
git commit -m "refactor: 抽出 VAD 工作流 useVad.js"
```

---

### Task 4: usePlayback.js

**Files:**
- Create: `src/usePlayback.js`

- [ ] **Step 1: 写 `src/usePlayback.js`**（原 App.vue:370-379, 382-396, 526-616 原样搬移；`ensureActiveVisible` 改注入 `scrollActiveIntoView`；`[ ] / f / Enter` 键所需的布局/视频操作改注入回调；监听挂载收拢为 attach/detach）

```js
import { computed } from 'vue';
import { stopSpeech, speak } from './tts.js';
import { createTwoFingerRecognizer } from './gestures.js';

// 播放意图层:点句播放/键盘/双指手势/蓝牙线控共用同一套命令。
// 依赖注入:核心状态 refs、effectiveRanges computed、getPlayer(挂载前为 null)、
// scrollActiveIntoView(切句后滚动)、toggleFab/toggleVideoCollapse/toggleFullscreen(快捷键动作)。
export function createPlayback({
  sentences, currentId, currentText, isPlaying, mediaKind,
  voices, ttsOn, ttsLang, ttsRate, ttsVoiceURI,
  effectiveRanges, getPlayer, notify,
  scrollActiveIntoView, toggleFab, toggleVideoCollapse, toggleFullscreen,
}) {
  // 当前选中句在列表中的索引（未选为 -1）
  const currentIdx = computed(() => sentences.value.findIndex(s => s.id === currentId.value));

  function stopAll() { getPlayer()?.stop(); stopSpeech(); isPlaying.value = false; }

  // 语音朗读:朗读逻辑在 tts.js,这里只做响应式桥(isPlaying)与提示
  function speakCurrent(text) {
    const r = speak(
      text,
      { lang: ttsLang.value, rate: ttsRate.value, voiceURI: ttsVoiceURI.value, voices: voices.value },
      () => { isPlaying.value = false; },
    );
    if (r === 'unsupported') notify('当前浏览器不支持语音朗读', 'error');
    else if (r === 'ok') isPlaying.value = true;
  }

  // 播放指定句子（点击与键盘共用）：选中 + 区间播放(无媒体时改用语音朗读)
  function playSentence(sentence) {
    currentId.value = sentence.id;
    currentText.value = sentence.text;
    if (mediaKind.value === null) {
      if (ttsOn.value) speakCurrent(sentence.text);
      else notify('请先打开音/视频文件或打开语音朗读功能', 'error');
      return;
    }
    const r = effectiveRanges.value.get(sentence.id) || { effStart: sentence.start, effEnd: sentence.end };
    isPlaying.value = true;
    getPlayer().playSegment(r.effStart, r.effEnd);
  }

  function replayCurrent() {                       // 未选则播第一句
    const i = currentIdx.value;
    if (i >= 0) playSentence(sentences.value[i]);
    else if (sentences.value.length) playSentence(sentences.value[0]);
  }
  function goPrev() {
    const i = currentIdx.value;
    if (i > 0) { playSentence(sentences.value[i - 1]); scrollActiveIntoView(); }
    else if (i === 0) replayCurrent();             // 首句:重播
  }
  function goNext() {
    const i = currentIdx.value, n = sentences.value.length;
    if (i < 0) { playSentence(sentences.value[0]); scrollActiveIntoView(); }  // 未选 → 第一句
    else if (i < n - 1) { playSentence(sentences.value[i + 1]); scrollActiveIntoView(); }
  }

  // 方向键播放控制。焦点在输入框时不拦截，避免影响微调数字输入。
  function onKeydown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    // 面板收展快捷键:不依赖字幕,空载引导页也可用。
    if (e.key === '[') { e.preventDefault(); toggleFab('left'); return; }
    if (e.key === ']') { e.preventDefault(); toggleFab('right'); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleVideoCollapse(); return; }
    // 回车:视频全屏切换(需媒体手势授权,键盘事件算 user activation)。全屏后快捷键仍走此全局监听。
    if (e.key === 'Enter' && mediaKind.value === 'video') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (!sentences.value.length) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        goNext(); break;                    // 末句 → 不操作
      case 'ArrowUp':
        e.preventDefault();
        goPrev(); break;                    // 首句 → 重播当前句
      case 'ArrowLeft':
        e.preventDefault();
        if (currentIdx.value >= 0) replayCurrent();   // 重读当前句（不滚动）
        break;
      case 'ArrowRight':
      case ' ':              // 空格 = 播放中暂停、未播放重播（同药丸中间按钮）
      case 'Spacebar':
        e.preventDefault();
        isPlaying.value ? stopAll() : replayCurrent();
        break;
    }
  }

  // 双指手势:上/下滑切句,轻点播放中停止/未播重播(同空格)
  const gesture = createTwoFingerRecognizer({
    onSwipe: dir => (dir > 0 ? goNext() : goPrev()),
    onTap: () => { isPlaying.value ? stopAll() : replayCurrent(); },
  });

  // 键盘/手势/蓝牙线控监听挂载(App 的 onMounted/onUnmounted 调用)。
  // 线控需要媒体会话激活(载入媒体时设 metadata)。
  function attach() {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('touchstart', gesture.onTouch, { passive: false });
    window.addEventListener('touchmove', gesture.onTouch, { passive: false });
    window.addEventListener('touchend', gesture.onTouchEnd, { passive: false });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('previoustrack', goPrev);
      navigator.mediaSession.setActionHandler('nexttrack', goNext);
      navigator.mediaSession.setActionHandler('play', replayCurrent);
      navigator.mediaSession.setActionHandler('pause', stopAll);
    }
  }
  function detach() {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('touchstart', gesture.onTouch);
    window.removeEventListener('touchmove', gesture.onTouch);
    window.removeEventListener('touchend', gesture.onTouchEnd);
  }

  return { playSentence, stopAll, replayCurrent, goPrev, goNext, attach, detach };
}
```

- [ ] **Step 2: 验证构建**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: Commit**

```bash
git add src/usePlayback.js
git commit -m "refactor: 抽出播放命令层 usePlayback.js(键盘/手势/线控)"
```

---

### Task 5: useLoader.js

**Files:**
- Create: `src/useLoader.js`

- [ ] **Step 1: 写 `src/useLoader.js`**（原 App.vue:199-270, 332-359 原样搬移；`mediaBlob` 改为模块内 `let` + 暴露 `getMediaBlob`，写入靠注入的 `setMediaBlob`（App 侧 `let` 存放供 VAD 用）；`videoCollapsed` 改注入 `expandVideo` 回调；停止播放复用 playback 的 `stopAll`）

```js
import { ref } from 'vue';
import { parseSRT } from './srt-parser.js';
import { saveFile, saveVadSegs, loadFiles, getCachedProbs } from './file-history.js';
import { stopSpeech } from './tts.js';
import { toSentences } from './useVad.js';
import sampleSrt from './assets/sample/sample.srt?raw';
import sampleAudio from './assets/sample/sample.aac';

// 文件载入层:外部字幕/音视频载入、清除、内置示例、恢复上次。
// 依赖注入:核心状态 refs、stopAll(playback)、getPlayer、vad(reset/setProbs)、
// setMediaBlob(App 侧持有原始 Blob 供 VAD 解码)、expandVideo(载入视频时展开)、
// selectSentenceById(恢复上次进度时选中并滚动)、notify。
export function createLoader({
  sentences, currentId, currentText, isPlaying, mediaKind, srtFromFile,
  stopAll, getPlayer, vad, setMediaBlob, expandVideo, notify, selectSentenceById,
}) {
  let mediaBlob = null;   // 本模块写入,经 setMediaBlob 同步给 App(VAD 解码用);getMediaBlob 供缓存比对
  const getMediaBlob = () => mediaBlob;

  // 应用字幕文本(不含提示,由调用方决定文案)。文件按钮与示例按钮共用。
  function applySubtitle(text) {
    srtFromFile.value = true;
    sentences.value = parseSRT(text);
    stopAll();
    currentId.value = null;
    currentText.value = '';
  }

  // 应用媒体源 URL + 显示名 + 类型。文件按钮与示例按钮共用。
  function applyMediaSrc(url, name, kind) {
    stopAll();
    getPlayer().setSrc(url);
    mediaKind.value = kind;
    // 设媒体元数据激活 media session,蓝牙线控才会派发按钮事件
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: name });
    if (kind === 'video') expandVideo();
  }

  function onSrtFile(file, save = true, selectId = null) {
    if (!file) return;
    if (save) saveFile('srt', file);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applySubtitle(reader.result);
        // 恢复上次:选中并滚到上次的句子
        if (selectId !== null) selectSentenceById(selectId);
        if (save) notify('已载入 ' + sentences.value.length + ' 句字幕');
      } catch (e) {
        notify('字幕解析失败：' + e.message, 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function onMediaFile(file, save = true) {
    if (!file) return;
    if (save) saveFile('media', file);
    mediaBlob = file;
    setMediaBlob(file);
    vad.reset();   // 换媒体,旧概率作废
    const isVideo = (file.type || '').startsWith('video/');
    applyMediaSrc(URL.createObjectURL(file), file.name, isVideo ? 'video' : 'audio');
    if (save) notify('已载入：' + file.name);
    // 命中缓存则免推理:直接注入留存概率,改参重切/重新分段都可用
    getCachedProbs(file).then(c => {
      if (c && mediaBlob === file) {
        vad.setProbs(c.probs, c.dur);
        if (save) notify('已复用该媒体的 VAD 结果(免推理)');
      }
    }).catch(() => {});
  }

  // 清除字幕/媒体(侧栏文件按钮旁的 ×):复用载入路径,再补各自的清理
  function clearSrt() {
    applySubtitle('');
    srtFromFile.value = false;
  }
  function clearMedia() {
    applyMediaSrc('', '', null);
    mediaBlob = null;
    setMediaBlob(null);
    vad.reset();   // 概率随媒体失效
  }

  // 一键载入内置示例(空载引导页按钮触发):字幕 + 音频,单条成功提示。
  function loadSample() {
    try {
      applySubtitle(sampleSrt);
    } catch (e) {
      notify('示例字幕解析失败：' + e.message, 'error');
      return;
    }
    applyMediaSrc(sampleAudio, '示例音频', 'audio');
    fetch(sampleAudio).then(r => r.blob()).then(b => { mediaBlob = b; setMediaBlob(b); });
    notify('已载入示例');
  }

  // 打开上次(空载引导页按钮触发):从 IndexedDB 取缓存的文件,直接走载入路径。
  const canRestore = ref(false);
  loadFiles().then(r => { canRestore.value = !!(r && (r.srt || r.media)); });
  async function restoreLast() {
    const rec = await loadFiles();
    if (!rec || (!rec.srt && !rec.vadSegs && !rec.media)) { canRestore.value = false; notify('没有可恢复的文件', 'error'); return; }
    // VAD 生成的字幕:直接重建分段(不走解析),srtFromFile 保持 false,VAD 面板仍可用
    if (rec.srtSource === 'vad' && rec.vadSegs) {
      sentences.value = toSentences(rec.vadSegs);
      selectSentenceById(rec.sentenceId);
    } else if (rec.srt) {
      onSrtFile(rec.srt, false, rec.sentenceId ?? null);
    }
    if (rec.media) onMediaFile(rec.media, false);
  }

  return { canRestore, getMediaBlob, onSrtFile, onMediaFile, clearSrt, clearMedia, loadSample, restoreLast };
}
```

注：`isPlaying`/`stopSpeech` 导入里 `stopSpeech` 未直接用（stopAll 内已含）——实际导入只需 `parseSRT/saveFile/loadFiles/getCachedProbs/saveVadSegs`。检查:saveVadSegs 未在本文件用(重切在 useVad)。**最终 import 行为：**

```js
import { saveFile, loadFiles, getCachedProbs } from './file-history.js';
```

（即删掉 `saveVadSegs` 与 `stopSpeech` 两个未用导入。）

- [ ] **Step 2: 验证构建**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: Commit**

```bash
git add src/useLoader.js
git commit -m "refactor: 抽出文件载入层 useLoader.js"
```

---

### Task 6: VideoStage.vue

**Files:**
- Create: `src/components/VideoStage.vue`

- [ ] **Step 1: 写 `src/components/VideoStage.vue`**（原 App.vue:109-145(拖高/meta/折叠), 400-404, 452-466(全屏药丸), 512-524(全屏), 663-689(模板) 原样搬移。fullscreenchange 监听随组件走；expose `mediaEl/toggleCollapse/toggleFullscreen` 供 App 侧 Player 与快捷键使用；自带一套 createPillSystem）

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import PillControls from './PillControls.vue';
import { createPillSystem, loadPos } from '../pill-drag.js';

const props = defineProps({
  mediaKind: { type: String, default: null },      // 'video' | 'audio' | null
  playing: { type: Boolean, default: false },
  hasSentences: { type: Boolean, default: false },
});
const emit = defineEmits(['fullscreenchange', 'prev', 'toggle', 'next']);

const mediaEl = ref(null);
const videoHeight = ref(240);
const videoCollapsed = ref(false);

let dragging = false, dragStartY = 0, dragStartH = 0;
function startResize(e) {
  dragging = true;
  dragStartY = e.clientY;
  dragStartH = videoHeight.value;
  // 指针锁定:手指/鼠标移出把手区域仍持续收到 move,鼠标/触摸统一走 Pointer Events
  e.target.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onResize(e) {
  if (!dragging) return;
  const delta = e.clientY - dragStartY; // 向下拖→把手向下→视频变高
  const maxH = window.innerHeight * 0.5; // 上限:视窗一半
  let h = dragStartH + delta;
  if (h < 100) h = 100;
  if (h > maxH) h = maxH;
  videoHeight.value = h;
}
function stopResize() { dragging = false; }
// 视频元数据就绪:按原始宽高比 + 当下容器宽算高度,封顶视窗一半。
// 视频本身较矮就适配它,而不是一上来占半屏。
function onVideoMeta() {
  const v = mediaEl.value;
  if (!v || !v.videoWidth) return;
  const w = v.clientWidth || v.parentElement.clientWidth;
  let h = w * (v.videoHeight / v.videoWidth);
  const maxH = window.innerHeight * 0.5;
  if (h > maxH) h = maxH;
  videoHeight.value = Math.round(h);
}
function toggleCollapse() {
  videoCollapsed.value = !videoCollapsed.value;
}

// ===== 全屏 =====
const stageRef = ref(null);           // 全屏容器(video + 控件层),全屏它而非 video 本身,控件层才能在全屏内显示
const isFullscreen = ref(false);
const videoOverlay = ref(false);      // 点击视频显示/隐藏悬浮控件(非全屏的 ⛶ 与全屏的播控药丸共用)

// 进全屏时:横版视频 + 设备竖屏 → 锁横屏(手机/平板观看体验);
// 退全屏浏览器自动解除方向锁。iOS Safari 不支持 lock,失败静默(用户手动转屏)。
async function toggleFullscreen() {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  await stageRef.value.requestFullscreen();
  const v = mediaEl.value;
  const portrait = matchMedia('(orientation: portrait)').matches;
  if (v.videoWidth > v.videoHeight && portrait) {
    try { await screen.orientation.lock('landscape'); } catch { /* 不支持则忽略 */ }
  }
}
function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
  emit('fullscreenchange');   // App 侧把底部控制条药丸夹回可见区
}

// ===== 全屏播控药丸 =====
// 播控药丸拖动:位置按"药丸中心占视频比例"存 localStorage,任意尺寸/全屏下等比复现
const VC_POS_KEY = 'videoCtrlPos';
const { makePillDrag, guard } = createPillSystem();
const pillRef = ref(null);
const vcPos = ref(loadPos(VC_POS_KEY, { x: 0.5, y: 0.55 }));
let vcStageRect = null;   // down 时量一次,拖动热路径零 DOM 读取
const vcPillDrag = makePillDrag({
  getEl: () => { vcStageRect = stageRef.value.getBoundingClientRect(); return pillRef.value; },
  clamp: (cx, cy, halfX, halfY) => {
    const st = vcStageRect;
    const x = Math.min(Math.max(cx, st.left + halfX), st.right - halfX);
    const y = Math.min(Math.max(cy, st.top + halfY), st.bottom - halfY);
    vcPos.value = { x: (x - st.left) / st.width, y: (y - st.top) / st.height };
  },
  persist: () => localStorage.setItem(VC_POS_KEY, JSON.stringify(vcPos.value)),
});

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange));
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  vcPillDrag.cancel();
});

// App 侧需要:Player 拿 mediaEl、快捷键 f/Enter 拿折叠/全屏
defineExpose({ mediaEl, toggleCollapse, toggleFullscreen });
</script>

<template>
  <div class="video-slot" :class="{ 'no-video': mediaKind !== 'video', collapsed: videoCollapsed }">
    <div v-show="!videoCollapsed" ref="stageRef" class="video-stage"
         :style="isFullscreen ? undefined : { height: videoHeight + 'px' }"
         @click="videoOverlay = !videoOverlay">
      <video ref="mediaEl" class="media-video"
             preload="metadata"
             @loadedmetadata="onVideoMeta"
             @dblclick.prevent="toggleCollapse"></video>
      <!-- 非全屏:右下角"进全屏"按钮(点击视频显隐) -->
      <button v-if="videoOverlay" class="vc-fs" :title="isFullscreen ? '退出全屏' : '全屏'" @click.stop="guard(toggleFullscreen, $event)">
        <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
      </button>
      <!-- 全屏:播控药丸(可拖动定位,位置持久化) -->
      <div v-if="isFullscreen && videoOverlay" ref="pillRef" class="vc-pill"
           :style="{ left: vcPos.x * 100 + '%', top: vcPos.y * 100 + '%' }"
           @pointerdown="vcPillDrag.down" @click.stop>
        <PillControls :guard="guard" :disabled="!hasSentences" :playing="playing"
                      @prev="$emit('prev')" @toggle="$emit('toggle')" @next="$emit('next')" />
      </div>
      <!-- 1px 全透明钉子:画面内容区顶部居中,阻止 Chromium 把拖进黑边的药丸剔除不绘制 -->
      <div class="vc-anchor"></div>
    </div>
    <div v-show="!videoCollapsed" class="resize-handle"
         @pointerdown="startResize" @pointermove="onResize"
         @pointerup="stopResize" @pointercancel="stopResize"></div>
    <button v-if="videoCollapsed" class="expand-btn" @click="toggleCollapse"><i class="fas fa-play" style="margin-right:6px"></i> 展开视频</button>
  </div>
</template>
```

注：`props` 变量未直接在 script 中使用（模板直接用 prop 名），写成 `defineProps({...})` 不赋值亦可；为清晰起见保留 `const props = defineProps(...)` 或去掉赋值，二选一，构建不报错即可。

- [ ] **Step 2: 验证构建**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: Commit**

```bash
git add src/components/VideoStage.vue
git commit -m "refactor: 抽出视频区组件 VideoStage.vue(拖高/折叠/全屏/播控药丸)"
```

---

### Task 7: 重写 App.vue 为编排层

**Files:**
- Modify: `src/App.vue`（整文件替换）

- [ ] **Step 1: 用以下内容整体替换 `src/App.vue`**

```vue
<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import vocab from './vocabulary.json';
import { tokenizeForRender } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import { computeEffectiveRanges } from './subtitle-tweak.js';
import { LEVEL_COLORS } from './level-colors.js';
import { saveProgress } from './file-history.js';
import { createToasts } from './toast.js';
import { ttsSupported, loadVoices } from './tts.js';
import { createLayout } from './useLayout.js';
import { createSettings } from './useSettings.js';
import { createVad } from './useVad.js';
import { createLoader } from './useLoader.js';
import { createPlayback } from './usePlayback.js';
import { createPillSystem, loadPos } from './pill-drag.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';
import PillControls from './components/PillControls.vue';
import VideoStage from './components/VideoStage.vue';
import Toasts from './components/Toasts.vue';

// ===== 词库 store(框架无关) =====
const store = createVocabStore();
store.init(vocab);
const vocabTable = store.getVocab();

// ===== 设置(持久化字段 + 勾选镜像) =====
const {
  enabled, highlightOn, controlBarOn, theme,
  ttsOn, ttsLang, ttsRate, ttsVoiceURI,
  offset, endMode, endOffset,
  vadThreshold, vadMinSpeech, vadMinSilence,
  onTweak, onToggleTts, onToggleLevel,
} = createSettings(store);
const voices = ref([]);

// ===== 核心状态(各功能模块共享,留在编排层) =====
const sentences = ref([]);
const currentId = ref(null);
const currentText = ref('');
const isPlaying = ref(false);
const mediaKind = ref(null);      // 'video' | 'audio' | null
let mediaBlob = null;             // 当前媒体的原始 File/Blob(VAD 解码用,非响应式;useLoader 写入)
const srtFromFile = ref(false);   // 用户载入的外部字幕(VAD 分段不算)

// toast:自动消失的状态消息(成功/错误均 2.5s)
const { toasts, notify, dismiss, pauseToast, resumeToast, disposeToasts } = createToasts();

// ===== 派生 computed =====
// 中栏渲染用：每句附加 tokens（仅依赖 sentences，缓存）
const renderedSentences = computed(() =>
  sentences.value.map(s => ({ ...s, tokens: tokenizeForRender(s.text, vocabTable) }))
);
// 末尾处理二选一:延长模式传 extend;衔接模式传 linkNext + linkNextOffset(底层互斥)
const effectiveRanges = computed(() => {
  const opts = endMode.value === 'linkNext'
    ? { offset: offset.value, linkNext: true, linkNextOffset: endOffset.value }
    : { offset: offset.value, extend: endOffset.value };
  return computeEffectiveRanges(sentences.value, opts);
});
// 有内容时 FAB 自动半透明（不遮挡视频），空载页全可见
const hasContent = computed(() => mediaKind.value !== null || sentences.value.length > 0);

// ===== 子组件实例与播放器 =====
const stageRef = ref(null);          // VideoStage(expose: mediaEl/toggleCollapse/toggleFullscreen)
const sentenceListRef = ref(null);
let player = null;
const getPlayer = () => player;

// 侧栏布局(三态状态机/拖宽/收展)在 useLayout.js;resize 后需把控制条药丸夹回可见区
const { leftWidth, rightWidth, hasOverlay, layoutClass, startSideResize, collapseLeft, collapseRight, toggleFab, closeBoth } = createLayout(clampCbIntoView);

// ===== 功能模块接线(依赖注入) =====
const { vadGen, vadProbs, runVad, reset: resetVad, setProbs } = createVad({
  sentences, currentId,
  getMediaBlob: () => mediaBlob,
  cfg: { threshold: vadThreshold, minSpeech: vadMinSpeech, minSilence: vadMinSilence },
  notify,
});

const { playSentence, stopAll, replayCurrent, goPrev, goNext, attach: attachPlayback, detach: detachPlayback } = createPlayback({
  sentences, currentId, currentText, isPlaying, mediaKind,
  voices, ttsOn, ttsLang, ttsRate, ttsVoiceURI,
  effectiveRanges, getPlayer, notify,
  scrollActiveIntoView: () => nextTick(() => sentenceListRef.value?.ensureVisible()),
  toggleFab,
  toggleVideoCollapse: () => stageRef.value?.toggleCollapse(),
  toggleFullscreen: () => stageRef.value?.toggleFullscreen(),
});

const { canRestore, onSrtFile, onMediaFile, clearSrt, clearMedia, loadSample, restoreLast } = createLoader({
  sentences, currentId, currentText, isPlaying, mediaKind, srtFromFile,
  stopAll, getPlayer, vad: { reset: resetVad, setProbs },
  setMediaBlob: b => { mediaBlob = b; },
  expandVideo: () => { /* 载入视频时展开折叠:经 stageRef 调 VideoStage 内部状态 */ stageExpandVideo(); },
  notify, selectSentenceById,
});

// VideoStage 没有直接暴露"展开"方法——expandVideo 需要在 VideoStage 的 defineExpose 中补一个 expand():
// 见下方 Step 2 的补充修改。stageExpandVideo 定义:
function stageExpandVideo() { stageRef.value?.expand(); }

// ===== 底部控制条药丸(依赖中栏 DOM 与侧栏布局互作用,留在编排层) =====
// 悬浮竖版药丸(同 vc-pill 样式),可拖动,中心点按视口比例存 localStorage,
// 转屏/换设备后等比复现(手机全屏锁横屏→退出的转场不会把位置夹丢)。旧版 px 坐标超界作废。
const CB_POS_KEY = 'ctrlBarPos';
const { makePillDrag, guard: guardPillClick } = createPillSystem();
const cbRef = ref(null);
const cbPos = ref(loadPos(CB_POS_KEY, { x: 0.5, y: 0.82 }));
// 活动范围限中栏可见区:中栏 rect(侧栏为绝对定位叠放,需把展开的侧栏扣掉),不会钻进侧栏/飞出屏幕
let cbBounds = null;
function measureCbBounds() {
  const r = cbRef.value.parentElement.getBoundingClientRect();
  let left = r.left, right = r.right;
  for (const p of document.querySelectorAll('.panel-left, .panel-right')) {
    const pr = p.getBoundingClientRect();
    if (pr.right <= r.left || pr.left >= r.right || pr.height < 10) continue;   // 折叠/不占中栏
    if (p.classList.contains('panel-left')) left = Math.max(left, pr.right);
    else right = Math.min(right, pr.left);
  }
  return { left, right, top: r.top, bottom: r.bottom };
}
const cbDrag = makePillDrag({
  getEl: () => { cbBounds = measureCbBounds(); return cbRef.value; },   // down 时量一次,拖动热路径零 DOM 读取
  clamp: (cx, cy, halfX, halfY) => {
    const b = cbBounds;
    cbPos.value = {
      x: Math.min(Math.max(cx, b.left + halfX), b.right - halfX) / innerWidth,
      y: Math.min(Math.max(cy, b.top + halfY), b.bottom - halfY) / innerHeight,
    };
  },
  persist: () => localStorage.setItem(CB_POS_KEY, JSON.stringify(cbPos.value)),
});
// 药丸出现/窗口尺寸/布局变化时夹回可见区(存的位置可能已被侧栏盖住或跑到屏幕外)
function clampCbIntoView() {
  if (document.fullscreenElement) return;   // 全屏期药丸不可见,别按全屏视口夹比例;退出时再夹
  nextTick(() => {
    if (!cbRef.value) return;
    cbBounds = measureCbBounds();
    const pl = cbRef.value.getBoundingClientRect();
    const p = cbPos.value;
    const hx = pl.width / 2, hy = pl.height / 2;
    const nx = Math.min(Math.max(p.x * innerWidth, cbBounds.left + hx), cbBounds.right - hx) / innerWidth;
    const ny = Math.min(Math.max(p.y * innerHeight, cbBounds.top + hy), cbBounds.bottom - hy) / innerHeight;
    if (nx !== p.x || ny !== p.y) cbPos.value = { x: nx, y: ny };   // 不越界不写,免触发无谓更新
  });
}
watch([() => sentences.value.length, layoutClass, leftWidth, rightWidth], clampCbIntoView);

// ===== 进度与选中 =====
// 点句即记进度(异步,失败静默)
watch(currentId, id => { if (sentences.value.length) saveProgress(id); });
// 按选中并滚到可见(恢复上次进度时用;找不到 id 则不动)
function selectSentenceById(id) {
  const s = sentences.value.find(x => x.id === id);
  if (s) { currentId.value = s.id; currentText.value = s.text; nextTick(() => sentenceListRef.value?.ensureVisible(true)); }
}

// ===== 挂载 =====
onMounted(() => {
  const el = stageRef.value.mediaEl;
  player = new Player(el);
  player.onStop(() => { isPlaying.value = false; });
  el.addEventListener('error', () => {
    if (el.error && mediaKind.value !== null) {
      isPlaying.value = false;
      notify('音/视频无法播放（编码不支持），建议改用 mp4/mp3', 'error');
    }
  });
  attachPlayback();
  // 加载 TTS 声音列表(异步,部分浏览器会多次触发 voiceschanged)。
  // getVoices() 中途可能返回空数组 → loadVoices 空结果返回 null,不覆盖已加载声音。
  const syncVoices = () => { const l = loadVoices(); if (l) voices.value = l; };
  syncVoices();
  if (ttsSupported) window.speechSynthesis.onvoiceschanged = syncVoices;
});
onUnmounted(() => {
  detachPlayback();
  cbDrag.cancel();
  disposeToasts();
});
</script>

<template>
  <div class="layout" :class="[layoutClass, { 'has-content': hasContent }]" :style="{ '--panel-left-w': leftWidth + 'px', '--panel-right-w': rightWidth + 'px' }">
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      :offset="offset"
      :end-mode="endMode"
      :end-offset="endOffset"
      :highlight-on="highlightOn"
      :control-bar-on="controlBarOn"
      :tts-on="ttsOn"
      :tts-lang="ttsLang"
      :tts-rate="ttsRate"
      :tts-voice-uri="ttsVoiceURI"
      :voices="voices"
      :theme="theme"
      :has-srt="sentences.length > 0"
      :srt-from-file="srtFromFile"
      :has-media="mediaKind !== null"
      :vad-has-probs="!!vadProbs"
      :vad-gen="vadGen"
      :vad-threshold="vadThreshold"
      :vad-min-speech="vadMinSpeech"
      :vad-min-silence="vadMinSilence"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
      @clear-srt="clearSrt"
      @clear-media="clearMedia"
      @vad-run="runVad"
      @tweak="onTweak"
      @toggle-tts="onToggleTts"
      @collapse="collapseLeft"
      @resizestart="startSideResize('left', $event)"
    />
    <main class="panel-center">
      <VideoStage
        ref="stageRef"
        :media-kind="mediaKind"
        :playing="isPlaying"
        :has-sentences="sentences.length > 0"
        @fullscreenchange="clampCbIntoView"
        @prev="goPrev"
        @toggle="isPlaying ? stopAll() : replayCurrent()"
        @next="goNext"
      />
      <SentenceList
        ref="sentenceListRef"
        :sentences="renderedSentences"
        :current-id="currentId"
        :is-playing="isPlaying"
        :enabled="enabled"
        :highlight-on="highlightOn"
        :colors="LEVEL_COLORS"
        :can-restore="canRestore"
        :media-loaded="mediaKind !== null"
        @click="playSentence"
        @copy="notify('已复制')"
        @sample="loadSample"
        @restore="restoreLast"
      />
      <nav v-if="sentences.length && controlBarOn" ref="cbRef" class="control-bar"
           :style="{ left: cbPos.x * 100 + '%', top: cbPos.y * 100 + '%' }"
           @pointerdown="cbDrag.down" @click.stop>
        <!-- 外层 v-if 已保证有字幕,disabled 免传 -->
        <PillControls :guard="guardPillClick" :playing="isPlaying"
                      @prev="goPrev" @toggle="isPlaying ? stopAll() : replayCurrent()" @next="goNext" />
      </nav>
    </main>
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
      :colors="LEVEL_COLORS"
      @collapse="collapseRight"
      @resizestart="startSideResize('right', $event)"
    />
    <button class="float-btn float-btn-left"  title="展开设置栏（[）" @click="toggleFab('left')"><i class="fas fa-bars"></i></button>
    <button class="float-btn float-btn-right" title="展开词卡栏（]）" @click="toggleFab('right')"><i class="fas fa-bars"></i></button>
    <div class="scrim" :class="{ show: hasOverlay }" @click="closeBoth"></div>
  </div>
  <Toasts :toasts="toasts" @dismiss="dismiss" @pause="pauseToast" @resume="resumeToast" />
</template>
```

- [ ] **Step 2: 补 VideoStage.vue 的 expand()**

Task 6 的 VideoStage.vue `defineExpose` 行改为（并新增 expand 函数）：

```js
function expand() { videoCollapsed.value = false; }   // 载入视频时恢复展开(useLoader 的 expandVideo 经 App 调用)
defineExpose({ mediaEl, toggleCollapse, toggleFullscreen, expand });
```

同时 App.vue 中 loader 接线处 `expandVideo: () => stageRef.value?.expand()` 可直接写，删掉 Step 1 中的 `stageExpandVideo` 中转函数（那是备选写法，采用本步后删除）。

- [ ] **Step 3: 验证构建 + 行数**

Run: `npm run build && wc -l src/App.vue`
Expected: 构建成功；行数 < 300

- [ ] **Step 4: Commit**

```bash
git add src/App.vue src/components/VideoStage.vue
git commit -m "refactor: App.vue 收敛为编排层(状态+接线+三栏模板),<300 行"
```

---

### Task 8: 双轨构建验证 + CLAUDE.md 更新 + 手动验收清单

**Files:**
- Modify: `CLAUDE.md`（架构表补新文件）

- [ ] **Step 1: 双轨构建**

Run: `npm run build && npm run build:pwa`
Expected: 均成功，无 "Could not dynamically require" 等运行时陷阱（构建期无报错即可）

- [ ] **Step 2: test.html 断言**

Run: `npm run dev` 后访问 `http://localhost:5173/test.html`
Expected: 全部断言通过（纯逻辑层未动，应原样绿）

- [ ] **Step 3: 更新 CLAUDE.md 架构表**

纯逻辑层表格末尾追加（或紧随其后新增"组合层"小节）：

```markdown
**组合层（Vue composable，依赖注入接线，App.vue 编排）：** `useLayout.js`（侧栏布局）、`useSettings.js`（设置持久化+勾选镜像）、`useVad.js`（VAD 工作流）、`usePlayback.js`（播放命令/键盘/手势/线控）、`useLoader.js`（文件载入/示例/恢复）、`pill-drag.js`（药丸拖拽纯机制，无 Vue 依赖）。共享核心状态（sentences/currentId/isPlaying/player/mediaBlob）留在 App.vue，工厂函数接收依赖返回 API，不用 provide/inject。
```

UI 层一段的组件列表补 `VideoStage.vue`（视频区+全屏+播控药丸）、`Toasts.vue`。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 架构表补组合层与新组件"
```

- [ ] **Step 5: 用户手动验收清单（交给用户本人在浏览器过）**

- 载入示例/字幕文件/音视频文件、清除、恢复上次（含 VAD 字幕恢复）
- 点句播放、区间微调（延长/衔接两种模式）、TTS 朗读开关
- 键盘：`↓/↑` 切句、`←` 重读、`→/空格` 停止、`[ ]` 侧栏、`f` 折叠视频、`Enter` 全屏（焦点在输入框时不拦截）
- 底部控制条药丸：拖动（松手位置持久化，刷新后等比复现）、点击不被拖动误触、侧栏展开时被夹回中栏
- 全屏：进/出、全屏内播控药丸拖动与持久化、横屏锁定
- 视频拖高、双击折叠/展开、空载引导页按钮
- VAD：推理进度提示、改参点"重新推理"走毫秒级重切、换媒体后旧概率作废
- toast 悬停暂停、点击关闭
- 设置持久化：改任意设置刷新后保留

---

## Self-Review 记录

- **覆盖**：App.vue 625 行 script + 108 行模板全部有去处（settings/vad/loader/playback/pill-drag/VideoStage/Toasts/App 保留项），无遗漏块。
- **占位符**：无 TBD/TODO；Step 2 的 `stageExpandVideo` 中转与直接 `expand()` 二义已在 Step 2 消解（采用后者，删中转）。
- **类型/签名一致性**：`createVad` 返回 `{vadGen, vadProbs, runVad, reset, setProbs}` 与 App/loader 用法一致；`createLoader` 的 `vad` 参数 App 侧传 `{ reset: resetVad, setProbs }`，签名匹配；`toSentences` 从 useVad.js 导出、useLoader 导入；`guard` 两处（VideoStage 内建、App 自建）语义一致。
- **行为差异审查**：仅两处等价改写——(1) 药丸 suppress 标志从全局共享改为按药丸各一套（同一药丸内自吞语义不变，跨药丸本就不可能同轮触发）；(2) `applySubtitle` 里 `if (player) player.stop(); stopSpeech(); isPlaying=false` 收拢为 `stopAll()`（getPlayer()?.stop() 含原判空）。其余逐行原样搬移。
