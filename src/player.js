// 媒体播放器（驱动 <audio> 或 <video>）：区间播放 + 到点自动停
// 用 requestAnimationFrame 轮询 currentTime，停播精度到一帧（~16ms），
// 比 timeupdate（~250ms）精准得多，避免区间尾部多播下一句开头。

export class Player {
  constructor(mediaEl) {
    this.media = mediaEl;
    this._endHandler = null;   // { end } 或 null
    this._stopCb = null;
    this._pauseBound = false;
    this._rafId = null;
  }

  setSrc(url) {
    this.media.src = url;
  }

  onStop(cb) {
    this._stopCb = cb;
    if (!this._pauseBound) {
      this.media.addEventListener('pause', () => {
        this._clearRaf();
        if (this._stopCb) this._stopCb();
      });
      this._pauseBound = true;
    }
  }

  playSegment(start, end) {
    this._endHandler = { end };
    const go = () => {
      this.media.currentTime = start;
      this.media.play().catch(() => {}); // 忽略自动播放策略报错
      this._startRafLoop(end);
    };
    if (this.media.readyState >= 1) {
      go();
    } else {
      const onReady = () => {
        this.media.removeEventListener('loadedmetadata', onReady);
        go();
      };
      this.media.addEventListener('loadedmetadata', onReady);
    }
  }

  // 每帧检查是否到达 end；一旦到达立即 pause（触发 pause 事件 → onStop）
  _startRafLoop(end) {
    this._clearRaf();
    const check = () => {
      if (!this._endHandler) return; // 已 stop
      if (this.media.currentTime >= end) {
        this.media.pause();
        return;
      }
      this._rafId = requestAnimationFrame(check);
    };
    this._rafId = requestAnimationFrame(check);
  }

  _clearRaf() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  stop() {
    this._endHandler = null;
    this._clearRaf();
    this.media.pause();
  }
}
