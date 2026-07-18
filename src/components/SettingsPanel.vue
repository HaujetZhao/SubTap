<script setup>
import { LEVEL_COLORS } from '../level-colors.js';

const props = defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true },
  offset: { type: Number, default: 0 },
  endMode: { type: String, default: 'extend' },     // 'extend' | 'linkNext'
  endOffset: { type: Number, default: 0 },
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
// 末尾处理模式循环切换:末尾延长 ↔ 句末衔接
function cycleEndMode() {
  emit('tweak', 'endMode', props.endMode === 'extend' ? 'linkNext' : 'extend');
}
</script>

<template>
  <aside class="panel-left">
    <!-- 文件(置顶) -->
    <section class="files">
      <h3 class="panel-title">文件</h3>
      <label class="file-btn">
        <span class="file-ico">S</span>
        打开字幕
        <input type="file" accept=".srt" @change="onSrtChange" />
      </label>
      <label class="file-btn alt">
        <span class="file-ico">♪</span>
        打开音/视频
        <input type="file" accept="audio/*,video/*" @change="onMediaChange" />
      </label>
    </section>

    <!-- 词库分级 -->
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-pill" :class="{ off: !enabled[lv] }">
          <input type="checkbox" class="sr-only" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span class="dot" :style="{ background: dotColor(lv) }"></span>
          <span class="label-text">{{ lv }}</span>
          <span class="switch" aria-hidden="true"></span>
        </label>
        <!-- 词汇提示:与分级同款卡片(灰圆点区分),顶部横线划分 -->
        <label class="level-pill vocab-toggle" :class="{ off: !highlightOn }">
          <input type="checkbox" class="sr-only" :checked="highlightOn"
                 @change="emit('toggle-highlight', $event.target.checked)" />
          <span class="dot muted"></span>
          <span class="label-text">词汇提示</span>
          <span class="switch" aria-hidden="true"></span>
        </label>
      </div>
    </section>

    <!-- 字幕微调 -->
    <section class="tweak">
      <h3 class="panel-title">字幕微调</h3>
      <label class="tweak-row">起始偏移
        <input type="number" min="-10" max="10" step="0.1" :value="offset"
               @change="onTweak('offset', parseFloat($event.target.value) || 0)" />
      </label>
      <!-- 末尾处理:点击文字/箭头在「末尾延长 ↔ 句末衔接」间切换,共用一个偏移输入 -->
      <div class="tweak-row">
        <span class="mode-toggle" @click="cycleEndMode"
              :title="endMode === 'linkNext' ? '当前:句末衔接(点击切换为末尾延长)' : '当前:末尾延长(点击切换为句末衔接)'">{{ endMode === 'linkNext' ? '句末衔接' : '末尾延长' }}<span class="cycle-icon" aria-hidden="true">↻</span></span>
        <input type="number" min="-5" max="5" step="0.1" :value="endOffset"
               @change="onTweak('endOffset', parseFloat($event.target.value) || 0)" />
      </div>
    </section>
  </aside>
</template>
