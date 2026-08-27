import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';

export default defineConfig({
  plugins: [
    vue(),
    viteSingleFile(),
    // dev 下 fetch("/src/assets/ciyuan.mdx") 会被 transform 管线当 JS 模块伺服(返回 export default 字符串),
    // 这里抢在它前面把 .mdx 按原始字节回给浏览器。仅 dev 需要:构建产物里是真实静态文件/内联 data URL。
    {
      name: 'serve-mdx-raw',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.includes('?') || !req.url.endsWith('.mdx')) return next();
          // 按请求路径映射回项目内文件,不硬编码词典位置
          const file = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
          res.setHeader('Content-Type', 'application/octet-stream');
          fs.createReadStream(file).pipe(res);
        });
      },
    },
  ],
  base: './',
  // .mdx 不在 Vite 内置静态资源类型里,dev 下会被当 JS 模块解析而报错;注册为资产后 ?url 导入三轨一致
  assetsInclude: ['**/*.mdx'],
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
