import { expect, test } from '@playwright/test';
import { configureAndSync } from './fixtures';

/** 朗读 Phase 1：顶栏入口、播放条、暂停/继续、下一句、设置语速。 */
test('朗读：系统 TTS 入口、控制条与语速设置', async ({ page }) => {
  await page.addInitScript(() => {
    const voices = [
      { name: '测试中文', lang: 'zh-CN', localService: true, default: true, voiceURI: 'fake-zh' },
    ];
    class FakeUtterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: unknown = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onboundary: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onresume: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    let current: FakeUtterance | null = null;
    const synth = {
      speaking: false,
      paused: false,
      pending: false,
      getVoices: () => voices,
      addEventListener: () => {},
      removeEventListener: () => {},
      speak(u: FakeUtterance) {
        current = u;
        synth.speaking = true;
        u.onstart?.();
      },
      pause() {
        synth.paused = true;
      },
      resume() {
        synth.paused = false;
      },
      cancel() {
        const u = current;
        current = null;
        synth.speaking = false;
        synth.paused = false;
        u?.onerror?.({ error: 'canceled' });
      },
    };
    try {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });
    } catch {
      // 浏览器不允许覆盖时，用例会落到 unsupported；由断言暴露。
    }
  });

  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '朗读' }).click();
  const bar = page.locator('.tts-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('第 1/');
  await expect(page.locator('.tts-play')).toHaveAttribute('aria-label', '暂停朗读');

  const highlighted = await page.evaluate(() => {
    const registry = (CSS as unknown as { highlights?: { has?: (name: string) => boolean } }).highlights;
    if (registry?.has) return registry.has('tts-current');
    return document.querySelectorAll('.tts-current-block').length > 0;
  });
  expect(highlighted).toBe(true);

  await page.locator('.tts-play').click();
  await expect(bar).toContainText('已暂停');
  await page.locator('.tts-play').click();
  await expect(bar).toContainText('第 1/');

  await page.locator('.tts-next').click();
  await expect(bar).toContainText('第 2/');

  await page.locator('.tts-more').click();
  await expect(page.getByRole('dialog', { name: '朗读' })).toBeVisible();
  await page.getByRole('button', { name: '1.5x' }).click();
  await page.locator('.drawer-close').click();
  await expect(bar).toContainText('1.5x');

  await page.locator('.tts-close').click();
  await expect(bar).toHaveCount(0);
});
