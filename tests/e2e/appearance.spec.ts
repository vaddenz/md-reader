import { expect, test } from '@playwright/test';
import { configureAndSync, readKv, writeKv } from './fixtures';

test('排版变量：字号与表格/引用比例在阅读页生效', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'appearance', { fontFamily: 'xihei', fontSize: 20, tableScale: 0.6, quoteScale: 0.8 });

  await page.goto('./#/doc/长文档.md');
  await expect(page.getByRole('heading', { name: '长文档' })).toBeVisible();

  const fontSize = await page.locator('.doc-content').evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('20px');
  const family = await page.locator('.doc-content').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('LXGW Neo XiHei Screen');
  const tableSize = await page.locator('.doc-content table').first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(tableSize).toBe('12px'); // 20 × 0.6
  const quoteSize = await page.locator('.doc-content blockquote').first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(quoteSize).toBe('16px'); // 20 × 0.8
});

test('未设置外观时保持现状口径（17px / 0.95 / 1）', async ({ page }) => {
  await configureAndSync(page);
  expect(await readKv(page, 'appearance')).toBeUndefined();
  await page.goto('./#/doc/长文档.md');
  await expect(page.getByRole('heading', { name: '长文档' })).toBeVisible();
  const fontSize = await page.locator('.doc-content').evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('17px');
  const tableSize = await page.locator('.doc-content table').first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(tableSize).toBe('16.15px'); // 17 × 0.95
});
