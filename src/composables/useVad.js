import { ref } from 'vue';
import { saveVadSegs, putCachedProbs } from '../logic/file-history.js';
import { FireRedVadStream, createSession, decodeAudio16k, postprocess, FRAME_SHIFT_S, prefetchVadAssets } from '../logic/vad.js';

// VAD 分段转句子(空文本);base 为起始编号(恢复上次/批量追加共用)
export const toSentences = (segs, base = 0) => segs.map(([s, e], i) => ({ id: base + i + 1, start: s, end: e, text: '' }));

// VAD 分段生成的全部状态与流程。依赖注入:
//   sentences/currentId:字幕列表(分段结果直接写入)
//   getMediaBlob:当前媒体的原始 File/Blob(推理解码用)
//   cfg:{ threshold, minSpeech, minSilence } 三个 ref(后处理参数)
//   notify:toast
export function createVad({ sentences, currentId, getMediaBlob, cfg, notify }) {
  const vadGen = ref(null);    // { doneSec, dur } 生成进度(null = 未在生成)
  // 推理结果留存:帧概率 + 时长。改后处理参数时直接重切,不用重新推理。
  const vadProbs = ref(null);  // { probs: number[], dur }
  // 解码后的 16k PCM 只在一次生成期间存在(2h 约 460MB,跑完即释放;重新推理重新解码 ~8s,换内存常驻)
  let vadWav = null;

  const vadCfg = () => ({
    threshold: cfg.threshold.value,
    minSpeech: Math.round(cfg.minSpeech.value / FRAME_SHIFT_S),
    minSilence: Math.round(cfg.minSilence.value / FRAME_SHIFT_S),
  });

  // 一次 push 整批:逐条 push 会每条触发一次全表 computed 重算
  function appendVadSegments(segs) {
    sentences.value.push(...toSentences(segs, sentences.value.length));
  }
  const segsSnapshot = () => sentences.value.map(({ start, end }) => [start, end]);

  // 用 VAD 把音频切成空白字幕分段:先一次性解码成 16k 单声道,
  // 再 30s 一片投喂流式推理,确定的分段即时追加进字幕列表;帧概率留存供改参重切。
  async function generateVadSrt() {
    const mediaBlob = getMediaBlob();
    if (!mediaBlob || vadGen.value) return;
    vadGen.value = { doneSec: 0, dur: 0, ready: false, dlDone: 0, dlTotal: 0 };
    // 点击即预取 wasm+onnx(带下载进度),与音频解码并行;createSession 命中 HTTP 缓存
    prefetchVadAssets(p => {
      if (!vadGen.value) return;
      vadGen.value.dlDone = p.done; vadGen.value.dlTotal = p.total;
    }).then(() => { if (vadGen.value) vadGen.value.dlReady = true; }).catch(() => {});
    sentences.value = [];
    currentId.value = null;
    let session = null;
    try {
      // 解码结果留存,重新推理不重复解码
      if (!vadWav) vadWav = await decodeAudio16k(mediaBlob);
      const wav = vadWav;
      vadGen.value.dur = wav.length / 16000;
      session = await createSession();
      vadGen.value.ready = true;   // session 就绪前可能在下载 wasm/onnx,UI 提示"下载推理组件"
      const vad = new FireRedVadStream(session, vadCfg());
      const STEP = 30 * 16000;
      for (let off = 0; off < wav.length; off += STEP) {
        appendVadSegments(await vad.push(wav.subarray(off, Math.min(off + STEP, wav.length))));
        vadGen.value.doneSec = Math.min(off + STEP, wav.length) / 16000;
        await new Promise(r => setTimeout(r));   // 让 UI 有机会渲染
      }
      appendVadSegments(await vad.flush(vadGen.value.dur));
      vadProbs.value = { probs: vad.probs, dur: vadGen.value.dur };
      // 两笔写同一条记录,必须串行(并发读-改-写会把先写的一方整体覆盖掉)
      await putCachedProbs(new Float32Array(vad.probs), vadGen.value.dur).catch(() => {});
      saveVadSegs(segsSnapshot()).catch(() => {});
      notify('VAD 分段完成：' + sentences.value.length + ' 句');
    } catch (e) {
      notify('VAD 生成失败：' + (e.message || e), 'error');
    } finally {
      session?.release?.();   // webgpu 下 session 不释放会在 GPU 进程累积,拖慢后续所有页面的 webgpu 推理
      vadGen.value = null;
      vadWav = null;   // 及时释放解码 PCM(几百 MB 量级);再推理时重新解码
    }
  }

  // 改后处理参数重切:直接用留存的帧概率,毫秒级
  function resegmentVad() {
    const p = vadProbs.value;
    if (!p) return;
    sentences.value = toSentences(postprocess(p.probs, p.dur, vadCfg()));
    currentId.value = null;
    saveVadSegs(segsSnapshot()).catch(() => {});
  }
  // vad-run 入口:有留存概率 = 改参重切,否则推理
  function runVad() {
    vadProbs.value ? resegmentVad() : generateVadSrt();
  }

  return {
    vadGen, vadProbs, runVad,
    reset: () => { vadProbs.value = null; vadWav = null; },   // 换媒体时旧概率作废
    setProbs: (probs, dur) => { vadProbs.value = { probs, dur }; },   // 命中缓存免推理
  };
}
