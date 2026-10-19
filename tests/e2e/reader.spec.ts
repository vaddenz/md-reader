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

  // b.md 中的互链回 a.md → 「返回来源」出现（限定正文，避开底部关联面板的同名 chip）
  await page.locator('.doc-content').getByRole('link', { name: '文档 A', exact: true }).click();
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
  const mock = await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  // 目录抽屉打开 → Esc 关闭（外壳行为）
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '目录' })).toHaveCount(0);

  // 文件树抽屉：3 篇文档、当前文档高亮、含「更新目录」手动刷新入口（spec §3）
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  const drawer = page.getByRole('dialog', { name: '全部文档' });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.tree-item')).toHaveCount(3);
  await expect(drawer.locator('.tree-current')).toHaveText('a');
  await expect(drawer.locator('.tree-current')).toHaveAttribute('aria-current', 'page');
  await expect(drawer.getByRole('button', { name: '更新目录' })).toBeVisible();

  // 点「更新目录」触发手动同步（与首页 SyncBadge 同口径：tree 请求 +1）
  await drawer.getByRole('button', { name: '更新目录' }).click();
  await expect.poll(() => mock.syncCalls()).toBe(2);

  // 点抽屉里的 深挖/b.md → 跳转、抽屉关闭、且不显示「返回来源」（抽屉跳转不是互链）
  await drawer.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '全部文档' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回来源' })).toHaveCount(0);
});

test('底部工具条：搜索/设置直达、外观开阅读内面板', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page).toHaveURL(/#\/search/);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  // 外观：阅读内面板，不离开阅读上下文（T4 修订；面板细节见「阅读内外观面板」用例）
  await page.getByRole('button', { name: '外观' }).click();
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toBeVisible();
  await expect(page).toHaveURL(/#\/doc\//);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toHaveCount(0);
  // 设置：仍直达设置页（外观区标题可见）
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.getByRole('heading', { name: '阅读外观' })).toBeVisible();
});

test('阅读内外观面板：不跳转、调整实时生效、Esc 关闭', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '外观' }).click();
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toBeVisible();
  await expect(page).toHaveURL(/#\/doc\//); // 不跳设置页

  const slider = page.locator('.appearance-sheet input[type="range"]').first();
  await slider.fill('19');
  await expect(page.locator('.doc-content')).toHaveCSS('--r-font-size', '19px'); // 实时生效

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toHaveCount(0);

  // 点击遮罩关闭（重开一次）
  await page.getByRole('button', { name: '外观' }).click();
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toBeVisible();
  await page.locator('.appearance-overlay').click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toHaveCount(0);
});

test('相关文档面板：双向引用分组 chips，点击互跳；无引用不渲染', async ({ page }) => {
  await configureAndSync(page);

  // 长文档.md 没有任何互链 → 面板整块不渲染
  await page.getByRole('link', { name: '长文档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '长文档' })).toBeVisible();
  await expect(page.locator('.related-docs')).toHaveCount(0);

  // a.md ↔ 深挖/b.md 双向引用：两个分组都出现，chip 显示标题
  await page.getByRole('button', { name: '返回首页' }).click();
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  const panel = page.locator('.related-docs');
  await expect(panel.getByRole('region', { name: '引用本文的' })).toBeVisible();
  await expect(panel.getByRole('region', { name: '本文引用的' })).toBeVisible();
  await expect(panel.getByRole('link', { name: '文档 B' })).toHaveCount(2);

  // 点 chip 直达 b.md（普通 <a> 经 Shell 拦截走路由，不整页刷新）
  await panel.getByRole('link', { name: '文档 B' }).first().click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page).toHaveURL(/#\/doc\//);
  await expect(page.getByRole('button', { name: '返回来源' })).toHaveCount(0); // 非正文互链，无来源条
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

test('目录抽屉：打开时定位到当前章节', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: '长文档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '长文档' })).toBeVisible();

  // 滚到文档后部（约 80% 处），让当前章节的目录项落在抽屉可视区之外，等待 scroll-spy 更新
  await page.evaluate(() => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.round(max * 0.8));
  });
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
  await expect(page.locator('.toc-item.toc-current')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const item = document.querySelector('.toc-item.toc-current');
        const body = item?.closest('.drawer-body');
        if (!item || !body) return false;
        const i = item.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        const center = i.top + i.height / 2;
        return center >= b.top && center <= b.bottom;
      }),
    )
    .toBe(true);
});

test('悬浮目录按钮：点击开目录、拖拽后位置持久化', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  const fab = page.getByRole('button', { name: '目录' });
  await expect(fab).toBeVisible();
  await expect(fab).toHaveClass(/doc-toc-fab/); // 钉到悬浮按钮本体：底栏旧「目录」项存在时此处即失败

  // 拖到左侧偏上：down → move → up
  const box = (await fab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(40, 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await fab.boundingBox())!.x).toBeLessThan(80);

  // 刷新后仍在左侧（持久化）
  await page.reload();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => (await page.getByRole('button', { name: '目录' }).boundingBox())!.x)
    .toBeLessThan(80);

  // 点击（非拖拽）打开目录
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
});
