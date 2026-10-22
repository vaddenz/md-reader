import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/md-reader/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-192.png',
        'icon-maskable-512.png',
      ],
      manifest: {
        name: '知识库', short_name: '知识库', lang: 'zh-CN',
        description: '个人自用：私有仓库 Markdown 阅读器',
        start_url: './', scope: './', display: 'standalone',
        theme_color: '#1F3FD4', background_color: '#FAF9F6',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/fonts/**'],
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mdreader-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // 本地朗读 WASM 运行时：按需加载后长期缓存；模型文件走 OPFS，不在这里。
            urlPattern: /\/tts\/runtime\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mdreader-tts-runtime',
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
