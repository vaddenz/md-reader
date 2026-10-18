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

  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
});

test('PWA：CSP meta 存在且锁定 connect-src（spec §9）', async ({ page }) => {
  await configureAndSync(page);

  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  const content = (await csp.getAttribute('content')) ?? '';
  expect(content).toContain("default-src 'self'");
  expect(content).toContain("connect-src 'self' https://api.github.com");
  expect(content).toContain("script-src 'self'");
  expect(content).toContain("object-src 'none'");
  expect(content).toContain("base-uri 'none'");
});
