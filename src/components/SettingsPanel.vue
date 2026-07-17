<script setup>
defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'audio-file']);

function onSrtChange(e) {
  const f = e.target.files[0];
  if (f) emit('srt-file', f);
}
function onAudioChange(e) {
  const f = e.target.files[0];
  if (f) emit('audio-file', f);
}
</script>

<template>
  <aside class="panel-left">
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      <div class="vocab-status">共 {{ levels.length }} 个分级</div>
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-item">
          <input type="checkbox" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span>{{ lv }}</span>
        </label>
      </div>
    </section>
    <section class="files">
      <h3 class="panel-title">文件</h3>
      <label class="file-btn">字幕 .srt
        <input type="file" accept=".srt" @change="onSrtChange" />
      </label>
      <label class="file-btn">音频
        <input type="file" accept="audio/*" @change="onAudioChange" />
      </label>
    </section>
  </aside>
</template>
