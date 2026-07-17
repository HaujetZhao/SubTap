(function (App) {
  'use strict';

  var state = {
    sentences: [],
    vocab: null,        // 合并后的大表
    currentId: null,
    player: null
  };

  // --- 文件载入 ---
  document.getElementById('srt-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        state.sentences = App.parseSRT(reader.result);
        App.renderSentences(document.getElementById('sentences'), state.sentences, onSentenceClick);
        App.setStatus('已载入 ' + state.sentences.length + ' 句字幕');
      } catch (err) {
        App.setStatus('字幕解析失败：' + err.message, true);
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  document.getElementById('audio-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var url = URL.createObjectURL(file);
    state.player.setSrc(url);
    state.audioName = file.name;
    App.setStatus('已载入音频：' + file.name);
  });

  document.getElementById('vocab-input').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        state.vocab = App.buildVocab(obj);
        App.setStatus('已载入词库：' + Object.keys(obj).length + ' 个分级');
      } catch (err) {
        App.setStatus('词库解析失败：' + err.message, true);
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  // --- 点句子 ---
  function onSentenceClick(sentence) {
    state.currentId = sentence.id;

    // 高亮
    var container = document.getElementById('sentences');
    App.highlightSentence(container, sentence.id);

    // 刷右栏
    var panel = document.getElementById('word-panel');
    if (state.vocab) {
      App.renderWordPanel(panel, App.lookupWords(sentence.text, state.vocab));
    } else {
      panel.className = 'placeholder';
      panel.textContent = '请先上传词库 .json';
    }

    // 播放
    if (!state.audioName) {
      App.setStatus('请先选择音频文件', true);
      return;
    }
    App.markPlaying(container, sentence.id, true);
    state.player.playSegment(sentence.start, sentence.end);
  }

  // --- 初始化播放器 ---
  state.player = new App.Player(document.getElementById('audio'));
  state.player.onStop(function () {
    if (state.currentId != null) {
      App.markPlaying(document.getElementById('sentences'), state.currentId, false);
    }
  });
})(window.App);
