import { expect, test, type Page } from '@playwright/test';
import { installGitHubMock, readKv, readStore, writeKv } from './fixtures';

const ENDPOINT = 'https://sync.example/rest/v1';
const DEFAULT_SCOPE = 'your-name/your-notes@main';
const NOW = 1_760_000_000_000;

interface RemoteRow {
  scope: string;
  collection: string;
  record_id: string;
  payload: unknown;
  updated_at: number;
  deleted: boolean;
  device_id: string;
  server_updated_at: string;
}

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const JWT = makeJwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 86400 * 365 });

/** 预置同步配置（默认仅手动），避免每个用例重复填表。 */
async function seedSyncConfig(page: Page): Promise<void> {
  await page.addInitScript((config) => {
    localStorage.setItem('mdreader.syncConfig', JSON.stringify(config));
  }, {
    version: 1,
    enabled: true,
    autoSync: false,
    backend: 'neon',
    values: { endpoint: ENDPOINT, token: JWT },
  });
}

function isPush(method: string, pathname: string): boolean {
  return method === 'POST' && pathname === '/rest/v1/rpc/sync_upsert';
}

/** 删除 kv 键（模拟本机数据丢失 / 新设备）。 */
async function deleteKv(page: Page, key: string): Promise<void> {
  const ok = await page.evaluate(
    (k) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const del = db.transaction('kv', 'readwrite').objectStore('kv').delete(k);
            del.onsuccess = () => { resolve(true); db.close(); };
            del.onerror = () => { resolve(false); db.close(); };
          } catch {
            resolve(false);
            db.close();
          }
        };
      }),
    key,
  );
  if (!ok) throw new Error(`deleteKv 失败：${key}`);
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
  await page.getByLabel('接口地址').fill(ENDPOINT);
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

test('跨设备同步：手动同步推送本地进度记录体', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token_1234' });
  await seedSyncConfig(page);
  const pushes: { p_records: { scope: string; collection: string; record_id: string; payload: unknown }[] }[] = [];
  await page.route('https://sync.example/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (isPush(request.method(), url.pathname)) {
      pushes.push(request.postDataJSON());
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('./#/settings/sync');
  await expect(page.getByRole('heading', { name: '跨设备同步' })).toBeVisible();
  await writeKv(page, 'progress', {
    '笔记/推送.md': { ratio: 0.42, updatedAt: NOW },
  });

  await page.getByRole('button', { name: '立即同步' }).click();
  await expect.poll(() => pushes.length).toBeGreaterThan(0);

  const records = pushes.flatMap((body) => body.p_records);
  const progress = records.find((record) => (
    record.collection === 'reading.progress' && record.record_id === '笔记/推送.md'
  ));
  expect(progress).toBeTruthy();
  expect(progress?.scope).toBe(DEFAULT_SCOPE);
  expect(progress?.payload).toEqual({ ratio: 0.42, updatedAt: NOW });
});

test('跨设备同步：清空本机进度与高亮后从远端恢复', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token_1234' });
  await seedSyncConfig(page);

  const rows = new Map<string, RemoteRow>();
  let serverClock = Date.parse('2026-01-01T00:00:00.000Z');
  await page.route('https://sync.example/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      const scope = url.searchParams.get('scope')?.replace(/^eq\./, '') ?? '';
      const sinceParam = url.searchParams.get('server_updated_at');
      const since = sinceParam ? Date.parse(sinceParam.replace(/^gte\./, '')) : 0;
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '500');
      const list = [...rows.values()]
        .filter((row) => row.scope === scope && Date.parse(row.server_updated_at) >= since)
        .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)
          || a.collection.localeCompare(b.collection)
          || a.record_id.localeCompare(b.record_id))
        .slice(offset, offset + limit);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
      return;
    }
    if (isPush(request.method(), url.pathname)) {
      const body = request.postDataJSON() as { p_records: Omit<RemoteRow, 'server_updated_at'>[] };
      for (const record of body.p_records) {
        serverClock += 1000;
        rows.set(`${record.scope}\u0000${record.collection}\u0000${record.record_id}`, {
          ...record,
          server_updated_at: new Date(serverClock).toISOString(),
        });
      }
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('./#/settings/sync');
  await expect(page.getByRole('heading', { name: '跨设备同步' })).toBeVisible();
  await writeKv(page, 'progress', { '同步/恢复.md': { ratio: 0.55, updatedAt: NOW } });
  await writeKv(page, 'highlights', {
    '同步/恢复.md': [{
      id: 'hl-restore-1',
      exact: '跨设备高亮',
      prefix: '',
      suffix: '',
      decorations: [{ kind: 'bg', color: 'yellow' }],
      createdAt: NOW,
    }],
  });

  const syncButton = page.getByRole('button', { name: '立即同步' });
  await syncButton.click();
  await expect.poll(() => [...rows.values()].filter((row) => row.collection === 'reading.progress').length).toBeGreaterThan(0);
  await expect.poll(() => [...rows.values()].filter((row) => row.collection === 'reading.highlights').length).toBeGreaterThan(0);
  // 等推送完成、outbox 删空后再清空本地数据，避免残留条目在第二次同步时被重新推送。
  await expect.poll(async () => {
    const entries = await readStore(page, 'sync_outbox') as unknown[] | null;
    return Array.isArray(entries) ? entries.length : -1;
  }).toBe(0);

  // 清空本机数据（保留同步配置与已 seed 标记），再同步一次。
  await deleteKv(page, 'progress');
  await deleteKv(page, 'highlights');
  await syncButton.click();

  await expect.poll(async () => {
    const map = await readKv(page, 'progress') as Record<string, { ratio?: number }> | undefined;
    return map?.['同步/恢复.md']?.ratio;
  }).toBe(0.55);
  await expect.poll(async () => {
    const map = await readKv(page, 'highlights') as Record<string, { id: string }[]> | undefined;
    return map?.['同步/恢复.md']?.[0]?.id;
  }).toBe('hl-restore-1');
});

test('跨设备同步：鉴权失败与表不存在显示对应中文错误', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token_1234' });
  await seedSyncConfig(page);
  let status = 401;
  await page.route('https://sync.example/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      await route.fulfill({ status, contentType: 'application/json', body: '{"message":"mock"}' });
      return;
    }
    if (isPush(request.method(), url.pathname)) {
      await route.fulfill({ status, contentType: 'application/json', body: '{"message":"mock"}' });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto('./#/settings/sync');
  await expect(page.getByRole('heading', { name: '跨设备同步' })).toBeVisible();
  const syncButton = page.getByRole('button', { name: '立即同步' });

  await syncButton.click();
  await expect(page.getByText('JWT 无效、已过期或没有权限')).toBeVisible();
  await expect(syncButton).toBeEnabled();

  status = 404;
  await syncButton.click();
  await expect(page.getByText('同步表不存在，请先执行初始化 SQL')).toBeVisible();
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
