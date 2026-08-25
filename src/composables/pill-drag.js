// 可拖药丸共用机制(全屏播控药丸/底部控制条):纯逻辑,无 Vue 依赖。
// 位移 <5px 视为点按钮;拖动中把"期望中心点"交给调用方的 clamp 写入自己的 pos;抬起时持久化并吞掉紧随的 click。
// getEl 在 down 时调用一次,调用方可在此缓存拖动期间不变的 rect(热路径零 DOM 读取)。
export function createPillSystem() {
  let suppressClick = false;

  function makePillDrag({ getEl, clamp, persist }) {
    let d = null;
    function down(e) {
      suppressClick = false;  // 上一轮拖动若无 click 派发,标志会残留,新按下时清掉
      const pl = getEl().getBoundingClientRect();
      d = {
        sx: e.clientX, sy: e.clientY,
        grabDX: e.clientX - (pl.left + pl.width / 2),
        grabDY: e.clientY - (pl.top + pl.height / 2),
        halfX: pl.width / 2, halfY: pl.height / 2,   // 拖动中尺寸不变,down 时量一次
        moved: false,
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    }
    function move(e) {
      if (!d) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
        d.moved = true;
      }
      clamp(e.clientX - d.grabDX, e.clientY - d.grabDY, d.halfX, d.halfY);
    }
    function up() {
      if (d?.moved) {
        persist();
        suppressClick = true;   // 拖完后吞掉紧随的 click,避免误触按钮
        // 若 click 落在无处理器的药丸背景上,guard 不会执行,标志残留会误吞下一次点按钮;
        // 故本轮 click 派发结束后(bubble 到 window)自行清除。
        window.addEventListener('click', () => { suppressClick = false; }, { once: true });
      }
      d = null;
      window.removeEventListener('pointermove', move);
    }
    return { down, cancel: () => window.removeEventListener('pointermove', move) };
  }

  // 拖完的 click 吞掉;正常点击 blur 焦点(空格时按钮不显焦点环)后执行
  function guard(fn, e) {
    if (suppressClick) { suppressClick = false; return; }
    e?.currentTarget.blur();
    fn();
  }
  return { makePillDrag, guard };
}

// localStorage JSON 读取统一入口(解析失败/为空返回 fallback)
export function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
// 药丸位置(0..1 比例坐标)读取:越界/缺字段作废用默认值
export function loadPos(key, def) {
  const p = loadJson(key, null);
  return (p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) ? p : def;
}
