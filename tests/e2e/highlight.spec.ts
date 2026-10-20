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
  await expect(page.locator('mark.hl-yellow')).toHaveCSS('background-color', 'rgb(255, 241, 168)'); // 原 rgb(255, 235, 59)
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

/** 在页面内选中包含 text 的段落片段并派发 contextmenu。 */
async function selectAndContextMenu(page: import('@playwright/test').Page, text: string) {
  // 正文为异步渲染（IDB 读取 → render）：先等目标文本出现，避免选中时机早于渲染的竞态。
  await expect.poll(() =>
    page.evaluate((t) => (document.querySelector('.doc-content')?.textContent ?? '').includes(t), text),
  ).toBe(true);
  await page.evaluate((t) => {
    const container = document.querySelector('.doc-content')!;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const i = node.data.indexOf(t);
      if (i !== -1) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + t.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        (node.parentElement ?? container).dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 240 }),
        );
        return;
      }
      node = walker.nextNode() as Text | null;
    }
    throw new Error(`未找到文本：${t}`);
  }, text);
}

test('右键菜单：选中文字出现菜单，复制与高亮黄可用', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => { (window as any).__copied = t; } },
    });
  });
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await selectAndContextMenu(page, 'MVCC 并发控制');
  const menu = page.locator('.selection-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['复制', '高亮·黄', '高亮·红']);

  await menu.getByRole('menuitem', { name: '复制' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe('MVCC 并发控制');

  await selectAndContextMenu(page, 'MVCC 并发控制');
  await page.locator('.selection-menu').getByRole('menuitem', { name: '高亮·黄' }).click();
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1);
  await expect(page.locator('mark.hl-yellow')).toHaveText('MVCC 并发控制');
  // 创建后选区被清空
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  // 已持久化
  await expect.poll(async () => {
    const kv = (await readKv(page, 'highlights')) as Record<string, unknown[]> | undefined;
    return kv?.['a.md']?.length ?? 0;
  }).toBe(1);
});

test('菜单随选区变化自动关闭，且不覆盖选区', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  // 目标段落在文档靠下位置：先滚入视口（居中），保证选区矩形实际可见、菜单定位按 rect 生效。
  await page.locator('.doc-content p', { hasText: 'MVCC 并发控制' }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  // 滚动会关闭菜单（spec §6.3），而 scrollIntoView 的 scroll 事件异步派发（下一渲染帧）：
  // 等两帧确保其派发完毕后再开菜单，避免「菜单刚挂载就被滚动事件关掉」的竞态。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
  await selectAndContextMenu(page, 'MVCC 并发控制');
  const menu = page.locator('.selection-menu');
  await expect(menu).toBeVisible();
  // 严格断言：菜单矩形整体在选区矩形之上或之下（竖直方向完全不重叠）。
  const clearsSelection = await page.evaluate(() => {
    const sel = window.getSelection()!;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const m = document.querySelector('.selection-menu')!.getBoundingClientRect();
    return m.top >= rect.bottom || m.bottom <= rect.top;
  });
  expect(clearsSelection).toBe(true);
  // 模拟拖动选择手柄（选区变化）→ 菜单自动关闭
  await page.evaluate(() => {
    const sel = window.getSelection()!;
    const r = sel.getRangeAt(0);
    r.setStart(r.startContainer, Math.max(0, r.startOffset - 1));
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await expect(menu).toBeHidden();
});

test('换色（红）替换黄；清除高亮', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await selectAndContextMenu(page, 'MVCC 并发控制');
  await page.locator('.selection-menu').getByRole('menuitem', { name: '高亮·黄' }).click();
  await expect(page.locator('mark.hl-yellow')).toHaveCount(1);

  // 选中同一段（此时是黄高亮）→ 菜单含清除高亮；点红 → 替换
  await selectAndContextMenu(page, 'MVCC 并发控制');
  await expect(page.locator('.selection-menu').getByRole('menuitem', { name: '清除高亮' })).toBeVisible();
  await page.locator('.selection-menu').getByRole('menuitem', { name: '高亮·红' }).click();
  await expect(page.locator('mark.hl-yellow')).toHaveCount(0);
  await expect(page.locator('mark.hl-red')).toHaveCount(1);
  await expect(page.locator('mark.hl-red')).toHaveCSS('background-color', 'rgb(255, 217, 212)'); // 原 rgb(255, 138, 128)
  await expect.poll(async () => {
    const kv = (await readKv(page, 'highlights')) as Record<string, { decorations: { color: string }[] }[]>;
    return (kv['a.md'] ?? []).map((r) => r.decorations[0].color); // 先清后加之间存在瞬时无记录的窗口
  }).toEqual(['red']);

  // 清除
  await selectAndContextMenu(page, 'MVCC 并发控制');
  await page.locator('.selection-menu').getByRole('menuitem', { name: '清除高亮' }).click();
  await expect(page.locator('mark.hl')).toHaveCount(0);
  await expect.poll(async () => {
    const kv = (await readKv(page, 'highlights')) as Record<string, unknown[]>;
    return kv['a.md']?.length ?? 0;
  }).toBe(0);
});

test('代码块内选区：只提供复制', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/深挖/b.md');
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await selectAndContextMenu(page, 'answer'); // hljs 会把代码拆成多个 span，取单个 token 的文本节点
  const menu = page.locator('.selection-menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['复制']);
});

test('全选：选区覆盖正文；复制内容不含代码复制按钮等界面文本', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/深挖/b.md');
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await page.evaluate(() => {
    const container = document.querySelector('.doc-content')!;
    container.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
  });
  await page.locator('.selection-menu').getByRole('menuitem', { name: '全选' }).click();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected).toContain('文档 B');
  // DOM Range 是连续区间，无法跳过中间的排除区（代码块内的按钮文本仍在选区文本里）；
  // 复制（Cmd/Ctrl+C）改写为可见文本，不得带入「复制」等界面文本。
  const copied = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.querySelector('.doc-content')!.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }),
    );
    return dt.getData('text/plain');
  });
  expect(copied).toContain('文档 B');
  expect(copied).toContain('const answer = 42;');
  expect(copied).not.toContain('复制');
});

test('全选后经菜单复制：内容不含界面文本', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => { (window as any).__copied = t; } },
    });
  });
  await configureAndSync(page);
  await page.goto('./#/doc/深挖/b.md');
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  const openMenu = () => page.evaluate(() => {
    document.querySelector('.doc-content')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }),
    );
  });
  await openMenu();
  await page.locator('.selection-menu').getByRole('menuitem', { name: '全选' }).click();
  await openMenu(); // 选区仍在 → 菜单含「复制」
  await page.locator('.selection-menu').getByRole('menuitem', { name: '复制' }).click();
  const copied = await page.evaluate(() => (window as any).__copied as string);
  expect(copied).toContain('文档 B');
  expect(copied).toContain('const answer = 42;');
  expect(copied).not.toContain('复制');
});

test('全选后切换文档：复制不再被旧选区劫持', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('.doc-content')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
  });
  await page.locator('.selection-menu').getByRole('menuitem', { name: '全选' }).click();
  await page.goto('./#/doc/深挖/b.md');
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  const copied = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.querySelector('.doc-content')!.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
    return dt.getData('text/plain');
  });
  expect(copied).toBe(''); // 应用不再改写复制内容
});

test('全选后正文原位换新（同容器）：复制不再被塌缩旧选区劫持', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('.doc-content')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
  });
  await page.locator('.selection-menu').getByRole('menuitem', { name: '全选' }).click();
  // 同一容器内正文换新（dangerouslySetInnerHTML 更新路径）：旧「全选」Range 塌缩到容器起点，
  // 且仍是当前 selection 的 range 对象（Chromium）——旧实现 cur === range 短路，复制被劫持为整篇新正文。
  await page.evaluate(() => {
    document.querySelector('.doc-content')!.innerHTML = '<h1>原位更新后的正文</h1><p>新的内容。</p>';
  });
  const copied = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.querySelector('.doc-content')!.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
    return dt.getData('text/plain');
  });
  expect(copied).toBe(''); // 塌缩的旧选区不代表全选，应用不得改写复制内容
});

test('高亮导出 JSON 与导入合并', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'highlights', { 'a.md': [record('h1')] });
  await page.goto('./#/settings/data');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出高亮' }).click(),
  ]);
  const path = await download.path();
  const fs = await import('node:fs/promises');
  const parsed = JSON.parse(await fs.readFile(path!, 'utf-8'));
  expect(parsed.formatVersion).toBe(1);
  expect(parsed.highlights['a.md']).toHaveLength(1);

  // 清空后导入同一份 → 恢复
  await writeKv(page, 'highlights', {});
  await page.setInputFiles('input[type="file"]', { name: 'hl.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(parsed)) });
  await expect(page.getByText(/导入 1 条/)).toBeVisible();
  await expect.poll(async () => {
    const kv = (await readKv(page, 'highlights')) as Record<string, unknown[]>;
    return kv['a.md']?.length ?? 0;
  }).toBe(1);
});
