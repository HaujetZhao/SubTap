import { ref, reactive, watch } from 'vue';
import { stopSpeech } from './tts.js';
import { loadJson } from './pill-drag.js';

// ponytail: 侧栏参数持久化（分级勾选/高亮/TTS/字幕微调/VAD 后处理），单 key 存 localStorage
const LS_S = 'subtap-settings';

// 设置层:全部持久化字段的 ref + 勾选镜像 + 写回 watch。store 为框架无关词库 store。
export function createSettings(store) {
  const _s = loadJson(LS_S, {});

  // 响应式勾选镜像：从 store 默认值读取（初中/高中/四级=false，其余=true），再用存档覆盖
  const enabled = reactive({});
  for (const lv of store.getLevels()) enabled[lv] = store.isEnabled(lv);
  if (_s.enabled) {
    for (const lv of store.getLevels()) {
      if (lv in _s.enabled) { enabled[lv] = !!_s.enabled[lv]; store.setEnabled(lv, !!_s.enabled[lv]); }
    }
  }

  // 高亮总开关（默认开，只控中栏）
  const highlightOn = ref(_s.highlightOn ?? true);
  // 底部药丸控制条开关(非全屏;全屏播控药丸不受此控)
  const controlBarOn = ref(_s.controlBarOn ?? true);
  // 主题:'light' | 'dark'(以后可加第三种),写 html[data-theme],CSS 按 data-theme 覆盖 token
  const theme = ref(_s.theme ?? 'light');
  watch(theme, v => document.documentElement.dataset.theme = v, { immediate: true });

  // 语音朗读参数(Web Speech API,无媒体时的播放替代)
  const ttsOn = ref(_s.ttsOn ?? false);
  const ttsLang = ref(_s.ttsLang ?? 'en-US');
  const ttsRate = ref(_s.ttsRate ?? 1);
  const ttsVoiceURI = ref(_s.ttsVoiceURI ?? '');   // 空 = 用语言默认声音

  // 字幕微调:endMode 为末尾处理模式(延长/衔接),endOffset 为共用偏移(秒)
  const offset = ref(_s.offset ?? 0);
  const endMode = ref(_s.endMode ?? 'extend');   // 'extend' | 'linkNext'
  const endOffset = ref(_s.endOffset ?? 0);

  // VAD 后处理参数(持久化,秒 → postprocess 的帧数 = 秒/0.01)
  const vadThreshold = ref(_s.vadThreshold ?? 0.6);
  const vadMinSpeech = ref(_s.vadMinSpeech ?? 0.2);
  const vadMinSilence = ref(_s.vadMinSilence ?? 0.1);

  // 持久化字段清单(单一来源):onTweak 分发与存档写回都从这里取
  const cfgRefs = {
    highlightOn, controlBarOn, theme,
    ttsOn, ttsLang, ttsRate, ttsVoiceURI,
    offset, endMode, endOffset,
    vadThreshold, vadMinSpeech, vadMinSilence,
  };
  function onTweak(key, val) { cfgRefs[key].value = val; }
  // 语音朗读开关:关闭时停止正在进行的朗读
  function onToggleTts(val) { ttsOn.value = val; if (!val) stopSpeech(); }
  function onToggleLevel(level, val) { enabled[level] = val; store.setEnabled(level, val); }

  // 写回存档（分级勾选 + cfgRefs 全部字段）
  watch(
    [enabled, ...Object.values(cfgRefs)],
    () => {
      try {
        const data = { enabled: { ...enabled } };
        for (const [k, r] of Object.entries(cfgRefs)) data[k] = r.value;
        localStorage.setItem(LS_S, JSON.stringify(data));
      } catch {}
    },
    { deep: true }
  );

  return { enabled, ...cfgRefs, onTweak, onToggleTts, onToggleLevel };
}
