// 双指手势识别(纯几何,框架无关,阈值常量住这)。
// 上滑→onSwipe(+1) 下一句,下滑→onSwipe(-1) 上一句,轻点→onTap(同空格:暂停/重播)。
// 捏合(两指反向/间距变化大)不算任何手势,并用来排除点击误判。
export function createTwoFingerRecognizer({ onSwipe, onTap }) {
  let twoFinger = null;

  // 绑 window 的 touchstart/touchmove(passive:false,preventDefault 禁原生双指缩放)
  function onTouch(e) {
    if (e.touches.length === 2) {
      const pts = [...e.touches].map(t => [t.clientX, t.clientY]);
      if (!twoFinger) twoFinger = { t: performance.now(), start: pts, last: pts };
      else twoFinger.last = pts;
      e.preventDefault();
    } else if (twoFinger && e.touches.length > 2) {
      // 有第三根手指加入,放弃本次手势
      twoFinger = null;
    }
  }
  function onTouchEnd() {
    if (!twoFinger) return;
    const { t, start, last } = twoFinger;
    twoFinger = null;
    const dt = performance.now() - t;
    const [v1, v2] = start.map((p, i) => [last[i][0] - p[0], last[i][1] - p[1]]);
    const spread0 = Math.hypot(start[1][0] - start[0][0], start[1][1] - start[0][1]);
    const spread1 = Math.hypot(last[1][0] - last[0][0], last[1][1] - last[0][1]);
    const pinch = Math.abs(spread1 - spread0);
    const move = Math.hypot(v1[0] + v2[0], v1[1] + v2[1]) / 2; // 两指平均位移
    const sameDir = v1[0] * v2[0] + v1[1] * v2[1] > 0;         // 两指方向一致(滑动),相反(捏合)
    if (move >= 30 && sameDir && Math.abs(v1[1] + v2[1]) > Math.abs(v1[0] + v2[0])) {
      onSwipe(v1[1] + v2[1] < 0 ? +1 : -1);
    }
    else if (move < 30 && pinch < 50 && dt < 400) onTap();
  }

  return { onTouch, onTouchEnd };
}

// 单指滑动识别(视频区):上/下滑切句,左滑开右栏,右滑开左栏。
// 位移 ≥60px 且主轴位移 > 副轴 *1.5 才算,否则不算(保留单击切控件层等行为)。
// onSwipe(dir) dir∈'up'|'down'|'left'|'right';up 返回是否识别为滑动(调用方据此吞掉紧随的 click)。
// ignore: 选择器,命中的元素(药丸/生词栏等自带拖拽语义)不作为滑动起点,由调用方告知。
export function createSwipeRecognizer(onSwipe, ignore) {
  let start = null;
  return {
    down(e) {
      start = ignore && e.target.closest(ignore) ? null : { x: e.clientX, y: e.clientY };
    },
    // 返回是否识别为滑动(调用方据此吞掉紧随的 click)
    up(e) {
      if (!start) return false;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onSwipe(dx < 0 ? 'left' : 'right');
        return true;
      }
      if (Math.abs(dy) >= 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        onSwipe(dy < 0 ? 'up' : 'down');
        return true;
      }
      return false;
    },
  };
}
