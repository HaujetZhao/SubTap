// 字幕解析(经第三方库 subsrt,自动识别 SRT/VTT/ASS/SSA/LRC/SBV/SUB/SMI 等格式)
// 输出统一为 Sentence[]:{id,start,end,text}(start/end 为秒;保留换行供双语 pre-line 渲染)

import subsrt from 'subsrt';

// 任意字幕文本 → Sentence[];容错:subsrt 抛错或无有效条目时返回 []
export function parseSRT(text) {
  let captions;
  try {
    // subsrt 的块分割正则对 LF 换行有 bug(VTT 等会被整段误判),统一成 CRLF 规避
    let norm = text.replace(/\r?\n/g, '\r\n');
    // subsrt 会丢弃空文本条目(纯时间轴字幕):时间轴行后直接空行时补一个零宽空格占位
    // (不能用普通空白——subsrt 的块分割正则 \r?\n\s+\r?\n 会把它连同空行吃掉)
    norm = norm.replace(/(--> [^\r\n]*\r\n)(?:\r\n)/g, '$1​\r\n\r\n');
    const fmt = subsrt.detect(norm);
    if (fmt === 'lrc') return [];   // LRC 无逐句结束时间,不适合点读,不支持
    captions = subsrt.parse(norm);
  } catch (e) {
    return [];
  }
  const sentences = [];
  for (const c of captions) {
    if (typeof c.start !== 'number' || typeof c.end !== 'number') continue;
    const t = (c.text != null ? String(c.text) : '').replace(/\r\n?/g, '\n').replace(/​/g, '').trim();  // 允许空文本(纯时间轴字幕,供点听);剥掉占位零宽空格
    sentences.push({ id: sentences.length + 1, start: c.start / 1000, end: c.end / 1000, text: t });
  }
  return sentences;
}
