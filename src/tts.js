// 浏览器语音朗读(Web Speech API),框架无关封装,对照 player.js。
// 朗读参数(lang/rate/voiceURI/voices)由调用方在 speak 时传入,本模块不持状态。
export const ttsSupported = 'speechSynthesis' in window;

export function stopSpeech() {
  if (ttsSupported) window.speechSynthesis.cancel();
}

// 取声音列表。Chrome 的 getVoices() 中途可能返回空数组,空结果返回 null 表示"别覆盖已加载的"。
export function loadVoices() {
  if (!ttsSupported) return null;
  const list = window.speechSynthesis.getVoices();
  return list.length ? list : null;
}

// 朗读一句话(双语字幕取首行英文)。返回 'ok' | 'unsupported'(空文本返回 undefined);
// 结束/出错经 onDone 回调(调用方用来清 isPlaying)。
export function speak(text, { lang, rate, voiceURI, voices = [] }, onDone) {
  if (!ttsSupported) return 'unsupported';
  stopSpeech();
  const english = text.split('\n')[0].trim();   // 双语字幕取首行英文
  if (!english) return;
  const u = new SpeechSynthesisUtterance(english);
  u.lang = lang;
  u.rate = rate;
  if (voiceURI) {
    const vc = voices.find(v => v.voiceURI === voiceURI);
    if (vc) u.voice = vc;
  }
  u.onend = onDone;
  u.onerror = onDone;
  window.speechSynthesis.speak(u);
  return 'ok';
}
