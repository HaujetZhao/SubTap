<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import vocab from './vocabulary.json';
import { parseSRT } from './srt-parser.js';
import { tokenizeForRender } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import { computeEffectiveRanges } from './subtitle-tweak.js';
import { LEVEL_COLORS } from './level-colors.js';
import { saveFile, saveVadSegs, saveProgress, loadFiles, getCachedProbs, putCachedProbs } from './file-history.js';
import { FireRedVadStream, createSession, decodeAudio16k, postprocess, FRAME_SHIFT_S, prefetchVadAssets } from './vad.js';
import { createToasts } from './toast.js';
import { ttsSupported, stopSpeech, loadVoices, speak } from './tts.js';
import { createTwoFingerRecognizer } from './gestures.js';
import { createLayout } from './useLayout.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';
import PillControls from './components/PillControls.vue';
import sampleSrt from './assets/sample/sample.srt?raw';
import sampleAudio from './assets/sample/sample.aac';

// 词库 store（框架无关，非响应式）
const store = createVocabStore();
store.init(vocab);
const vocabTable = store.getVocab();

// localStorage JSON 读取统一入口(解析失败/为空返回 fallback)
function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
// 药丸位置(0..1 比例坐标)读取:越界/缺字段作废用默认值
function loadPos(key, def) {
  const p = loadJson(key, null);
  return (p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) ? p : def;
}

// ponytail: 侧栏参数持久化（分级勾选/高亮/TTS/字幕微调），单 key 存 localStorage
const LS_S = 'subtap-settings';
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

// 底部控制条（手机盲操）:有字幕时常驻,竖版悬浮药丸可拖

// 语音朗读(Web Speech API,无媒体时的播放替代)
const ttsOn = ref(_s.ttsOn ?? false);
const ttsLang = ref(_s.ttsLang ?? 'en-US');
const ttsRate = ref(_s.ttsRate ?? 1);
const ttsVoiceURI = ref(_s.ttsVoiceURI ?? '');   // 空 = 用语言默认声音
const voices = ref([]);

// 全局状态
const sentences = ref([]);
const currentId = ref(null);
const currentText = ref('');
const isPlaying = ref(false);
const mediaKind = ref(null); // 'video' | 'audio' | null
let mediaBlob = null;        // 当前媒体的原始 File/Blob(VAD 解码用,非响应式)

// VAD 生成字幕分段的状态(null = 未在生成)
const vadGen = ref(null);    // { doneSec, dur }
// 推理结果留存:帧概率 + 时长。改后处理参数时直接重切,不用重新推理。
const vadProbs = ref(null);  // { probs: number[], dur }
// 解码后的 16k PCM 只在一次生成期间存在(2h 约 460MB,跑完即释放;
// 下次完整推理重新解码 ~8s,换内存常驻)。
let vadWav = null;
// 后处理参数(持久化,秒 → postprocess 的帧数 = 秒/0.01)
const vadThreshold = ref(_s.vadThreshold ?? 0.6);
const vadMinSpeech = ref(_s.vadMinSpeech ?? 0.2);
const vadMinSilence = ref(_s.vadMinSilence ?? 0.1);
const vadCfg = () => ({
  threshold: vadThreshold.value,
  minSpeech: Math.round(vadMinSpeech.value / FRAME_SHIFT_S),
  minSilence: Math.round(vadMinSilence.value / FRAME_SHIFT_S),
});

// 侧栏布局(三态状态机/拖宽/收展)独立在 useLayout.js;resize 后需把控制条药丸夹回可见区
const { leftWidth, rightWidth, hasOverlay, layoutClass, startSideResize, collapseLeft, collapseRight, toggleFab, closeBoth } = createLayout(clampCbIntoView);

// 有内容时 FAB 自动半透明（不遮挡视频），空载页全可见
const hasContent = computed(() => mediaKind.value !== null || sentences.value.length > 0);

// toast:自动消失的状态消息(成功/错误均 2.5s)
const { toasts, notify, dismiss, pauseToast, resumeToast, disposeToasts } = createToasts();

// 字幕微调参数:endMode 为末尾处理模式(延长/衔接),endOffset 为两者共用的偏移(秒)
const offset = ref(_s.offset ?? 0);
const endMode = ref(_s.endMode ?? 'extend');   // 'extend' | 'linkNext'
const endOffset = ref(_s.endOffset ?? 0);

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

// 持久化设置的字段清单(单一来源):onTweak 分发与存档写回都从这里取
const cfgRefs = {
  highlightOn, controlBarOn, theme,
  ttsOn, ttsLang, ttsRate, ttsVoiceURI,
  offset, endMode, endOffset,
  vadThreshold, vadMinSpeech, vadMinSilence,
};

function onTweak(key, val) {
  cfgRefs[key].value = val;
}
// 语音朗读开关:关闭时停止正在进行的朗读
function onToggleTts(val) {
  ttsOn.value = val;
  if (!val) stopSpeech();
}
let player = null;

function onToggleLevel(level, val) {
  enabled[level] = val;
  store.setEnabled(level, val);
}

// 侧栏参数写回存档（分级勾选 + cfgRefs 全部字段）
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

// VAD 后处理参数变化 → 用留存概率即时重切
// 改参不自动重切:有留存概率时由用户点「重新推理」(runVad)才生效

// 用户载入的外部字幕(文件/示例)。VAD 分段不算——它生成的句子不应禁用 VAD 小节。
const srtFromFile = ref(false);

// 应用字幕文本(不含提示,由调用方决定文案)。文件按钮与示例按钮共用。
function applySubtitle(text) {
  srtFromFile.value = true;
  sentences.value = parseSRT(text);
  if (player) player.stop();
  stopSpeech();
  currentId.value = null;
  currentText.value = '';
  isPlaying.value = false;
}

// 应用媒体源 URL + 显示名 + 类型。文件按钮与示例按钮共用。
function applyMediaSrc(url, name, kind) {
  if (player) player.stop();
  stopSpeech();
  isPlaying.value = false;
  player.setSrc(url);
  mediaKind.value = kind;
  // 设媒体元数据激活 media session,蓝牙线控才会派发按钮事件
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: name });
  if (kind === 'video') videoCollapsed.value = false;
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
  vadProbs.value = null;   // 换媒体,旧概率作废
  vadWav = null;
  const isVideo = (file.type || '').startsWith('video/');
  applyMediaSrc(URL.createObjectURL(file), file.name, isVideo ? 'video' : 'audio');
  if (save) notify('已载入：' + file.name);
  // 命中缓存则免推理:直接注入留存概率,改参重切/重新分段都可用
  getCachedProbs(file).then(c => {
    if (c && mediaBlob === file) {
      vadProbs.value = { probs: c.probs, dur: c.dur };
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
  vadProbs.value = null;   // 概率随媒体失效
  vadWav = null;
}

// 用 VAD 把音频切成空白字幕分段:先一次性解码成 16k 单声道,
// 再 30s 一片投喂流式推理,确定的分段即时追加进字幕列表;帧概率留存供改参重切。
async function generateVadSrt() {
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
const toSentences = (segs, base = 0) => segs.map(([s, e], i) => ({ id: base + i + 1, start: s, end: e, text: '' }));
// 一次 push 整批:逐条 push 会每条触发一次全表 computed 重算
function appendVadSegments(segs) {
  sentences.value.push(...toSentences(segs, sentences.value.length));
}
// 改后处理参数重切:直接用留存的帧概率,毫秒级
function resegmentVad() {
  const p = vadProbs.value;
  if (!p) return;
  sentences.value = toSentences(postprocess(p.probs, p.dur, vadCfg()));
  currentId.value = null;
  saveVadSegs(segsSnapshot()).catch(() => {});
}
const segsSnapshot = () => sentences.value.map(({ start, end }) => [start, end]);
// vad-run 入口:有留存概率 = 改参重切,否则推理
function runVad() {
  vadProbs.value ? resegmentVad() : generateVadSrt();
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
  fetch(sampleAudio).then(r => r.blob()).then(b => { mediaBlob = b; });
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

// 点句即记进度(异步,失败静默)
watch(currentId, id => { if (sentences.value.length) saveProgress(id); });

// 按选中并滚到可见(恢复上次进度时用;找不到 id 则不动)
function selectSentenceById(id) {
  const s = sentences.value.find(x => x.id === id);
  if (s) { currentId.value = s.id; currentText.value = s.text; nextTick(() => sentenceListRef.value?.ensureVisible(true)); }
}

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
  player.playSegment(r.effStart, r.effEnd);
}

// 当前选中句在列表中的索引（未选为 -1）
const currentIdx = computed(() => sentences.value.findIndex(s => s.id === currentId.value));

const sentenceListRef = ref(null);

// ===== 视频自定义控件 =====
// 右下角"进/退全屏"小按钮(点击视频显隐);全屏内另有播控药丸(可拖动定位)。
const stageRef = ref(null);           // 全屏容器(video + 控件层),全屏它而非 video 本身,控件层才能在全屏内显示
const isFullscreen = ref(false);
const videoOverlay = ref(false);      // 点击视频显示/隐藏悬浮控件(非全屏的 ⛶ 与全屏的播控药丸共用)

// ===== 可拖药丸共用机制(全屏播控药丸/底部控制条) =====
// 位移 <5px 视为点按钮;拖动中把"期望中心点"交给调用方的 clamp 写入自己的 pos;抬起时持久化并吞掉紧随的 click。
// getEl 在 down 时调用一次,调用方可在此缓存拖动期间不变的 rect(热路径零 DOM 读取)。
let pillSuppressClick = false;
function makePillDrag({ getEl, clamp, persist }) {
  let d = null;
  function down(e) {
    pillSuppressClick = false;  // 上一轮拖动若无 click 派发,标志会残留,新按下时清掉
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
      pillSuppressClick = true;   // 拖完后吞掉紧随的 click,避免误触按钮
      // 若 click 落在无处理器的药丸背景上,guardPillClick 不会执行,标志残留会误吞下一次点按钮;
      // 故本轮 click 派发结束后(bubble 到 window)自行清除。
      window.addEventListener('click', () => { pillSuppressClick = false; }, { once: true });
    }
    d = null;
    window.removeEventListener('pointermove', move);
  }
  return { down, cancel: () => window.removeEventListener('pointermove', move) };
}
function guardPillClick(fn, e) {
  if (pillSuppressClick) { pillSuppressClick = false; return; }
  e?.currentTarget.blur();   // 点击后不滞留焦点,否则空格时按钮显焦点环
  fn();
}

// 播控药丸拖动:位置按"药丸中心占视频比例"存 localStorage,任意尺寸/全屏下等比复现
const VC_POS_KEY = 'videoCtrlPos';
const pillRef = ref(null);
const vcPos = ref(loadPos(VC_POS_KEY, { x: 0.5, y: 0.55 }));
let vcStageRect = null;   // down 时量一次,拖动热路径零 DOM 读取(同 cbBounds)
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
// 底部控制条:悬浮竖版药丸(同 vc-pill 样式),可拖动,中心点按视口比例存 localStorage,
// 转屏/换设备后等比复现(手机全屏锁横屏→退出的转场不会把位置夹丢)。旧版 px 坐标超界作废。
const CB_POS_KEY = 'ctrlBarPos';
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

// 全屏切换。进全屏时:横版视频 + 设备竖屏 → 锁横屏(手机/平板观看体验);
// 退全屏浏览器自动解除方向锁。iOS Safari 不支持 lock,失败静默(用户手动转屏)。
function onFullscreenChange() { isFullscreen.value = !!document.fullscreenElement; clampCbIntoView(); }

async function toggleFullscreen() {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  await stageRef.value.requestFullscreen();
  const v = mediaEl.value;
  const portrait = matchMedia('(orientation: portrait)').matches;
  if (v.videoWidth > v.videoHeight && portrait) {
    try { await screen.orientation.lock('landscape'); } catch { /* 不支持则忽略 */ }
  }
}

// 播放意图函数:键盘 onKeydown 与底部控制条共用同一套行为
function stopAll() { player.stop(); stopSpeech(); isPlaying.value = false; }
function replayCurrent() {                       // 未选则播第一句
  const i = currentIdx.value;
  if (i >= 0) playSentence(sentences.value[i]);
  else if (sentences.value.length) playSentence(sentences.value[0]);
}
function goPrev() {
  const i = currentIdx.value;
  if (i > 0) { playSentence(sentences.value[i - 1]); ensureActiveVisible(); }
  else if (i === 0) replayCurrent();             // 首句:重播
}
function goNext() {
  const i = currentIdx.value, n = sentences.value.length;
  if (i < 0) { playSentence(sentences.value[0]); ensureActiveVisible(); }  // 未选 → 第一句
  else if (i < n - 1) { playSentence(sentences.value[i + 1]); ensureActiveVisible(); }
}
// 键盘上下切换后，若目标句不在视窗内则滚到容器顶部（平滑）；在视窗内则不动。
function ensureActiveVisible() {
  nextTick(() => sentenceListRef.value?.ensureVisible());
}

// 方向键播放控制。焦点在输入框时不拦截，避免影响微调数字输入。
function onKeydown(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  // 面板收展快捷键:不依赖字幕,空载引导页也可用。
  if (e.key === '[') { e.preventDefault(); toggleFab('left'); return; }
  if (e.key === ']') { e.preventDefault(); toggleFab('right'); return; }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleCollapse(); return; }
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

onMounted(() => {
  player = new Player(mediaEl.value);
  player.onStop(() => { isPlaying.value = false; });
  mediaEl.value.addEventListener('error', () => {
    if (mediaEl.value.error && mediaKind.value !== null) {
      isPlaying.value = false;
      notify('音/视频无法播放（编码不支持），建议改用 mp4/mp3', 'error');
    }
  });
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  // 蓝牙耳机线控 → 药丸同款功能(需要媒体会话激活,applyMediaSrc 里设 metadata)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('previoustrack', () => goPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => goNext());
    navigator.mediaSession.setActionHandler('play', () => replayCurrent());
    navigator.mediaSession.setActionHandler('pause', () => stopAll());
  }
  // 加载 TTS 声音列表(异步,部分浏览器会多次触发 voiceschanged)。
  // getVoices() 中途可能返回空数组 → loadVoices 空结果返回 null,不覆盖已加载声音。
  const syncVoices = () => { const l = loadVoices(); if (l) voices.value = l; };
  syncVoices();
  if (ttsSupported) window.speechSynthesis.onvoiceschanged = syncVoices;
  // 双指手势:识别在 gestures.js,这里只绑监听(禁原生双指缩放)
  window.addEventListener('touchstart', gesture.onTouch, { passive: false });
  window.addEventListener('touchmove', gesture.onTouch, { passive: false });
  window.addEventListener('touchend', gesture.onTouchEnd, { passive: false });
});

// 双指手势:上/下滑切句,轻点播放中停止/未播重播(同空格)
const gesture = createTwoFingerRecognizer({
  onSwipe: dir => (dir > 0 ? goNext() : goPrev()),
  onTap: () => { isPlaying.value ? stopAll() : replayCurrent(); },
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  vcPillDrag.cancel();
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
      <div class="video-slot" :class="{ 'no-video': mediaKind !== 'video', collapsed: videoCollapsed }">
        <div v-show="!videoCollapsed" ref="stageRef" class="video-stage"
             :style="isFullscreen ? undefined : { height: videoHeight + 'px' }"
             @click="videoOverlay = !videoOverlay">
          <video ref="mediaEl" class="media-video"
                 preload="metadata"
                 @loadedmetadata="onVideoMeta"
                 @dblclick.prevent="toggleCollapse"></video>
          <!-- 非全屏:右下角"进全屏"按钮(点击视频显隐) -->
          <button v-if="videoOverlay" class="vc-fs" :title="isFullscreen ? '退出全屏' : '全屏'" @click.stop="guardPillClick(toggleFullscreen, $event)">
            <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
          </button>
          <!-- 全屏:播控药丸(可拖动定位,位置持久化) -->
          <div v-if="isFullscreen && videoOverlay" ref="pillRef" class="vc-pill"
               :style="{ left: vcPos.x * 100 + '%', top: vcPos.y * 100 + '%' }"
               @pointerdown="vcPillDrag.down" @click.stop>
            <PillControls :guard="guardPillClick" :disabled="!sentences.length" :playing="isPlaying"
                          @prev="goPrev" @toggle="isPlaying ? stopAll() : replayCurrent()" @next="goNext" />
          </div>
          <!-- 1px 全透明钉子:画面内容区顶部居中,阻止 Chromium 把拖进黑边的药丸剔除不绘制 -->
          <div class="vc-anchor"></div>
        </div>
        <div v-show="!videoCollapsed" class="resize-handle"
             @pointerdown="startResize" @pointermove="onResize"
             @pointerup="stopResize" @pointercancel="stopResize"></div>
        <button v-if="videoCollapsed" class="expand-btn" @click="toggleCollapse"><i class="fas fa-play" style="margin-right:6px"></i> 展开视频</button>
      </div>
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
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type"
         @click="dismiss(t.id)"
         @mouseenter="pauseToast(t)" @mouseleave="resumeToast(t)">
      <span class="ico"><i :class="t.type === 'error' ? 'fas fa-xmark' : 'fas fa-check'"></i></span>
      <span class="msg">{{ t.message }}</span>
      <span class="dismiss"><i class="fas fa-xmark"></i></span>
      <span :key="t.key" class="bar"></span>
    </div>
  </div>
</template>
