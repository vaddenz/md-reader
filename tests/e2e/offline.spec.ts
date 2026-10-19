import { expect, test } from '@playwright/test';
import { configureAndSync } from './fixtures';

/**
 * 离线全链路（T23）：同步完成 → 断网整页刷新 → 应用壳由 Service Worker 预缓存供给、
 * 内容来自 IndexedDB；恢复在线后横幅消失并自动补同步。
 */
test('离线：已同步文档可读、搜索可用；恢复在线后自动同步', async ({ page, context }) => {
  const mock = await configureAndSync(page);
  expect(mock.syncCalls()).toBe(1);

  // 首次访问完成 SW 接管（clientsClaim）后才具备离线启动能力：此后刷新由预缓存供壳
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  // 断网 + 整页刷新：不触网也能启动
  await context.setOffline(true);
  await page.reload();

  const banner = page.locator('.offline-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('离线模式 · 上次同步');
  await expect(page.locator('.tree-item')).toHaveCount(3);

  // 已同步文档：正文来自 IndexedDB，离线可读
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  // 离线搜索：命中来自 IndexedDB 缓存正文
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('link', { name: '搜索文档' }).click();
  await expect(page).toHaveURL(/#\/search\?q=$/);
  await page.getByLabel('搜索关键词').fill('MVCC');
  await expect(page.locator('.search-result')).toHaveCount(2);

  // 离线期间不发起同步（自动同步等恢复在线再跑）
  expect(mock.syncCalls()).toBe(1);

  // 恢复在线：横幅消失 + 自动补同步（目录树请求再次发出）
  await context.setOffline(false);
  await expect(page.locator('.offline-banner')).toHaveCount(0);
  await expect.poll(() => mock.syncCalls()).toBe(2);
});
