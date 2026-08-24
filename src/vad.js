// FireRedVAD 前端流式推理（移植自 d:/repos/VAD/infer_onnx.mjs，模型含 fbank+CMVN+DFSMN）。
// 流式：每次 push 一段音频，攒够 30s 一块就推理；SAFE 帧之前的分段是确定的，
// 可随块累积追加到字幕列表，不用等全部跑完。
// webgpu 入口 = jsep 构建,含 WebGPU + wasm 回退;纯 wasm 入口不含 webgpu EP
import * as ort from 'onnxruntime-web/webgpu';

// wasm 加载器经 wasmPaths 动态 import,必须是绝对 URL(裸相对路径会被当模块名解析失败),
// 且与 ort 版本配套,从 public/ort/ 取(构建时随静态资源拷贝)。
ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href;

const CHUNK = 3000;   // 每块产出帧数(30s)
const OV = 160;       // 推理上下文帧数(> 8层×19帧感受野,1.6s)
const SAFE = 50;      // 后处理回溯安全边(平滑5 + min_speech20,留余量 0.5s)
export const FRAME_SHIFT_S = 0.01;   // 帧移(秒),App 侧参数换算帧数用
const FRAME_LENGTH_S = 0.025;

// ---------- 后处理(默认参数 = FireRedVadConfig 默认值,postprocess 的 cfg 可覆盖) ----------

function convolveFull(arr, kernel) {
  const n = arr.length, k = kernel.length, out = new Float64Array(n + k - 1);
  for (let i = 0; i < n; i++) {
    if (arr[i] === 0) continue;
    for (let j = 0; j < k; j++) out[i + j] += arr[i] * kernel[j];
  }
  return out;
}

/** probs: 概率数组。cfg 可覆盖 CFG 任意字段(平滑窗/阈值/最短语音帧等)。返回 [start_s, end_s] 分段列表。 */
export function postprocess(probs, wavDur, cfg = {}) {
  const CFG = { smoothWindow: 5, threshold: 0.4, minSpeech: 20, maxSpeech: 2000, minSilence: 20, mergeSilence: 0, extendSpeech: 0, ...cfg };
  // 1. 概率滑窗平滑(边界用累积平均)
  const w = CFG.smoothWindow;
  let smoothed;
  if (w <= 1) smoothed = Array.from(probs);
  else {
    const kernel = new Array(w).fill(1 / w);
    smoothed = Array.from(convolveFull(probs, kernel).slice(0, probs.length));
    for (let i = 0; i < Math.min(w - 1, probs.length); i++) {
      let s = 0; for (let j = 0; j <= i; j++) s += probs[j];
      smoothed[i] = s / (i + 1);
    }
  }
  // 2. 阈值二值化
  const preds = smoothed.map(p => (p >= CFG.threshold ? 1 : 0));
  // 3. 4 状态机(静音/疑似语音/语音/疑似静音),min_speech/min_silence 约束转移
  const d = new Array(preds.length).fill(0);
  let state = 0, speechStart = -1, silenceStart = -1;
  for (let t = 0; t < preds.length; t++) {
    const isSpeech = preds[t] === 1;
    if (state === 0) {
      if (isSpeech) { state = 1; speechStart = t; }
    } else if (state === 1) {
      if (isSpeech) {
        if (t - speechStart >= CFG.minSpeech) {
          state = 2;
          for (let i = speechStart; i < t; i++) d[i] = 1;
        }
      } else { state = 0; speechStart = -1; }
    } else if (state === 2) {
      if (!isSpeech) { state = 3; silenceStart = t; }
    } else if (state === 3) {
      if (!isSpeech) {
        if (t - silenceStart >= CFG.minSilence) { state = 0; speechStart = -1; }
      } else { state = 2; silenceStart = -1; }
    }
    d[t] = (state === 2 || state === 3) ? 1 : 0;
  }
  // 4. 修正平滑窗把段首吃掉的部分
  const nd = [...d];
  for (let t = 1; t < d.length; t++) {
    if (d[t - 1] === 0 && d[t] === 1) {
      const start = Math.max(0, t - CFG.smoothWindow);
      for (let i = start; i < t; i++) nd[i] = 1;
    }
  }
  let dec = nd;
  // 5. 短静音并入语音(默认关) / 6. 语音段前后扩展(默认关)
  if (CFG.mergeSilence > 0) {
    const md = [...dec];
    let ss = null;
    for (let t = 1; t < dec.length; t++) {
      if (dec[t - 1] === 1 && dec[t] === 0 && ss === null) ss = t;
      else if (dec[t - 1] === 0 && dec[t] === 1 && ss !== null) {
        if (t - ss < CFG.mergeSilence)
          for (let i = ss; i < t; i++) md[i] = 1;
        ss = null;
      }
    }
    dec = md;
  }
  if (CFG.extendSpeech > 0) {
    const e = CFG.extendSpeech, kernel = new Array(2 * e + 1).fill(1);
    const ext = convolveFull(dec, kernel)
      .slice(Math.trunc(kernel.length / 2), Math.trunc(kernel.length / 2) + dec.length);
    dec = Array.from(ext, v => (v > 0 ? 1 : 0));
  }
  // 7. 超长段(>maxSpeech 帧)在概率最低点切开
  const toSeg = dd => {
    const segs = [];
    let start = null;
    for (let t = 0; t < dd.length; t++) {
      if (dd[t] === 1 && start === null) start = t;
      else if (dd[t] === 0 && start !== null) {
        segs.push([start * FRAME_SHIFT_S, t * FRAME_SHIFT_S]);
        start = null;
      }
    }
    if (start !== null) {
      let end = dd.length * FRAME_SHIFT_S + FRAME_LENGTH_S;
      if (wavDur != null) end = Math.min(end, wavDur);
      segs.push([start * FRAME_SHIFT_S, end]);
    }
    return segs;
  };
  const final_ = [...dec];
  for (const [ss_, es_] of toSeg(dec)) {
    const sf = Math.trunc(ss_ / FRAME_SHIFT_S), ef = Math.trunc(es_ / FRAME_SHIFT_S);
    if (ef - sf > CFG.maxSpeech) {
      let start = sf;
      while (ef - start > CFG.maxSpeech) {
        const ws = Math.trunc(start + CFG.maxSpeech / 2), we = Math.trunc(start + CFG.maxSpeech);
        let mi = ws;
        for (let i = ws; i < we; i++) if (probs[i] < probs[mi]) mi = i;
        final_[mi] = 0;
        start = mi + 1;
      }
    }
  }
  return toSeg(final_).map(([s, e]) =>
    [Math.round(s * 1000) / 1000, Math.round(e * 1000) / 1000]);
}

// ---------- 流式推理 ----------
function numFrames(n) {
  return n >= 400 ? 1 + Math.trunc((n - 400) / 160) : Math.ceil(n / 160);
}

/** 按指定 EP 建 session。eps 缺省 = ['webgpu','wasm'],ort 自行回退(两后端共用 jsep wasm)。
 *  注意:session 用完必须 release——webgpu 下挂着不释放会拖慢同浏览器所有页面的后续 webgpu 推理(跨页、刷新不清,仅浏览器重启恢复)。 */
export async function createSession(eps) {
  const buf = await (await fetch('models/vad_full.onnx')).arrayBuffer();
  return ort.InferenceSession.create(buf, { executionProviders: eps ?? ['webgpu', 'wasm'] });
}

/** 预取当前设备将用的 ort wasm + onnx 模型进 HTTP 缓存(读流统计字节数,报 {done,total} 进度)。
 *  流读完的响应 Chrome 仍写入 HTTP 缓存,之后 createSession / ort 加载器命中缓存免二次下载。
 *  有 gpu 走 jsep,无 gpu(移动端)回退 asyncify。 */
export function prefetchVadAssets(onProgress = () => {}) {
  const variant = navigator.gpu ? 'jsep' : 'asyncify';
  const urls = [
    new URL(`ort/ort-wasm-simd-threaded.${variant}.wasm`, document.baseURI),
    new URL('models/vad_full.onnx', document.baseURI),
  ];
  const done = [0, 0], total = [0, 0];
  const report = () => onProgress({ done: done[0] + done[1], total: total[0] + total[1] });
  return Promise.all(urls.map(async (u, i) => {
    const res = await fetch(u);
    total[i] = +res.headers.get('Content-Length') || 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done: fin, value } = await reader.read();
      if (fin) break;
      done[i] += value.byteLength;
      report();
    }
    report();
  }));
}

export class FireRedVadStream {
  /** session: ort.InferenceSession;
   *  cfg: 后处理参数覆盖(阈值/最短语音帧等),渐进输出的分段也用它切 */
  constructor(session, cfg = {}) {
    this.session = session;
    this.cfg = cfg;
    this.nextFrame = 0;   // 下一个待推理的全局帧号
    this.bufStart = 0;    // buffer[0] 对应的全局采样号
    this.buf = new Float32Array(0);  // 保留的 wav 采样(含左上下文)
    this.probs = [];      // 已有概率(全局帧 0 起,4B/帧)
    this.emitted = 0;     // 已输出的分段数
  }

  /** 追加音频(float32 采样,16k),内部攒块推理。返回本次新确定的分段。 */
  async push(samples) {
    const totalSamples = this.bufStart + this.buf.length + samples.length;
    const merged = new Float32Array(this.buf.length + samples.length);
    merged.set(this.buf); merged.set(samples, this.buf.length);
    this.buf = merged;
    while (numFrames(totalSamples) >= this.nextFrame + CHUNK + OV) {
      await this._runChunk(this.nextFrame + CHUNK);
    }
    return this._emit(false);
  }

  /** 音频结束:冲刷剩余部分,返回最后确定的分段。 */
  async flush(wavDur) {
    const T = numFrames(this.bufStart + this.buf.length);
    if (T > this.nextFrame) await this._runChunk(T);
    return this._emit(true, wavDur);
  }

  /** 跑 [nextFrame, endFrame) 一块(overlap-save)。 */
  async _runChunk(endFrame) {
    const s = this.nextFrame, e = endFrame;
    const a = Math.max(0, s - OV);
    const s0 = 160 * a - this.bufStart;
    const s1 = Math.min(this.buf.length, 160 * (e - 1) + 400 - this.bufStart);
    // 用拷贝不用 subarray 视图:proxy 模式会把输入 buffer 转移给 worker,视图会被 detach
    const slice = this.buf.slice(s0, s1);
    const input = new ort.Tensor('float32', slice, [slice.length]);
    const { probs } = await this.session.run({ wav: input });
    this.probs.push(...probs.data.subarray(s - a, s - a + (e - s)));
    probs.dispose?.();   // 输入输出 tensor 不释放会随 run 次数累积(GPU 内存),实测越跑越慢
    input.dispose?.();
    // 回收左上下文之前的采样
    const release = 160 * (e - OV) - this.bufStart;
    if (release > 0) {
      this.buf = this.buf.slice(release);
      this.bufStart += release;
    }
    this.nextFrame = e;
  }

  /** 输出 SAFETY 边之前新确定的分段。
   *  非冲刷时丢弃仍开口于截断处的最后一段(其结束时间还会变);已闭合段不会变。 */
  _emit(final, wavDur) {
    const cut = final ? this.probs.length : this.probs.length - SAFE;
    if (cut <= 0) return [];
    const segs = postprocess(this.probs.slice(0, cut), final ? wavDur : undefined, this.cfg);
    if (!final && segs.length && segs[segs.length - 1][1] >= (cut - 1) * FRAME_SHIFT_S) {
      segs.pop();
    }
    const fresh = segs.slice(this.emitted);
    this.emitted = segs.length;
    return fresh;
  }
}

/** 解码任意音视频文件 → 16k 单声道 float32 采样。 */
export async function decodeAudio16k(blob) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  // OfflineAudioContext 重采样到 16k 单声道(视频/高采样率音频统一前端处理)
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  // 模型输入要 int16 原始幅度(不归一化),WebAudio 给的是 -1..1,原地放大回去
  // (渲染结果独占,改写无副作用;省一次同尺寸大拷贝)
  const wav = rendered.getChannelData(0);
  for (let i = 0; i < wav.length; i++) wav[i] *= 32768;
  return wav;
}


