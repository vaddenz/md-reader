import { expect, test, type Page } from '@playwright/test';
import { configureAndSync, expireDoc, readFileRecord } from './fixtures';

/**
 * 缓存过期（T23）：8 天未用的文档在启动清理（sweepExpired）后正文置空（text → null），
 * 目录出现「未缓存」徽标；点击按需下载写回。另覆盖过期文档离线打开与「纳入全文搜索」。
 */

/** 目录树条目（按文件名精确定位：带「未缓存」徽标后可访问名会变化，不能再用 exact name）。 */
function treeItem(page: Page, name: string) {
  return page.locator('.tree-item').filter({ has: page.locator('.tree-name', { hasText: new RegExp(`^${name}$`) }) });
}

test('过期清理：正文置空 + 目录标「未缓存」；点击按需下载并写回', async ({ page }) => {
  await configureAndSync(page);

  // 把 a.md 的最后使用时间改为 8 天前（超过 7 天 TTL），再整页刷新触发启动清理
  await expireDoc(page, 'a.md');
  expect((await readFileRecord(page, 'a.md'))?.text ?? null).not.toBeNull(); // 前置：正文已缓存，置空只能来自过期清理
  await page.reload();

  await expect.poll(async () => (await readFileRecord(page, 'a.md'))?.text).toBeNull();

  // 目录出现「未缓存」徽标（仅 a.md 一枚）
  const item = treeItem(page, 'a');
  await expect(page.locator('.tree-badge')).toHaveCount(1);
  await expect(item.locator('.tree-badge')).toHaveText('未缓存');

  // 点击 → 按需下载（mock 提供 blob）→ 正常渲染 + 正文重新落盘
  await item.click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect.poll(async () => (await readFileRecord(page, 'a.md'))?.text ?? null).not.toBeNull();

  // 回首页：已重新缓存，徽标消失
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page.locator('.tree-badge')).toHaveCount(0);
});

test('过期文档离线：提示「该文档未缓存，需联网下载后阅读」，恢复后重试可读', async ({ page, context }) => {
  const mock = await configureAndSync(page);

  await expireDoc(page, '长文档.md');
  expect((await readFileRecord(page, '长文档.md'))?.text ?? null).not.toBeNull(); // 前置：正文已缓存
  await page.reload();
  const item = treeItem(page, '长文档');
  await expect(item.locator('.tree-badge')).toHaveText('未缓存');

  // 离线：page.route 的拦截响应不经过网络栈（实测），显式断网保证按需下载失败
  await context.setOffline(true);
  mock.setFailNetwork(true);
  await expect(page.locator('.offline-banner')).toBeVisible();

  await item.click();
  await expect(page.getByText('该文档未缓存，需联网下载后阅读')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();

  // 恢复在线 → 重试：按需下载成功，正文可读且写回
  mock.setFailNetwork(false);
  await context.setOffline(false);
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('heading', { name: '长文档' })).toBeVisible();
  await expect.poll(async () => (await readFileRecord(page, '长文档.md'))?.text ?? null).not.toBeNull();
});

test('搜索：过期文档不参与，一键「纳入全文搜索」后命中', async ({ page }) => {
  await configureAndSync(page);

  await expireDoc(page, '长文档.md');
  expect((await readFileRecord(page, '长文档.md'))?.text ?? null).not.toBeNull(); // 前置：正文已缓存
  await page.reload();

  // 「版本控制」仅出现在 长文档.md；它已过期 → 不参与搜索并给出提示
  await page.goto(`./#/search?q=${encodeURIComponent('版本控制')}`);
  const hint = page.locator('.search-uncached');
  await expect(hint).toContainText('1 篇文档未缓存（已过期），未参与搜索');
  await expect(page.locator('.search-result')).toHaveCount(0);
  await expect(page.getByText('未找到匹配的文档')).toBeVisible();

  // 纳入全文搜索：按需下载 → 缓存自愈重建 → 重搜命中
  await page.getByRole('button', { name: '纳入全文搜索' }).click();
  await expect(page.locator('.search-result')).toHaveCount(1);
  await expect(page.locator('.search-result-title')).toHaveText('长文档');
  await expect.poll(async () => (await readFileRecord(page, '长文档.md'))?.text ?? null).not.toBeNull();
});
