<script setup>
import { ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';

const props = defineProps({
  sentences: { type: Array, required: true },   // 含 tokens 的 renderedSentences
  currentId: { type: [Number, null], default: null },
  isPlaying: { type: Boolean, default: false },
  enabled: { type: Object, required: true },
  highlightOn: { type: Boolean, default: true },
  colors: { type: Object, required: true }
});
const emit = defineEmits(['click', 'sample']);

// 滚动容器 DOM(getScrollElement 取值要用 ref 的 .value)
const scrollRef = ref(null);

// TanStack 虚拟滚动:动态高度模式。
// 选 TanStack 而非 vue-virtual-scroller —— 后者的 DynamicScroller 在向上滚时
// "估高→实测修正"会引发内容跳动(anchor 逻辑在 logical/visual 两套坐标间反复横跳);
// TanStack 的 measureElement + scrollOffset 补偿能保持视窗内容视觉稳定,实测不跳。
// estimateSize 给初始估高,measureElement 实测真实高度并自动补偿 scrollTop。
const virtualizer = useVirtualizer({
  get count() { return props.sentences.length; },
  getScrollElement: () => scrollRef.value,
  estimateSize: () => 48,
  overscan: 10,
  getItemKey: (i) => props.sentences[i].id
});

// 供父组件调用:仅当当前选中句【不在视窗内】时,滚动让其顶部对齐容器顶部。
// 设计:只在键盘上下切换时按需调用,避免每次切换都滚动干扰注意力。
function ensureVisible() {
  const c = scrollRef.value;
  if (!c) return;
  const el = c.querySelector('.sentence.active');
  if (el) {
    const cR = c.getBoundingClientRect();
    const eR = el.getBoundingClientRect();
    if (eR.top >= cR.top && eR.bottom <= cR.bottom) return; // 已完全在视窗内,不滚
  }
  const idx = props.sentences.findIndex(s => s.id === props.currentId);
  if (idx >= 0) virtualizer.value.scrollToIndex(idx, { align: 'start' });
}
defineExpose({ ensureVisible });

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// 片段背景:高亮开 + 片段有级别 + 该级勾选 → 该级色半透明；否则无
function tokStyle(tok) {
  if (!props.highlightOn || !tok.level || !props.enabled[tok.level]) return {};
  const c = props.colors[tok.level];
  return c ? { backgroundColor: c + '26' } : {};
}
</script>

<template>
  <div class="sentences-wrap">
    <div v-if="sentences.length" ref="scrollRef" class="sentences">
      <div class="ts-track" :style="{ height: virtualizer.getTotalSize() + 'px' }">
        <div
          v-for="vi in virtualizer.getVirtualItems()"
          :key="vi.key"
          class="ts-item"
          :data-index="vi.index"
          :style="{ transform: `translateY(${vi.start}px)` }"
          :ref="el => virtualizer.measureElement(el)"
        >
          <div
            class="sentence"
            :class="{ active: sentences[vi.index].id === currentId, playing: sentences[vi.index].id === currentId && isPlaying }"
            @click="emit('click', sentences[vi.index])"
          >
            <div class="play-icon"><i :class="(sentences[vi.index].id === currentId && isPlaying) ? 'fas fa-pause' : 'fas fa-play'"></i></div>
            <div class="time">[{{ fmt(sentences[vi.index].start) }}]</div>
            <div class="text">
              <span v-for="(tok, i) in sentences[vi.index].tokens" :key="i" :style="tokStyle(tok)">{{ tok.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <div class="empty-head">
        <div class="empty-title">SubTap <span class="zh">字幕点读器</span></div>
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
          <div class="empty-key"><kbd>←</kbd><kbd>→</kbd>重读/停止</div>
          <div class="empty-key"><kbd>[</kbd><kbd>]</kbd>收起左/右边栏</div>
          <div class="empty-key"><kbd>F</kbd>收起视频(或双击)</div>
        </div>
      </div>
      <button class="empty-sample-btn" @click="emit('sample')"><i class="fas fa-play" style="margin-right:4px"></i> 载入示例</button>
      <a class="empty-footer" href="https://github.com/HaujetZhao/SubTap" target="_blank" rel="noopener">GitHub · HaujetZhao/SubTap</a>
    </div>
  </div>
</template>
