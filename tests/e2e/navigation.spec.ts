import { expect, test } from '@playwright/test';
import { configureAndSync, installGitHubMock } from './fixtures';

/**
 * 返回语义（spec §2.6）：搜索「取消」与设置「返回」= 回到进入前的页面；
 * 阅读页顶栏「返回」= 回首页（多标签下不回上一个标签，用户验收裁定 2026-10-20）；
 * 无应用内历史（直接打开/冷启动）时均回首页。
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

  // 阅读页顶栏返回 → 回首页（不是来源页）
  await page.getByRole('button', { name: '返回首页' }).click();
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

  // 阅读页顶栏返回 → 回首页；首页 → ⚙ → 返回 → 回首页
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('返回语义：搜索结果进文档，顶栏返回回到首页（用户验收裁定）', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: '搜索文档' }).click();
  await page.getByLabel('搜索关键词').fill('MVCC');
  // 结果点击选择器以 search.spec 既有用法为准（.search-result-title）
  await page.locator('.search-result-title').first().click();
  await expect(page).toHaveURL(/#\/doc\//);
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('返回语义：直接打开文档（无应用内历史）返回回首页', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token' });
  await page.goto('./#/doc/a.md');
  // 缺失态正文里也有「返回首页」按钮：用顶栏类名钉到 doc-back，避免同名歧义。
  await expect(page.locator('.doc-back')).toBeVisible();
  await page.locator('.doc-back').click();
  await expect(page).toHaveURL(/#\/$/);
});
