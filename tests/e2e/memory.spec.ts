import { expect, test } from '@playwright/test';
import { configureAndSync, readKv } from './fixtures';

test('记忆助手：入口可见、题库拉取体检、选择持久化', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: '记忆助手' }).click();
  await expect(page.getByRole('heading', { name: '记忆助手', level: 1 })).toBeVisible();
  await expect(page.getByText('未配置模型，将使用「对照参考答案 + 自评」模式。')).toBeVisible();

  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await expect(bank).toContainText('未获取');

  await bank.getByRole('checkbox').check();
  await expect(bank).toContainText('5 题');
  await expect(bank).toContainText('1 处问题');

  // 选择落库
  await expect.poll(async () => (await readKv(page, 'memSelection') as { banks?: string[] } | undefined)?.banks)
    .toEqual(['题库/示例题库.jsonl']);

  // 筛选选项来自已加载题库
  await expect(page.getByRole('group', { name: '题型' })).toContainText('概念');

  // 刷新后仍勾选、题量仍在（缓存命中，无需再拉取）
  await page.reload();
  await expect(bank.getByRole('checkbox')).toBeChecked();
  await expect(bank).toContainText('5 题');
});
