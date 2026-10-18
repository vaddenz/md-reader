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

test('设置页调整外观：预览联动、防抖持久化、阅读页生效', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/settings');

  const section = page.locator('section', { has: page.getByRole('heading', { name: '阅读外观' }) });
  await expect(section).toBeVisible();

  // 字号滑块 → 预览即时生效
  await section.locator('input[type="range"]').first().fill('20');
  await expect(section.locator('.appearance-preview')).toHaveCSS('font-size', '20px');

  // 表格比例 60% → 预览表格字号 = 20 × 0.6
  await section.locator('input[type="range"]').nth(1).fill('0.6');
  await expect(section.locator('.appearance-preview table')).toHaveCSS('font-size', '12px');

  // 字体切换 → 预览字体栈生效
  await section.getByRole('radio', { name: /等线/ }).check();
  await expect(section.locator('.appearance-preview')).toHaveCSS('font-family', /LXGW Neo XiHei Screen/);

  // 防抖 300ms 后持久化
  await expect.poll(async () => (await readKv(page, 'appearance')) as Record<string, unknown> | undefined)
    .toMatchObject({ fontFamily: 'xihei', fontSize: 20, tableScale: 0.6 });

  // 阅读页生效
  await page.goto('./#/doc/长文档.md');
  await expect(page.getByRole('heading', { name: '长文档' })).toBeVisible();
  const fontSize = await page.locator('.doc-content').evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('20px');
});

test('字体样张页：三种字体并排样张', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/font-preview');
  await expect(page.getByRole('heading', { name: '字体样张' })).toBeVisible();
  await expect(page.locator('.font-sample')).toHaveCount(3);
  await expect(page.locator('.font-sample').nth(0)).toContainText('系统默认');
  await expect(page.locator('.font-sample').nth(1)).toContainText('等线');
  await expect(page.locator('.font-sample').nth(2)).toContainText('宋体');
});
