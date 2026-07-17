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
const audioName = ref('');
const statusText = ref('请选择文件');
const statusError = ref(false);

const audioEl = ref(null);
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
      // 重置选中/播放态，避免新字幕的同 id 句子预高亮、旧单词面板残留
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

function onAudioFile(file) {
  if (!file) return;
  player.setSrc(URL.createObjectURL(file));
  audioName.value = file.name;
  statusText.value = '已载入音频：' + file.name;
  statusError.value = false;
}

function onSentenceClick(sentence) {
  currentId.value = sentence.id;
  currentText.value = sentence.text;
  if (!audioName.value) {
    statusText.value = '请先选择音频文件';
    statusError.value = true;
    return;
  }
  isPlaying.value = true;
  player.playSegment(sentence.start, sentence.end);
}

onMounted(() => {
  player = new Player(audioEl.value);
  player.onStop(() => { isPlaying.value = false; });
  // 音频解码失败时提示（如浏览器不支持的编码）
  audioEl.value.addEventListener('error', () => {
    if (audioEl.value.error && audioName.value) {
      isPlaying.value = false;
      statusText.value = '音频无法播放（编码不支持），建议改用 mp3';
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
      @audio-file="onAudioFile"
    />
    <main class="panel-center">
      <div class="video-slot"></div>
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
  <audio ref="audioEl" class="hidden" preload="metadata"></audio>
</template>
