/**
 * mdx.js —— 精简版 MDX 词典解析（浏览器环境，纯逻辑层）
 *
 * 参照 js-mdict 的解析逻辑，按「优词词源词典」实际用到的格式特性裁剪：
 *   - 版本 2.0（数字字段 8 字节大端，词长字段 2 字节大端）
 *   - 编码 UTF-8
 *   - 加密 Encrypted=2：key block info 一段用 ripemd128 派生密钥的 XOR 流加密
 *     （固定算法、无需用户密码，其余段落不加密）
 *   - 压缩：key block info / key block / record block 全部 zlib（块头 4 字节类型标记 0x02 + 4 字节 adler32）
 *     → 用浏览器原生 DecompressionStream('deflate')（deflate 即 zlib 格式），因此 API 是异步的
 *
 * 文件布局（version 2.0，数字均大端）：
 *   [0:4]               header 长度（字节数）
 *   [4 : 4+len]         header 文本（UTF-16LE 的 XML 属性串）
 *   [+4]                adler32（跳过不校验，下同）
 *   key header          5×8：key 块数 / 词条数 / key-info 解压尺寸 / key-info 压缩尺寸 / key 块总压缩尺寸
 *   [+4]                adler32
 *   key block info      （本词典加密）每块：8 词条数 | 2 首词字节长 | 首词+\0 | 2 末词字节长 | 末词+\0 | 8 压缩尺寸 | 8 解压尺寸
 *   key blocks          每块 zlib；块内每条：8 字节 record 偏移 + UTF-8 词头 + \0
 *   record header       4×8：record 块数 / 词条数 / record-info 尺寸 / record 块总压缩尺寸
 *   record block info   每块：8 压缩尺寸 + 8 解压尺寸（本身无压缩）
 *   record blocks       每块 zlib 的词条 HTML 正文；key 里的 record 偏移是解压后全流的绝对偏移
 */

/** ripemd128：纯 JS 实现（移植自 js-mdict/ripemd128.js，MIT，Feng Dihai），仅为 encrypt=2 解密服务 */
function ripemd128(dataBuffer) {
  const rotl = (x, n) => (x >>> (32 - n)) | (x << n);
  const S = [
    [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8],
    [7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12],
    [11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5],
    [11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12],
    [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6],
    [9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11],
    [9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5],
    [15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8],
  ];
  const X = [
    [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
    [7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8],
    [3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12],
    [1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2],
    [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12],
    [6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2],
    [15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13],
    [8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14],
  ];
  const K = [0x00000000,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0x50a28be6,0x5c4dd124,0x6d703ef3,0x00000000];
  const F = [
    (x,y,z) => x ^ y ^ z,
    (x,y,z) => (x & y) | (~x & z),
    (x,y,z) => (x | ~y) ^ z,
    (x,y,z) => (x & z) | (y & ~z),
  ];
  const hash = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  const bytes = dataBuffer.byteLength;
  const u8 = new Uint8Array(dataBuffer);
  const padding = new Uint8Array((bytes % 64 < 56 ? 56 : 120) - (bytes % 64));
  padding[0] = 0x80;
  const total = new Uint8Array(u8.length + padding.length + 8);
  total.set(u8); total.set(padding, u8.length);
  const bits = bytes << 3;
  new DataView(total.buffer).setUint32(total.length - 8, bits, true);
  new DataView(total.buffer).setUint32(total.length - 4, bits >>> 31, true);
  const x = new Uint32Array(total.buffer);
  for (let i = 0; i < x.length; i += 16) {
    let aa = hash[0], bb = hash[1], cc = hash[2], dd = hash[3];
    let aaa = aa, bbb = bb, ccc = cc, ddd = dd, t, tmp;
    for (t = 0; t < 64; ++t) {
      const r = ~~(t / 16);
      aa = rotl(aa + F[r](bb, cc, dd) + x[i + X[r][t % 16]] + K[r], S[r][t % 16]);
      tmp = dd; dd = cc; cc = bb; bb = aa; aa = tmp;
    }
    for (; t < 128; ++t) {
      const r = ~~(t / 16);
      const rr = ~~((63 - (t % 64)) / 16);
      aaa = rotl(aaa + F[rr](bbb, ccc, ddd) + x[i + X[r][t % 16]] + K[r], S[r][t % 16]);
      tmp = ddd; ddd = ccc; ccc = bbb; bbb = aaa; aaa = tmp;
    }
    ddd = hash[1] + cc + ddd;
    hash[1] = hash[2] + dd + aaa;
    hash[2] = hash[3] + aa + bbb;
    hash[3] = hash[0] + bb + ccc;
    hash[0] = ddd;
  }
  return new Uint8Array(hash.buffer);
}

/** encrypt=2 的密钥派生：块头 [4:8] 字节 + 固定尾巴异或 0x95 0x36，过 ripemd128 */
function deriveKey(packed) {
  const seed = new Uint8Array(8);
  seed.set(packed.slice(4, 8));
  seed[4] ^= 0x95; seed[5] ^= 0x36;
  return ripemd128(seed.buffer);
}

/** encrypt=2 的 XOR 流解密：prev 初值 0x36，i 取相对切片下标（原地修改） */
function fastDecrypt(buf, key) {
  let prev = 0x36;
  for (let i = 0; i < buf.length; ++i) {
    const raw = buf[i];
    buf[i] = (((raw >> 4) | (raw << 4)) & 0xff) ^ prev ^ (i & 0xff) ^ key[i % 16];
    prev = raw;
  }
}

/** 浏览器原生 zlib 解压（DecompressionStream 的 'deflate' 即 zlib 格式） */
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 解压一个 mdx 压缩块：[0:4] 类型标记（0x02=zlib）+ [4:8] adler32 + 压缩数据。
 * encrypted 仅 key block info 为真：先 XOR 解密再 inflate。
 * 信任边界：校验压缩类型与解压尺寸。
 */
async function unpackBlock(packed, expectSize, encrypted) {
  const type = packed[0];
  if (type !== 0x02) throw new Error(`不支持的压缩类型 0x${type.toString(16).padStart(2, '0')}（本模块只实现 zlib）`);
  const body = packed.slice(8);
  if (encrypted) fastDecrypt(body, deriveKey(packed));
  const out = await inflate(body);
  if (out.length !== expectSize) throw new Error(`解压尺寸不符：${out.length} != ${expectSize}`);
  return out;
}

/**
 * 创建 MDX 词典实例：全量解析 key 列表（小写化排序），lookup 二分查找。
 * @param {ArrayBuffer} arrayBuffer 整个 .mdx 文件（如 `await file.arrayBuffer()`）
 * @returns {Promise<{wordCount:number, lookup(word:string):Promise<string|null>}>}
 */
export async function createMdx(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const decoder = new TextDecoder('utf-8');
  const big64 = off => Number(dv.getBigUint64(off));

  // ---- header：长度 + UTF-16LE 属性串 ----
  const headerLen = dv.getUint32(0);
  const headerText = new TextDecoder('utf-16le').decode(u8.slice(4, 4 + headerLen));
  const attrs = {};
  for (const m of headerText.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  if (attrs.Encrypted !== '2') throw new Error(`不支持的加密标记 Encrypted="${attrs.Encrypted}"（只实现 encrypt=2 的固定解密）`);

  // ---- key header：5×8 字节 ----
  const kh = 4 + headerLen + 4; // 跳过 header adler32
  const numKeyBlocks = big64(kh);
  const numKeys = big64(kh + 8);
  const kbiStart = kh + 40 + 4; // 5×8 头 + adler32

  // ---- key block info（加密 + zlib）：只取每块的 压缩尺寸/解压尺寸 ----
  const keyInfo = await unpackBlock(u8.slice(kbiStart, kbiStart + big64(kh + 24)), big64(kh + 16), true);
  const kdv = new DataView(keyInfo.buffer, keyInfo.byteOffset);
  const keyBlocks = []; // {packSize, unpackSize}
  for (let p = 0, n = 0; n < numKeyBlocks; n++) {
    p += 8;                                   // 词条数
    p += 2 + kdv.getUint16(p) + 1;            // 首词：2 字节长（不含 \0）+ 词 + \0
    p += 2 + kdv.getUint16(p) + 1;            // 末词：同上
    const packSize = Number(kdv.getBigUint64(p)); p += 8;
    const unpackSize = Number(kdv.getBigUint64(p)); p += 8;
    keyBlocks.push({ packSize, unpackSize });
  }

  // ---- key blocks：全量解出词条 {lower, recordStart}；recordEnd 由下一项 recordStart 补齐 ----
  const kbStart = kbiStart + big64(kh + 24);
  const entries = [];
  let fileOff = kbStart;
  for (const { packSize, unpackSize } of keyBlocks) {
    const block = await unpackBlock(u8.slice(fileOff, fileOff + packSize), unpackSize, false);
    fileOff += packSize;
    const bdv = new DataView(block.buffer, block.byteOffset);
    for (let p = 0; p < block.length;) {
      const recordStart = Number(bdv.getBigUint64(p));
      const end = block.indexOf(0, p + 8);
      entries.push({ lower: decoder.decode(block.subarray(p + 8, end)).toLowerCase(), recordStart });
      p = end + 1;
    }
  }
  if (entries.length !== numKeys) throw new Error(`词条数不符：${entries.length} != ${numKeys}`);

  // ---- record header + record block info：块的文件位置与解压流累积偏移 ----
  const rh = kbStart + big64(kh + 32); // key 块总压缩尺寸之后
  const numRecordBlocks = big64(rh);
  const riStart = rh + 32;
  const rbFileStart = riStart + big64(rh + 16);
  const recordBlocks = []; // {fileStart, packSize, unpackAcc}
  let packAcc = 0, unpackAcc = 0, unpackTotal = 0;
  for (let i = 0, q = riStart; i < numRecordBlocks; i++) {
    const packSize = big64(q); q += 8;
    const unpackSize = big64(q); q += 8;
    recordBlocks.push({ fileStart: rbFileStart + packAcc, packSize, unpackSize, unpackAcc });
    packAcc += packSize; unpackAcc += unpackSize;
  }
  unpackTotal = unpackAcc;
  for (let i = 0; i < entries.length - 1; i++) entries[i].recordEnd = entries[i + 1].recordStart;
  entries[entries.length - 1].recordEnd = unpackTotal;

  // mdx 自带排序不可靠（大小写/多语言），照 js-mdict 策略：内存排序后二分
  entries.sort((a, b) => (a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : 0));

  // 单块缓存：词条访问有局部性，相邻词条不重复解压同一 record 块
  let cacheIdx = -1, cacheBlock = null;

  return {
    wordCount: entries.length,
    /** 排序后的小写词表（去重前；同词多条 record 相邻），供全量遍历 */
    words: () => entries.map(e => e.lower),
    /** 查词（大小写不敏感）；未命中返回 null */
    async lookup(word) {
      const lower = word.toLowerCase();
      let lo = 0, hi = entries.length - 1, mid = 0;
      while (lo <= hi) {
        mid = (lo + hi) >> 1;
        const k = entries[mid].lower;
        if (k < lower) lo = mid + 1;
        else if (k > lower) hi = mid - 1;
        else break;
      }
      if (entries[mid].lower !== lower) return null;
      const item = entries[mid];
      // 二分找 record 块：recordStart 落在 [unpackAcc, unpackAcc+unpackSize) 区间
      let l = 0, h = recordBlocks.length - 1, bi = 0;
      while (l <= h) {
        const m = (l + h) >> 1;
        if (item.recordStart >= recordBlocks[m].unpackAcc) { bi = m; l = m + 1; }
        else h = m - 1;
      }
      const rb = recordBlocks[bi];
      if (bi !== cacheIdx) {
        cacheBlock = await unpackBlock(u8.slice(rb.fileStart, rb.fileStart + rb.packSize), rb.unpackSize, false);
        cacheIdx = bi;
      }
      return decoder.decode(cacheBlock.subarray(item.recordStart - rb.unpackAcc, item.recordEnd - rb.unpackAcc));
    },
  };
}
