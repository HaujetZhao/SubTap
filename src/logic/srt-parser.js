// 字幕解析(经第三方库 subsrt,自动识别 SRT/VTT/ASS/SSA/LRC/SBV/SUB/SMI 等格式)
// 输出统一为 Sentence[]:{id,start,end,text}(start/end 为秒;保留换行供双语 pre-line 渲染)

import subsrt from 'subsrt';
import { isWordTimedVtt, resplitWordTimedVtt } from './yt-vtt-resplit.js';

// 任意字幕文本 → Sentence[];容错:subsrt 抛错或无有效条目时返回 []
export function parseSRT(text) {
  // YouTube 自动字幕(字级时间戳滚动 VTT)先重分句成规整句子,常规解析接不住滚动重复
  if (isWordTimedVtt(text)) return resplitWordTimedVtt(text);
  let captions;
  try {
    // ASS/SSA 在 CRLF 归一化后会被 subsrt 误判成 sbv(解析出 0 条),原文直接解析
    // (ASS 走 LF 没问题;captions 保留 data.Style 供双语合并)
    if (['ass', 'ssa'].includes(subsrt.detect(text))) {
      const events = subsrt.parse(text);
      captions = dropTopOnly(events);  // 画面字/注释等顶部定位的不是台词,过滤
    } else {
    // subsrt 的块分割正则对 LF 换行有 bug(VTT 等会被整段误判),统一成 CRLF 规避
    let norm = text.replace(/\r?\n/g, '\r\n');
    // subsrt 会丢弃空文本条目(纯时间轴字幕):时间轴行后直接空行时补一个零宽空格占位
    // (不能用普通空白——subsrt 的块分割正则 \r?\n\s+\r?\n 会把它连同空行吃掉)
    norm = norm.replace(/(--> [^\r\n]*\r\n)(?:\r\n)/g, '$1​\r\n\r\n');
    const fmt = subsrt.detect(norm);
    if (fmt === 'lrc') return [];   // LRC 无逐句结束时间,不适合点读,不支持
    captions = subsrt.parse(norm);
    }
  } catch (e) {
    return [];
  }
  const sentences = [];
  for (const c of mergeBilingual(captions)) {
    if (typeof c.start !== 'number' || typeof c.end !== 'number') continue;
    const t = (c.text != null ? String(c.text) : '').replace(/\r\n?/g, '\n').replace(/​/g, '').trim();  // 允许空文本(纯时间轴字幕,供点听);剥掉占位零宽空格
    sentences.push({ id: sentences.length + 1, start: c.start / 1000, end: c.end / 1000, text: t });
  }
  return sentences;
}

// 双语字幕组常见结构:中日/中英是两条独立 Dialogue,起止时间完全相同、靠 Style 区分。
// 按 (start,end) 分组,同组文本不同者按出现顺序合并为一条(文本 \n 连接,渲染层 pre-line 多行)。
// 不依赖 Style 命名,对同时间戳的注释/顶部字幕也会合并——可接受(同帧双语本就该一起显示)。
function mergeBilingual(captions) {
  const out = [];
  const byTime = new Map(); // `${start}|${end}` -> caption(已输出那条)
  for (const c of captions) {
    const key = `${c.start}|${c.end}`;
    const prev = byTime.get(key);
    if (prev && c.text != null && String(c.text).trim() && String(c.text) !== prev.text) {
      prev.text += '\n' + String(c.text);
    } else if (!prev) {
      byTime.set(key, c);
      out.push(c);
    }
  }
  // ASS 文件里 Dialogue 不一定按时间排(如 OP/ED 的 JP 层在前、CN 层整段垫后),统一按 start 稳定排序
  out.sort((a, b) => a.start - b.start);
  // 逐帧动画画面字:同一句话拆成几十条首尾相接(每条 ~40ms)的 Dialogue 靠 \pos 逐帧挪动,
  // 同文本且间隔 ≤0.2s 的相邻句折叠为一句(顺带合并双语后两轨各自折叠,靠相接时间自然对齐)
  const merged = [];
  for (const c of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.text === c.text && c.start <= prev.end + 0.2) prev.end = Math.max(prev.end, c.end);
    else merged.push(c);
  }
  return merged;
}

// ASS 屏幕上方过滤:Alignment 7/8/9(小键盘上排)为顶部定位,通常是画面字/注释/Staff 而非台词。
// 规则:同时间戳组内全部顶部定位才整组丢弃——OP 歌词常见"日文在底、中文在顶"的组,保留。
// (只看 Style 的 Alignment,不管 Dialogue 文本里的 \an 覆盖标签)
function dropTopOnly(events) {
  const styleAlign = new Map();
  const captions = [];
  for (const e of events) {
    if (e.type === 'style') styleAlign.set(e.data.Name, e.data.Alignment);
    else if (e.type === 'caption') captions.push(e);
  }
  const isTop = c => [7, 8, 9].includes(Number(styleAlign.get(c.data.Style)));
  const hasBottom = new Set(captions.filter(c => !isTop(c)).map(c => `${c.start}|${c.end}`));
  return captions.filter(c => !isTop(c) || hasBottom.has(`${c.start}|${c.end}`));
}
