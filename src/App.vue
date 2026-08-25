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
const stageRef = ref(null);          // VideoStage(expose: mediaEl/toggleCollapse/toggleFullscreen/expand)
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
  expandVideo: () => stageRef.value?.expand(),
  notify, selectSentenceById,
});

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
