// scripts/gen-icons.mjs — 从 scripts/assets/icon.svg 渲染 PWA / iOS 图标。
// 依赖 Playwright 的 Chromium（与 e2e 共用）：首次运行前需 `npx playwright install chromium`。
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const source = readFileSync(new URL('./assets/icon.svg', import.meta.url), 'utf8');
const outDir = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(outDir, { recursive: true });

if (!source.includes('<g id="art">')) {
  throw new Error('scripts/assets/icon.svg 缺少 <g id="art"> 标记，无法生成 maskable 版本');
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 512, height: 512 },
  deviceScaleFactor: 1,
});

/**
 * 渲染一个方形图标。
 * maskable 版本只缩放书本主体，背景仍铺满画布，避免系统裁切时露出透明边。
 */
async function render(size, file, { maskable = false } = {}) {
  const svg = maskable
    ? source.replace(
        '<g id="art">',
        '<g id="art" transform="translate(256 256) scale(0.9) translate(-256 -256)">',
      )
    : source;

  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:#F2EFE7;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
  );
  await page.screenshot({ path: `${outDir}${file}`, type: 'png' });
  console.log(`public/${file} 已生成 (${size}×${size})`);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(192, 'icon-maskable-192.png', { maskable: true });
await render(512, 'icon-maskable-512.png', { maskable: true });
await render(180, 'apple-touch-icon.png');

await browser.close();
