<script setup>
const props = defineProps({
  sentences: { type: Array, required: true },   // 含 tokens 的 renderedSentences
  currentId: { type: [Number, null], default: null },
  isPlaying: { type: Boolean, default: false },
  enabled: { type: Object, required: true },
  highlightOn: { type: Boolean, default: true },
  colors: { type: Object, required: true }
});
const emit = defineEmits(['click']);

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
  <div class="sentences">
    <div v-if="!sentences.length" class="placeholder">选择字幕后，句子列表会显示在这里</div>
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
