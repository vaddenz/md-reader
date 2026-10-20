import { expect, test } from '@playwright/test';

/**
 * 回归：v1 → v2 升级被旧页面连接阻塞时，首页不能永远停在「加载中…」。
 * 约 6 秒超时后应给出可重试提示；释放旧连接后点击重试即可恢复。
 */
test('数据库升级被旧连接阻塞：超时提示 + 重试恢复', async ({ page, context }) => {
  // 旧页面（模拟更新前仍打开的标签页 / PWA 实例）持有 mdreader v1 连接
  const old = await context.newPage();
  await old.goto('./favicon.svg');
  await old.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('mdreader', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onsuccess = () => {
          (window as unknown as { __held?: IDBDatabase }).__held = req.result;
          resolve();
        };
        req.onerror = () => reject(req.error);
      }),
  );

  // 新版本页面：有 Token（跳过引导页），但无仓库配置（不触发同步）
  await page.addInitScript(() => {
    try { localStorage.setItem('mdreader.token', 'ghp_e2e_fake_token'); } catch { /* ignore */ }
  });
  await page.goto('./');

  const alert = page.getByRole('alert').filter({ hasText: '本地数据库被其它页面占用' });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('alert')).not.toHaveText(/加载中/);
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();

  // 释放旧连接 → 重试 → 恢复为空态（无文档、无配置）
  await old.evaluate(() => {
    (window as unknown as { __held?: IDBDatabase }).__held?.close();
  });
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('暂无文档，点「更新目录」同步仓库')).toBeVisible({ timeout: 15_000 });
});
