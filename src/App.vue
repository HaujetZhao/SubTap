<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import vocab from './logic/vocabulary.json';
import { tokenizeForRender } from './logic/word-lookup.js';
import { createVocabStore } from './logic/vocab-store.js';
import { Player } from './logic/player.js';
import { computeEffectiveRanges } from './logic/subtitle-tweak.js';
import { LEVEL_COLORS } from './logic/level-colors.js';
import { saveProgress } from './logic/file-history.js';
import { createToasts } from './logic/toast.js';
import { ttsSupported, loadVoices } from './logic/tts.js';
import { createLayout } from './composables/useLayout.js';
import { createSettings } from './composables/useSettings.js';
import { createVad } from './composables/useVad.js';
import { createLoader } from './composables/useLoader.js';
import { createPlayback } from './composables/usePlayback.js';
import { createPillSystem, loadPos } from './composables/pill-drag.js';
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
// 画面内字幕层用：当前句 tokens（复用中栏缓存，不重切词）
const currentTokens = computed(() =>
  renderedSentences.value.find(s => s.id === currentId.value)?.tokens ?? []
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
const { leftWidth, rightWidth, fsRightWidth, fsLeftWidth, hasOverlay, layoutClass, startSideResize, isSideOpen, collapseLeft, collapseRight, toggleFab, closeBoth } = createLayout(clampCbIntoView);

// ===== 功能模块接线(依赖注入) =====
const { vadGen, vadProbs, runVad, reset: resetVad, setProbs } = createVad({
  sentences, currentId,
  getMediaBlob: () => mediaBlob,
  cfg: { threshold: vadThreshold, minSpeech: vadMinSpeech, minSilence: vadMinSilence },
  notify,
});

const { playSentence, stopAll, replayCurrent, togglePlay, goPrev, goNext, attach: attachPlayback, detach: detachPlayback } = createPlayback({
  sentences, currentId, currentText, isPlaying, mediaKind,
  voices, ttsOn, ttsLang, ttsRate, ttsVoiceURI,
  effectiveRanges, getPlayer, notify,
  scrollActiveIntoView: () => nextTick(() => sentenceListRef.value?.ensureVisible()),
  toggleFab,
  // 全屏时 [ / ] 切全屏设置栏/生词栏,平时切普通左/右栏(isFsWord/fsWordOpen/fsLeftOpen 在下方声明,keydown 时已就绪)
  toggleFabLeft: () => isFsWord.value ? (fsLeftOpen.value = !fsLeftOpen.value) : toggleFab('left'),
  toggleFabRight: () => isFsWord.value ? (fsWordOpen.value = !fsWordOpen.value) : toggleFab('right'),
  toggleVideoCollapse: () => stageRef.value?.toggleCollapse(),
  toggleFullscreen: () => stageRef.value?.toggleFullscreen(),
});

const { canRestore, onSrtFile, onMediaFile, onMediaHandle, clearSrt, clearMedia, loadSample, restoreLast } = createLoader({
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
// 占位按布局状态而非实时 rect 判定:侧栏滑出是 CSS 过渡,收起瞬间 rect 仍盖着中栏,
// 读 DOM 会把药丸夹错位且动画结束后无人再纠正。overlay 是浮层不推内容,药丸原位不动
function measureCbBounds() {
  const r = cbRef.value.parentElement.getBoundingClientRect();
  let left = r.left, right = r.right;
  const lc = layoutClass.value;
  if (lc['left-pinned']) left += leftWidth.value;
  if (lc['right-pinned']) right -= rightWidth.value;
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

// ===== 全屏生词栏/设置栏 =====
// 全屏时 WordPanel/SettingsPanel Teleport 进 .video-stage(全屏元素内才可见);开关状态由 VideoStage 持有经 v-model
const isFsWord = ref(false);
const fsWordOpen = ref(false);
const fsLeftOpen = ref(false);
// 全屏态以 VideoStage 的 fullscreenchange 载荷为准(单一事实源);收起由 VideoStage 侧置开关完成
function onFullscreenChange(fs) {
  isFsWord.value = fs;
  clampCbIntoView();
}
// 两个 WordPanel 实例(普通/全屏)共用 props;仅 collapse/resizestart 按挂载位置分派
const wpProps = computed(() => ({ store, enabled, currentText: currentText.value, colors: LEVEL_COLORS }));
const onWordCollapse = () => isFsWord.value ? (fsWordOpen.value = false) : collapseRight();
const onWordResizeStart = e => startSideResize(isFsWord.value ? 'fs' : 'right', e);
// SettingsPanel 同理:全屏 collapse 收全屏栏,resizestart 拖全屏宽度;两处挂载共用 props(computed 随依赖更新)。
// levels/vadHasProbs 提独立 computed:spProps 依赖过宽(滑杆拖动频率更新),重跑时若内联取
// getLevels()(每次 slice 新数组)会让 levels prop 引用每 tick 变化,触发面板无谓重渲染
const spLevels = computed(() => store.getLevels());
const spVadHasProbs = computed(() => !!vadProbs.value);
const spProps = computed(() => ({
  store, levels: spLevels.value, enabled: enabled, offset: offset.value, endMode: endMode.value, endOffset: endOffset.value,
  highlightOn: highlightOn.value, controlBarOn: controlBarOn.value,
  ttsOn: ttsOn.value, ttsLang: ttsLang.value, ttsRate: ttsRate.value, ttsVoiceUri: ttsVoiceURI.value,
  voices: voices.value, theme: theme.value,
  hasSrt: sentences.value.length > 0, srtFromFile: srtFromFile.value, hasMedia: mediaKind.value !== null,
  vadHasProbs: spVadHasProbs.value, vadGen: vadGen.value, vadThreshold: vadThreshold.value,
  vadMinSpeech: vadMinSpeech.value, vadMinSilence: vadMinSilence.value,
}));
// 注意 key 用裸事件名(v-on 对象的 key 即事件名,不加 on 前缀——加前缀会被再包一层 onOn*)
const spEmits = {
  'toggle-level': onToggleLevel, 'srt-file': onSrtFile, 'media-file': onMediaFile, 'media-handle': onMediaHandle,
  'clear-srt': clearSrt, 'clear-media': clearMedia, 'vad-run': runVad, tweak: onTweak, 'toggle-tts': onToggleTts,
  collapse: () => isFsWord.value ? (fsLeftOpen.value = false) : collapseLeft(),
  resizestart: e => startSideResize(isFsWord.value ? 'fsLeft' : 'left', e),
};
// 视频区单指左右滑(非全屏):唤出对应侧栏,已展开则不动(手势语义是"唤出"不是"切换")
function onSwipeOpen(side) { if (!isSideOpen(side)) toggleFab(side); }

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
    <!-- SettingsPanel 两个实例(普通/全屏)共用 props/emits,同 WordPanel 的 v-if 双分支 Teleport -->
    <SettingsPanel v-if="!isFsWord" v-bind="spProps" v-on="spEmits" />
    <Teleport v-else to=".video-stage">
      <SettingsPanel v-bind="spProps" v-on="spEmits" />
    </Teleport>
    <main class="panel-center">
      <VideoStage
        ref="stageRef"
        v-model:word-open="fsWordOpen"
        v-model:left-open="fsLeftOpen"
        :media-kind="mediaKind"
        :playing="isPlaying"
        :has-sentences="sentences.length > 0"
        :current-tokens="currentTokens"
        :enabled="enabled"
        :highlight-on="highlightOn"
        :colors="LEVEL_COLORS"
        :fs-right-width="fsRightWidth"
        :fs-left-width="fsLeftWidth"
        @fullscreenchange="onFullscreenChange"
        @prev="goPrev"
        @toggle="togglePlay"
        @next="goNext"
        @open-left="onSwipeOpen('left')"
        @open-right="onSwipeOpen('right')"
      />
      <SentenceList
        ref="sentenceListRef"
        :sentences="renderedSentences"
        :current-id="currentId"
        :is-playing="isPlaying"
        :enabled="enabled"
        :highlight-on="highlightOn"
        :colors="LEVEL_COLORS"
        :theme="theme"
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
                      @prev="goPrev" @toggle="togglePlay" @next="goNext" />
      </nav>
    </main>
    <!-- 全屏时 Teleport 进 .video-stage;用 v-if 双分支而非 :disabled 切换——
         disabled 搬移节点在 VideoStage 同批更新下会触发 Vue moveTeleport 的 null 容器崩溃,
         重新挂载走全新 mount 路径则无此问题 -->
    <WordPanel v-if="!isFsWord" v-bind="wpProps"
               @collapse="onWordCollapse" @resizestart="onWordResizeStart" />
    <Teleport v-else to=".video-stage">
      <WordPanel v-bind="wpProps"
                 @collapse="onWordCollapse" @resizestart="onWordResizeStart" />
    </Teleport>
    <button class="float-btn float-btn-left"  title="展开设置栏（[）" @click="toggleFab('left')"><i class="fas fa-bars"></i></button>
    <button class="float-btn float-btn-right" title="展开词卡栏（]）" @click="toggleFab('right')"><i class="fas fa-bars"></i></button>
    <div class="scrim" :class="{ show: hasOverlay }" @click="closeBoth"></div>
  </div>
  <Toasts :toasts="toasts" @dismiss="dismiss" @pause="pauseToast" @resume="resumeToast" />
</template>
