import { expect, test, type Page } from '@playwright/test';
import { configureAndSync, writeKv } from './fixtures';

/** 当前滚动比例（与实现同口径：scrollY / max(1, scrollHeight - innerHeight)）。 */
function scrollRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return window.scrollY / max;
  });
}

test('阅读进度：滚到中部退出，重开自动恢复到记录比例（±5%）', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.waitForTimeout(300); // 初次打开（无进度 → 页首）的恢复落定，避免与应用自身的 scrollTo 竞争

  // 滚到约 50%
  await page.evaluate(() => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.round(max * 0.5));
  });
  await page.waitForTimeout(1200); // 等一个节流窗口：进度落盘（≥1s）
  const recorded = await scrollRatio(page);
  expect(recorded).toBeGreaterThan(0.4);
  expect(recorded).toBeLessThan(0.6);

  // 退出到首页：新历史条目没有 scroll 记忆 → 重开时按已保存进度默认落位（spec §1.4）
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page.getByRole('link', { name: '搜索文档' })).toBeVisible();
  await expect(page.locator('.home-recents')).toBeVisible();

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => Math.abs((await scrollRatio(page)) - recorded), { message: '重开后恢复到 ±5% 内' })
    .toBeLessThan(0.05);
});

test('无进度的文档默认停在页首', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect.poll(() => scrollRatio(page)).toBeLessThan(0.05);
});

test('首页壳子：标题顶栏、搜索框、继续阅读卡带进度', async ({ page }) => {
  await configureAndSync(page);

  // 预置一篇的阅读进度（壳子用例只关心首页渲染，不经由滚动落盘）
  await writeKv(page, 'progress', { 'a.md': { ratio: 0.5, updatedAt: Date.now() } });
  await page.reload();
  await expect(page.locator('.tree-item')).toHaveCount(3);

  await expect(page.getByRole('heading', { name: '知识库', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: '搜索文档' })).toBeVisible(); // 结构契约：名称不变
  await expect(page.locator('.home-recents')).toBeVisible();
  await expect(page.locator('.home-recents .home-progress')).toBeVisible(); // 新增进度条节点
});

test('收藏：星标后首页出现收藏区块，取消后消失', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  // 未收藏 → 点击星标 → 已收藏（aria-pressed 切换）
  const star = page.getByRole('button', { name: '收藏', exact: true });
  await expect(star).toBeVisible();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // 首页出现「收藏」区块，直达该文档
  await page.getByRole('button', { name: '返回首页' }).click();
  const favorites = page.locator('.home-favorites');
  await expect(favorites).toBeVisible();
  await expect(favorites.getByRole('link', { name: '文档 A' })).toBeVisible();

  // 从收藏区进入 → 取消收藏 → 首页区块消失
  await favorites.getByRole('link', { name: '文档 A' }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  await expect(page.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page.locator('.home-favorites')).toHaveCount(0);
});
