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

test('浏览器标签：锁被拒时自动进入全屏并重试；回竖屏退出全屏且不打扰', async ({ page }) => {
  // 平台事实：lock 需要全屏上下文——未全屏一律拒绝；requestFullscreen 设置伪 fullscreenElement。
  await page.addInitScript(() => {
    const lockCalls: string[] = [];
    const fsCalls: string[] = [];
    (window as any).__lockCalls = lockCalls;
    (window as any).__fsCalls = fsCalls;
    let fsEl: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    // init script 执行时 documentElement 尚不存在：在原型上挂 stub。
    (Element.prototype as any).requestFullscreen = function () {
      fsCalls.push('request');
      fsEl = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    (Document.prototype as any).exitFullscreen = function () {
      fsCalls.push('exit');
      fsEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    Object.defineProperty(screen, 'orientation', {
      value: {
        lock: (t: string) => { lockCalls.push(t); return fsEl ? Promise.resolve() : Promise.reject(new Error('requires fullscreen')); },
        unlock: () => Promise.resolve(),
      },
    });
  });
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '横屏' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls)).toContain('landscape-primary');
  await expect.poll(() => page.evaluate(() => (window as any).__fsCalls)).toContain('request');
  await expect(page.getByText(/不支持方向锁定/)).toHaveCount(0);

  await page.getByRole('button', { name: '横屏' }).click(); // 回竖屏
  await expect.poll(() => page.evaluate(() => (window as any).__fsCalls)).toContain('exit');
  await expect(page.getByText(/不支持方向锁定/)).toHaveCount(0);
});

test('退出全屏后重新应用锁定（静默）', async ({ page }) => {
  await stubOrientation(page);
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls.length)).toBeGreaterThan(0); // 启动锁定已完成
  const before = await page.evaluate(() => (window as any).__lockCalls.length as number);
  await page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls.length)).toBe(before + 1);
});

test('设置页三态单选与头部同步', async ({ page }) => {
  await stubOrientation(page);
  await configureAndSync(page);
  await page.goto('./#/settings');
  await page.getByRole('radio', { name: '横屏', exact: true }).check();
  await expect.poll(() => page.evaluate(() => (window as any).__lockCalls)).toContain('landscape-primary');
});
