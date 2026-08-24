// 从 node_modules/onnxruntime-web 拷 wasm 运行时到 public/ort/。
// jsep 一对 = webgpu 后端;asyncify 一对 = 无 gpu 设备回退 CPU wasm 用(移动端实测必需)。
// 两份都在时,有 gpu 走 jsep、无 gpu ort 自动选 asyncify。
// 浏览器运行时按 URL fetch 这些文件,node_modules 不上网页服务器,故需落到 public/。
// gitignore 掉了 public/ort/,每次 dev/build/CI 由本脚本按需生成。
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules/onnxruntime-web/dist');
const dst = join(root, 'public/ort');

await rm(dst, { recursive: true, force: true });
await mkdir(dst, { recursive: true });
for (const f of [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
]) {
  await cp(join(src, f), join(dst, f));
  console.log('synced', f);
}
