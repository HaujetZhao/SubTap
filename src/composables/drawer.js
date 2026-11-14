// 侧栏抽屉机制(navigation-drawer「drawer 兼 sidebar」变体,纯逻辑无 Vue 依赖)。
// 面板根元素带 popover="manual",打开时成为铺满视口的顶层滑动面:
//   · 横向 scroll-snap 双停靠点(左栏:开=0/关=max;右栏镜像:开=max/关=0),拖拽的动量、速度、中断全由浏览器原生处理;
//   · backdrop 透明度由滚动位置驱动(scroll-driven animation,不支持时 JS 兜底);
//   · 开合判定唯一事实源是 IntersectionObserver(sheet 完全进入=开、完全离开=关),
//     关闭只滚回关闭位、不动 popover,滑出动画播完才真正 hidePopover。
// 状态机:closed → opening → open → closing → closed。每侧一个实例,
// 元素经 attach/detach 接线(面板进全屏时非全屏实例卸载,detach 重置状态)。
export function createDrawer({ side, getMain, getFab, onClose }) {
  let root = null, scroller = null, sheet = null, main = null;
  let state = 'closed';
  let observer = null;
  // 极小阈值:面板真完全消失才算关(IO 比率按像素量化,略高于单像素步长)
  const visibleThreshold = () => 1 / window.innerWidth;
  // 开/关对应的 scrollLeft(两侧镜像:左栏开=0,右栏开=max)。scrollTo 会 clamp 到最大
  // 滚动量(=sheet 宽),max 直接给 scrollWidth 即可
  const openPos  = () => (side === 'left' ? 0 : scroller.scrollWidth);
  const closePos = () => (side === 'left' ? scroller.scrollWidth : 0);

  // 真正关:只在 sheet 完全离视口(IO 报告)或跨断点强收(instant)时走到
  function teardown(restoreFocus) {
    state = 'closed';
    // hidePopover 后根元素落回基类样式(transform ±100%/opacity 0),而基类带过渡,
    // 会再播一遍滑出动画(第二遍闪现)。先瞬时禁用过渡,待本帧样式落地后再恢复
    // (setTimeout 0 在样式重算之后执行;rAF 在重算之前,恢复会赶上同一帧又触发过渡)
    const el = root;
    el.style.transition = 'none';
    el.hidePopover();
    el.removeAttribute('aria-modal');
    main.inert = false;
    const fab = getFab();
    fab.setAttribute('aria-expanded', 'false');
    if (restoreFocus) fab.focus();
    onClose();
    setTimeout(() => { el.style.transition = ''; }, 0);
  }

  function onIO(entries) {
    const entry = entries.at(-1);   // 程序滚动可能一批多条,只看最新
    if (entry.intersectionRatio < visibleThreshold()) {
      // 页面加载/重连时 observer 也会报 closed(此时非抽屉态),忽略
      if (!root.hasAttribute('aria-modal')) return;
      teardown(true);
    } else if (entry.intersectionRatio === 1 && (state === 'opening' || state === 'closing')) {
      // 开启确认/滑出途中被拖回:命令路径早已写过 UI 状态,这里只推进状态机
      state = 'open';
    }
  }

  async function open() {
    if (state === 'open' || state === 'opening') return;
    if (state === 'closing') {   // 滑出途中反向:popover 还开着,滚回开启位即可
      state = 'opening';
      scroller.scrollTo({ left: openPos(), behavior: 'auto' });
      return;
    }
    state = 'opening';
    root.showPopover();
    root.setAttribute('aria-modal', 'true');   // popover 非模态,模态语义手动补齐
    main.inert = true;
    getFab().setAttribute('aria-expanded', 'true');
    // 无 scroll-initial-target 支持(Firefox/Safari):先瞬跳关闭位再等双帧,让平滑滚动有起点
    if (!CSS.supports('scroll-initial-target', 'nearest')) {
      scroller.scrollTo({ left: closePos(), behavior: 'instant' });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (state !== 'opening') return;   // 等待窗口内已被 close,别再把滚动拉回开启位
    }
    // 无滚动驱动动画时的首帧兜底:此刻在关闭位,取 0(透明),首个 scroll 事件起由 onScroll 接管
    // (有动画时被 keyframes 覆盖,不生效)
    root.style.setProperty('--drawer-backdrop', '0');
    scroller.scrollTo({ left: openPos(), behavior: 'auto' });   // behavior:auto 交给 CSS scroll-behavior(尊重 reduced-motion)
    sheet.querySelector('.collapse-btn-panel')?.focus({ preventScroll: true });
  }

  function close(instant = false) {
    if (state === 'closed') return;
    if (instant) { teardown(false); return; }   // 跨断点切换:不做滑出动画,直接转 pinned
    if (state !== 'open' && state !== 'opening') return;
    state = 'closing';
    // 只滚回关闭位,不立刻 hidePopover——顶层中途移除就看不见滑出动画;IO 关
    scroller.scrollTo({ left: closePos(), behavior: 'auto' });
  }

  function onScrollerClick(e) {
    if (!sheet.contains(e.target)) close();   // 点 sheet 外(=backdrop 区)只关本侧
  }

  function onEsc(e) {
    if (e.key !== 'Escape' || state === 'closed' || state === 'closing') return;
    if (document.querySelector('dialog[open]')) return;   // MKV 轨道弹窗开着时,Esc 让给原生 dialog
    close();
  }

  // fallback:不支持 scroll-driven animation 时按滚动位置手算 backdrop 透明度。
  // p=0 在开位、1 在关位(两侧同构,分母都是 sheet 宽);右栏时间线反向,backdrop 取 p
  function onScroll() {
    const p = scroller.scrollLeft / sheet.offsetWidth;
    root.style.setProperty('--drawer-backdrop', String(side === 'left' ? 1 - p : p));
  }

  function attach(el) {
    root = el;
    scroller = el.querySelector('.drawer-scroller');
    sheet = el.querySelector('.drawer-sheet');
    main = getMain();
    state = 'closed';
    observer = new IntersectionObserver(onIO, { root, threshold: [visibleThreshold(), 1] });
    observer.observe(sheet);
    scroller.addEventListener('click', onScrollerClick);
    document.addEventListener('keydown', onEsc);
    if (!CSS.supports('animation-timeline', 'scroll()')) scroller.addEventListener('scroll', onScroll);
  }

  function detach() {
    observer?.disconnect();
    // 进全屏时面板实例整体卸载(popover 随文档移除自动隐藏),无需 hidePopover,重置状态与模态语义
    if (state !== 'closed') {
      state = 'closed';
      main.inert = false;
      getFab().setAttribute('aria-expanded', 'false');
      onClose();
    }
    scroller?.removeEventListener('click', onScrollerClick);
    scroller?.removeEventListener('scroll', onScroll);
    document.removeEventListener('keydown', onEsc);
    observer = null;
    root = scroller = sheet = main = null;
  }

  return {
    attach, detach, open, close,
    get isOpen() { return state === 'opening' || state === 'open'; },
  };
}
