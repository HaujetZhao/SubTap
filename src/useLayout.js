import { ref, computed, onMounted, onUnmounted } from 'vue';

// 侧栏布局状态机(仿 DeepSeek 三态):迟滞双阈值自动 pin,手动 hide/overlay 覆盖。
// 独立于 App 的其余状态:输入只有 window 尺寸与用户拖拽,输出 refs/computed
// (App 顶层解构后模板自动解包)。
export function createLayout(onAfterResize) {
  const BP = { leftPin: 1100, leftUnpin: 1080, rightPin: 800, rightUnpin: 780 };
  const leftPin  = ref(window.innerWidth > BP.leftPin);
  const rightPin = ref(window.innerWidth > BP.rightPin);
  const leftHide  = ref(false);   // 手动折叠覆盖 pin
  const rightHide = ref(false);
  const leftOv  = ref(false);      // 窄屏手动 overlay
  const rightOv = ref(false);
  const sideDragging = ref(false);

  function recompute() {
    const w = window.innerWidth;
    const lp = leftPin.value, rp = rightPin.value;
    if (w > BP.leftPin)        leftPin.value  = true;
    else if (w < BP.leftUnpin) leftPin.value  = false;
    if (w > BP.rightPin)        rightPin.value = true;
    else if (w < BP.rightUnpin) rightPin.value = false;
    // 跨阈值时清手动标志,让自动态重新接管
    if (leftPin.value  !== lp) { leftHide.value  = false; leftOv.value  = false; }
    if (rightPin.value !== rp) { rightHide.value = false; rightOv.value = false; }
  }
  let resizeRaf = 0;
  const onWindowResize = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { recompute(); onAfterResize(); });
  };

  const leftPinned  = computed(() => leftPin.value  && !leftHide.value  && !leftOv.value);
  const rightPinned = computed(() => rightPin.value && !rightHide.value && !rightOv.value);
  const hasOverlay  = computed(() => leftOv.value || rightOv.value);
  const layoutClass = computed(() => ({
    'left-pinned':   leftPinned.value,
    'right-pinned':  rightPinned.value,
    'left-overlay':  leftOv.value,
    'right-overlay': rightOv.value,
    'has-overlay':   hasOverlay.value,
    'side-dragging': sideDragging.value,
  }));

  // push 模式拖拽调左右栏宽(180–480),持久化。应用走 .layout 的 :style 绑定 CSS var。
  const LS_W = 'subtap-widths';
  let _w = {};
  try { _w = JSON.parse(localStorage.getItem(LS_W)) || {}; } catch {}
  const leftWidth  = ref(_w.leftWidth  ?? 230);
  const rightWidth = ref(_w.rightWidth ?? 280);
  // 宽度持久化在 stopSideResize 写一次,不随拖动热路径每个 pointermove 写盘
  let sideDrag = null;
  function startSideResize(panel, e) {
    sideDragging.value = true;
    sideDrag = { panel, x: e.clientX, w: panel === 'left' ? leftWidth.value : rightWidth.value };
    document.addEventListener('pointermove', onSideResize);
    document.addEventListener('pointerup', stopSideResize);
    e.preventDefault();
  }
  function onSideResize(e) {
    if (!sideDrag) return;
    const delta = sideDrag.panel === 'left' ? e.clientX - sideDrag.x : sideDrag.x - e.clientX;
    const w = Math.min(480, Math.max(180, sideDrag.w + delta));
    (sideDrag.panel === 'left' ? leftWidth : rightWidth).value = w;
  }
  function stopSideResize() {
    sideDragging.value = false;
    sideDrag = null;
    document.removeEventListener('pointermove', onSideResize);
    document.removeEventListener('pointerup', stopSideResize);
    try { localStorage.setItem(LS_W, JSON.stringify({ leftWidth: leftWidth.value, rightWidth: rightWidth.value })); } catch {}
  }

  // 栏顶收起按钮:overlay 开则关 overlay,否则手动折叠
  const collapseLeft  = () => leftOv.value  ? (leftOv.value = false)  : (leftHide.value = true);
  const collapseRight = () => rightOv.value ? (rightOv.value = false) : (rightHide.value = true);
  // FAB/快捷键:宽屏 toggle hide(折叠↔展开,与栏顶收起按钮一致),窄屏 toggle overlay(两栏互斥)
  function toggleFab(side) {
    if (side === 'left') {
      if (leftPin.value) { leftHide.value = !leftHide.value; leftOv.value = false; }
      else leftOv.value = !leftOv.value;
    } else {
      if (rightPin.value) { rightHide.value = !rightHide.value; rightOv.value = false; }
      else rightOv.value = !rightOv.value;
    }
    if (leftOv.value && rightOv.value) rightOv.value = false;   // 互斥
  }
  const closeBoth = () => { leftOv.value = false; rightOv.value = false; };

  onMounted(() => {
    window.addEventListener('resize', onWindowResize);
    recompute();
  });
  onUnmounted(() => {
    window.removeEventListener('resize', onWindowResize);
    cancelAnimationFrame(resizeRaf);
    // 未注册时 remove 是 no-op,无条件清(拖拽进行中卸载仅开发期热重载会走到)
    document.removeEventListener('pointermove', onSideResize);
    document.removeEventListener('pointerup', stopSideResize);
  });

  return { leftWidth, rightWidth, hasOverlay, layoutClass, startSideResize, collapseLeft, collapseRight, toggleFab, closeBoth };
}
