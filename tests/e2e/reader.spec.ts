import { expect, test, type Page } from '@playwright/test';
import { installGitHubMock, type GitHubMock } from './fixtures';

const TOKEN = 'ghp_e2e_fake_token';

/** 无 Token 引导 → 表单配置 Token → 首页出现 3 篇文档（自动同步完成）。 */
async function configureAndSync(page: Page): Promise<GitHubMock> {
  const mock = await installGitHubMock(page);
  await page.goto('./');
  await page.waitForURL(/#\/setup$/);
  await expect(page.getByRole('heading', { name: '配置访问 Token' })).toBeVisible();

  await page.getByPlaceholder('粘贴 Fine-grained PAT').fill(TOKEN);
  await page.getByRole('button', { name: '验证并保存' }).click();

  await page.waitForURL(/#\/$/);
  await expect(page.locator('.tree-item')).toHaveCount(3);
  await expect(page.getByText(/上次同步/)).toBeVisible();
  return mock;
}

test('P2 全链路：引导配置 → 自动同步 → mermaid/锚点/返回来源/滚动恢复/系统返回', async ({ page }) => {
  const mock = await configureAndSync(page);
  await expect.poll(() => mock.syncCalls()).toBe(1); // 自动同步确定触发，且不重复触发

  // 打开 深挖/b.md：mermaid 占位懒渲染为 svg
  await page.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.locator('.md-mermaid svg')).toBeVisible();

  // b.md 中的互链回 a.md → 「返回来源」出现
  await page.getByRole('link', { name: '文档 A', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回来源' })).toBeVisible();

  // 页内锚点（T13 修复的回归覆盖）：文档仍在（不是 404 页）且已滚动
  await page.getByRole('link', { name: /跳到/ }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page).toHaveURL(/#\/doc\//);
  await expect(page.locator('body')).not.toContainText('Unexpected Application Error');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  // 滚到文末互链处，记录滚动位置后点互链去 b.md
  const inApp = page.locator('.doc-content a.in-app-link').last();
  await inApp.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(300);
  await inApp.click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回来源' })).toBeVisible();

  // 「返回来源」→ 回到 a.md，滚动位置还原（±50px）
  await page.getByRole('button', { name: '返回来源' }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 50, before);

  // 系统返回（Android 返回手势的等价物）→ 回到 b.md 条目；该条目非互链跳入，无「返回来源」
  await page.goBack();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回来源' })).toHaveCount(0);
});

test('阅读页双抽屉：文件树高亮当前文档、点击跳转、与目录抽屉互斥', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  // 目录抽屉打开 → Esc 关闭（外壳行为）
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '目录' })).toHaveCount(0);

  // 文件树抽屉：3 篇文档、当前文档高亮
  await page.getByRole('button', { name: '文件' }).click();
  const drawer = page.getByRole('dialog', { name: '全部文档' });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.tree-item')).toHaveCount(3);
  await expect(drawer.locator('.tree-current')).toHaveText('a');
  await expect(drawer.locator('.tree-current')).toHaveAttribute('aria-current', 'page');

  // 点抽屉里的 深挖/b.md → 跳转、抽屉关闭、且不显示「返回来源」（抽屉跳转不是互链）
  await drawer.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '全部文档' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回来源' })).toHaveCount(0);
});

test('已配置 Token（localStorage 预置）：启动不再跳转引导页', async ({ page }) => {
  await installGitHubMock(page, { token: TOKEN });
  await page.goto('./');
  await expect(page.getByRole('link', { name: '搜索文档' })).toBeVisible();
  expect(page.url()).not.toContain('#/setup');
});

test('Token 无效（401）：留在引导页提示错误，不写入 Token', async ({ page }) => {
  await installGitHubMock(page, { failAuth: true });
  await page.goto('./');
  await page.waitForURL(/#\/setup$/);

  await page.getByPlaceholder('粘贴 Fine-grained PAT').fill('bad-token');
  await page.getByRole('button', { name: '验证并保存' }).click();

  await expect(page.getByRole('alert')).toHaveText('Token 无效或已过期');
  await expect(page).toHaveURL(/#\/setup$/);
  expect(await page.evaluate(() => localStorage.getItem('mdreader.token'))).toBeNull();
});

test('网络不可用：提示错误且停留在引导页', async ({ page }) => {
  await installGitHubMock(page, { failNetwork: true });
  await page.goto('./');
  await page.waitForURL(/#\/setup$/);

  await page.getByPlaceholder('粘贴 Fine-grained PAT').fill('any-token');
  await page.getByRole('button', { name: '验证并保存' }).click();

  await expect(page.getByRole('alert')).toHaveText('网络不可用');
  await expect(page).toHaveURL(/#\/setup$/);
});
