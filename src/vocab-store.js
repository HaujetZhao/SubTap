(function (App) {
  'use strict';

  var state = {
    ready: false,
    levels: [],      // 分级名，按词库顺序
    vocab: null,     // buildVocab 产物（大表 {word:{level,def}}）
    enabled: {}      // {level: bool}
  };

  function init(vocabObj) {
    state.vocab = App.buildVocab(vocabObj || {});
    // 分级顺序取自词库 key 顺序
    state.levels = Object.keys(vocabObj || {});
    state.enabled = {};
    for (var i = 0; i < state.levels.length; i++) {
      state.enabled[state.levels[i]] = true; // 默认全选
    }
    state.ready = true;
  }

  function isReady() { return state.ready; }
  function getLevels() { return state.levels.slice(); }
  function isEnabled(level) { return !!state.enabled[level]; }

  function setEnabled(level, bool) {
    state.enabled[level] = !!bool;
    return state.enabled[level];
  }

  // 句子 → {level: Word[]}（只含已勾选且有命中的级；每级内按句中首次出现顺序）
  function lookupByLevel(text) {
    var flat = App.lookupWords(text, state.vocab); // 扁平 Word[]，已按句中顺序、去重
    var groups = {};
    for (var i = 0; i < flat.length; i++) {
      var w = flat[i];
      if (!state.enabled[w.level]) continue;
      if (!groups[w.level]) groups[w.level] = [];
      groups[w.level].push(w);
    }
    return groups;
  }

  App.VocabStore = {
    init: init,
    isReady: isReady,
    getLevels: getLevels,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    lookupByLevel: lookupByLevel
  };
})(window.App);
