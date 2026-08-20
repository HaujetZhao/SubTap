// 最近打开的文件缓存(IndexedDB,单记录 {srt: File, media: File})。
// File/Blob 可结构化克隆直接存;恢复时字幕 .text()、媒体 createObjectURL。
const DB_NAME = 'subtap-files';
const STORE = 'files';
const KEY = 'last';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
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

// 读-改-写合并：单独更新字幕或媒体，另一边保留；换字幕时旧进度作废
export async function saveFile(kind, file) {
  const prev = (await idbOp('readonly', s => s.get(KEY))) || {};
  prev[kind] = file;
  if (kind === 'srt') prev.sentenceId = null;
  await idbOp('readwrite', s => s.put(prev, KEY));
}

// 记住上次点到的句子 id（句 id 由解析顺序决定，同文件重开稳定）
export async function saveProgress(sentenceId) {
  const prev = (await idbOp('readonly', s => s.get(KEY))) || {};
  prev.sentenceId = sentenceId;
  await idbOp('readwrite', s => s.put(prev, KEY));
}

export async function loadFiles() {
  try { return (await idbOp('readonly', s => s.get(KEY))) || null; } catch { return null; }
}
