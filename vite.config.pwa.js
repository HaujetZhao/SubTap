import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// PWA 构建配置:用于 GitHub Pages 在线版(可安装、可离线)。
// 与 vite.config.js(单文件构建,给 Release 的 SubTap.html)分开,
// 因为 PWA 的 service worker 和 manifest 必须是独立外链文件,无法内联进单 HTML。
// ponytail: 两套配置而非参数化,避免 if/else 污染主配置,各自清晰。
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      // prompt 而非 autoUpdate:autoUpdate 会在发现新版时 skipWaiting + 强制 reload,
      // 手机上网络差时刚打开就被迫重新下载全部预缓存、体验极差。
      // prompt 且不弹提示 UI:新版仅在后台预缓存,彻底关闭应用后下次冷启动才生效。
      registerType: 'prompt',
      manifest: {
        name: 'SubTap · 字幕点读器',
        short_name: 'SubTap',
        description: '字幕点读学英语:载入字幕+音视频,点句即播,词库分级着色。',
        theme_color: '#5a8c6a',
        background_color: '#5a8c6a',
        display: 'standalone',
        start_url: './',
        // PNG 图标(放 public/,构建时拷到 dist/ 根):Android/iOS 安装都需要位图,
        // SVG 在 iOS Safari「添加到主屏幕」会显示空白。maskable 留安全区防被遮罩裁切。
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // 缓存所有构建产物,实现完全离线可用。
        // 示例音频(sample.aac,~1.5MB)不预缓存:打开页面时不下载,点「载入示例」时 video.src 触发按需取;
        // 首次取回后用 CacheFirst 缓存,二次点秒开。字幕 sample.srt 走 ?raw 内联进 JS(~3.5KB),随页面加载。
        // VAD 的 wasm/onnx(合计 ~14MB)同理不预缓存:首次推理时按需取,CacheFirst 永不过期。
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        runtimeCaching: [
          { urlPattern: /\.aac$/, handler: 'CacheFirst', options: { cacheName: 'sample-audio' } },
          { urlPattern: /\/(ort|ort-asyncify|models)\//, handler: 'CacheFirst', options: { cacheName: 'vad-assets' } },
          // 词源词典(~3.5MB)不预缓存:首次查词源时按需取,CacheFirst 缓存后离线可用(同 VAD 资产策略)。
          { urlPattern: /ciyuan\.mdx$/, handler: 'CacheFirst', options: { cacheName: 'ciyuan-dict' } },
        ],
      },
    }),
  ],
  base: './',
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  // 词源词典 public/ciyuan.mdx(~3.5MB)不进 bundler:运行时 fetch,首次取回 CacheFirst 缓存。
  build: {
    commonjsOptions: {
      dynamicRequireTargets: ['node_modules/subsrt/lib/format/*.js'],
    },
  },
});
