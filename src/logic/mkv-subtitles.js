// MKV 内封文本字幕提取：两遍 EBML 扫描。
// 参照 matroska-subtitles 的 corner case 清单（spec 2026-08-28）：
// 只处理文本字幕轨（S_TEXT/* 与 ffmpeg 的 D_WEBVTT/*）；位图轨（PGS/VobSub）忽略；不做 lacing（字幕轨规范单帧）；
// ContentCompression 走原生 DecompressionStream('deflate')（zlib，与 mdx.js 同款）。

export function isMkv(buf) {
  if (!(buf.length >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3)) return false;
  // 下钻 EBML 头找 DocType(0x4282) 排除 WebM（魔数相同，字幕轨形制不同不处理）；缺省 matroska
  const lenAt = (i) => {  // vint/id 的编码长度
    let len = 1;
    for (let m = 0x80; m; m >>= 1) { if (buf[i] & m) break; len++; }
    return len;
  };
  const vintAt = (i) => {  // 值（清标记位，size 用）
    const len = lenAt(i);
    let v = buf[i] & ((0x100 >> len) - 1);
    for (let k = 1; k < len; k++) v = v * 256 + buf[i + k];
    return v;
  };
  const idLen = lenAt(0);                       // 首元素必是 EBML 头本身（id 0x1A45DFA3）
  const sLen = lenAt(idLen);
  const start = idLen + sLen, end = start + vintAt(idLen);
  let i = start;
  while (i < end) {
    const l = lenAt(i);
    let eid = buf[i];
    for (let k = 1; k < l; k++) eid = eid * 256 + buf[i + k];  // id 保留标记位
    const size = vintAt(i + l);
    const body = i + l + lenAt(i + l);
    if (eid === 0x4282) return new TextDecoder().decode(buf.subarray(body, body + size)) !== 'webm';
    i = body + size;
  }
  return true;   // 头里没有 DocType（缺省 matroska）
}

export async function extractMkvSubtitles(buf) {
  // --- 基础读取原语 ---
  const vint = (i) => {  // [值, 长度]，清标记位（size / track number 用）
    const b = buf[i]; let len = 1;
    for (let m = 0x80; m; m >>= 1) { if (b & m) break; len++; }
    let v = b & ((0x100 >> len) - 1);
    for (let k = 1; k < len; k++) v = v * 256 + buf[i + k];
    return [v, len];
  };
  const elId = (i) => {  // element id：保留标记位
    const b = buf[i]; let len = 1;
    for (let m = 0x80; m; m >>= 1) { if (b & m) break; len++; }
    let v = b;
    for (let k = 1; k < len; k++) v = v * 256 + buf[i + k];
    return [v, len];
  };
  const uint = (i, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + buf[i + k]; return v; };
  const text = (a, b) => new TextDecoder().decode(buf.subarray(a, b));
  // 未知 size：size vint 数据位全 1（4/8 字节等各形态都要认）
  const isUnknownSize = (v, len) => v === (1 << (7 * len)) - 1;

  // --- 第一遍：轨道元数据 + TimecodeScale（EBML头/Segment/Info/Tracks 下钻）---
  const tracks = [];
  let timecodeScale = 1e6;  // ns，默认值
  let i = 0;
  while (i < buf.length) {
    const [id, idLen] = elId(i);
    const [size, sizeLen] = vint(i + idLen);
    const body = i + idLen + sizeLen, end = body + size;
    if (id === 0x1A45DFA3 || id === 0x18538067 || id === 0x1654AE6B || id === 0x1549A966) { i = body; continue; } // EBML/Segment/Tracks/Info 下钻
    if (id === 0x2AD7B1) timecodeScale = uint(body, size);                       // TimecodeScale
    if (id === 0xAE) {                                                            // TrackEntry
      let j = body, t = { compressed: false };
      while (j < end) {
        const [sid, sl] = elId(j), [ss, ssl] = vint(j + sl), sb = j + sl + ssl, se = sb + ss;
        if (sid === 0xD7) t.no = uint(sb, ss);                                    // TrackNumber
        if (sid === 0x83) t.type = uint(sb, ss);                                  // TrackType
        if (sid === 0x86) t.codec = text(sb, se);                                 // CodecID
        if (sid === 0x22B59C) t.lang = text(sb, se);                              // Language
        if (sid === 0x536E) t.name = text(sb, se);                                // Name
        if (sid === 0x6D80) t.compressed = true;                                  // ContentEncodings → 载荷按 zlib 压缩处理
        j = se;
      }
      if (t.type === 0x11 && t.codec && (t.codec.startsWith('S_TEXT') || t.codec.startsWith('D_WEBVTT'))) tracks.push(t);
    }
    if (id === 0x1F43B675) break;  // 到第一个 Cluster，元数据阶段结束
    i = end;
  }
  if (!tracks.length) return { tracks: [], cuesByTrack: new Map() };

  // --- 第二遍：扫 Cluster 收块（SimpleBlock / BlockGroup 内 Block+BlockDuration）---
  const scale = timecodeScale / 1e6;  // block 时间单位 → ms
  const raw = new Map(tracks.map(t => [t.no, []]));  // no -> [{ms, durMs|null, payload}]
  const collectBlock = (bb, be, durMs) => {
    const [tno, tl] = vint(bb);
    if (!raw.has(tno)) return;
    const rel = ((buf[bb + tl] << 8) | buf[bb + tl + 1]) * scale;
    raw.get(tno).push({ ms: clusterMs + rel, durMs, payload: buf.subarray(bb + tl + 3, be) });
  };
  let clusterMs = 0;
  i = 0;
  while (i < buf.length) {
    const [id, idLen] = elId(i);
    const [size, sizeLen] = vint(i + idLen);
    if (id === 0x18538067) { i += idLen + sizeLen; continue; }                    // Segment 只穿透（size 可能未知）
    const body = i + idLen + sizeLen, end = body + size;
    if (id === 0x1F43B675) {                                                      // Cluster
      const cend = isUnknownSize(size, sizeLen) ? buf.length : end;               // 未知 size：子元素扫到流尾
      let j = body;
      while (j < cend) {
        const [cid, cl] = elId(j), [cs, csl] = vint(j + cl), cb = j + cl + csl, ce = cb + cs;
        if (cid === 0xE7) clusterMs = uint(cb, cs) * scale;                       // Cluster Timecode
        if (cid === 0xA3) collectBlock(cb, ce, null);                             // SimpleBlock（无时长）
        if (cid === 0xA0) {                                                       // BlockGroup：Block + BlockDuration
          let k = cb, block = null, dur = null;
          while (k < ce) {
            const [bid, bl] = elId(k), [bs, bsl] = vint(k + bl), bb = k + bl + bsl, be = bb + bs;
            if (bid === 0xA1) block = [bb, be];
            if (bid === 0x9B) dur = uint(bb, bs) * scale;
            k = be;
          }
          if (block) collectBlock(block[0], block[1], dur);
        }
        j = ce;
      }
    }
    i = end;
  }

  // --- 载荷解析：解码 + 按 codec 取文本 ---
  const decode = async (payload, compressed) => {
    if (!compressed) return new TextDecoder().decode(payload);
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([payload]).stream().pipeThrough(ds);
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  };
  const parseText = (codec, s) => {
    s = s.replace(/\r/g, '');
    // ASS/SSA Dialogue 尾字段：readOrder,layer,style,name,marginL,marginR,marginV,effect,text
    // （SSA 嵌入 Matroska 后字段布局与 ASS 一致，均取第 9 个字段起，逗号属于正文要保留）
    if (codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA') {
      return s.split(',').slice(8).join(',')
        .replace(/\\N/g, ' ').replace(/\\n/g, ' ').trim();
    }
    // D_WEBVTT（ffmpeg 对 webvtt 流写的 CodecID，WebM 形制）：
    // 载荷前两行是 cue settings + identifier，其后才是正文。保留内部换行（YouTube
    // 字级时间戳 VTT 的滚动行结构依赖多行），由上层重建 VTT 文本走 parseSRT 重分句
    if (codec.startsWith('D_WEBVTT')) return s.split('\n').slice(2).join('\n');
    // 其余 S_TEXT（UTF8/WEBVTT）：载荷即 cue 原文
    return s.replace(/\n/g, ' ').trim();
  };

  const cuesByTrack = new Map();
  for (const t of tracks) {
    const items = raw.get(t.no).sort((a, b) => a.ms - b.ms);
    const cues = [];
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const s = parseText(t.codec, await decode(it.payload, t.compressed));
      if (!s) continue;
      const start = it.ms / 1000;
      const next = items[k + 1];
      const end = it.durMs != null ? (it.ms + it.durMs) / 1000
        : Math.min(next ? next.ms / 1000 : start + 5, start + 5);
      cues.push({ start, end: Math.max(end, start + 0.001), text: s });
    }
    cuesByTrack.set(t.no, cues);
  }
  return { tracks, cuesByTrack };
}
