(function (App) {
  'use strict';

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function renderSentences(container, sentences, onClick) {
    container.innerHTML = '';
    for (var i = 0; i < sentences.length; i++) {
      (function (s) {
        var div = document.createElement('div');
        div.className = 'sentence';
        div.dataset.id = s.id;
        div.innerHTML =
          '<span class="play-icon">▶</span>' +
          '<span class="time">[' + fmtTime(s.start) + ']</span>' +
          '<span class="text"></span>';
        div.querySelector('.text').textContent = s.text.replace(/\n/g, ' ');
        div.addEventListener('click', function () { onClick(s); });
        container.appendChild(div);
      })(sentences[i]);
    }
  }

  function clearSentences(container) {
    container.innerHTML = '<div class="placeholder">选择字幕后，句子列表会显示在这里</div>';
  }

  function highlightSentence(container, id) {
    var all = container.querySelectorAll('.sentence');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('active', String(all[i].dataset.id) === String(id));
    }
  }

  function markPlaying(container, id, playing) {
    var el = container.querySelector('.sentence[data-id="' + id + '"]');
    if (!el) return;
    el.classList.toggle('playing', playing);
    el.querySelector('.play-icon').textContent = playing ? '⏸' : '▶';
  }

  function renderWordPanel(panelEl, words) {
    if (!words || words.length === 0) {
      panelEl.className = 'placeholder';
      panelEl.textContent = '当前句没有词库中的单词';
      return;
    }
    panelEl.className = '';
    panelEl.innerHTML = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var div = document.createElement('div');
      div.className = 'word';
      div.innerHTML =
        '<div class="head"><span class="w"></span><span class="level"></span></div>' +
        '<div class="def"></div>';
      div.querySelector('.w').textContent = w.word;
      div.querySelector('.level').textContent = w.level;
      div.querySelector('.def').textContent = w.def;
      panelEl.appendChild(div);
    }
  }

  function setStatus(text, isError) {
    var el = document.getElementById('status');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  App.fmtTime = fmtTime;
  App.renderSentences = renderSentences;
  App.clearSentences = clearSentences;
  App.highlightSentence = highlightSentence;
  App.markPlaying = markPlaying;
  App.renderWordPanel = renderWordPanel;
  App.setStatus = setStatus;
})(window.App);
