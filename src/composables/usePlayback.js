import { computed } from 'vue';
import { stopSpeech, speak } from '../logic/tts.js';
import { createTwoFingerRecognizer } from '../logic/gestures.js';

// 播放意图层:点句播放/键盘/双指手势/蓝牙线控共用同一套命令。
// 依赖注入:核心状态 refs、effectiveRanges computed、getPlayer(挂载前为 null)、
// scrollActiveIntoView(切句后滚动)、toggleFab/toggleVideoCollapse/toggleFullscreen(快捷键动作)。
export function createPlayback({
  sentences, currentId, currentText, isPlaying, mediaKind,
  voices, ttsOn, ttsLang, ttsRate, ttsVoiceURI,
  effectiveRanges, getPlayer, notify,
  scrollActiveIntoView, toggleFab, toggleFabRight, toggleVideoCollapse, toggleFullscreen,
}) {
  // 当前选中句在列表中的索引（未选为 -1）
  const currentIdx = computed(() => sentences.value.findIndex(s => s.id === currentId.value));

  function stopAll() { getPlayer()?.stop(); stopSpeech(); isPlaying.value = false; }

  // 语音朗读:朗读逻辑在 tts.js,这里只做响应式桥(isPlaying)与提示
  function speakCurrent(text) {
    const r = speak(
      text,
      { lang: ttsLang.value, rate: ttsRate.value, voiceURI: ttsVoiceURI.value, voices: voices.value },
      () => { isPlaying.value = false; },
    );
    if (r === 'unsupported') notify('当前浏览器不支持语音朗读', 'error');
    else if (r === 'ok') isPlaying.value = true;
  }

  // 播放指定句子（点击与键盘共用）：选中 + 区间播放(无媒体时改用语音朗读)
  function playSentence(sentence) {
    currentId.value = sentence.id;
    currentText.value = sentence.text;
    if (mediaKind.value === null) {
      if (ttsOn.value) speakCurrent(sentence.text);
      else notify('请先打开音/视频文件或打开语音朗读功能', 'error');
      return;
    }
    const r = effectiveRanges.value.get(sentence.id) || { effStart: sentence.start, effEnd: sentence.end };
    isPlaying.value = true;
    getPlayer().playSegment(r.effStart, r.effEnd);
  }

  function replayCurrent() {                       // 未选则播第一句
    const i = currentIdx.value;
    if (i >= 0) playSentence(sentences.value[i]);
    else if (sentences.value.length) playSentence(sentences.value[0]);
  }
  function goPrev() {
    const i = currentIdx.value;
    if (i > 0) { playSentence(sentences.value[i - 1]); scrollActiveIntoView(); }
    else if (i === 0) replayCurrent();             // 首句:重播
  }
  function goNext() {
    const i = currentIdx.value, n = sentences.value.length;
    if (i < 0) { playSentence(sentences.value[0]); scrollActiveIntoView(); }  // 未选 → 第一句
    else if (i < n - 1) { playSentence(sentences.value[i + 1]); scrollActiveIntoView(); }
  }

  // 方向键播放控制。焦点在输入框时不拦截，避免影响微调数字输入。
  function onKeydown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    // 面板收展快捷键:不依赖字幕,空载引导页也可用。
    if (e.key === '[') { e.preventDefault(); toggleFab('left'); return; }
    if (e.key === ']') { e.preventDefault(); toggleFabRight(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleVideoCollapse(); return; }
    // 回车:视频全屏切换(需媒体手势授权,键盘事件算 user activation)。全屏后快捷键仍走此全局监听。
    if (e.key === 'Enter' && mediaKind.value === 'video') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (!sentences.value.length) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        goNext(); break;                    // 末句 → 不操作
      case 'ArrowUp':
        e.preventDefault();
        goPrev(); break;                    // 首句 → 重播当前句
      case 'ArrowLeft':
        e.preventDefault();
        if (currentIdx.value >= 0) replayCurrent();   // 重读当前句（不滚动）
        break;
      case 'ArrowRight':
      case ' ':              // 空格 = 播放中暂停、未播放重播（同药丸中间按钮）
      case 'Spacebar':
        e.preventDefault();
        isPlaying.value ? stopAll() : replayCurrent();
        break;
    }
  }

  // 双指手势:上/下滑切句,轻点播放中停止/未播重播(同空格)
  const gesture = createTwoFingerRecognizer({
    onSwipe: dir => (dir > 0 ? goNext() : goPrev()),
    onTap: () => { isPlaying.value ? stopAll() : replayCurrent(); },
  });

  // 键盘/手势/蓝牙线控监听挂载(App 的 onMounted/onUnmounted 调用)。
  // 线控需要媒体会话激活(载入媒体时设 metadata)。
  function attach() {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('touchstart', gesture.onTouch, { passive: false });
    window.addEventListener('touchmove', gesture.onTouch, { passive: false });
    window.addEventListener('touchend', gesture.onTouchEnd, { passive: false });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('previoustrack', goPrev);
      navigator.mediaSession.setActionHandler('nexttrack', goNext);
      navigator.mediaSession.setActionHandler('play', replayCurrent);
      navigator.mediaSession.setActionHandler('pause', stopAll);
    }
  }
  function detach() {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('touchstart', gesture.onTouch);
    window.removeEventListener('touchmove', gesture.onTouch);
    window.removeEventListener('touchend', gesture.onTouchEnd);
  }

  return { playSentence, stopAll, replayCurrent, goPrev, goNext, attach, detach };
}
