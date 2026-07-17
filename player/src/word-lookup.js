(function (App) {
  'use strict';

  // 词库（两级 {level: {word: def}}）→ 合并大表 {word: {level, def}}
  function buildVocab(vocabObj) {
    var table = {};
    var levels = Object.keys(vocabObj || {});
    for (var i = 0; i < levels.length; i++) {
      var level = levels[i];
      var dict = vocabObj[level] || {};
      var words = Object.keys(dict);
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        // 已存在则保留首个出现的分级（通常更基础），可按需改
        if (!table[w]) {
          table[w] = { level: level, def: dict[w] };
        }
      }
    }
    return table;
  }

  // 句子文本 + 大表 → Word[]（按出现顺序、去重、只返回命中的）
  function lookupWords(text, vocab) {
    var lower = (text || '').toLowerCase();
    // 拆词：非字母（撇号除外）都当分隔符
    var tokens = lower.split(/[^a-z']+/).filter(Boolean);
    var seen = {};
    var result = [];
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (seen[tok]) continue;
      var entry = vocab[tok];
      if (entry) {
        seen[tok] = true;
        result.push({ word: tok, level: entry.level, def: entry.def });
      }
    }
    return result;
  }

  App.buildVocab = buildVocab;
  App.lookupWords = lookupWords;
})(window.App);
