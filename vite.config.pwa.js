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
      registerType: 'autoUpdate',
      manifest: {
        name: '字幕点读器 SubTap',
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
        // 缓存所有构建产物,实现完全离线可用
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm}'],
      },
    }),
  ],
  base: './',
  build: {
    commonjsOptions: {
      dynamicRequireTargets: ['node_modules/subsrt/lib/format/*.js'],
    },
  },
});
