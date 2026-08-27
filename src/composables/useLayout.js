import { ref, reactive, computed, toRef, onMounted, onUnmounted } from 'vue';
import { loadJson } from './pill-drag.js';

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

  // push 模式拖拽调左右栏宽(180–480,再按视口宽夹取),持久化。
  // 应用走 .layout 的 :style 绑定 CSS var。宽度分横竖屏各存一套:手机转屏后视口宽度
  // 差异大,同一宽度两头都不合适(旧单套格式字段对不上,自然回默认)。
  const LS_W = 'subtap-widths';
  const DEF = { left: 230, right: 280 };
  const _w = loadJson(LS_W, {});
  // push 模式给中间区留 160px;overlay(窄屏)是浮层不占中间区,只留 48px 边缝即可拖到接近满屏
  const clamp = w => {
    const reserve = leftPin.value || rightPin.value ? 160 : 48;
    return Math.max(180, Math.min(w, Math.min(480, window.innerWidth - reserve)));
  };
  // reactive:computed getter 靠它建立依赖,set 后才能通知 App 的 :style 更新 CSS var
  const saved = reactive({
    landscape: { ...DEF, ..._w.landscape },
    portrait:  { ...DEF, ..._w.portrait },
    // 全屏生词栏是独立实例,宽度单独存(不分横竖屏:全屏基本恒为锁定的横屏)
    fsRight: clamp(_w.fsRight ?? 320),
  });
  const om = matchMedia('(orientation: portrait)');
  const cur = () => saved[om.matches ? 'portrait' : 'landscape'];
  const leftWidth  = computed({ get: () => cur().left,  set: v => { cur().left = v; } });
  const rightWidth = computed({ get: () => cur().right, set: v => { cur().right = v; } });
  const fsRightWidth = toRef(saved, 'fsRight');
  // 转屏:切到另一套值并把新视口放不下的宽度夹回来
  function onOrientationChange() {
    const c = cur();
    c.left = clamp(c.left);
    c.right = clamp(c.right);
  }
  // 宽度持久化在 stopSideResize 写一次,不随拖动热路径每个 pointermove 写盘
  let sideDrag = null;
  const WIDTH_REFS = { left: leftWidth, right: rightWidth, fs: fsRightWidth };
  function startSideResize(panel, e) {
    sideDragging.value = true;
    sideDrag = { panel, x: e.clientX, w: WIDTH_REFS[panel].value };
    document.addEventListener('pointermove', onSideResize);
    document.addEventListener('pointerup', stopSideResize);
    e.preventDefault();
  }
  function onSideResize(e) {
    if (!sideDrag) return;
    const delta = sideDrag.panel === 'left' ? e.clientX - sideDrag.x : sideDrag.x - e.clientX;
    WIDTH_REFS[sideDrag.panel].value = clamp(sideDrag.w + delta);
  }
  function stopSideResize() {
    sideDragging.value = false;
    sideDrag = null;
    document.removeEventListener('pointermove', onSideResize);
    document.removeEventListener('pointerup', stopSideResize);
    try { localStorage.setItem(LS_W, JSON.stringify(saved)); } catch {}
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
    om.addEventListener('change', onOrientationChange);
    onOrientationChange();   // 存的宽度可能超出当前视口(如换设备),先夹一次
    recompute();
  });
  onUnmounted(() => {
    window.removeEventListener('resize', onWindowResize);
    om.removeEventListener('change', onOrientationChange);
    cancelAnimationFrame(resizeRaf);
    // 未注册时 remove 是 no-op,无条件清(拖拽进行中卸载仅开发期热重载会走到)
    document.removeEventListener('pointermove', onSideResize);
    document.removeEventListener('pointerup', stopSideResize);
  });

  return { leftWidth, rightWidth, fsRightWidth, hasOverlay, layoutClass, startSideResize, collapseLeft, collapseRight, toggleFab, closeBoth };
}
