<script setup>
import { ref } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { tokStyle as tokStyleBase } from '../logic/level-colors.js';

const props = defineProps({
  sentences: { type: Array, required: true },   // 含 tokens 的 renderedSentences
  currentId: { type: [Number, null], default: null },
  isPlaying: { type: Boolean, default: false },
  enabled: { type: Object, required: true },
  highlightOn: { type: Boolean, default: true },
  colors: { type: Object, required: true },
  theme: { type: String, default: 'light' },
  canRestore: { type: Boolean, default: false },
  mediaLoaded: { type: Boolean, default: false }   // 已载媒体但无字幕时,空载引导页让位给 VAD 按钮
});
const emit = defineEmits(['click', 'copy', 'sample', 'restore']);

// 长按复制:移动端长按 500ms 自动复制当前句文本
const LONG_MS = 500;
let longPressTimer = null;
let longPressFired = false;

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}
function copySentence(sentence) {
  const text = sentence.text || sentence.tokens.map(t => t.text).join('');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  else fallbackCopy(text);
  emit('copy');
}

function onSentenceTouchStart(e, sentence) {
  longPressFired = false;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressFired = true;
    copySentence(sentence);
  }, LONG_MS);
}
function onSentenceTouchEnd() { clearTimeout(longPressTimer); }
function onSentenceContextMenu(e, sentence) {
  e.preventDefault();
  copySentence(sentence);
}
function onSentenceClick(sentence) {
  if (longPressFired) { longPressFired = false; return; }
  emit('click', sentence);
}

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
// 平滑由 scrollToIndex 的 behavior 参数按次指定——容器 CSS 不开 smooth,
// 否则动态测高的 scrollTop 补偿也会被平滑化,向上滚时抖动跳变。
// instant=true(恢复上次的远距离跳转)用 'auto',避免长动画。
function ensureVisible(instant = false) {
  const c = scrollRef.value;
  if (!c) return;
  const el = c.querySelector('.sentence.active');
  if (el) {
    const cR = c.getBoundingClientRect();
    const eR = el.getBoundingClientRect();
    if (eR.top >= cR.top && eR.bottom <= cR.bottom) return; // 已完全在视窗内,不滚
  }
  const idx = props.sentences.findIndex(s => s.id === props.currentId);
  if (idx < 0) return;
  virtualizer.value.scrollToIndex(idx, { align: 'start', behavior: instant ? 'auto' : 'smooth' });
}
defineExpose({ ensureVisible });

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// 亮色:级别色半透明背景;暗色背景变暗,改为前景色叠加(同视频字幕层,级别色向白混)
function tokStyle(tok) {
  return tokStyleBase(tok, { ...props, dark: props.theme === 'dark' });
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
            @click="onSentenceClick(sentences[vi.index])"
            @contextmenu="onSentenceContextMenu($event, sentences[vi.index])"
            @touchstart="onSentenceTouchStart($event, sentences[vi.index])"
            @touchend="onSentenceTouchEnd"
            @touchmove="onSentenceTouchEnd"
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

    <div v-else-if="!mediaLoaded" class="empty">
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
          <div class="empty-key"><kbd>Enter</kbd>视频全屏切换</div>
        </div>
      </div>
      <div class="empty-actions">
        <button class="empty-sample-btn" @click="emit('sample')"><i class="fas fa-play" style="margin-right:4px"></i> 载入示例</button>
        <button v-if="canRestore" class="empty-last-btn" @click="emit('restore')"><i class="fas fa-clock-rotate-left" style="margin-right:4px"></i> 打开上次</button>
      </div>
      <a class="empty-footer" href="https://github.com/HaujetZhao/SubTap" target="_blank" rel="noopener">GitHub · HaujetZhao/SubTap</a>
    </div>
  </div>
</template>
