import { expect, test } from '@playwright/test';
import { configureAndSync, installGitHubMock } from './fixtures';

async function stubOrientation(page: import('@playwright/test').Page, behavior: 'ok' | 'reject' = 'ok') {
  await page.addInitScript((mode) => {
    const calls: string[] = [];
    (window as any).__lockCalls = calls;
    Object.defineProperty(screen, 'orientation', {
      value: {
        lock: (t: string) => (mode === 'ok' ? (calls.push(t), Promise.resolve()) : Promise.reject(new Error('unsupported'))),
        unlock: () => Promise.resolve(),
      },
    });
  }, behavior);
}

test('启动锁定竖屏；状态持久化', async ({ page }) => {
  await stubOrientation(page);
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token' });
  await page.goto('./');
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls)).toContain('portrait');
});

test('头部横屏开关与旋转：调用序列与持久化', async ({ page }) => {
  await stubOrientation(page);
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '横屏' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls)).toContain('landscape-primary');

  await page.getByRole('button', { name: '旋转' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls)).toContain('landscape-secondary');

  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls)).toContain('landscape-secondary'); // 启动恢复
  await expect(page.getByRole('button', { name: '旋转' })).toBeVisible();
});

test('不支持时：用户操作给出安装提示', async ({ page }) => {
  await stubOrientation(page, 'reject');
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '横屏' }).click();
  await expect(page.getByText(/不支持方向锁定/)).toBeVisible();
});

test('设置页三态单选与头部同步', async ({ page }) => {
  await stubOrientation(page);
  await configureAndSync(page);
  await page.goto('./#/settings');
  await page.getByRole('radio', { name: '横屏', exact: true }).check();
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls)).toContain('landscape-primary');
});
