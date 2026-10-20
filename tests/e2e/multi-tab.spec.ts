import { expect, test } from '@playwright/test';
import { configureAndSync, readKv, writeKv } from './fixtures';

test('标签登记：打开两篇文档 → kv 记录两条、active 为当前；返回首页保留', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();

  await expect
    .poll(async () => {
      const raw = (await readKv(page, 'tabs')) as { list?: { docPath: string }[]; activeId?: string } | undefined;
      return raw?.list?.map((t) => t.docPath).join(',') ?? '';
    })
    .toBe('a.md,深挖/b.md');

  // active 为当前文档（B）的标签。
  const active = (await readKv(page, 'tabs')) as { list?: { id: string; docPath: string }[]; activeId?: string } | undefined;
  expect(active?.list?.find((t) => t.id === active.activeId)?.docPath).toBe('深挖/b.md');

  // 返回首页后标签保留（kv 不变）。
  // 阅读页顶栏返回 = 回首页（用户验收裁定），B 由抽屉推入的历史不再需要逐步后退。
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/#\/$/);
  const raw = (await readKv(page, 'tabs')) as { list?: unknown[] } | undefined;
  expect(raw?.list).toHaveLength(2);
});

test('多标签：唤出切换器、切换与位置恢复、关闭行为', async ({ page }) => {
  await configureAndSync(page);

  // 打开 A，滚到 50% 等进度落盘
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.round(max * 0.5));
  });
  await page.waitForTimeout(1200);
  const ratio = () =>
    page.evaluate(() => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return window.scrollY / max;
    });
  const aRatio = await ratio();

  // 经文件抽屉打开 B（新标签）
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();

  // 唤出切换器：两行、当前标记在 B
  await page.getByRole('button', { name: '切换标签' }).click();
  const panel = page.getByRole('group', { name: '打开的标签' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.doc-tab-row')).toHaveCount(2);
  await expect(panel.locator('.doc-tab-current')).toContainText('文档 B');
  await expect(panel.locator('.doc-tab-current .doc-tab-open')).toHaveAttribute('aria-current', 'true');

  // 切回 A：位置恢复到 ±5%
  await panel.getByRole('button', { name: '文档 A', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => Math.abs((await ratio()) - aRatio), { message: '切回 A 后位置 ±5% 内' })
    .toBeLessThan(0.05);

  // 关闭当前（A）→ 切到相邻 B；弹层保持打开（便于连续关闭）
  await page.getByRole('button', { name: '切换标签' }).click();
  await page.getByRole('button', { name: '关闭标签：文档 A' }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page).toHaveURL(/#\/doc\//);
  await expect(page.getByRole('group', { name: '打开的标签' }).locator('.doc-tab-row')).toHaveCount(1);

  // 关闭最后一个（B）→ 回首页；重开文档 → 单标签（标题按钮仍在，可再关）
  await page.getByRole('button', { name: '关闭标签：文档 B' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '切换标签' }).click();
  await expect(page.getByRole('group', { name: '打开的标签' }).locator('.doc-tab-row')).toHaveCount(1);
});

test('多标签：切换后两边的目录按钮均可见（回归）', async ({ page }) => {
  await configureAndSync(page);

  // tab1 = A，tab2 = B（抽屉打开 B，二者都有 h1–h4 标题 → 都应显示悬浮目录按钮）
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page.getByRole('button', { name: '目录' })).toBeVisible();

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.getByRole('button', { name: '目录' })).toBeVisible();

  // 切回 A → 切回 B：两边都保持目录入口（真机验收反馈的回归钉）
  await page.getByRole('button', { name: '切换标签' }).click();
  await page.getByRole('button', { name: '文档 A', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page.getByRole('button', { name: '目录' })).toBeVisible();

  await page.getByRole('button', { name: '切换标签' }).click();
  await page.getByRole('button', { name: '文档 B', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.getByRole('button', { name: '目录' })).toBeVisible();
});

test('多标签：重启恢复与去重', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();

  // 重启（整页重载）：标签恢复、当前文档聚焦
  await page.reload();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await page.getByRole('button', { name: '切换标签' }).click();
  const panel = page.getByRole('group', { name: '打开的标签' });
  await expect(panel.locator('.doc-tab-row')).toHaveCount(2);
  await expect(panel.locator('.doc-tab-current')).toContainText('文档 B');
  await page.keyboard.press('Escape');

  // 去重：返回首页（阅读页顶栏返回 = 回首页，一次）→ 重开 B → 仍为两条（聚焦已有，不新开）
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await page.getByRole('button', { name: '切换标签' }).click();
  await expect(page.getByRole('group', { name: '打开的标签' }).locator('.doc-tab-row')).toHaveCount(2);
});

test('清除全部数据后标签清空（不复活、不写回）', async ({ page }) => {
  await configureAndSync(page);

  // 开 A、B
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();

  // 设置 → 清除全部数据（确认）
  await page.getByRole('button', { name: '返回首页' }).click(); // 顶栏返回 = 回首页（标签保留）
  await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await page.getByRole('link', { name: /数据管理/ }).click();
  await expect(page).toHaveURL(/#\/settings\/data$/);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '清除全部数据' }).click();
  await page.waitForURL(/#\/setup$/);

  // 重新配置 Token → 首页 → 打开 A → 切换器仅 1 条（旧标签不得复活）
  await page.getByPlaceholder('粘贴 Fine-grained PAT').fill('ghp_e2e_fake_token');
  await page.getByRole('button', { name: '验证并保存' }).click();
  await page.waitForURL(/#\/$/);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '切换标签' }).click();
  await expect(page.getByRole('group', { name: '打开的标签' }).locator('.doc-tab-row')).toHaveCount(1);
});

test('多标签：边界（损坏清理 / 缺失剔除）', async ({ page }) => {
  await configureAndSync(page);

  // 损坏存储 → 空标签起步（打开文档后只有 1 条）
  await writeKv(page, 'tabs', 'garbage');
  await page.reload();
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => ((await readKv(page, 'tabs')) as { list?: unknown[] } | undefined)?.list?.length)
    .toBe(1);

  // 恢复时剔除已不存在的文档（树缓存为准）
  await writeKv(page, 'tabs', {
    list: [
      { id: 't1', docPath: '已删除.md', title: '已删除', openedAt: 1 },
      { id: 't2', docPath: 'a.md', title: '文档 A', openedAt: 2 },
    ],
    activeId: 't1',
  });
  await writeKv(page, 'tree', {
    entries: [
      { path: 'a.md', sha: 'sha-a' },
      { path: '深挖/b.md', sha: 'sha-b' },
      { path: '长文档.md', sha: 'sha-long' },
    ],
  });
  await page.reload();
  await expect
    .poll(async () => {
      const raw = (await readKv(page, 'tabs')) as { list?: { docPath: string }[] } | undefined;
      return raw?.list?.map((t) => t.docPath).join(',') ?? '';
    })
    .toBe('a.md');
});
