// 媒体播放器（驱动 <audio> 或 <video>）：区间播放 + 到点自动停
// 前台用 requestAnimationFrame 轮询 currentTime，停播精度到一帧（~16ms），
// 比 timeupdate（~250ms）精准得多，避免区间尾部多播下一句开头。
// 后台标签 rAF 会被浏览器暂停，故再用 timeupdate 兜底（媒体自身时钟，后台照常触发）。

export class Player {
  constructor(mediaEl) {
    this.media = mediaEl;
    this._endHandler = null;   // { end } 或 null
    this._stopCb = null;
    this._pauseBound = false;
    this._rafId = null;
    this._onTimeUpdate = null; // timeupdate 兜底监听器
  }

  setSrc(url) {
    this.media.src = url;
  }

  onStop(cb) {
    this._stopCb = cb;
    if (!this._pauseBound) {
      this.media.addEventListener('pause', () => {
        this._clearRaf();
        this._unbindEndCheck();
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
      this._bindEndCheck(end);           // 后台兜底
      this._startRafLoop(end);           // 前台精准
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

  // 前台：每帧检查是否到达 end；一旦到达立即 pause（触发 pause 事件 → onStop）
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

  // 后台兜底：timeupdate 由媒体时钟驱动，rAF 被暂停时仍能到点停（~250ms 粒度）
  _bindEndCheck(end) {
    this._unbindEndCheck();
    this._onTimeUpdate = () => {
      if (this._endHandler && this.media.currentTime >= end) {
        this.media.pause();
      }
    };
    this.media.addEventListener('timeupdate', this._onTimeUpdate);
  }
  _unbindEndCheck() {
    if (this._onTimeUpdate) {
      this.media.removeEventListener('timeupdate', this._onTimeUpdate);
      this._onTimeUpdate = null;
    }
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
    this._unbindEndCheck();
    this.media.pause();
  }
}
