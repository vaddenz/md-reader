import { expect, test } from '@playwright/test';
import { configureAndSync } from './fixtures';

test('搜索直达：结果列表 → 打开第 2 条 → 命中高亮并滚动到命中处', async ({ page }) => {
  await configureAndSync(page);

  await page.goto('./#/search?q=MVCC');
  const results = page.locator('.search-result');
  await expect(results.first()).toBeVisible();
  expect(await results.count()).toBeGreaterThanOrEqual(2);

  // 第 2 条为 a.md（命中 1 处、位于文末）；片段中的命中词已高亮
  await expect(results.nth(1).locator('.search-result-title')).toHaveText('文档 A');
  await expect(results.nth(1).locator('.search-snippet mark').first()).toBeVisible();

  await results.nth(1).locator('.search-result-title').click();

  await expect(page).toHaveURL(/#\/doc\/a\.md\?q=MVCC/);
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page.locator('mark.search-mark').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('搜索页输入即时搜索：空查询提示 → 输入后防抖出结果', async ({ page }) => {
  await configureAndSync(page);

  // 首页入口 → 空 q（不预填）：展示输入提示
  await page.getByRole('link', { name: '搜索文档' }).click();
  await expect(page).toHaveURL(/#\/search\?q=$/);
  await expect(page.locator('.search-hint')).toBeVisible();
  await expect(page.locator('.search-result')).toHaveCount(0);

  // 输入 → 200ms 防抖写回 URL → 结果列表（长文档命中 20 处排第一）
  await page.getByLabel('搜索关键词').fill('MVCC');
  await expect(page).toHaveURL(/q=MVCC/);
  await expect(page.locator('.search-result')).toHaveCount(2);
  await expect(page.locator('.search-result-title').first()).toHaveText('长文档');
});
