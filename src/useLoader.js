import { ref } from 'vue';
import { parseSRT } from './srt-parser.js';
import { saveFile, loadFiles, getCachedProbs } from './file-history.js';
import { toSentences } from './useVad.js';
import sampleSrt from './assets/sample/sample.srt?raw';
import sampleAudio from './assets/sample/sample.aac';

// 文件载入层:外部字幕/音视频载入、清除、内置示例、恢复上次。
// 依赖注入:核心状态 refs、stopAll(playback)、getPlayer、vad(reset/setProbs)、
// setMediaBlob(App 侧持有原始 Blob 供 VAD 解码)、expandVideo(载入视频时展开)、
// selectSentenceById(恢复上次进度时选中并滚动)、notify。
export function createLoader({
  sentences, currentId, currentText, isPlaying, mediaKind, srtFromFile,
  stopAll, getPlayer, vad, setMediaBlob, expandVideo, notify, selectSentenceById,
}) {
  let mediaBlob = null;   // 本模块写入,经 setMediaBlob 同步给 App(VAD 解码用);本地留一份供缓存命中比对
  const getMediaBlob = () => mediaBlob;

  // 应用字幕文本(不含提示,由调用方决定文案)。文件按钮与示例按钮共用。
  function applySubtitle(text) {
    srtFromFile.value = true;
    sentences.value = parseSRT(text);
    stopAll();
    currentId.value = null;
    currentText.value = '';
  }

  // 应用媒体源 URL + 显示名 + 类型。文件按钮与示例按钮共用。
  function applyMediaSrc(url, name, kind) {
    stopAll();
    getPlayer().setSrc(url);
    mediaKind.value = kind;
    // 设媒体元数据激活 media session,蓝牙线控才会派发按钮事件
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: name });
    if (kind === 'video') expandVideo();
  }

  function onSrtFile(file, save = true, selectId = null) {
    if (!file) return;
    if (save) saveFile('srt', file);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applySubtitle(reader.result);
        // 恢复上次:选中并滚到上次的句子
        if (selectId !== null) selectSentenceById(selectId);
        if (save) notify('已载入 ' + sentences.value.length + ' 句字幕');
      } catch (e) {
        notify('字幕解析失败：' + e.message, 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function onMediaFile(file, save = true) {
    if (!file) return;
    if (save) saveFile('media', file);
    mediaBlob = file;
    setMediaBlob(file);
    vad.reset();   // 换媒体,旧概率作废
    const isVideo = (file.type || '').startsWith('video/');
    applyMediaSrc(URL.createObjectURL(file), file.name, isVideo ? 'video' : 'audio');
    if (save) notify('已载入：' + file.name);
    // 命中缓存则免推理:直接注入留存概率,改参重切/重新分段都可用
    getCachedProbs(file).then(c => {
      if (c && mediaBlob === file) {
        vad.setProbs(c.probs, c.dur);
        if (save) notify('已复用该媒体的 VAD 结果(免推理)');
      }
    }).catch(() => {});
  }

  // 清除字幕/媒体(侧栏文件按钮旁的 ×):复用载入路径,再补各自的清理
  function clearSrt() {
    applySubtitle('');
    srtFromFile.value = false;
  }
  function clearMedia() {
    applyMediaSrc('', '', null);
    mediaBlob = null;
    setMediaBlob(null);
    vad.reset();   // 概率随媒体失效
  }

  // 一键载入内置示例(空载引导页按钮触发):字幕 + 音频,单条成功提示。
  function loadSample() {
    try {
      applySubtitle(sampleSrt);
    } catch (e) {
      notify('示例字幕解析失败：' + e.message, 'error');
      return;
    }
    applyMediaSrc(sampleAudio, '示例音频', 'audio');
    fetch(sampleAudio).then(r => r.blob()).then(b => { mediaBlob = b; setMediaBlob(b); });
    notify('已载入示例');
  }

  // 打开上次(空载引导页按钮触发):从 IndexedDB 取缓存的文件,直接走载入路径。
  const canRestore = ref(false);
  loadFiles().then(r => { canRestore.value = !!(r && (r.srt || r.media)); });
  async function restoreLast() {
    const rec = await loadFiles();
    if (!rec || (!rec.srt && !rec.vadSegs && !rec.media)) { canRestore.value = false; notify('没有可恢复的文件', 'error'); return; }
    // VAD 生成的字幕:直接重建分段(不走解析),srtFromFile 保持 false,VAD 面板仍可用
    if (rec.srtSource === 'vad' && rec.vadSegs) {
      sentences.value = toSentences(rec.vadSegs);
      selectSentenceById(rec.sentenceId);
    } else if (rec.srt) {
      onSrtFile(rec.srt, false, rec.sentenceId ?? null);
    }
    if (rec.media) onMediaFile(rec.media, false);
  }

  return { canRestore, onSrtFile, onMediaFile, clearSrt, clearMedia, loadSample, restoreLast };
}
