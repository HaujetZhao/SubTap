<script setup>
import { LEVEL_COLORS } from '../level-colors.js';

const props = defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true },
  offset: { type: Number, default: 0 },
  extend: { type: Number, default: 0 },
  linkNext: { type: Boolean, default: false },
  linkNextOffset: { type: Number, default: -0.1 },
  highlightOn: { type: Boolean, default: true }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'media-file', 'tweak', 'toggle-highlight']);

function dotColor(lv) { return LEVEL_COLORS[lv] || '#9ca3af'; }

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
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-item">
          <input type="checkbox" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span class="level-dot" :style="{ background: dotColor(lv) }"></span>
          <span>{{ lv }}</span>
        </label>
      </div>
      <label class="level-item highlight-toggle">
        <input type="checkbox" :checked="highlightOn"
               @change="emit('toggle-highlight', $event.target.checked)" />
        <span>用背景色突出单词</span>
      </label>
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
      <label v-show="linkNext" class="tweak-row">句末连接偏移(秒)
        <input type="number" min="-5" max="5" step="0.1" :value="linkNextOffset"
               @change="onTweak('linkNextOffset', parseFloat($event.target.value) || 0)" />
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
