<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import PillControls from './PillControls.vue';
import { createPillSystem, loadPos } from '../pill-drag.js';

defineProps({
  mediaKind: { type: String, default: null },      // 'video' | 'audio' | null
  playing: { type: Boolean, default: false },
  hasSentences: { type: Boolean, default: false },
});
const emit = defineEmits(['fullscreenchange', 'prev', 'toggle', 'next']);

const mediaEl = ref(null);
const videoHeight = ref(240);
const videoCollapsed = ref(false);

let dragging = false, dragStartY = 0, dragStartH = 0;
function startResize(e) {
  dragging = true;
  dragStartY = e.clientY;
  dragStartH = videoHeight.value;
  // 指针锁定:手指/鼠标移出把手区域仍持续收到 move,鼠标/触摸统一走 Pointer Events
  e.target.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onResize(e) {
  if (!dragging) return;
  const delta = e.clientY - dragStartY; // 向下拖→把手向下→视频变高
  const maxH = window.innerHeight * 0.5; // 上限:视窗一半
  let h = dragStartH + delta;
  if (h < 100) h = 100;
  if (h > maxH) h = maxH;
  videoHeight.value = h;
}
function stopResize() { dragging = false; }
// 视频元数据就绪:按原始宽高比 + 当下容器宽算高度,封顶视窗一半。
// 视频本身较矮就适配它,而不是一上来占半屏。
function onVideoMeta() {
  const v = mediaEl.value;
  if (!v || !v.videoWidth) return;
  const w = v.clientWidth || v.parentElement.clientWidth;
  let h = w * (v.videoHeight / v.videoWidth);
  const maxH = window.innerHeight * 0.5;
  if (h > maxH) h = maxH;
  videoHeight.value = Math.round(h);
}
function toggleCollapse() {
  videoCollapsed.value = !videoCollapsed.value;
}
function expand() { videoCollapsed.value = false; }   // 载入视频时恢复展开(useLoader 的 expandVideo 经 App 调用)

// ===== 全屏 =====
const stageRef = ref(null);           // 全屏容器(video + 控件层),全屏它而非 video 本身,控件层才能在全屏内显示
const isFullscreen = ref(false);
const videoOverlay = ref(false);      // 点击视频显示/隐藏悬浮控件(非全屏的 ⛶ 与全屏的播控药丸共用)

// 进全屏时:横版视频 + 设备竖屏 → 锁横屏(手机/平板观看体验);
// 退全屏浏览器自动解除方向锁。iOS Safari 不支持 lock,失败静默(用户手动转屏)。
async function toggleFullscreen() {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  await stageRef.value.requestFullscreen();
  const v = mediaEl.value;
  const portrait = matchMedia('(orientation: portrait)').matches;
  if (v.videoWidth > v.videoHeight && portrait) {
    try { await screen.orientation.lock('landscape'); } catch { /* 不支持则忽略 */ }
  }
}
function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
  emit('fullscreenchange');   // App 侧把底部控制条药丸夹回可见区
}

// ===== 全屏播控药丸 =====
// 播控药丸拖动:位置按"药丸中心占视频比例"存 localStorage,任意尺寸/全屏下等比复现
const VC_POS_KEY = 'videoCtrlPos';
const { makePillDrag, guard } = createPillSystem();
const pillRef = ref(null);
const vcPos = ref(loadPos(VC_POS_KEY, { x: 0.5, y: 0.55 }));
let vcStageRect = null;   // down 时量一次,拖动热路径零 DOM 读取
const vcPillDrag = makePillDrag({
  getEl: () => { vcStageRect = stageRef.value.getBoundingClientRect(); return pillRef.value; },
  clamp: (cx, cy, halfX, halfY) => {
    const st = vcStageRect;
    const x = Math.min(Math.max(cx, st.left + halfX), st.right - halfX);
    const y = Math.min(Math.max(cy, st.top + halfY), st.bottom - halfY);
    vcPos.value = { x: (x - st.left) / st.width, y: (y - st.top) / st.height };
  },
  persist: () => localStorage.setItem(VC_POS_KEY, JSON.stringify(vcPos.value)),
});

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange));
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  vcPillDrag.cancel();
});

// App 侧需要:Player 拿 mediaEl、快捷键 f/Enter 拿折叠/全屏、载入视频时展开
defineExpose({ mediaEl, toggleCollapse, toggleFullscreen, expand });
</script>

<template>
  <div class="video-slot" :class="{ 'no-video': mediaKind !== 'video', collapsed: videoCollapsed }">
    <div v-show="!videoCollapsed" ref="stageRef" class="video-stage"
         :style="isFullscreen ? undefined : { height: videoHeight + 'px' }"
         @click="videoOverlay = !videoOverlay">
      <video ref="mediaEl" class="media-video"
             preload="metadata"
             @loadedmetadata="onVideoMeta"
             @dblclick.prevent="toggleCollapse"></video>
      <!-- 非全屏:右下角"进全屏"按钮(点击视频显隐) -->
      <button v-if="videoOverlay" class="vc-fs" :title="isFullscreen ? '退出全屏' : '全屏'" @click.stop="guard(toggleFullscreen, $event)">
        <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
      </button>
      <!-- 全屏:播控药丸(可拖动定位,位置持久化) -->
      <div v-if="isFullscreen && videoOverlay" ref="pillRef" class="vc-pill"
           :style="{ left: vcPos.x * 100 + '%', top: vcPos.y * 100 + '%' }"
           @pointerdown="vcPillDrag.down" @click.stop>
        <PillControls :guard="guard" :disabled="!hasSentences" :playing="playing"
                      @prev="$emit('prev')" @toggle="$emit('toggle')" @next="$emit('next')" />
      </div>
      <!-- 1px 全透明钉子:画面内容区顶部居中,阻止 Chromium 把拖进黑边的药丸剔除不绘制 -->
      <div class="vc-anchor"></div>
    </div>
    <div v-show="!videoCollapsed" class="resize-handle"
         @pointerdown="startResize" @pointermove="onResize"
         @pointerup="stopResize" @pointercancel="stopResize"></div>
    <button v-if="videoCollapsed" class="expand-btn" @click="toggleCollapse"><i class="fas fa-play" style="margin-right:6px"></i> 展开视频</button>
  </div>
</template>
