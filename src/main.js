// 入口：组装模块、绑定事件、三栏联动
import { parseSRT } from './srt-parser.js';
import { buildVocab, lookupWords } from './word-lookup.js';
import { Player } from './player.js';
import { createVocabStore } from './vocab-store.js';
import * as ui from './ui.js';

const store = createVocabStore(buildVocab, lookupWords);

const state = {
  sentences: [],
  currentId: null,
  player: null,
  currentText: ''
};

// --- 初始化词库（内置 or fetch 兜底） ---
function initVocab() {
  if (window.__VOCAB__) {
    store.init(window.__VOCAB__);
    ui.setVocabStatus('词库已内置：' + store.getLevels().length + ' 个分级', false);
    setupSettings();
  } else {
    ui.setVocabStatus('正在加载词库…', false);
    fetch('src/vocabulary.json')
      .then(r => r.json())
      .then(obj => {
        store.init(obj);
        ui.setVocabStatus('词库已加载：' + store.getLevels().length + ' 个分级', false);
        setupSettings();
      })
      .catch(() => ui.setVocabStatus('词库加载失败', true));
  }
}

function setupSettings() {
  ui.renderSettings(document.getElementById('levels'), store, (level, enabled) => {
    store.setEnabled(level, enabled);
    if (state.currentText) refreshWordPanel(state.currentText);
  });
}

function refreshWordPanel(text) {
  const panel = document.getElementById('word-panel');
  if (!store.isReady()) {
    panel.className = 'placeholder';
    panel.textContent = '词库未就绪';
    return;
  }
  const levels = store.getLevels();
  const anyEnabled = levels.some(l => store.isEnabled(l));
  if (!anyEnabled) {
    panel.className = 'placeholder';
    panel.textContent = '未勾选任何分级';
    return;
  }
  ui.renderWordGroups(panel, store, store.lookupByLevel(text));
}

// --- 文件载入 ---
document.getElementById('srt-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.sentences = parseSRT(reader.result);
      ui.renderSentences(document.getElementById('sentences'), state.sentences, onSentenceClick);
      ui.setStatus('已载入 ' + state.sentences.length + ' 句字幕');
    } catch (err) {
      ui.setStatus('字幕解析失败：' + err.message, true);
    }
  };
  reader.readAsText(file, 'utf-8');
});

document.getElementById('audio-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  state.player.setSrc(URL.createObjectURL(file));
  state.audioName = file.name;
  ui.setStatus('已载入音频：' + file.name);
});

// --- 点句子 ---
function onSentenceClick(sentence) {
  const container = document.getElementById('sentences');
  if (state.currentId != null && state.currentId !== sentence.id) {
    ui.markPlaying(container, state.currentId, false);
  }
  state.currentId = sentence.id;
  state.currentText = sentence.text;

  ui.highlightSentence(container, sentence.id);
  refreshWordPanel(sentence.text);

  if (!state.audioName) {
    ui.setStatus('请先选择音频文件', true);
    return;
  }
  ui.markPlaying(container, sentence.id, true);
  state.player.playSegment(sentence.start, sentence.end);
}

// --- 初始化 ---
state.player = new Player(document.getElementById('audio'));
const audioEl = document.getElementById('audio');
audioEl.addEventListener('error', () => {
  if (audioEl.error && state.audioName) {
    ui.setStatus('音频无法播放（编码不支持），建议改用 mp3', true);
  }
});
state.player.onStop(() => {
  if (state.currentId != null) {
    ui.markPlaying(document.getElementById('sentences'), state.currentId, false);
  }
});

initVocab();
