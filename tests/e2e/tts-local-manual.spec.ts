import { expect, test } from '@playwright/test';
import { configureAndSync } from './fixtures';

/** 手动验收：真实下载 ModelScope 离线包并切到本地引擎。TTS_LOCAL_MANUAL=1 时运行。 */
test.skip(!process.env.TTS_LOCAL_MANUAL, 'manual acceptance only');

test('本地语音包：下载、启用、播放、暂停/继续', async ({ page }) => {
  test.setTimeout(420_000);
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '更多' }).click();
  await page.locator('.doc-more').getByRole('button', { name: '朗读' }).click();
  await page.locator('.tts-more').click();
  const dialog = page.getByRole('dialog', { name: '朗读' });
  await expect(dialog.getByRole('button', { name: '下载离线语音包' })).toBeVisible();
  await dialog.getByRole('button', { name: '下载离线语音包' }).click();
  await expect(dialog.getByText(/已下载/)).toBeVisible({ timeout: 360_000 });

  await dialog.getByRole('button', { name: '离线语音包', exact: true }).click();
  await page.locator('.drawer-close').click();
  const bar = page.locator('.tts-bar');
  await expect(bar).toContainText('离线包');
  await expect(bar).toContainText(/第 \d+\/31 句/, { timeout: 60_000 });

  await page.locator('.tts-play').click();
  await expect(bar).toContainText('已暂停');
  await page.locator('.tts-play').click();
  await expect(bar).toContainText(/第 \d+\/31 句/);

  const before = Number((await bar.innerText()).match(/第 (\d+)\/31/)?.[1] ?? 0);
  await page.locator('.tts-next').click();
  await expect(bar).toContainText(`第 ${before + 1}/31`);

  await page.locator('.tts-close').click();
  await expect(bar).toHaveCount(0);
});
