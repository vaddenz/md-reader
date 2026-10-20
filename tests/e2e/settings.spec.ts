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

type SettingsSection = 'account' | 'reading' | 'data' | 'about';

const SECTION_TITLES: Record<SettingsSection, string> = {
  account: '账户与仓库',
  reading: '阅读体验',
  data: '数据管理',
  about: '关于',
};

/** SPA 内切换路由（仅改 hash，不整页刷新，保留内存中的同步状态）。 */
async function goToSettings(page: Page, section?: SettingsSection): Promise<void> {
  const hash = section ? `#/settings/${section}` : '#/settings';
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await expect(page.getByRole('heading', { name: section ? SECTION_TITLES[section] : '设置' })).toBeVisible();
}

test('设置页：Token 掩码显示；更换需校验成功后写入', async ({ page }) => {
  const oldToken = 'ghp_e2e_fake_token_1234';
  await installGitHubMock(page, { token: oldToken });
  await page.goto('./#/settings/account');
  await expect(page.getByRole('heading', { name: '账户与仓库' })).toBeVisible();

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

test('设置页：Owner 与当前仓库需「保存」才写入（trim 后生效）', async ({ page }) => {
  await configureAndSync(page);
  await goToSettings(page, 'account');

  const owner = page.getByLabel('Owner');
  const repoName = page.getByLabel('仓库名');
  const branch = page.getByLabel('分支');
  await expect(owner).toHaveValue('your-name');
  await expect(repoName).toHaveValue('your-notes');
  await expect(branch).toHaveValue('main');

  // Owner 草稿不写入；保存后 trim 生效
  await owner.fill('  other  ');
  expect(await readConfig(page)).toEqual({ owner: 'your-name', repo: 'your-notes', branch: 'main' });
  await page.getByRole('button', { name: '保存 Owner' }).click();
  await expect(page.getByText('用户名已保存')).toBeVisible();
  expect(await readConfig(page)).toEqual({ owner: 'other', repo: 'your-notes', branch: 'main' });
  await expect(owner).toHaveValue('other');

  // 仓库草稿不写入；保存后 trim 生效
  await repoName.fill('  notes  ');
  await branch.fill('  dev  ');
  expect(await readConfig(page)).toEqual({ owner: 'other', repo: 'your-notes', branch: 'main' });
  await page.getByRole('button', { name: '保存仓库' }).click();
  await expect(page.getByText('仓库已保存，下次同步使用新配置')).toBeVisible();
  expect(await readConfig(page)).toEqual({ owner: 'other', repo: 'notes', branch: 'dev' });
  await expect(repoName).toHaveValue('notes');
  await expect(branch).toHaveValue('dev');

  // 空值校验：报错且不写入
  await repoName.fill('   ');
  await page.getByRole('button', { name: '保存仓库' }).click();
  await expect(page.getByText('请填写仓库名与分支')).toBeVisible();
  expect(await readConfig(page)).toEqual({ owner: 'other', repo: 'notes', branch: 'dev' });
});

test('设置页：同一 Owner 下添加/切换仓库，书库相互隔离', async ({ page }) => {
  await configureAndSync(page);

  // scratch 返回空树：用于确认新仓库拥有独立书库，不会读到 your-notes 的缓存。
  await page.route('https://api.github.com/repos/your-name/scratch/git/trees/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sha: 'tree-notes', truncated: false, tree: [] }),
    }),
  );

  await goToSettings(page, 'account');
  await page.getByRole('button', { name: '+ 添加仓库' }).click();
  const addForm = page.locator('.settings-add-form');
  await addForm.getByLabel('仓库名').fill('scratch');
  await addForm.getByLabel('分支').fill('dev');
  await addForm.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByText('仓库已添加；切换到该仓库后开始同步')).toBeVisible();
  await expect(page.locator('.settings-repo-row-name')).toHaveText(['your-notes', 'scratch']);

  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('mdreader.repos')!));
  expect(state.owner).toBe('your-name');
  expect(state.repos).toHaveLength(2);
  expect(state.activeRepoId).toBe('default');

  // 切换到 scratch：整页刷新后仍回到设置账户页，当前仓库随之变化。
  await page.locator('.settings-repo-row').filter({ hasText: 'scratch' }).getByRole('radio').check();
  await page.waitForURL(/#\/settings\/account$/);
  await expect(page.getByLabel('仓库名')).toHaveValue('scratch');
  await expect(page.locator('.settings-repo-current')).toHaveCount(1);

  // scratch 的独立书库：空树同步后首页为空。
  await page.goto('./#/');
  await expect(page.getByText('暂无文档，点「更新目录」同步仓库')).toBeVisible();

  // 切回 your-notes：原书库的 3 篇文档仍在。
  await goToSettings(page, 'account');
  await page.locator('.settings-repo-row').filter({ hasText: 'your-notes' }).getByRole('radio').check();
  await page.waitForURL(/#\/settings\/account$/);
  await expect(page.getByLabel('仓库名')).toHaveValue('your-notes');
  await page.goto('./#/');
  await expect(page.locator('.tree-item')).toHaveCount(3);

  // 删除非当前仓库 scratch（本机独立库一并回收）。
  await goToSettings(page, 'account');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除仓库 scratch' }).click();
  await expect(page.getByText('仓库已删除')).toBeVisible();
  await expect(page.locator('.settings-repo-row-name')).toHaveText(['your-notes']);
});

test('设置页：清除全部数据需二次确认，确认后清空并回引导页', async ({ page }) => {
  await configureAndSync(page);
  await goToSettings(page, 'data');

  // 取消确认：数据保留，停留数据管理页
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '清除全部数据' }).click();
  await expect(page).toHaveURL(/#\/settings\/data$/);
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

  // 数据管理：存储统计 3 篇全部已缓存 + 体积文案
  await goToSettings(page, 'data');
  await expect(page.getByText('已缓存 3 篇 / 未缓存 0 篇')).toBeVisible();
  await expect(page.getByText(/已用 .+ \/ 配额 /)).toBeVisible();

  // 账户与仓库：立即同步 → 目录请求 +1，完成后显示「上次同步：刚刚」
  await goToSettings(page, 'account');
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

test('设置首页：连接状态卡 + 分组导航进入二级页并可返回', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/settings');

  // 连接状态卡：仓库、分支、掩码 Token 与一键同步
  await expect(page.getByText('GitHub 连接')).toBeVisible();
  await expect(page.getByText('your-name / your-notes')).toBeVisible();
  await expect(page.locator('.settings-connect-token')).toHaveText('ghp_e2e_fake…oken');
  await expect(page.getByRole('button', { name: '立即同步' })).toBeVisible();

  // 分组导航：三项进入各自二级页
  await expect(page.getByRole('link', { name: /阅读体验/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /数据管理/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /关于/ })).toBeVisible();

  await page.getByRole('link', { name: /阅读体验/ }).click();
  await expect(page).toHaveURL(/#\/settings\/reading$/);
  await expect(page.getByRole('heading', { name: '阅读体验' })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);

  await page.getByRole('link', { name: /数据管理/ }).click();
  await expect(page).toHaveURL(/#\/settings\/data$/);
  await expect(page.getByRole('heading', { name: '数据管理' })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
});
