// 媒体播放器（驱动 <audio> 或 <video>）：区间播放 + 到点自动停

export class Player {
  constructor(mediaEl) {
    this.media = mediaEl;
    this._endHandler = null;
    this._stopCb = null;
    this._pauseBound = false;

    this.media.addEventListener('timeupdate', () => {
      if (this._endHandler && this.media.currentTime >= this._endHandler.end) {
        this.media.pause();
      }
    });
  }

  setSrc(url) {
    this.media.src = url;
  }

  onStop(cb) {
    this._stopCb = cb;
    if (!this._pauseBound) {
      this.media.addEventListener('pause', () => {
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

  stop() {
    this._endHandler = null;
    this.media.pause();
  }
}
