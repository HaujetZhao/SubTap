<script setup>
import { ref } from 'vue';

const props = defineProps({
  sentences: { type: Array, required: true },   // 含 tokens 的 renderedSentences
  currentId: { type: [Number, null], default: null },
  isPlaying: { type: Boolean, default: false },
  enabled: { type: Object, required: true },
  highlightOn: { type: Boolean, default: true },
  colors: { type: Object, required: true }
});
const emit = defineEmits(['click']);

const containerRef = ref(null);

// 供父组件调用：仅当当前选中句【不在视窗内】时，滚动让其顶部对齐容器顶部。
// 平滑动画由容器 CSS scroll-behavior:smooth 提供；顶部/底部自然夹边界。
// 设计：只在键盘上下切换时按需调用，避免每次切换都滚动干扰注意力。
function ensureVisible() {
  const c = containerRef.value;
  const el = c && c.querySelector('.sentence.active');
  if (!c || !el) return;
  const cR = c.getBoundingClientRect();
  const eR = el.getBoundingClientRect();
  if (eR.top >= cR.top && eR.bottom <= cR.bottom) return; // 已完全在视窗内，不滚
  c.scrollTop += (eR.top - cR.top); // 否则滚到容器顶部
}
defineExpose({ ensureVisible });

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// 片段背景：高亮开 + 片段有级别 + 该级勾选 → 该级色半透明；否则无
function tokStyle(tok) {
  if (!props.highlightOn || !tok.level || !props.enabled[tok.level]) return {};
  const c = props.colors[tok.level];
  return c ? { backgroundColor: c + '26' } : {};
}
</script>

<template>
  <div class="sentences" ref="containerRef">
    <div v-if="!sentences.length" class="empty">
      <div class="empty-head">
        <div class="empty-title">字幕点读器<span class="dash"> —— </span>英语学习助手</div>
        <div class="empty-sub">点读式学习，主动交互，高效学习不犯困</div>
      </div>
      <div class="empty-grid">
        <div class="empty-card">
          <div class="empty-card-h">三步上手</div>
          <div class="empty-step"><span class="num">1</span><span>载入字幕和视频</span></div>
          <div class="empty-step"><span class="num">2</span><span>点击字幕播放</span></div>
          <div class="empty-step"><span class="num">3</span><span>右侧学习生词</span></div>
        </div>
        <div class="empty-card">
          <div class="empty-card-h">快捷键</div>
          <div class="empty-key"><kbd>↑</kbd><kbd>↓</kbd>上/下一句</div>
          <div class="empty-key"><kbd>←</kbd>重读当前句</div>
          <div class="empty-key"><kbd>→</kbd>停止(或空格)</div>
        </div>
      </div>
    </div>
    <div
      v-for="s in sentences"
      :key="s.id"
      class="sentence"
      :class="{ active: s.id === currentId, playing: s.id === currentId && isPlaying }"
      @click="emit('click', s)"
    >
      <span class="play-icon">{{ (s.id === currentId && isPlaying) ? '⏸' : '▶' }}</span>
      <span class="time">[{{ fmt(s.start) }}]</span>
      <span class="text">
        <span v-for="(tok, i) in s.tokens" :key="i" :style="tokStyle(tok)">{{ tok.text }}</span>
      </span>
    </div>
  </div>
</template>
