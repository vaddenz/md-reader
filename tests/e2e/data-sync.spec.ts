import { expect, test } from '@playwright/test';
import { installGitHubMock } from './fixtures';

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

test('跨设备同步：默认仅手动，测试连接与手动同步', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token_1234' });
  await page.route('https://sync.example/rest/v1/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('./#/settings/sync');
  await page.getByLabel('接口地址').fill('https://sync.example/rest/v1');
  await page.getByLabel('JWT').fill(makeJwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 86400 }));

  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText(/连接成功/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mdreader.syncConfig'))).toBeNull();

  await page.getByRole('button', { name: '保存并启用' }).click();
  await expect(page.getByText('仅手动同步')).toBeVisible();
  await expect(page.getByLabel('自动同步')).not.toBeChecked();

  await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.getByText(/拉取/)).toBeVisible();
});

test('清除全部数据会清掉同步配置', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token_1234' });
  // 首页加载前预置同步配置（about:blank 上无法访问 localStorage）。
  await page.addInitScript(() => localStorage.setItem('mdreader.syncConfig', JSON.stringify({
    version: 1, enabled: true, autoSync: false, backend: 'neon',
    values: { endpoint: 'https://sync.example/rest/v1', token: 'x' },
  })));
  await page.goto('./#/settings/data');
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '清除全部数据' }).click();
  await expect(page.getByRole('heading', { name: '配置访问 Token' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mdreader.syncConfig'))).toBeNull();
});
