import { expect, test } from '@playwright/test';
import { BANK_PATH, BANK_TEXT, configureAndSync, readKv, writeKv } from './fixtures';

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

/** 只选示例题库的选择配置（T7/T9 用例同样先预置选择，再直接进概览页）。 */
const BANK_ONLY_SELECTION = {
  banks: [BANK_PATH],
  filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] },
  sessionSize: 20, newPerDay: 10,
};

test('记忆助手：预选题库自动加载', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', BANK_ONLY_SELECTION);

  await page.goto('./#/memory');

  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await expect(bank.getByRole('checkbox')).toBeChecked();
  await expect(bank).toContainText('5 题');
  await expect(bank).toContainText('1 处问题');
  // 自动加载结果同样进入筛选数据源
  await expect(page.getByRole('group', { name: '题型' })).toContainText('概念');
});

test('记忆助手：同步后 sha 变化使解析缓存失效并自动重载', async ({ page }) => {
  const mock = await configureAndSync(page);

  // 先手动加载一次（memSelection 落库 + mem_banks 存下旧 sha 的解析结果）
  await page.getByRole('link', { name: '记忆助手' }).click();
  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await bank.getByRole('checkbox').check();
  await expect(bank).toContainText('5 题');

  // 题库更新（换 sha + 多一题 → 6 题）并同步：旧解析结果必须立即失效
  const updated = BANK_TEXT + JSON.stringify({ id: 'Q3.1', type: '概念', chapter: '3. 补充', question: '什么是宏任务？', answer: '- 宏任务队列。' }) + '\n';
  mock.updateDoc(BANK_PATH, updated);
  await page.goto('./#/settings');
  await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.getByText('上次同步：刚刚')).toBeVisible();

  // 回到概览页：sha 不一致 → 不沿用旧解析，自动重载新版本
  await page.goto('./#/memory');
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('6 题');
});

test('记忆助手：自动加载失败静默保留「未获取」，连网后手动重试可加载', async ({ page }) => {
  const mock = await configureAndSync(page);
  await writeKv(page, 'memSelection', BANK_ONLY_SELECTION);
  mock.setFailNetwork(true);

  await page.goto('./#/memory');
  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await expect(bank).toContainText('未获取');
  // 失败静默：不弹 toast
  await expect(page.locator('.toast')).toHaveCount(0);

  // 手动重试（取消 / 重勾）在恢复网络后加载成功
  mock.setFailNetwork(false);
  await bank.getByRole('checkbox').uncheck();
  await bank.getByRole('checkbox').check();
  await expect(bank).toContainText('5 题');
});
