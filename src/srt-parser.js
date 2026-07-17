// SRT 字幕解析（纯函数）

// 把 "HH:MM:SS,mmm" 或 "HH:MM:SS.mmm" 转成秒（浮点）；非法返回 null
export function timestampToSeconds(ts) {
  const m = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(ts.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2], s = +m[3], ms = +m[4];
  return h * 3600 + min * 60 + s + ms / 1000;
}

// SRT 文本 → Sentence[]：{id,start,end,text}；容错跳过坏块
export function parseSRT(text) {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const blocks = normalized.split(/\n\s*\n/);
  const sentences = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const lines = block.split('\n');
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1; // 跳过序号行

    const tm = /^([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(lines[idx].trim());
    if (!tm) continue; // 容错

    const start = timestampToSeconds(tm[1]);
    const end = timestampToSeconds(tm[2]);
    if (start === null || end === null) continue;

    const text = lines.slice(idx + 1).join('\n').trim();
    sentences.push({ id: sentences.length + 1, start, end, text });
  }
  return sentences;
}
