import { expect, test } from '@playwright/test';
import { configureAndSync } from './fixtures';

/** PWA 基座（T23）：Service Worker 注册/接管与预缓存、manifest 可达、noindex 防收录。 */

test('PWA：Service Worker 注册、接管页面并建立预缓存', async ({ page }) => {
  await configureAndSync(page);

  // ready 在 SW 激活时兑现（未注册则永不 resolve）
  const active = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active !== null));
  expect(active).toBe(true);

  // clientsClaim：当前页面无需二次刷新即被接管
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''))
    .toContain('/md-reader/sw.js');

  // 预缓存已建立（离线整页刷新的前提）
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.some((name) => name.startsWith('workbox-precache'))).toBe(true);
});

test('PWA：manifest 存在且可 200 获取；robots noindex 防收录', async ({ page }) => {
  await configureAndSync(page);

  const link = page.locator('link[rel=manifest]');
  await expect(link).toHaveCount(1);
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).not.toBe('');

  // page.request 不经 page.route，直接取预览服务器的静态资源
  const res = await page.request.get(new URL(href, page.url()).href);
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.name).toBe('知识库');
  expect(manifest.display).toBe('standalone');

  // 图标：any + maskable 都要有，且实际可获取
  const icons: Array<{ src: string; sizes: string; purpose?: string }> = manifest.icons;
  expect(icons.some((icon) => icon.sizes === '192x192')).toBe(true);
  expect(icons.some((icon) => icon.sizes === '512x512')).toBe(true);
  const maskable = icons.find((icon) => (icon.purpose ?? '').split(/\s+/).includes('maskable'));
  expect(maskable).toBeTruthy();
  if (!maskable) throw new Error('manifest 缺少 maskable 图标');
  const maskableRes = await page.request.get(new URL(maskable.src, page.url()).href);
  expect(maskableRes.status()).toBe(200);

  // iOS 主屏图标
  const apple = page.locator('link[rel="apple-touch-icon"]');
  await expect(apple).toHaveCount(1);
  const appleHref = (await apple.getAttribute('href')) ?? '';
  const appleRes = await page.request.get(new URL(appleHref, page.url()).href);
  expect(appleRes.status()).toBe(200);

  // 浏览器标签页 favicon
  const favicon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(favicon).toHaveCount(1);
  const faviconHref = (await favicon.getAttribute('href')) ?? '';
  const faviconRes = await page.request.get(new URL(faviconHref, page.url()).href);
  expect(faviconRes.status()).toBe(200);

  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
});

test('PWA：CSP meta 存在且锁定 connect-src（spec §9）', async ({ page }) => {
  await configureAndSync(page);

  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  const content = (await csp.getAttribute('content')) ?? '';
  expect(content).toContain("default-src 'self'");
  expect(content).toContain("connect-src 'self' https:");
  expect(content).toContain("script-src 'self'");
  expect(content).toContain("object-src 'none'");
  expect(content).toContain("base-uri 'none'");
});

test('字体：不进入 SW 预缓存清单，文件可访问', async ({ page }) => {
  await page.goto('./');
  const sw = await page.request.get('./sw.js');
  expect(sw.ok()).toBeTruthy();
  const body = await sw.text();
  // 预缓存清单不得包含字体文件（用具体文件名断言，避免受生成代码格式影响）
  expect(body).not.toContain('lxgw-neo-xihei-screen-full');
  expect(body).not.toContain('noto-serif-sc-variable');
  const font = await page.request.get('./fonts/lxgw-neo-xihei-screen-full.woff2');
  expect(font.status()).toBe(200);
});
