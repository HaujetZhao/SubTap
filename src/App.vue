<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import vocab from './vocabulary.json';
import { parseSRT } from './srt-parser.js';
import { buildVocab, classifyWords, tokenizeForRender } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import { computeEffectiveRanges } from './subtitle-tweak.js';
import { LEVEL_COLORS } from './level-colors.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';

// 词库 store（框架无关，非响应式）
const store = createVocabStore(buildVocab, classifyWords);
store.init(vocab);
const vocabTable = store.getVocab();

// 响应式勾选镜像：从 store 默认值读取（初中/高中/四级=false，其余=true）
const enabled = reactive({});
for (const lv of store.getLevels()) enabled[lv] = store.isEnabled(lv);

// 高亮总开关（默认开，只控中栏）
const highlightOn = ref(true);

// 全局状态
const sentences = ref([]);
const currentId = ref(null);
const currentText = ref('');
const isPlaying = ref(false);
const mediaName = ref('');
const mediaKind = ref(null); // 'video' | 'audio' | null
const statusText = ref('请选择文件');
const statusError = ref(false);

// 字幕微调参数
const offset = ref(0);
const extend = ref(0);
const linkNext = ref(false);
const linkNextOffset = ref(-0.1);

const mediaEl = ref(null);
const videoHeight = ref(240);
const videoCollapsed = ref(false);
let dragging = false, dragStartY = 0, dragStartH = 0;

function startResize(e) {
  dragging = true;
  dragStartY = e.clientY;
  dragStartH = videoHeight.value;
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  e.preventDefault();
}
function onResize(e) {
  if (!dragging) return;
  const delta = e.clientY - dragStartY; // 鼠标向下→手柄向下→视频变高
  const maxH = window.innerHeight * 0.7;
  let h = dragStartH + delta;
  if (h < 100) h = 100;
  if (h > maxH) h = maxH;
  videoHeight.value = h;
}
function stopResize() {
  dragging = false;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}
function toggleCollapse() {
  videoCollapsed.value = !videoCollapsed.value;
}

// 中栏渲染用：每句附加 tokens（仅依赖 sentences，缓存）
const renderedSentences = computed(() =>
  sentences.value.map(s => ({ ...s, tokens: tokenizeForRender(s.text, vocabTable) }))
);

const effectiveRanges = computed(() => computeEffectiveRanges(sentences.value, {
  offset: offset.value,
  extend: extend.value,
  linkNext: linkNext.value,
  linkNextOffset: linkNextOffset.value
}));

function onTweak(key, val) {
  if (key === 'offset') offset.value = val;
  else if (key === 'extend') extend.value = val;
  else if (key === 'linkNext') linkNext.value = val;
  else if (key === 'linkNextOffset') linkNextOffset.value = val;
  else console.warn('未知微调参数：', key);
}
let player = null;

function onToggleLevel(level, val) {
  enabled[level] = val;
  store.setEnabled(level, val);
}

function onSrtFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      sentences.value = parseSRT(reader.result);
      if (player) player.stop();
      currentId.value = null;
      currentText.value = '';
      isPlaying.value = false;
      statusText.value = '已载入 ' + sentences.value.length + ' 句字幕';
      statusError.value = false;
    } catch (e) {
      statusText.value = '字幕解析失败：' + e.message;
      statusError.value = true;
    }
  };
  reader.readAsText(file, 'utf-8');
}

function onMediaFile(file) {
  if (!file) return;
  if (player) player.stop();
  isPlaying.value = false;
  player.setSrc(URL.createObjectURL(file));
  mediaName.value = file.name;
  const isVideo = (file.type || '').startsWith('video/');
  mediaKind.value = isVideo ? 'video' : 'audio';
  if (isVideo) {
    videoCollapsed.value = false;
    videoHeight.value = Math.round(window.innerHeight / 2);
  }
  statusText.value = '已载入：' + file.name;
  statusError.value = false;
}

function onSentenceClick(sentence) {
  playSentence(sentence);
}

// 播放指定句子（点击与键盘共用）：选中 + 区间播放
function playSentence(sentence) {
  currentId.value = sentence.id;
  currentText.value = sentence.text;
  if (!mediaName.value) {
    statusText.value = '请先选择音/视频文件';
    statusError.value = true;
    return;
  }
  const r = effectiveRanges.value.get(sentence.id) || { effStart: sentence.start, effEnd: sentence.end };
  isPlaying.value = true;
  player.playSegment(r.effStart, r.effEnd);
}

// 当前选中句在列表中的索引（未选为 -1）
const currentIdx = computed(() => sentences.value.findIndex(s => s.id === currentId.value));

// 方向键播放控制。焦点在输入框时不拦截，避免影响微调数字输入。
function onKeydown(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (!sentences.value.length) return;
  const n = sentences.value.length;
  const idx = currentIdx.value;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (idx < 0) playSentence(sentences.value[0]);            // 未选 → 第一句
      else if (idx < n - 1) playSentence(sentences.value[idx + 1]); // 下一句
      break; // 末句 → 不操作
    case 'ArrowUp':
      e.preventDefault();
      if (idx > 0) playSentence(sentences.value[idx - 1]);      // 上一句
      break; // 未选/首句 → 不操作
    case 'ArrowLeft':
      e.preventDefault();
      if (idx >= 0) playSentence(sentences.value[idx]);          // 重读当前句
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (player) player.stop();                                 // 结束当前句
      break;
  }
}

onMounted(() => {
  player = new Player(mediaEl.value);
  player.onStop(() => { isPlaying.value = false; });
  mediaEl.value.addEventListener('error', () => {
    if (mediaEl.value.error && mediaName.value) {
      isPlaying.value = false;
      statusText.value = '音/视频无法播放（编码不支持），建议改用 mp4/mp3';
      statusError.value = true;
    }
  });
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="layout">
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      :offset="offset"
      :extend="extend"
      :link-next="linkNext"
      :link-next-offset="linkNextOffset"
      :highlight-on="highlightOn"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
      @tweak="onTweak"
      @toggle-highlight="val => highlightOn = val"
    />
    <main class="panel-center">
      <div class="video-slot" :class="{ 'no-video': mediaKind !== 'video', collapsed: videoCollapsed }">
        <video v-show="!videoCollapsed" ref="mediaEl" class="media-video"
               preload="metadata" :style="{ height: videoHeight + 'px' }"></video>
        <button v-show="!videoCollapsed" class="collapse-btn" @click="toggleCollapse">收起</button>
        <div v-show="!videoCollapsed" class="resize-handle" @mousedown="startResize"></div>
        <button v-if="videoCollapsed" class="expand-btn" @click="toggleCollapse">▸ 展开视频</button>
      </div>
      <SentenceList
        :sentences="renderedSentences"
        :current-id="currentId"
        :is-playing="isPlaying"
        :enabled="enabled"
        :highlight-on="highlightOn"
        :colors="LEVEL_COLORS"
        @click="onSentenceClick"
      />
      <span class="status" :class="{ error: statusError }">{{ statusText }}</span>
    </main>
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
      :colors="LEVEL_COLORS"
    />
  </div>
</template>
