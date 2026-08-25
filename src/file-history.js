// 最近打开的文件缓存(IndexedDB 'subtap' 库,单记录 'last' {srt, media, sentenceId, probs, dur})。
// 只存上一次:换媒体时旧概率随之作废;再载入同一媒体时概率复用(指纹比对)。
// File/Blob 可结构化克隆直接存;恢复时字幕 .text()、媒体 createObjectURL。
const DB_NAME = 'subtap';
const STORE = 'files';
const KEY = 'last';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbOp(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

// 读-改-写合并:fn 收到当前记录(无则空对象),就地改后写回
async function update(fn) {
  const prev = (await idbOp('readonly', s => s.get(KEY))) || {};
  fn(prev);
  await idbOp('readwrite', s => s.put(prev, KEY));
}

// 单独更新字幕或媒体,另一边保留;换字幕/媒体时旧进度与旧概率作废
// srtSource 标志字幕来源('file'=外部字幕文件 / 'vad'=VAD 生成分段),恢复时决定 VAD 功能是否可用
export function saveFile(kind, file) {
  return update(prev => {
    prev[kind] = file;
    if (kind === 'srt') { prev.sentenceId = null; prev.srtSource = 'file'; prev.vadSegs = null; }
    if (kind === 'media') prev.probs = null;
  });
}

/** VAD 生成/重切后留存分段(直接存数组,不经 srt 文本往返),顶替记录里的外部字幕。 */
export function saveVadSegs(segs) {
  return update(prev => {
    prev.srt = null;
    prev.srtSource = 'vad';
    prev.vadSegs = segs;
    prev.sentenceId = null;
  });
}

// 记住上次点到的句子 id（句 id 由解析顺序决定，同文件重开稳定）
export function saveProgress(sentenceId) {
  return update(prev => { prev.sentenceId = sentenceId; });
}

export async function loadFiles() {
  try { return (await idbOp('readonly', s => s.get(KEY))) || null; } catch { return null; }
}

// ---------- VAD 概率(并入 'last' 记录,仅当前媒体有效) ----------

/** 媒体指纹:同名同大小同修改时间 = 同文件,留存概率可复用。 */
export const mediaKey = blob => blob.name + '|' + blob.size + '|' + (blob.lastModified ?? 0);

/** 载入媒体时查上次留存概率:上次媒体与本次同一文件则命中,免推理。 */
export async function getCachedProbs(blob) {
  try {
    const rec = await idbOp('readonly', s => s.get(KEY));
    if (rec?.probs && rec.media && mediaKey(rec.media) === mediaKey(blob)) return rec;
    return null;
  } catch { return null; }
}

export function putCachedProbs(probs, dur) {
  return update(prev => {
    prev.probs = probs;
    prev.dur = dur;
  });
}
