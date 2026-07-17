<script setup>
const props = defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true },
  offset: { type: Number, default: 0 },
  extend: { type: Number, default: 0 },
  linkNext: { type: Boolean, default: false }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'media-file', 'tweak']);

function onSrtChange(e) {
  const f = e.target.files[0];
  if (f) emit('srt-file', f);
}
function onMediaChange(e) {
  const f = e.target.files[0];
  if (f) emit('media-file', f);
}
function onTweak(key, val) {
  emit('tweak', key, val);
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

    <section class="tweak">
      <h3 class="panel-title">字幕微调</h3>
      <label class="tweak-row">起始偏移(秒)
        <input type="number" min="-10" max="10" step="0.1" :value="offset"
               @change="onTweak('offset', parseFloat($event.target.value) || 0)" />
      </label>
      <label class="tweak-row">末尾延长(秒)
        <input type="number" min="0" max="5" step="0.1" :value="extend"
               @change="onTweak('extend', parseFloat($event.target.value) || 0)" />
      </label>
      <label class="level-item">
        <input type="checkbox" :checked="linkNext"
               @change="onTweak('linkNext', $event.target.checked)" />
        <span>句末连接(播到下一句开头)</span>
      </label>
    </section>

    <section class="files">
      <h3 class="panel-title">文件</h3>
      <label class="file-btn">字幕 .srt
        <input type="file" accept=".srt" @change="onSrtChange" />
      </label>
      <label class="file-btn">音/视频
        <input type="file" accept="audio/*,video/*" @change="onMediaChange" />
      </label>
    </section>
  </aside>
</template>
