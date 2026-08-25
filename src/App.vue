<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import vocab from './vocabulary.json';
import { parseSRT } from './srt-parser.js';
import { buildVocab, classifyWords, tokenizeForRender } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import { computeEffectiveRanges } from './subtitle-tweak.js';
import { LEVEL_COLORS } from './level-colors.js';
import { saveFile, saveVadSegs, saveProgress, loadFiles, getCachedProbs, putCachedProbs } from './file-history.js';
import { FireRedVadStream, createSession, decodeAudio16k, postprocess, FRAME_SHIFT_S, prefetchVadAssets } from './vad.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';
import sampleSrt from './assets/sample/sample.srt?raw';
import sampleAudio from './assets/sample/sample.aac';

// 词库 store（框架无关，非响应式）
const store = createVocabStore(buildVocab, classifyWords);
store.init(vocab);
const vocabTable = store.getVocab();

// ponytail: 侧栏参数持久化（分级勾选/高亮/TTS/字幕微调），单 key 存 localStorage
const LS_S = 'subtap-settings';
const _s = (() => { try { return JSON.parse(localStorage.getItem(LS_S) || '{}'); } catch { return {}; } })();

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
const mediaName = ref('');
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

// 三态状态机(仿 DeepSeek):迟滞双阈值自动 pin,手动 hide/overlay 覆盖。
const BP = { leftPin: 1100, leftUnpin: 1080, rightPin: 800, rightUnpin: 780 };
const leftPin  = ref(window.innerWidth > BP.leftPin);
const rightPin = ref(window.innerWidth > BP.rightPin);
const leftHide  = ref(false);   // 手动折叠覆盖 pin
const rightHide = ref(false);
const leftOv  = ref(false);      // 窄屏手动 overlay
const rightOv = ref(false);
const sideDragging = ref(false);

// 有内容时 FAB 自动半透明（不遮挡视频），空载页全可见
const hasContent = computed(() => mediaKind.value !== null || sentences.value.length > 0);

function recompute() {
  const w = window.innerWidth;
  const lp = leftPin.value, rp = rightPin.value;
  if (w > BP.leftPin)        leftPin.value  = true;
  else if (w < BP.leftUnpin) leftPin.value  = false;
  if (w > BP.rightPin)        rightPin.value = true;
  else if (w < BP.rightUnpin) rightPin.value = false;
  // 跨阈值时清手动标志,让自动态重新接管
  if (leftPin.value  !== lp) { leftHide.value  = false; leftOv.value  = false; }
  if (rightPin.value !== rp) { rightHide.value = false; rightOv.value = false; }
}
let resizeRaf = 0;
const onWindowResize = () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(recompute); };

const leftPinned  = computed(() => leftPin.value  && !leftHide.value  && !leftOv.value);
const rightPinned = computed(() => rightPin.value && !rightHide.value && !rightOv.value);
const hasOverlay  = computed(() => leftOv.value || rightOv.value);
const layoutClass = computed(() => ({
  'left-pinned':   leftPinned.value,
  'right-pinned':  rightPinned.value,
  'left-overlay':  leftOv.value,
  'right-overlay': rightOv.value,
  'has-overlay':   hasOverlay.value,
  'side-dragging': sideDragging.value,
}));

// push 模式拖拽调左右栏宽(180–480),持久化。应用走 .layout 的 :style 绑定 CSS var。
const LS_W = 'subtap-widths';
const _w = (() => { try { return JSON.parse(localStorage.getItem(LS_W) || '{}'); } catch { return {}; } })();
const leftWidth  = ref(_w.leftWidth  ?? 230);
const rightWidth = ref(_w.rightWidth ?? 280);
watch([leftWidth, rightWidth], ([l, r]) => {
  try { localStorage.setItem(LS_W, JSON.stringify({ leftWidth: l, rightWidth: r })); } catch {}
});
let sideDrag = null;
function startSideResize(panel, e) {
  sideDragging.value = true;
  sideDrag = { panel, x: e.clientX, w: panel === 'left' ? leftWidth.value : rightWidth.value };
  document.addEventListener('pointermove', onSideResize);
  document.addEventListener('pointerup', stopSideResize);
  e.preventDefault();
}
function onSideResize(e) {
  if (!sideDrag) return;
  const delta = sideDrag.panel === 'left' ? e.clientX - sideDrag.x : sideDrag.x - e.clientX;
  const w = Math.min(480, Math.max(180, sideDrag.w + delta));
  (sideDrag.panel === 'left' ? leftWidth : rightWidth).value = w;
}
function stopSideResize() {
  sideDragging.value = false;
  sideDrag = null;
  document.removeEventListener('pointermove', onSideResize);
  document.removeEventListener('pointerup', stopSideResize);
}

// 栏顶收起按钮:overlay 开则关 overlay,否则手动折叠
const collapseLeft  = () => leftOv.value  ? (leftOv.value = false)  : (leftHide.value = true);
const collapseRight = () => rightOv.value ? (rightOv.value = false) : (rightHide.value = true);
// FAB/快捷键:宽屏 toggle hide(折叠↔展开,与栏顶收起按钮一致),窄屏 toggle overlay(两栏互斥)
function toggleFab(side) {
  if (side === 'left') {
    if (leftPin.value) { leftHide.value = !leftHide.value; leftOv.value = false; }
    else leftOv.value = !leftOv.value;
  } else {
    if (rightPin.value) { rightHide.value = !rightHide.value; rightOv.value = false; }
    else rightOv.value = !rightOv.value;
  }
  if (leftOv.value && rightOv.value) rightOv.value = false;   // 互斥
}
const closeBoth = () => { leftOv.value = false; rightOv.value = false; };

// toast:自动消失的状态消息(成功/错误均 2.5s)
const toasts = reactive([]);
let toastSeq = 0;
function notify(message, type = 'success') {
  // 相同文案的 toast 先关掉旧的,避免连续点击堆叠一串(如未载媒体时连点句子)
  for (let i = toasts.length - 1; i >= 0; i--) {
    if (toasts[i].message === message) {
      clearTimeout(toasts[i].timer);
      toasts.splice(i, 1);
    }
  }
  const t = { id: ++toastSeq, message, type, key: 0 };
  toasts.push(t);
  t.key++;                        // 触发进度条动画重启
  t.timer = setTimeout(() => dismiss(t.id), 2500);
}
function dismiss(id) {
  const i = toasts.findIndex(x => x.id === id);
  if (i < 0) return;
  clearTimeout(toasts[i].timer);
  toasts.splice(i, 1);
}
function pauseToast(t) {
  clearTimeout(t.timer);
}
function resumeToast(t) {
  if (!toasts.find(x => x.id === t.id)) return;   // 已被关闭,不再重设定时器
  t.key++;                        // 重启进度条动画
  t.timer = setTimeout(() => dismiss(t.id), 2500);
}

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

function onTweak(key, val) {
  if (key === 'offset') offset.value = val;
  else if (key === 'endMode') endMode.value = val;
  else if (key === 'endOffset') endOffset.value = val;
  else if (key === 'ttsLang') ttsLang.value = val;
  else if (key === 'ttsRate') ttsRate.value = val;
  else if (key === 'ttsVoiceURI') ttsVoiceURI.value = val;
  else if (key === 'vadThreshold') vadThreshold.value = val;
  else if (key === 'vadMinSpeech') vadMinSpeech.value = val;
  else if (key === 'vadMinSilence') vadMinSilence.value = val;
  else console.warn('未知微调参数：', key);
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

// 侧栏参数写回存档（分级勾选/高亮/TTS/字幕微调/VAD 后处理参数）
watch(
  [enabled, highlightOn, controlBarOn, ttsOn, ttsLang, ttsRate, ttsVoiceURI, offset, endMode, endOffset, theme, vadThreshold, vadMinSpeech, vadMinSilence],
  () => {
    try {
      localStorage.setItem(LS_S, JSON.stringify({
        enabled: { ...enabled },
        highlightOn: highlightOn.value,
        controlBarOn: controlBarOn.value,
        theme: theme.value,
        ttsOn: ttsOn.value, ttsLang: ttsLang.value, ttsRate: ttsRate.value, ttsVoiceURI: ttsVoiceURI.value,
        offset: offset.value, endMode: endMode.value, endOffset: endOffset.value,
        vadThreshold: vadThreshold.value, vadMinSpeech: vadMinSpeech.value, vadMinSilence: vadMinSilence.value,
      }));
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
  mediaName.value = name;
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
      if (selectId !== null) {
        const s = sentences.value.find(x => x.id === selectId);
        if (s) {
          currentId.value = s.id; currentText.value = s.text;
          nextTick(() => sentenceListRef.value?.ensureVisible(true));
        }
      }
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
    putCachedProbs(new Float32Array(vad.probs), vadGen.value.dur).catch(() => {});
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
    const s = sentences.value.find(x => x.id === rec.sentenceId);
    if (s) { currentId.value = s.id; currentText.value = s.text; nextTick(() => sentenceListRef.value?.ensureVisible(true)); }
  } else if (rec.srt) {
    onSrtFile(rec.srt, false, rec.sentenceId ?? null);
  }
  if (rec.media) onMediaFile(rec.media, false);
}

// 点句即记进度(异步,失败静默)
watch(currentId, id => { if (sentences.value.length) saveProgress(id); });

function onSentenceClick(sentence) {
  playSentence(sentence);
}

// 浏览器语音朗读(Web Speech API)。无媒体时作为播放替代。
function stopSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
function speakSentence(text) {
  if (!('speechSynthesis' in window)) {
    notify('当前浏览器不支持语音朗读', 'error');
    return;
  }
  stopSpeech();
  const english = (text.split('\n')[0] || text).trim();   // 双语字幕取首行英文
  if (!english) return;
  const u = new SpeechSynthesisUtterance(english);
  u.lang = ttsLang.value;
  u.rate = ttsRate.value;
  if (ttsVoiceURI.value) {
    const vc = voices.value.find(v => v.voiceURI === ttsVoiceURI.value);
    if (vc) u.voice = vc;
  }
  u.onend = () => { isPlaying.value = false; };
  u.onerror = () => { isPlaying.value = false; };
  window.speechSynthesis.speak(u);
  isPlaying.value = true;
}

// 播放指定句子（点击与键盘共用）：选中 + 区间播放(无媒体时改用语音朗读)
function playSentence(sentence) {
  currentId.value = sentence.id;
  currentText.value = sentence.text;
  if (!mediaName.value) {
    if (ttsOn.value) speakSentence(sentence.text);
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
const vcPos = ref((() => { try { return JSON.parse(localStorage.getItem(VC_POS_KEY)) } catch { return null } })() || { x: 0.5, y: 0.55 });
const vcPillDrag = makePillDrag({
  getEl: () => pillRef.value,
  clamp: (cx, cy, halfX, halfY) => {
    const st = stageRef.value.getBoundingClientRect();
    const x = Math.min(Math.max(cx, st.left + halfX), st.right - halfX);
    const y = Math.min(Math.max(cy, st.top + halfY), st.bottom - halfY);
    vcPos.value = { x: (x - st.left) / st.width, y: (y - st.top) / st.height };
  },
  persist: () => localStorage.setItem(VC_POS_KEY, JSON.stringify(vcPos.value)),
});
// 底部控制条:悬浮竖版药丸(同 vc-pill 样式),可拖动,中心点 px 坐标存 localStorage
const CB_POS_KEY = 'ctrlBarPos';
const cbRef = ref(null);
const cbPos = ref((() => { try { return JSON.parse(localStorage.getItem(CB_POS_KEY)) } catch { return null } })()
  || { x: innerWidth / 2, y: innerHeight - 140 });
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
      x: Math.min(Math.max(cx, b.left + halfX), b.right - halfX),
      y: Math.min(Math.max(cy, b.top + halfY), b.bottom - halfY),
    };
  },
  persist: () => localStorage.setItem(CB_POS_KEY, JSON.stringify(cbPos.value)),
});
// 药丸出现/窗口尺寸/布局变化时夹回可见区(存的位置可能已被侧栏盖住或跑到屏幕外)
function clampCbIntoView() {
  nextTick(() => {
    if (!cbRef.value) return;
    cbBounds = measureCbBounds();
    const pl = cbRef.value.getBoundingClientRect();
    const p = cbPos.value;
    const hx = pl.width / 2, hy = pl.height / 2;
    cbPos.value = {
      x: Math.min(Math.max(p.x, cbBounds.left + hx), cbBounds.right - hx),
      y: Math.min(Math.max(p.y, cbBounds.top + hy), cbBounds.bottom - hy),
    };
  });
}
watch([() => sentences.value.length, layoutClass, leftWidth, rightWidth], clampCbIntoView);
window.addEventListener('resize', clampCbIntoView);

// 全屏切换。进全屏时:横版视频 + 设备竖屏 → 锁横屏(手机/平板观看体验);
// 退全屏浏览器自动解除方向锁。iOS Safari 不支持 lock,失败静默(用户手动转屏)。
function onFullscreenChange() { isFullscreen.value = !!document.fullscreenElement; }

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
    if (mediaEl.value.error && mediaName.value) {
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
  // 注意:getVoices() 中途可能返回空数组,直接覆盖会清空已加载声音 → 声音下拉只剩"默认"。
  // 空结果忽略。
  function loadVoices() {
    if ('speechSynthesis' in window) {
      const list = window.speechSynthesis.getVoices();
      if (list.length) voices.value = list;
    }
  }
  loadVoices();
  if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = loadVoices;
  window.addEventListener('resize', onWindowResize);
  // 实验:双指手势监控(禁原生双指缩放,识别双指点击/滑动方向)
  window.addEventListener('touchstart', onTwoFingerTouch, { passive: false });
  window.addEventListener('touchmove', onTwoFingerTouch, { passive: false });
  window.addEventListener('touchend', onTwoFingerTouchEnd, { passive: false });
  recompute();
});

// 双指手势:touchstart/move 时 preventDefault 禁掉原生双指缩放;
// 结束时分类:上滑→下一句,下滑→上一句,轻点→播放中停止/未播重播(同空格)。
// 间距变化大(捏合)不算任何手势,并用来排除点击误判
let twoFinger = null;
function onTwoFingerTouch(e) {
  if (e.touches.length === 2) {
    const pts = [...e.touches].map(t => [t.clientX, t.clientY]);
    if (!twoFinger) twoFinger = { t: performance.now(), start: pts, last: pts };
    else twoFinger.last = pts;
    e.preventDefault();
  } else if (twoFinger && e.touches.length > 2) {
    // 有第三根手指加入,放弃本次手势
    twoFinger = null;
  }
}
function onTwoFingerTouchEnd() {
  if (!twoFinger) return;
  const { t, start, last } = twoFinger;
  twoFinger = null;
  const dt = performance.now() - t;
  const [v1, v2] = start.map((p, i) => [last[i][0] - p[0], last[i][1] - p[1]]);
  const spread0 = Math.hypot(start[1][0] - start[0][0], start[1][1] - start[0][1]);
  const spread1 = Math.hypot(last[1][0] - last[0][0], last[1][1] - last[0][1]);
  const pinch = Math.abs(spread1 - spread0);
  const move = Math.hypot(v1[0] + v2[0], v1[1] + v2[1]) / 2; // 两指平均位移
  const sameDir = v1[0] * v2[0] + v1[1] * v2[1] > 0;         // 两指方向一致(滑动),相反(捏合)
  if (move >= 30 && sameDir && Math.abs(v1[1] + v2[1]) > Math.abs(v1[0] + v2[0])) {
    if (v1[1] + v2[1] < 0) goNext(); else goPrev();
  }
  else if (move < 30 && pinch < 50 && dt < 400) { isPlaying.value ? stopAll() : replayCurrent(); }
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onWindowResize);
  cancelAnimationFrame(resizeRaf);
  if (sideDrag) {                      // 拖拽进行中卸载(仅开发期热重载),清掉 mouse listener
    document.removeEventListener('mousemove', onSideResize);
    document.removeEventListener('mouseup', stopSideResize);
  }
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('resize', clampCbIntoView);
  vcPillDrag.cancel();
  cbDrag.cancel();
  toasts.forEach(t => clearTimeout(t.timer));
  toasts.splice(0);
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
      @toggle-highlight="val => highlightOn = val"
      @toggle-control-bar="val => controlBarOn = val"
      @toggle-tts="onToggleTts"
      @set-theme="val => theme = val"
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
          <button v-if="videoOverlay" class="vc-fs" :title="isFullscreen ? '退出全屏' : '全屏'" @click.stop="toggleFullscreen(); $event.currentTarget.blur()">
            <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
          </button>
          <!-- 全屏:播控药丸(可拖动定位,位置持久化) -->
          <div v-if="isFullscreen && videoOverlay" ref="pillRef" class="vc-pill"
               :style="{ left: vcPos.x * 100 + '%', top: vcPos.y * 100 + '%' }"
               @pointerdown="vcPillDrag.down" @click.stop>
            <button class="vc-big" title="上一句" :disabled="!sentences.length" @click="guardPillClick(goPrev, $event)"><i class="fas fa-chevron-up"></i></button>
            <button class="vc-big" :title="isPlaying ? '暂停' : '重播'" :disabled="!sentences.length" @click="guardPillClick(isPlaying ? stopAll : replayCurrent, $event)">
              <i :class="isPlaying ? 'fas fa-stop' : 'fas fa-play'"></i>
            </button>
            <button class="vc-big" title="下一句" :disabled="!sentences.length" @click="guardPillClick(goNext, $event)"><i class="fas fa-chevron-down"></i></button>
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
        @click="onSentenceClick"
        @copy="notify('已复制')"
        @sample="loadSample"
        @restore="restoreLast"
      />
      <nav v-if="sentences.length && controlBarOn" ref="cbRef" class="control-bar"
           :style="{ left: cbPos.x + 'px', top: cbPos.y + 'px' }"
           @pointerdown="cbDrag.down" @click.stop>
        <button class="vc-big" title="上一句" :disabled="!sentences.length" @click="guardPillClick(goPrev, $event)">
          <i class="fas fa-chevron-up"></i>
        </button>
        <button class="vc-big" :title="isPlaying ? '暂停' : '重播'" :disabled="!sentences.length" @click="guardPillClick(isPlaying ? stopAll : replayCurrent, $event)">
          <i :class="isPlaying ? 'fas fa-stop' : 'fas fa-play'"></i>
        </button>
        <button class="vc-big" title="下一句" :disabled="!sentences.length" @click="guardPillClick(goNext, $event)">
          <i class="fas fa-chevron-down"></i>
        </button>
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
