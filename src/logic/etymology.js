// 词源查询（纯逻辑层）
// 词典是 src/assets/ciyuan.mdx（~3.5MB），`?url` 导入三轨全兼容：
// dev 由 dev server 伺服；PWA 构建成 assets/ciyuan-<hash>.mdx（runtime CacheFirst）；
// 单文件构建被 vite-plugin-singlefile 内联成 base64 data URL，fetch(data:) 在 file:// 下可用。
import mdxUrl from '../assets/mdx/ciyuan.mdx?url';
import { lemmatizeChain } from './lemmatize.js';
import { createMdx } from './mdx.js';

let dict = null;          // createMdx 实例；false = 不可用（fetch 失败等），静默降级
let initPromise = null;
const cache = new Map();  // 词（小写）→ 词条 HTML | null

async function ensureDict() {
  if (dict) return dict;
  if (dict === false) return null;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        dict = await createMdx(await (await fetch(mdxUrl)).arrayBuffer());
      } catch {
        dict = false;
      }
    })();
  }
  await initPromise;
  return dict || null;
}

/** 后台预热：解析一次词典（~0.5s，一次性），之后所有查询同步走缓存秒出。返回词典实例或 null */
export function prewarm() {
  return ensureDict();
}

/** 去掉词条开头的 MDict 包装：大字词头（<font size=+2>词</font>）+ 灰色虚线横线（<hr>），正文从首个锚点/正文起 */
function stripWrapper(html) {
  // 开头形如 <a name="_topX">…<font size=+2>word</font>\r\n<hr style=…>，去掉到 <hr> 为止
  const hr = html.indexOf('<hr');
  return hr >= 0 ? html.slice(html.indexOf('>', hr) + 1) : html;
}

/**
 * 查词源：先查原词（小写），未命中沿 lemmatizeChain 派生链逐个试
 * （dangerously → dangerous → danger），命中即停。结果缓存。
 * @returns {Promise<string|null>} 词条 HTML 片段；无词条或词典不可用时为 null
 */
export async function lookupEtymology(word) {
  const lower = word.toLowerCase();
  if (cache.has(lower)) return cache.get(lower);
  const d = await ensureDict();
  if (!d) return null;
  let html = await d.lookup(lower);
  if (html == null) {
    for (const cand of lemmatizeChain(lower)) {
      html = await d.lookup(cand);
      if (html != null) break;
    }
  }
  if (html != null) html = stripWrapper(html);
  cache.set(lower, html);
  return html;
}
