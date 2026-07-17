// 词库管理：内置词库 + 分级勾选状态 + 按级查询
// 依赖注入 buildVocab/lookupWords，便于测试

export function createVocabStore(buildVocab, lookupWords) {
  const state = {
    ready: false,
    levels: [],     // 分级名，按词库顺序
    vocab: null,    // buildVocab 产物（大表）
    enabled: {}     // {level: bool}
  };

  function init(vocabObj) {
    state.vocab = buildVocab(vocabObj || {});
    state.levels = Object.keys(vocabObj || {});
    state.enabled = {};
    for (const level of state.levels) state.enabled[level] = true; // 默认全选
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
    const flat = lookupWords(text, state.vocab);
    const groups = {};
    for (const w of flat) {
      if (!state.enabled[w.level]) continue;
      if (!groups[w.level]) groups[w.level] = [];
      groups[w.level].push(w);
    }
    return groups;
  }

  return { init, isReady, getLevels, isEnabled, setEnabled, lookupByLevel };
}
