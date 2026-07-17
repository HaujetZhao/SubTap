(function (App) {
  'use strict';

  function Player(audioEl) {
    this.audio = audioEl;
    this._endHandler = null;
    this._stopCb = null;
    var self = this;

    // 复用：到 end 自动停
    this.audio.addEventListener('timeupdate', function () {
      if (self._endHandler && self.audio.currentTime >= self._endHandler.end) {
        self.audio.pause();
      }
    });
  }

  Player.prototype.setSrc = function (url) {
    this.audio.src = url;
  };

  Player.prototype.onStop = function (cb) {
    this._stopCb = cb;
    var self = this;
    // 只绑一次 pause 转发
    if (!this._pauseBound) {
      this.audio.addEventListener('pause', function () {
        if (self._stopCb) self._stopCb();
      });
      this._pauseBound = true;
    }
  };

  Player.prototype.playSegment = function (start, end) {
    var self = this;
    this._endHandler = { end: end };

    var go = function () {
      self.audio.currentTime = start;
      self.audio.play().catch(function () {}); // 忽略自动播放策略报错
    };

    // 首次需等 metadata 才能 seek
    if (this.audio.readyState >= 1) {
      go();
    } else {
      this.audio.addEventListener('loadedmetadata', function onReady() {
        self.audio.removeEventListener('loadedmetadata', onReady);
        go();
      });
    }
  };

  Player.prototype.stop = function () {
    this._endHandler = null;
    this.audio.pause();
  };

  App.Player = Player;
})(window.App);
