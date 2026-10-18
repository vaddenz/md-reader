import { expect, test } from '@playwright/test';
import { configureAndSync, countFiles, installGitHubMock } from './fixtures';

const AUTH_TEXT = '登录已过期，请重新授权（本地缓存已保留）';

/**
 * 失效授权（T23）：引导页 401 提示；已有缓存后同步遇 401 → 跳 `#/setup?reauth=1`
 * 提示重新授权且本地缓存保留（T22 行为钉住）；另附限流（403）toast 覆盖。
 */
test('未授权（401）：引导页提示「Token 无效或已过期」且不写入；换有效 Token 后进入首页', async ({ page }) => {
  const mock = await installGitHubMock(page, { failAuth: true });
  await page.goto('./');
  await page.waitForURL(/#\/setup$/);

  await page.getByPlaceholder('粘贴 Fine-grained PAT').fill('ghp_e2e_bad_token');
  await page.getByRole('button', { name: '验证并保存' }).click();
  await expect(page.getByRole('alert')).toHaveText('Token 无效或已过期');
  await expect(page).toHaveURL(/#\/setup$/);
  expect(await page.evaluate(() => localStorage.getItem('mdreader.token'))).toBeNull();

  // mock 恢复健康后换有效 Token：正常进入首页并完成自动同步
  mock.setFailAuth(false);
  await page.getByPlaceholder('粘贴 Fine-grained PAT').fill('ghp_e2e_fake_token');
  await page.getByRole('button', { name: '验证并保存' }).click();
  await page.waitForURL(/#\/$/);
  await expect(page.locator('.tree-item')).toHaveCount(3);
});

test('同步遇 401：跳转 #/setup?reauth=1 提示重新授权，本地缓存保留', async ({ page }) => {
  const mock = await configureAndSync(page);

  // 缓存就绪后令鉴权失效，触发一次同步
  mock.setFailAuth(true);
  await page.getByRole('button', { name: '更新目录' }).click();

  await page.waitForURL(/#\/setup\?reauth=1$/);
  await expect(page.locator('.setup-reauth')).toHaveText(AUTH_TEXT);
  await expect(page.locator('.toast')).toHaveText(AUTH_TEXT); // T22：toast 替代 window.alert

  // 缓存保留：库仍在、3 篇文档记录未丢、Token 未被清除（可重新授权后继续用）
  const dbs = await page.evaluate(() => indexedDB.databases());
  expect(dbs.map((d) => d.name)).toContain('mdreader');
  await expect.poll(() => countFiles(page)).toBe(3);
  expect(await page.evaluate(() => localStorage.getItem('mdreader.token'))).toBe('ghp_e2e_fake_token');
});

test('限流（403）：同步失败提示「GitHub 请求超限，N 分钟后重试」', async ({ page }) => {
  await configureAndSync(page);

  // 覆盖目录树请求为 403 限流：跨域响应须显式暴露 x-ratelimit-* 头，应用才能读到（T22 实测）
  const resetAt = Math.ceil((Date.now() + 150_000) / 1000);
  await page.route(/\/git\/trees\//, (route) =>
    route.fulfill({
      status: 403,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetAt),
      },
      body: JSON.stringify({ message: 'API rate limit exceeded' }),
    }),
  );

  await page.getByRole('button', { name: '更新目录' }).click();
  await expect(page.locator('.toast')).toHaveText('GitHub 请求超限，3 分钟后重试');
  await expect(page.locator('.sync-badge-text')).toHaveText('同步失败');
});
