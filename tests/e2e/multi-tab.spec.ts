import { expect, test } from '@playwright/test';
import { configureAndSync, readKv } from './fixtures';

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
  // 返回语义（spec §2.6）是「回到进入前的页面」：B → A → 首页需两次返回（B 由抽屉推入历史）。
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/doc\//);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  const raw = (await readKv(page, 'tabs')) as { list?: unknown[] } | undefined;
  expect(raw?.list).toHaveLength(2);
});
