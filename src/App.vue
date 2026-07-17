<script setup>
import { ref, reactive, onMounted } from 'vue';
import vocab from './vocabulary.json';
import { parseSRT } from './srt-parser.js';
import { buildVocab, lookupWords } from './word-lookup.js';
import { createVocabStore } from './vocab-store.js';
import { Player } from './player.js';
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';

// 词库 store（框架无关，非响应式）
const store = createVocabStore(buildVocab, lookupWords);
store.init(vocab);

// 响应式勾选镜像：驱动 UI 重算
const enabled = reactive({});
for (const lv of store.getLevels()) enabled[lv] = true;

// 全局状态
const sentences = ref([]);
const currentId = ref(null);
const currentText = ref('');
const isPlaying = ref(false);
const mediaName = ref('');
const statusText = ref('请选择文件');
const statusError = ref(false);

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
  const delta = dragStartY - e.clientY; // 向上拖增大高度
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
  statusText.value = '已载入：' + file.name;
  statusError.value = false;
}

function onSentenceClick(sentence) {
  currentId.value = sentence.id;
  currentText.value = sentence.text;
  if (!mediaName.value) {
    statusText.value = '请先选择音/视频文件';
    statusError.value = true;
    return;
  }
  isPlaying.value = true;
  player.playSegment(sentence.start, sentence.end);
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
});
</script>

<template>
  <div class="layout">
    <SettingsPanel
      :levels="store.getLevels()"
      :enabled="enabled"
      @toggle-level="onToggleLevel"
      @srt-file="onSrtFile"
      @media-file="onMediaFile"
    />
    <main class="panel-center">
      <div class="video-slot" :class="{ empty: !mediaName }">
        <div class="video-bar">
          <button class="collapse-btn" @click="toggleCollapse">
            {{ videoCollapsed ? '展开视频' : '收起视频' }}
          </button>
        </div>
        <video v-show="!videoCollapsed" ref="mediaEl" class="media-video"
               preload="metadata" controls :style="{ height: videoHeight + 'px' }"></video>
        <div v-show="!videoCollapsed" class="resize-handle" @mousedown="startResize"></div>
      </div>
      <SentenceList
        :sentences="sentences"
        :current-id="currentId"
        :is-playing="isPlaying"
        @click="onSentenceClick"
      />
      <span class="status" :class="{ error: statusError }">{{ statusText }}</span>
    </main>
    <WordPanel
      :store="store"
      :enabled="enabled"
      :current-text="currentText"
    />
  </div>
</template>
