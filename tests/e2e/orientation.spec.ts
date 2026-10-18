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
