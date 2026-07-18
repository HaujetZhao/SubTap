// 字幕解析(经第三方库 subsrt,自动识别 SRT/VTT/ASS/SSA/LRC/SBV/SUB/SMI 等格式)
// 输出统一为 Sentence[]:{id,start,end,text}(start/end 为秒;保留换行供双语 pre-line 渲染)

import subsrt from 'subsrt';

// 保留:把 "HH:MM:SS,mmm"/"HH:MM:SS.mmm" 转秒(test.html 仍引用)
export function timestampToSeconds(ts) {
  const m = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(ts.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2], s = +m[3], ms = +m[4];
  return h * 3600 + min * 60 + s + ms / 1000;
}

// 任意字幕文本 → Sentence[];容错:subsrt 抛错或无有效条目时返回 []
export function parseSRT(text) {
  let captions;
  try {
    // subsrt 的块分割正则对 LF 换行有 bug(VTT 等会被整段误判),统一成 CRLF 规避
    const norm = text.replace(/\r?\n/g, '\r\n');
    captions = subsrt.parse(norm);
  } catch (e) {
    return [];
  }
  if (!Array.isArray(captions)) return [];
  const sentences = [];
  for (const c of captions) {
    if (typeof c.start !== 'number' || typeof c.end !== 'number') continue;
    const t = (c.text != null ? String(c.text) : '').replace(/\r\n?/g, '\n').trim();
    if (!t) continue;
    sentences.push({ id: sentences.length + 1, start: c.start / 1000, end: c.end / 1000, text: t });
  }
  return sentences;
}
