import { expect, test } from '@playwright/test';
import { configureAndSync, readKv, selectAndContextMenu } from './fixtures';

interface StoredNote {
  id: string;
  exact: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

async function storedNotes(page: import('@playwright/test').Page): Promise<StoredNote[]> {
  const kv = (await readKv(page, 'notes')) as Record<string, StoredNote[]> | undefined;
  return kv?.['a.md'] ?? [];
}

test('笔记：选中文字创建、符号可点击编辑、刷新后仍在', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await selectAndContextMenu(page, 'MVCC 并发控制');
  await page.locator('.selection-menu').getByRole('menuitem', { name: '笔记' }).click();

  const dialog = page.getByRole('dialog', { name: '添加笔记' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('MVCC 并发控制')).toBeVisible();
  await dialog.getByLabel('笔记内容').fill('第一版笔记：MVCC 的可见性规则。');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();

  const mark = page.locator('.doc-content button.note-mark');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute('aria-label', '查看笔记');
  await expect.poll(async () => (await storedNotes(page))[0]?.body).toBe('第一版笔记：MVCC 的可见性规则。');
  const stored = (await storedNotes(page))[0];
  expect(stored.exact).toBe('MVCC 并发控制');

  // 刷新后按锚点重新渲染
  await page.reload();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page.locator('.doc-content button.note-mark')).toHaveCount(1);

  // 点击符号 → 编辑
  await page.locator('.doc-content button.note-mark').click();
  const edit = page.getByRole('dialog', { name: '编辑笔记' });
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('笔记内容')).toHaveValue('第一版笔记：MVCC 的可见性规则。');
  await edit.getByLabel('笔记内容').fill('第二版笔记：补充快照读。');
  await edit.getByRole('button', { name: '保存' }).click();
  await expect(edit).toBeHidden();
  await expect.poll(async () => (await storedNotes(page))[0]?.body).toBe('第二版笔记：补充快照读。');
  expect((await storedNotes(page))[0].updatedAt).toBeGreaterThan(stored.updatedAt);
});

test('笔记列表：⋯ 菜单入口按正文位置展示，点击打开编辑', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  // 在靠后的引用句和靠前的标题句各建一条，验证列表按正文位置排序。
  await selectAndContextMenu(page, 'MVCC 并发控制');
  await page.locator('.selection-menu').getByRole('menuitem', { name: '笔记' }).click();
  await page.getByRole('dialog', { name: '添加笔记' }).getByLabel('笔记内容').fill('后面的笔记');
  await page.getByRole('dialog', { name: '添加笔记' }).getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.doc-content button.note-mark')).toHaveCount(1);

  await selectAndContextMenu(page, '文档 A');
  await page.locator('.selection-menu').getByRole('menuitem', { name: '笔记' }).click();
  await page.getByRole('dialog', { name: '添加笔记' }).getByLabel('笔记内容').fill('前面的笔记');
  await page.getByRole('dialog', { name: '添加笔记' }).getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.doc-content button.note-mark')).toHaveCount(2);

  await page.getByRole('button', { name: '更多' }).click();
  await page.locator('.doc-more').getByRole('button', { name: /^笔记/ }).click();
  const drawer = page.getByRole('dialog', { name: '笔记' });
  await expect(drawer).toBeVisible();
  const items = drawer.locator('.note-item-body');
  await expect(items).toHaveText(['前面的笔记', '后面的笔记']);

  await drawer.locator('.note-item').first().click();
  const edit = page.getByRole('dialog', { name: '编辑笔记' });
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('笔记内容')).toHaveValue('前面的笔记');
  await edit.getByRole('button', { name: '取消' }).click();
  await expect(edit).toBeHidden();
});

test('删除笔记：符号与列表同步消失', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await selectAndContextMenu(page, 'MVCC 并发控制');
  await page.locator('.selection-menu').getByRole('menuitem', { name: '笔记' }).click();
  await page.getByRole('dialog', { name: '添加笔记' }).getByLabel('笔记内容').fill('待删除');
  await page.getByRole('dialog', { name: '添加笔记' }).getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.doc-content button.note-mark')).toHaveCount(1);

  page.once('dialog', (d) => void d.accept());
  await page.locator('.doc-content button.note-mark').click();
  await page.getByRole('dialog', { name: '编辑笔记' }).getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.doc-content button.note-mark')).toHaveCount(0);
  await expect.poll(async () => (await storedNotes(page)).length).toBe(0);

  await page.getByRole('button', { name: '更多' }).click();
  await page.locator('.doc-more').getByRole('button', { name: /^笔记/ }).click();
  await expect(page.getByRole('dialog', { name: '笔记' }).getByText('这篇文档还没有笔记。', { exact: false })).toBeVisible();
});
