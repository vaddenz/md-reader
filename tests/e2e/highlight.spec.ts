import { expect, test } from '@playwright/test';
import { configureAndSync, readFileRecord, readKv, writeKv } from './fixtures';

const QUOTE = 'MVCC 并发控制与版本可见性';

function record(id: string, color = 'yellow') {
  return { id, exact: QUOTE, prefix: '文末补充用于搜索直达：', suffix: '。', decorations: [{ kind: 'bg', color }], createdAt: 1 };
}

test('高亮渲染：预置记录在打开时锚定并显示', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'highlights', { 'a.md': [record('h1')] });
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1);
  await expect(page.locator('mark.hl-yellow')).toHaveText(QUOTE);
  await expect(page.locator('mark.hl-yellow')).toHaveCSS('background-color', 'rgb(255, 235, 59)'); // --hl-yellow: #ffeb3b
  // 刷新后仍在
  await page.reload();
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1);
});

test('笔记更新后自动重锚（在引用句之前新增段落）', async ({ page }) => {
  const mock = await configureAndSync(page);
  await writeKv(page, 'highlights', { 'a.md': [record('h1')] });
  await page.goto('./#/doc/a.md');
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1);

  // 取当前可见正文（纯文本足够验证重锚），在开头加一段后写回 mock；
  // 回首页点「更新目录」触发同步（树 sha 已变 → 下载新正文），轮询缓存落地后再打开文档。
  const text = await page.evaluate(() => document.querySelector('.doc-content')?.textContent ?? '');
  mock.updateDoc('a.md', `新增开头段落。\n\n${text}`);
  await page.goto('./#/');
  await page.getByRole('button', { name: '更新目录' }).click();
  await expect.poll(async () => (await readFileRecord(page, 'a.md'))?.text ?? '').toContain('新增开头段落');
  await page.goto('./#/doc/a.md');
  await expect(page.locator('.doc-content')).toContainText('新增开头段落');
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1);
  await expect(page.locator('mark.hl-yellow')).toHaveText(QUOTE);
});

test('高亮文字被改写：孤儿保留记录、不渲染；改回后恢复', async ({ page }) => {
  const mock = await configureAndSync(page);
  await writeKv(page, 'highlights', { 'a.md': [record('h1')] });
  await page.goto('./#/doc/a.md');
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1);

  const text = await page.evaluate(() => document.querySelector('.doc-content')?.textContent ?? '');
  mock.updateDoc('a.md', text.replace(QUOTE, '这段文字被改写了'));
  await page.goto('./#/');
  await page.getByRole('button', { name: '更新目录' }).click();
  await expect.poll(async () => (await readFileRecord(page, 'a.md'))?.text ?? '').toContain('这段文字被改写了');
  await page.goto('./#/doc/a.md');
  await expect(page.locator('.doc-content')).toContainText('这段文字被改写了');
  await expect(page.locator('mark.hl-yellow')).toHaveCount(0);
  const kv = (await readKv(page, 'highlights')) as { 'a.md': unknown[] };
  expect(kv['a.md']).toHaveLength(1); // 记录保留

  mock.updateDoc('a.md', text);
  await page.goto('./#/');
  await page.getByRole('button', { name: '更新目录' }).click();
  await expect.poll(async () => (await readFileRecord(page, 'a.md'))?.text ?? '').toContain(QUOTE);
  await page.goto('./#/doc/a.md');
  await expect(page.locator('.doc-content')).toContainText(QUOTE);
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1); // 改回原文自动恢复
});
