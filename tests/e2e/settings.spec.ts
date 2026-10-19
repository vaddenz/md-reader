import { expect, test, type Page } from '@playwright/test';
import { configureAndSync, installGitHubMock } from './fixtures';

/** 用独立连接读 IndexedDB kv.config（读完立即关闭，不影响应用自身的连接）。 */
async function readConfig(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('kv', 'readonly').objectStore('kv').get('config');
          get.onsuccess = () => { resolve(get.result ?? null); db.close(); };
          get.onerror = () => { resolve(null); db.close(); };
        };
        req.onerror = () => resolve(null);
      }),
  );
}

/** SPA 内切换路由（仅改 hash，不整页刷新，保留内存中的同步状态）。 */
async function goToSettings(page: Page): Promise<void> {
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
}

test('设置页：Token 掩码显示；更换需校验成功后写入', async ({ page }) => {
  const oldToken = 'ghp_e2e_fake_token_1234';
  await installGitHubMock(page, { token: oldToken });
  await page.goto('./#/settings');

  // 掩码：只显示前缀与末 4 位，完整值不出现在页面上
  await expect(page.locator('.settings-token')).toHaveText('ghp_e2e_fake…1234');
  await expect(page.locator('.settings-token')).not.toHaveText(oldToken);

  // 更换成功：校验通过后写入新 Token，掩码同步更新
  await page.getByRole('button', { name: '更换' }).click();
  await page.getByLabel('新的 GitHub Token').fill('github_pat_e2e_new_token_5678');
  await page.getByRole('button', { name: '验证并保存' }).click();
  await expect(page.locator('.settings-token')).toHaveText('github_pat_e…5678');
  await expect(page.getByText('Token 已更新')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mdreader.token'))).toBe('github_pat_e2e_new_token_5678');

  // 更换失败（401）：提示错误且不写入
  await page.route('https://api.github.com/user', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Bad credentials"}' }),
  );
  await page.getByRole('button', { name: '更换' }).click();
  await page.getByLabel('新的 GitHub Token').fill('ghp_bad_token');
  await page.getByRole('button', { name: '验证并保存' }).click();
  await expect(page.getByRole('alert')).toHaveText('Token 无效或已过期');
  expect(await page.evaluate(() => localStorage.getItem('mdreader.token'))).toBe('github_pat_e2e_new_token_5678');
});

test('设置页：仓库配置需「保存」才写入（trim 后生效）', async ({ page }) => {
  await configureAndSync(page);
  await goToSettings(page);

  const owner = page.getByLabel('Owner');
  await expect(owner).toHaveValue('vaddenz');
  await expect(page.getByLabel('仓库名')).toHaveValue('interview');
  await expect(page.getByLabel('分支')).toHaveValue('main');

  // 未保存的修改不写入 kv.config
  await owner.fill('  other  ');
  expect(await readConfig(page)).toEqual({ owner: 'vaddenz', repo: 'interview', branch: 'main' });

  // 保存：trim 后写入
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  expect(await readConfig(page)).toEqual({ owner: 'other', repo: 'interview', branch: 'main' });
  await expect(owner).toHaveValue('other');

  // 空值校验：报错且不写入
  await owner.fill('   ');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('请填写完整的仓库信息（Owner / 仓库名 / 分支）')).toBeVisible();
  expect(await readConfig(page)).toEqual({ owner: 'other', repo: 'interview', branch: 'main' });
});

test('设置页：清除全部数据需二次确认，确认后清空并回引导页', async ({ page }) => {
  await configureAndSync(page);
  await goToSettings(page);

  // 取消确认：数据保留，停留设置页
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '清除全部数据' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  expect(await page.evaluate(() => localStorage.getItem('mdreader.token'))).toBe('ghp_e2e_fake_token');

  // 确认：清空 IndexedDB + Token → 引导页
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '清除全部数据' }).click();
  await page.waitForURL(/#\/setup$/);
  expect(await page.evaluate(() => localStorage.getItem('mdreader.token'))).toBeNull();
  // 不钉版本号：清空后应用会立刻以当前 schema 版本重建空库（v2），钉 1 会 VersionError。
  const fileCount = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const count = db.transaction('files', 'readonly').objectStore('files').count();
          count.onsuccess = () => { resolve(count.result); db.close(); };
          count.onerror = () => { resolve(-1); db.close(); };
        };
        req.onerror = () => resolve(-1);
      }),
  );
  expect(fileCount).toBe(0);
});

test('设置页：立即同步与存储统计', async ({ page }) => {
  const mock = await configureAndSync(page);
  await goToSettings(page);

  // 存储统计：3 篇全部已缓存 + 体积文案
  await expect(page.getByText('已缓存 3 篇 / 未缓存 0 篇')).toBeVisible();
  await expect(page.getByText(/已用 .+ \/ 配额 /)).toBeVisible();

  // 立即同步：目录请求 +1，完成后显示「上次同步：刚刚」
  const before = mock.syncCalls();
  await page.getByRole('button', { name: '立即同步' }).click();
  await expect.poll(() => mock.syncCalls()).toBe(before + 1);
  await expect(page.getByText('上次同步：刚刚')).toBeVisible();
});

test('首页「设置」入口：点击进入设置页', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
});
