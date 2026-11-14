// 侧栏抽屉机制（navigation-drawer「drawer 兼 sidebar」变体，纯逻辑无 Vue 依赖）。
// 面板根元素带 popover="manual"，打开时成为铺满视口的顶层滑动面：
//   · 横向 scroll-snap 双停靠点（左栏：开=0／关=max；右栏镜像：开=max／关=0），
//     拖拽的动量、速度、中断全由浏览器原生处理；
//   · backdrop 透明度由滚动位置驱动（scroll-driven animation，目标浏览器为最新 Chrome）；
//   · 开合判定唯一事实源是 IntersectionObserver（sheet 完全进入=开、完全离开=关），
//     关闭只滚回关闭位、不动 popover，滑出动画播完才真正 hidePopover。
// 每侧一个实例，元素经 attach/detach 接线（面板进全屏时非全屏实例卸载）。
export function createDrawer({ side, getFab, getOtherOpen, onOpen, onClose }) {
  let root = null, scroller = null, sheet = null, page = null;
  let observer = null;
  // 开合事实源是 DOM：滑出途中 popover 仍处于打开态，命令层无需另设状态。
  // detach 后（全屏/卸载）视为关闭——命令层可能晚一步到达
  const isShown = () => !!root && root.matches(':popover-open');
  // 开/关对应的 scrollLeft（两侧镜像：左栏开=0，右栏开=max）。scrollTo 会 clamp 到
  // 最大滚动量（=sheet 宽），max 直接给 scrollWidth 即可
  const openPos  = () => (side === 'left' ? 0 : scroller.scrollWidth);
  const closePos = () => (side === 'left' ? scroller.scrollWidth : 0);

  // 模态语义：root 之外的整页（FAB、另一侧面板、中栏）不可交互／不可聚焦。
  // 另一侧可能刚打开，root 可能残留上一轮的 inert，这里一并清掉
  function setPageInert(on) {
    for (const el of page.children) el.inert = on && el !== root;
  }

  // 真正关：只在 sheet 完全离视口（IO 报告）或跨断点强收（instant）时走到
  function finish(restoreFocus) {
    root.hidePopover();
    root.removeAttribute('aria-modal');
    onClose();
    // 另一侧抽屉已接管页面模态：inert 归它维护，焦点也不该抢
    if (getOtherOpen()) return;
    setPageInert(false);
    if (restoreFocus) getFab().focus();
  }

  function onIO(entries) {
    const entry = entries.at(-1);   // 程序滚动可能一批多条，只看最新
    if (entry.intersectionRatio < 1 / window.innerWidth) {
      // 页面加载／非抽屉态也会报完全离开，此时 popover 未开，忽略
      if (isShown()) finish(true);
    } else if (entry.intersectionRatio === 1) {
      // 只有 popover 开着才存在「完全进入」：pinned 态 sheet 是 display:contents，无布局盒。
      // 拖回中途反向时 popover 仍是打开态，经此回写确认命令层的开状态
      if (isShown()) onOpen();
    }
  }

  function open() {
    // popover 已开 = 正处于滑出／滑入途中，只需滚回开启位
    if (isShown()) {
      scroller.scrollTo({ left: openPos(), behavior: 'auto' });
      return;
    }
    root.showPopover();
    root.setAttribute('aria-modal', 'true');   // popover 非模态，模态语义手动补齐
    setPageInert(true);
    // behavior:auto 交给 CSS scroll-behavior（尊重 reduced-motion）
    scroller.scrollTo({ left: openPos(), behavior: 'auto' });
    sheet.querySelector('.collapse-btn-panel').focus({ preventScroll: true });
  }

  function close(instant = false) {
    if (!isShown()) return;
    if (instant) { finish(false); return; }   // 跨断点切换：不做滑出动画，直接转 pinned
    // 只滚回关闭位，不立刻 hidePopover——顶层中途移除就看不见滑出动画；收尾由 IO 触发
    scroller.scrollTo({ left: closePos(), behavior: 'auto' });
  }

  function onScrollerClick(e) {
    if (!sheet.contains(e.target)) close();   // 点 sheet 外（=backdrop 区）只关本侧
  }

  function attach(el) {
    root = el;
    page = el.parentElement;   // 卸载时子树已脱离文档，父节点须在挂载期缓存
    scroller = el.querySelector('.drawer-scroller');
    sheet = el.querySelector('.drawer-sheet');
    observer = new IntersectionObserver(onIO, { root, threshold: [1 / window.innerWidth, 1] });
    observer.observe(sheet);
    scroller.addEventListener('click', onScrollerClick);
  }

  function detach() {
    if (!root) return;   // 卸载时可能从未 attach
    observer.disconnect();
    scroller.removeEventListener('click', onScrollerClick);
    // aria-modal 存在 = 进入全屏时抽屉正开着；元素随卸载消失，无需 hidePopover。
    // 进入全屏/卸载时两侧实例总是一起 detach，无需看另一侧，直接清页面模态
    if (root.hasAttribute('aria-modal')) {
      root.removeAttribute('aria-modal');
      onClose();
      setPageInert(false);
    }
    observer = root = scroller = sheet = page = null;
  }

  return { attach, detach, open, close, isOpen: isShown };
}
