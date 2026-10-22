import { expect, test } from '@playwright/test';
import { configureAndSync } from './fixtures';

/** 朗读 Phase 2：离线语音包入口与引擎选择（不实际下载模型）。 */
test('朗读：离线语音包入口、引擎按钮与系统引擎默认值', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '更多' }).click();
  await page.locator('.doc-more').getByRole('button', { name: '朗读' }).click();
  const bar = page.locator('.tts-bar');
  await expect(bar).toContainText('系统语音');

  await page.locator('.tts-more').click();
  const dialog = page.getByRole('dialog', { name: '朗读' });
  await expect(dialog.getByRole('heading', { name: '引擎' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '下载离线语音包' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '离线语音包', exact: true })).toBeDisabled();
  await expect(dialog.getByText(/约 140MB/)).toBeVisible();

  await page.locator('.drawer-close').click();
  await page.locator('.tts-close').click();
  await expect(bar).toHaveCount(0);
});
