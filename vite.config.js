import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: './',
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  server: {
    // 跨域隔离:开启后 ort 的 wasm 多线程才可用(bench-vad.html 里测 threads 变体)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    // subsrt 用动态 require('./format/'+name+'.js') 加载各格式处理器,
    // 生产构建时 @rollup/plugin-commonjs 无法静态解析,需显式声明这些目标,
    // 否则打包后运行时会抛 "Could not dynamically require" 导致整页空白。
    commonjsOptions: {
      // 大小写敏感:Windows 下 cwd 是 d:/ 但依赖解析成 D:/,必须用绝对路径匹配盘符
      // (本机开发路径;CI 在 Linux 上 cwd 小写匹配默认 root,不走这项)
      dynamicRequireRoot: 'D:/repos/SubTap/node_modules/subsrt/lib',
      dynamicRequireTargets: ['node_modules/subsrt/lib/format/*.js'],
    },
  },
});
