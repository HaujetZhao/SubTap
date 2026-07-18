<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';
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
const offset = ref(0);
const endMode = ref('extend');   // 'extend' | 'linkNext'
const endOffset = ref(0);

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
      stopSpeech();
      currentId.value = null;
      currentText.value = '';
      isPlaying.value = false;
      notify('已载入 ' + sentences.value.length + ' 句字幕');
    } catch (e) {
      notify('字幕解析失败：' + e.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function onMediaFile(file) {
  if (!file) return;
  if (player) player.stop();
  stopSpeech();
  isPlaying.value = false;
  player.setSrc(URL.createObjectURL(file));
  mediaName.value = file.name;
  const isVideo = (file.type || '').startsWith('video/');
  mediaKind.value = isVideo ? 'video' : 'audio';
  if (isVideo) {
    videoCollapsed.value = false;
    videoHeight.value = Math.round(window.innerHeight / 2);
  }
  notify('已载入：' + file.name);
}

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
  u.lang = 'en-US';
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
    speakSentence(sentence.text);
    return;
  }
  const r = effectiveRanges.value.get(sentence.id) || { effStart: sentence.start, effEnd: sentence.end };
  isPlaying.value = true;
  player.playSegment(r.effStart, r.effEnd);
}

// 当前选中句在列表中的索引（未选为 -1）
const currentIdx = computed(() => sentences.value.findIndex(s => s.id === currentId.value));

const sentenceListRef = ref(null);
// 键盘上下切换后，若目标句不在视窗内则滚到容器顶部（平滑）；在视窗内则不动。
function ensureActiveVisible() {
  nextTick(() => sentenceListRef.value?.ensureVisible());
}

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
      if (idx < 0) { playSentence(sentences.value[0]); ensureActiveVisible(); }            // 未选 → 第一句
      else if (idx < n - 1) { playSentence(sentences.value[idx + 1]); ensureActiveVisible(); } // 下一句
      break; // 末句 → 不操作
    case 'ArrowUp':
      e.preventDefault();
      if (idx > 0) { playSentence(sentences.value[idx - 1]); ensureActiveVisible(); }      // 上一句
      break; // 未选/首句 → 不操作
    case 'ArrowLeft':
      e.preventDefault();
      if (idx >= 0) playSentence(sentences.value[idx]);          // 重读当前句（不滚动）
      break;
    case 'ArrowRight':
    case ' ':              // 空格 = 结束播放（同 →）
    case 'Spacebar':
      e.preventDefault();
      if (player) player.stop();                                 // 结束媒体播放
      stopSpeech();                                              // 结束语音朗读
      isPlaying.value = false;
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
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  toasts.forEach(t => clearTimeout(t.timer));
  toasts.splice(0);
});
</script>

<template>
  <div class="layout">
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      :offset="offset"
      :end-mode="endMode"
      :end-offset="endOffset"
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
        ref="sentenceListRef"
        :sentences="renderedSentences"
        :current-id="currentId"
        :is-playing="isPlaying"
        :enabled="enabled"
        :highlight-on="highlightOn"
        :colors="LEVEL_COLORS"
        @click="onSentenceClick"
      />
    </main>
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
      :colors="LEVEL_COLORS"
    />
  </div>
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type"
         @click="dismiss(t.id)"
         @mouseenter="pauseToast(t)" @mouseleave="resumeToast(t)">
      <span class="ico">{{ t.type === 'error' ? '!' : '✓' }}</span>
      <span class="msg">{{ t.message }}</span>
      <span class="dismiss">×</span>
      <span :key="t.key" class="bar"></span>
    </div>
  </div>
</template>
