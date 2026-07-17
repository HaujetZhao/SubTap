// 词库管理：内置词库 + 分级勾选状态 + 按级查询
// 依赖注入 buildVocab/classifyWords，便于测试

export function createVocabStore(buildVocab, classifyWords) {
  const state = {
    ready: false,
    levels: [],     // 分级名（库级 + '超纲'）
    vocab: null,    // buildVocab 产物（大表）
    enabled: {}     // {level: bool}
  };
  // 默认不勾选的基础级别
  const DEFAULT_OFF = new Set(['初中', '高中', '四级']);

  function init(vocabObj) {
    state.vocab = buildVocab(vocabObj || {});
    state.levels = Object.keys(vocabObj || {}).concat(['超纲']);
    state.enabled = {};
    for (const level of state.levels) {
      state.enabled[level] = !DEFAULT_OFF.has(level);
    }
    state.ready = true;
  }

  function isReady() { return state.ready; }
  function getLevels() { return state.levels.slice(); }
  function getVocab() { return state.vocab; }
  function isEnabled(level) { return !!state.enabled[level]; }
  function setEnabled(level, bool) {
    state.enabled[level] = !!bool;
    return state.enabled[level];
  }

  // 句子 → {level: Word[]}（按 levels 顺序，只含已勾选且有命中的级；含超纲组）
  function lookupByLevel(text) {
    const all = classifyWords(text, state.vocab);
    const result = {};
    for (const level of state.levels) {
      if (!state.enabled[level]) continue;
      if (all[level] && all[level].length) result[level] = all[level];
    }
    return result;
  }

  return { init, isReady, getLevels, getVocab, isEnabled, setEnabled, lookupByLevel };
}
