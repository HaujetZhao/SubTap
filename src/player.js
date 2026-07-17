// 音频播放器：区间播放 + 到点自动停

export class Player {
  constructor(audioEl) {
    this.audio = audioEl;
    this._endHandler = null;
    this._stopCb = null;
    this._pauseBound = false;

    this.audio.addEventListener('timeupdate', () => {
      if (this._endHandler && this.audio.currentTime >= this._endHandler.end) {
        this.audio.pause();
      }
    });
  }

  setSrc(url) {
    this.audio.src = url;
  }

  onStop(cb) {
    this._stopCb = cb;
    if (!this._pauseBound) {
      this.audio.addEventListener('pause', () => {
        if (this._stopCb) this._stopCb();
      });
      this._pauseBound = true;
    }
  }

  playSegment(start, end) {
    this._endHandler = { end };
    const go = () => {
      this.audio.currentTime = start;
      this.audio.play().catch(() => {}); // 忽略自动播放策略报错
    };
    if (this.audio.readyState >= 1) {
      go();
    } else {
      const onReady = () => {
        this.audio.removeEventListener('loadedmetadata', onReady);
        go();
      };
      this.audio.addEventListener('loadedmetadata', onReady);
    }
  }

  stop() {
    this._endHandler = null;
    this.audio.pause();
  }
}
