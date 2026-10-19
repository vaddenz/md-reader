import { expect, test } from '@playwright/test';
import { configureAndSync, installGitHubMock } from './fixtures';

/**
 * 返回语义（全站统一，spec §2.6）：返回/取消 = 回到进入前的页面；
 * 无应用内历史（直接打开/冷启动）时回首页。
 */

test('返回语义：搜索取消回到来源页（阅读页/首页）', async ({ page }) => {
  await configureAndSync(page);

  // 阅读页 → ⋯搜索 → 取消 → 回阅读页（问题一）
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page).toHaveURL(/#\/search/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(/#\/doc\//);
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  // 首页 → 搜索文档 → 取消 → 回首页
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole('link', { name: '搜索文档' }).click();
  await expect(page).toHaveURL(/#\/search/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('返回语义：设置返回回到来源页（阅读页/首页）', async ({ page }) => {
  await configureAndSync(page);

  // 阅读页 → ⋯设置 → 返回 → 回阅读页
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/doc\//);
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  // 首页 → ⚙ → 返回 → 回首页
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('返回语义：搜索结果进文档，顶栏返回回到搜索页', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: '搜索文档' }).click();
  await page.getByLabel('搜索关键词').fill('MVCC');
  // 结果点击选择器以 search.spec 既有用法为准（.search-result-title）
  await page.locator('.search-result-title').first().click();
  await expect(page).toHaveURL(/#\/doc\//);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/search\?q=MVCC/);
});

test('返回语义：直接打开文档（无应用内历史）返回回首页', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token' });
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
});
