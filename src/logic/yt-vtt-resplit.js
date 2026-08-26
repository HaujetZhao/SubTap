// YouTube 自动字幕 VTT 重分句(滚动字幕 → 规整句子)
// YouTube 自动字幕是滚动窗口:每 cue = 上一 cue 尾部重复 + 新词,且新词带 <ts><c> 字级时间戳。
// 此处抽词流 → 滚动去重 → 按标点分句 → 顺序对齐组句,输出规整 Sentence[](与 srt-parser 同构)。
// cue 切分用 node-webvtt(spec 合规,正确处理 cue 设置/header/占位空行)。

import webvtt from 'node-webvtt';

// 是否为 YouTube 字级时间戳 VTT(<ts><c> 内嵌标签);普通 VTT 返回 false,走常规解析
export function isWordTimedVtt(text) {
  return /^﻿?WEBVTT/m.test(text) && /\d{2}:\d{2}:\d{2}\.\d{3}>\s*<c>/.test(text);
}

// 抽词流:[{word, start(秒)}]。行首裸词(上一窗口尾词)无标签,时间用 cue start 近似
function wordStream(text) {
  const { cues } = webvtt.parse(text, { meta: true });  // meta:true 允许 WEBVTT 头部带 Kind/Language 行
  const words = [];
  let prevCueWords = [];  // 上一 cue 的纯文本词序列
  for (const cue of cues) {
    const cueWords = [];
    for (const line of cue.text.split('\n')) {
      const tagAt = line.indexOf('<');
      const head = tagAt >= 0 ? line.slice(0, tagAt) : line;
      for (const hw of head.split(' ')) if (hw) cueWords.push({ word: hw, start: undefined });
      let pending;
      for (const m of line.matchAll(/<(\d{2}):(\d{2}):(\d{2})\.(\d{3})>|<c>([^<]*)<\/c>/g)) {
        if (m[1] !== undefined) pending = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
        else if (m[5].trim()) cueWords.push({ word: m[5].trim(), start: pending });
      }
    }
    // 滚动去重:找与本 cue 前缀匹配的上一 cue 尾部最大长度,其余为新词
    const plain = cueWords.map(w => w.word);
    let dup = 0;
    for (let k = Math.min(plain.length, prevCueWords.length); k > 0; k--) {
      if (plain.slice(0, k).join('\n') === prevCueWords.slice(-k).join('\n')) { dup = k; break; }
    }
    for (const w of cueWords.slice(dup)) words.push({ ...w, start: w.start ?? cue.start });
    prevCueWords = plain;
  }
  return words;
}

function countUnits(text) {
  const cjk = [...text].filter(ch => ch >= '一' && ch <= '鿿').length;
  const en = text.split(/\s+/).filter(w => w && ![...w].every(c => c >= '一' && c <= '鿿')).length;
  return cjk + en;
}

// 分句:强标点(。?.?!)切句,缩写点不切;句内弱标点(，,)两侧各超 3 单位才断行
function smartSplit(text, minUnits = 3) {
  const parts = text.split(/([。？]|[.?!](?:\s+|$))/);
  const sentences = [];
  let buf = '';
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (part.trim() && '。？.?!'.includes(part.trim())) {
      buf += part;
      // 缩写点不切:显式缩写(Dr. 等),或单字母大写点且前后词均大写开头(Philip H. Smith)
      const next = pi + 1 < parts.length ? parts[pi + 1] : '';
      if (/(?:^|\s)(?:Dr|Mr|Mrs|Ms|Prof|St|Jr|Sr|vs|etc)\.\s*$/.test(buf)) continue;
      if (/(?:^|\s)[A-Z][\w'’-]*\s+[A-Z]\.\s*$/.test(buf) && /^\s*[A-Z]/.test(next)) continue;
      sentences.push(buf);
      buf = '';
    } else buf += part;
  }
  if (buf.trim()) sentences.push(buf);

  const lines = [];
  for (const sent of sentences) {
    const segs = [];
    const ps = sent.split(/([，,](?:\s+|$))/);
    for (let i = 0; i < ps.length; i += 2) segs.push(ps[i] + (ps[i + 1] ?? ''));
    for (let i = 0; i < segs.length; i++) {
      lines.push(segs[i]);
      const nxt = segs[i + 1];
      if (nxt === undefined || !/[,，]\s*$/.test(segs[i])) continue;
      if (countUnits(segs[i]) > minUnits && countUnits(nxt) > minUnits) continue;
      segs[i + 1] = segs[i] + nxt;  // 任一侧太短,并入下一段
      lines.pop();
    }
  }
  return lines;
}

const clean = w => w.toLowerCase().replace(/[^\w'’]/g, '');

// 词流 + 分句 → Sentence[]。对齐:句子的清洗词序是词流清洗后序列的连续切片
export function resplitWordTimedVtt(text) {
  const words = wordStream(text).filter(w => !/\[[^\]]*\]/.test(w.word));   // 剔除 [music] 等声音标签
  if (!words.length) return [];
  const fullText = words.map(w => w.word.trim()).join(' ').replace(/\s+/g, ' ').trim();
  const lines = smartSplit(fullText);
  const cleaned = words.map(w => clean(w.word));
  const sentences = [];
  let wi = 0;
  for (let li = 0; li < lines.length; li++) {
    if (wi >= words.length) break;  // 对齐耗尽,剩余句丢弃(不应发生,词流与分句同源)
    const startWi = wi;
    for (const lw of lines[li].split(' ').map(clean).filter(Boolean)) {
      while (wi < cleaned.length && cleaned[wi] !== lw) wi++;
      wi++;
    }
    const endWi = Math.min(wi - 1, words.length - 1);
    const t1 = words[startWi].start;
    const lastStart = words[Math.max(endWi, startWi)].start;
    const t2 = li + 1 < lines.length && wi < words.length
      ? Math.min(words[wi].start - 0.1, lastStart + 1.0)      // 句末 = 下句首词前 0.1s,上限末词 +1s
      : lastStart + Math.max(0.35 * countUnits(lines[li]), 0.1); // 末句按词数估时长兜底
    sentences.push({ id: sentences.length + 1, start: t1, end: Math.max(t2, t1 + 0.1), text: lines[li].trim() });
  }
  return sentences;
}
