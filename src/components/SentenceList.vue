<script setup>
defineProps({
  sentences: { type: Array, required: true },
  currentId: { type: [Number, null], default: null },
  isPlaying: { type: Boolean, default: false }
});
const emit = defineEmits(['click']);

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
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
      <span class="text">{{ s.text.replace(/\n/g, ' ') }}</span>
    </div>
  </div>
</template>
