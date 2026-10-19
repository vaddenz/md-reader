# 多标签页（波2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阅读页支持多标签：可同时打开多个文档、点标题唤出切换器、切换时恢复各文档阅读进度、跨重启保留——验收后发 `v1.3.0`。

**Architecture:** 新增 `lib/tabs.ts` 纯逻辑（open/focus/close/rename/sanitize/prune）+ `TabsContext`（app 级状态，kv 持久化，Shell 挂载）+ DocPage 登记链路（进入文档即登记/聚焦）+ DocHeader 标题切换器（≥2 标签显示 ▾，单标签也可唤出用于关闭）。位置恢复复用既有「进度自动落位」（spec §3.3 明文「默认跳转语义，同 §1.4」），不新增滚动存储。

**Tech Stack:** React 18 + TS + Vite PWA；react-router 6（createHashRouter）；kv（IndexedDB）持久化；Playwright e2e + Vitest 单测。

**Spec:** `docs/specs/2026-10-19-md-reader-reading-ux-design.md` §3（已评审通过；本计划含 §3.3 一处修订：单标签时标题同样可唤出——消除与 §3.4「关最后一个回首页」的可达性矛盾，见 Task 5）

**工作区:** `/Users/pw/workspace/src/md-reader/.worktrees/multi-tab`（分支 `multi-tab`，基于 `main@d218052` = v1.2.0）。所有命令在此目录执行。

## Global Constraints

- **零数据迁移**：新增 kv 键 `tabs`（缺省/损坏 → 空标签，不阻塞启动）；既有键（favorites/progress/tree）不动。
- **无新增运行时依赖**；标签 id 生成用 `Date.now()+序号`（不引 crypto）。
- **结构契约**：既有 aria 名集合不变（返回/更多/目录/搜索/收藏/取消收藏/设置/文件/横屏/旋转/更新目录）；`.tree-item` 恒 3；`搜索文档` 文案；新 UI 的可访问名固定为：`切换标签`（标题按钮）、`打开的标签`（切换器容器）、`关闭标签：<标题>`（关闭钮）。
- **e2e 断言纪律**：不得弱化既有断言；新用例先 RED 后 GREEN；全链每任务全绿：`npm test && npx tsc --noEmit && CI=1 npm run test:e2e`（CI=1 防端口复用）。
- 令牌取色（`--card/--shell/--ink/--ink2/--acc-text/--shadow-card`）；文案按本计划给定值，不自由发挥。

## 任务总览

| # | 任务 | 主要文件 | 规格 |
| --- | --- | --- | --- |
| 1 | 标签数据层（纯逻辑 + 单测） | 新 `src/lib/tabs.ts` / `tests/unit/tabs.test.ts` | §3.1–3.4 |
| 2 | TabsContext + 登记链路 | 新 `src/state/TabsContext.tsx` / `Shell.tsx` / `DocPage.tsx` / e2e | §3.1–3.2 |
| 3 | 标题切换器 UI | `DocHeader.tsx` / `content.css` / 新 e2e | §3.3–3.4 |
| 4 | 恢复与边界 | 复用 T2/T3 代码 + 新 e2e | §3.1/§3.6 |
| 5 | 工艺门与文档 | `DESIGN.md` / `PRODUCT.md` / spec 修订 / 验收清单 / 1.3.0 | §5.2/§6 |
| 6 | 合并部署 + 真机验收 + tag v1.3.0 | git / 用户关卡 | §6 |

---

### Task 1: 标签数据层（纯逻辑 + 单测）

**Files:**
- Create: `src/lib/tabs.ts`
- Test: `tests/unit/tabs.test.ts`

**Interfaces:**
- Produces: `TabRecord { id, docPath, title, openedAt }`；`TabsState { list, activeId }`；`EMPTY_TABS`；`openTab(state, docPath, title, now?) → TabsState`（已开 → 仅聚焦）；`closeTab(state, id) → { state, navigateTo: string | null }`（navigateTo 为 docPath 或 `'home'` 或 null）；`renameTab(state, id, title) → TabsState`；`sanitizeTabs(raw) → TabsState`；`pruneMissing(state, knownPaths) → TabsState`。Task 2/3 依赖这些签名。

- [ ] **Step 1: 写失败单测** `tests/unit/tabs.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  closeTab, EMPTY_TABS, openTab, pruneMissing, renameTab, sanitizeTabs, type TabsState,
} from '../../src/lib/tabs';

const s = (list: TabsState['list'], activeId: string | null): TabsState => ({ list, activeId });
const t = (id: string, docPath: string, title = '') => ({ id, docPath, title, openedAt: 1 });

describe('openTab', () => {
  it('新文档：追加并聚焦；同文档：仅聚焦（不重复开）', () => {
    const a = openTab(EMPTY_TABS, 'a.md', 'A');
    expect(a.list).toHaveLength(1);
    expect(a.activeId).toBe(a.list[0].id);
    const b = openTab(a, 'b.md', 'B');
    expect(b.list).toHaveLength(2);
    const again = openTab(b, 'a.md', 'A');
    expect(again.list).toHaveLength(2);           // 去重
    expect(again.activeId).toBe(b.list[0].id);    // 聚焦已有
  });
});

describe('closeTab', () => {
  it('关非当前：仅移除，不导航', () => {
    const st = s([t('1', 'a.md'), t('2', 'b.md')], '2');
    const r = closeTab(st, '1');
    expect(r.state.list).toHaveLength(1);
    expect(r.state.activeId).toBe('2');
    expect(r.navigateTo).toBeNull();
  });
  it('关当前：优先右邻、次左邻', () => {
    const st = s([t('1', 'a.md'), t('2', 'b.md'), t('3', 'c.md')], '2');
    expect(closeTab(st, '2').navigateTo).toBe('c.md');
    const st2 = s([t('1', 'a.md'), t('2', 'b.md')], '2');
    expect(closeTab(st2, '2').navigateTo).toBe('a.md');
  });
  it('关最后一个：activeId 置空、navigateTo=home', () => {
    const st = s([t('1', 'a.md')], '1');
    const r = closeTab(st, '1');
    expect(r.state.list).toHaveLength(0);
    expect(r.state.activeId).toBeNull();
    expect(r.navigateTo).toBe('home');
  });
  it('未知 id：原样返回', () => {
    const st = s([t('1', 'a.md')], '1');
    expect(closeTab(st, 'x').state).toBe(st);
  });
});

describe('renameTab / sanitizeTabs / pruneMissing', () => {
  it('renameTab：空标题/未知 id 不改；同值返回原引用', () => {
    const st = s([t('1', 'a.md', 'A')], '1');
    expect(renameTab(st, '1', '')).toBe(st);
    expect(renameTab(st, 'x', 'X')).toBe(st);
    expect(renameTab(st, '1', 'A')).toBe(st);
    expect(renameTab(st, '1', 'A2').list[0].title).toBe('A2');
  });
  it('sanitizeTabs：损坏 → 空；非法项丢弃；按 docPath 去重；activeId 非法回退首个', () => {
    expect(sanitizeTabs(null)).toEqual(EMPTY_TABS);
    expect(sanitizeTabs('garbage')).toEqual(EMPTY_TABS);
    const ok = sanitizeTabs({
      list: [t('1', 'a.md', 'A'), { id: 1 }, t('3', 'a.md'), t('4', 'b.md', 'B')],
      activeId: 'nope',
    });
    expect(ok.list.map((x) => x.docPath)).toEqual(['a.md', 'b.md']);
    expect(ok.activeId).toBe(ok.list[0].id);
  });
  it('pruneMissing：剔除不在树的；active 被剔 → null；无变化返回原引用', () => {
    const st = s([t('1', 'a.md'), t('2', 'gone.md')], '2');
    const pruned = pruneMissing(st, new Set(['a.md']));
    expect(pruned.list.map((x) => x.docPath)).toEqual(['a.md']);
    expect(pruned.activeId).toBeNull();
    expect(pruneMissing(st, new Set(['a.md', 'gone.md']))).toBe(st);
  });
});
```

- [ ] **Step 2: 运行确认失败** `npx vitest run tests/unit/tabs.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/lib/tabs.ts`**

```ts
/** 多标签数据层（spec §3）：纯函数，无 IO、无 React。 */

export interface TabRecord {
  id: string;
  docPath: string;
  title: string;
  openedAt: number;
}

export interface TabsState {
  list: TabRecord[];
  activeId: string | null;
}

export const EMPTY_TABS: TabsState = { list: [], activeId: null };

let seq = 0;
/** 标签 id：时间基 + 进程内序号（无需 crypto）。 */
function newTabId(): string {
  seq += 1;
  return `t-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** 打开文档：已开 → 仅聚焦；未开 → 新建并聚焦（spec §3.2 总是新开 + 去重）。 */
export function openTab(state: TabsState, docPath: string, title: string, now = Date.now()): TabsState {
  const found = state.list.find((t) => t.docPath === docPath);
  if (found) return found.id === state.activeId ? state : { ...state, activeId: found.id };
  const tab: TabRecord = { id: newTabId(), docPath, title, openedAt: now };
  return { list: [...state.list, tab], activeId: tab.id };
}

/** 关闭标签（spec §3.4）：关当前 → 切相邻（优先右、次左）、关最后一个 → 回首页。 */
export function closeTab(state: TabsState, id: string): { state: TabsState; navigateTo: string | null } {
  const idx = state.list.findIndex((t) => t.id === id);
  if (idx < 0) return { state, navigateTo: null };
  const list = state.list.filter((t) => t.id !== id);
  if (state.activeId !== id) return { state: { ...state, list }, navigateTo: null };
  const next = list[idx] ?? list[idx - 1] ?? null;
  return { state: { list, activeId: next?.id ?? null }, navigateTo: next ? next.docPath : 'home' };
}

/** 回填标题（文档就绪后）；无变化返回原引用。 */
export function renameTab(state: TabsState, id: string, title: string): TabsState {
  if (!title) return state;
  const idx = state.list.findIndex((t) => t.id === id);
  if (idx < 0 || state.list[idx].title === title) return state;
  const list = state.list.slice();
  list[idx] = { ...list[idx], title };
  return { ...state, list };
}

/** 存储清洗（spec §3.6）：损坏/非法 → 空；按 docPath 去重；activeId 非法回退首个。 */
export function sanitizeTabs(raw: unknown): TabsState {
  if (!raw || typeof raw !== 'object') return EMPTY_TABS;
  const obj = raw as { list?: unknown; activeId?: unknown };
  if (!Array.isArray(obj.list)) return EMPTY_TABS;
  const list: TabRecord[] = [];
  for (const item of obj.list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.docPath !== 'string') continue;
    if (list.some((x) => x.docPath === r.docPath)) continue;
    list.push({
      id: r.id,
      docPath: r.docPath,
      title: typeof r.title === 'string' ? r.title : '',
      openedAt: typeof r.openedAt === 'number' && Number.isFinite(r.openedAt) ? r.openedAt : 0,
    });
  }
  const activeId = typeof obj.activeId === 'string' && list.some((t) => t.id === obj.activeId)
    ? obj.activeId
    : (list[0]?.id ?? null);
  return { list, activeId };
}

/** 剔除不在本地树缓存中的标签（spec §3.6 恢复时文档已不存在）；无变化返回原引用。 */
export function pruneMissing(state: TabsState, knownPaths: ReadonlySet<string>): TabsState {
  const list = state.list.filter((t) => knownPaths.has(t.docPath));
  if (list.length === state.list.length) return state;
  const activeId = list.some((t) => t.id === state.activeId) ? state.activeId : null;
  return { list, activeId };
}
```

- [ ] **Step 4: 运行确认通过 + 全链** `npx vitest run tests/unit/tabs.test.ts` → PASS；`npm test && npx tsc --noEmit && CI=1 npm run test:e2e` → 全绿

- [ ] **Step 5: 提交** `git add src/lib/tabs.ts tests/unit/tabs.test.ts && git commit -m "feat: 多标签数据层（打开/关闭/清洗/剔除 + 单测）"`

---

### Task 2: TabsContext + 登记链路

**Files:**
- Create: `src/state/TabsContext.tsx`
- Modify: `src/app/Shell.tsx`（Provider 挂载）
- Modify: `src/pages/DocPage.tsx`（登记 + 标题回填）
- Test: `tests/e2e/multi-tab.spec.ts`（新建）

**Interfaces:**
- Consumes: Task 1 全部纯函数；`kvGet/kvSet`（`src/data/db`）；`docHref/toRouterPath/HOME`（`src/app/nav`）。
- Produces: `useTabs(): { loaded, tabs, ensureTab(docPath), setTitle(docPath, title), activateTab(id), close(id) }`——Task 3 消费。kv 键 `tabs` = `{ list, activeId }`。

- [ ] **Step 1: 写失败 e2e** `tests/e2e/multi-tab.spec.ts`

```ts
import { expect, test } from '@playwright/test';
import { configureAndSync, readKv } from './fixtures';

test('标签登记：打开两篇文档 → kv 记录两条、active 为当前；返回首页保留', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();

  await expect
    .poll(async () => {
      const raw = (await readKv(page, 'tabs')) as { list?: { docPath: string }[]; activeId?: string } | undefined;
      return raw?.list?.map((t) => t.docPath).join(',') ?? '';
    })
    .toBe('a.md,深挖/b.md');

  // 返回首页后标签保留（kv 不变）
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  const raw = (await readKv(page, 'tabs')) as { list?: unknown[] } | undefined;
  expect(raw?.list).toHaveLength(2);
});
```

- [ ] **Step 2: 运行确认失败** `CI=1 npx playwright test tests/e2e/multi-tab.spec.ts` → FAIL（kv 无 tabs）

- [ ] **Step 3: 实现 `src/state/TabsContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOME, docHref, toRouterPath } from '../app/nav';
import { kvGet, kvSet } from '../data/db';
import {
  closeTab, EMPTY_TABS, openTab, pruneMissing, renameTab, sanitizeTabs, type TabsState,
} from '../lib/tabs';

const TABS_KEY = 'tabs';

interface TabsCtx {
  /** kv 载入完成（DocPage 的登记 effect 需等待，避免与恢复竞态）。 */
  loaded: boolean;
  tabs: TabsState;
  /** 打开/聚焦文档（DocPage 挂载时调用）。 */
  ensureTab(docPath: string): void;
  /** 回填标题（文档就绪后）。 */
  setTitle(docPath: string, title: string): void;
  /** 切换器：激活并导航到某标签（当前标签调用为幂等 no-op）。 */
  activateTab(id: string): void;
  /** 关闭标签：关当前 → 自动切相邻/回首页。 */
  close(id: string): void;
}

const Ctx = createContext<TabsCtx>(null!);

export function useTabs(): TabsCtx {
  return useContext(Ctx);
}

/** 多标签状态（spec §3.1）：kv 持久化、跨重启恢复；载入时按本地树缓存剔除已不存在文档。 */
export function TabsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [tabs, setTabs] = useState<TabsState>(EMPTY_TABS);
  const [loaded, setLoaded] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await kvGet<unknown>(TABS_KEY).catch(() => undefined);
      let next = sanitizeTabs(raw);
      const tree = await kvGet<{ entries?: { path?: string }[] }>('tree').catch(() => undefined);
      const paths = new Set(
        (tree?.entries ?? []).map((e) => e.path).filter((p): p is string => typeof p === 'string'),
      );
      if (paths.size > 0) next = pruneMissing(next, paths);
      if (!cancelled) {
        setTabs(next);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 持久化：载入完成后任何状态变化都落盘（含载入时的清洗/剔除结果）。
  useEffect(() => {
    if (!loaded) return;
    void kvSet(TABS_KEY, tabs).catch(() => undefined);
  }, [tabs, loaded]);

  const ensureTab = useCallback((docPath: string) => {
    setTabs((s) => {
      const found = s.list.find((t) => t.docPath === docPath);
      if (found) return found.id === s.activeId ? s : { ...s, activeId: found.id };
      return openTab(s, docPath, '');
    });
  }, []);

  const setTitle = useCallback((docPath: string, title: string) => {
    setTabs((s) => {
      const t = s.list.find((x) => x.docPath === docPath);
      return t ? renameTab(s, t.id, title) : s;
    });
  }, []);

  const activateTab = useCallback((id: string) => {
    const s = tabsRef.current;
    const t = s.list.find((x) => x.id === id);
    if (!t || s.activeId === id) return;
    setTabs((prev) => ({ ...prev, activeId: id }));
    navigate(toRouterPath(docHref(t.docPath)));
  }, [navigate]);

  const close = useCallback((id: string) => {
    const { state: next, navigateTo } = closeTab(tabsRef.current, id);
    setTabs(next);
    if (navigateTo === 'home') navigate(toRouterPath(HOME));
    else if (navigateTo) navigate(toRouterPath(docHref(navigateTo)));
  }, [navigate]);

  const value = useMemo(
    () => ({ loaded, tabs, ensureTab, setTitle, activateTab, close }),
    [loaded, tabs, ensureTab, setTitle, activateTab, close],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 4: Shell 挂载 + DocPage 登记**

`src/app/Shell.tsx`：`OrientationProvider` 内、`<div className="shell">` 外包一层 `<TabsProvider>`（import 自 `../state/TabsContext`）。

`src/pages/DocPage.tsx`：
- import `useTabs`；在组件内取 `const { loaded: tabsLoaded, ensureTab, setTitle: setTabTitle } = useTabs();`
- 在既有 effects 之后加入（spec §3.2 登记链路）：

```tsx
  // 多标签登记（spec §3.2）：载入完成后确保当前文档在标签中并聚焦。
  useEffect(() => {
    if (!tabsLoaded) return;
    ensureTab(path);
  }, [tabsLoaded, path, ensureTab]);

  // 就绪后回填标签标题（切换器显示用）。
  useEffect(() => {
    if (cur.kind === 'ready' && cur.title) setTabTitle(path, cur.title);
  }, [cur, path, setTabTitle]);
```

- [ ] **Step 5: 全链** `npm test && npx tsc --noEmit && CI=1 npm run test:e2e` → 全绿（既有用例不得受影响）

- [ ] **Step 6: 提交** `git add -A && git commit -m "feat: 多标签上下文与登记链路（kv 持久化 + Shell/DocPage 接入）"`

---

### Task 3: 标题切换器 UI

**Files:**
- Modify: `src/components/DocHeader.tsx`
- Modify: `src/styles/content.css`
- Test: `tests/e2e/multi-tab.spec.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的 `useTabs()`。
- Produces: 可访问名契约 `切换标签`（标题按钮）、`打开的标签`（容器）、`关闭标签：<标题>`（关闭钮）；class `.doc-title-btn/.doc-title-caret/.doc-tabs/.doc-tab-row/.doc-tab-current/.doc-tab-open/.doc-tab-title/.doc-tab-close`。

- [ ] **Step 1: 写失败 e2e（追加到 multi-tab.spec.ts）**

```ts
test('多标签：唤出切换器、切换与位置恢复、关闭行为', async ({ page }) => {
  await configureAndSync(page);

  // 打开 A，滚到 50% 等进度落盘
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.round(max * 0.5));
  });
  await page.waitForTimeout(1200);
  const ratio = () =>
    page.evaluate(() => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return window.scrollY / max;
    });
  const aRatio = await ratio();

  // 经文件抽屉打开 B（新标签）
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();

  // 唤出切换器：两行、当前标记在 B
  await page.getByRole('button', { name: '切换标签' }).click();
  const panel = page.getByRole('group', { name: '打开的标签' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.doc-tab-row')).toHaveCount(2);
  await expect(panel.locator('.doc-tab-current')).toContainText('文档 B');

  // 切回 A：位置恢复到 ±5%
  await panel.getByRole('button', { name: '文档 A', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => Math.abs((await ratio()) - aRatio), { message: '切回 A 后位置 ±5% 内' })
    .toBeLessThan(0.05);

  // 关闭当前（A）→ 切到相邻 B；弹层保持打开（便于连续关闭）
  await page.getByRole('button', { name: '切换标签' }).click();
  await page.getByRole('button', { name: '关闭标签：文档 A' }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page).toHaveURL(/#\/doc\//);
  await expect(page.getByRole('group', { name: '打开的标签' }).locator('.doc-tab-row')).toHaveCount(1);

  // 关闭最后一个（B）→ 回首页；重开文档 → 单标签（标题按钮仍在，可再关）
  await page.getByRole('button', { name: '关闭标签：文档 B' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '切换标签' }).click();
  await expect(page.getByRole('group', { name: '打开的标签' }).locator('.doc-tab-row')).toHaveCount(1);
});
```

- [ ] **Step 2: 运行确认失败** `CI=1 npx playwright test tests/e2e/multi-tab.spec.ts -g "切换器"` → FAIL（无「切换标签」按钮）

- [ ] **Step 3: 实现（DocHeader.tsx）**

- import `useTabs`；组件内：`const { tabs, activateTab, close } = useTabs();`，`const [tabsOpen, setTabsOpen] = useState(false);`，`const tabsRef = useRef<HTMLDivElement>(null);`
- 关闭逻辑（与 ⋯ 同款，独立 effect）：

```tsx
  // 切换器弹层：外部 pointerdown / Escape 关闭；标题按钮自身点击由 closest 排除。
  useEffect(() => {
    if (!tabsOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (tabsRef.current?.contains(target as Node)) return;
      if (target?.closest?.('.doc-title-btn')) return;
      setTabsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabsOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [tabsOpen]);
```

- 标题区替换（`<span className="doc-title">` 一行 → 以下；`multi = tabs.list.length >= 2`）：

```tsx
      <button
        type="button"
        className="doc-title doc-title-btn"
        aria-label="切换标签"
        aria-expanded={tabsOpen}
        onClick={() => {
          setMore(false); // 与 ⋯ 互斥
          setTabsOpen((v) => !v);
        }}
      >
        <span className="doc-title-text" title={title || undefined}>{title}</span>
        {tabs.list.length >= 2 && (
          <svg className="doc-title-caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>
      {tabsOpen && (
        <div className="doc-tabs" role="group" aria-label="打开的标签" ref={tabsRef}>
          {tabs.list.map((t) => (
            <div key={t.id} className={t.id === tabs.activeId ? 'doc-tab-row doc-tab-current' : 'doc-tab-row'}>
              <button
                type="button"
                className="doc-tab-open"
                onClick={() => {
                  setTabsOpen(false);
                  activateTab(t.id);
                }}
              >
                <span className="doc-tab-title">{t.title || t.docPath}</span>
              </button>
              <button
                type="button"
                className="doc-tab-close"
                aria-label={`关闭标签：${t.title || t.docPath}`}
                onClick={() => close(t.id)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
```

- ⋯ 按钮 `onClick` 补 `setTabsOpen(false);`（互斥）。
- 顶栏隐藏守卫：`hidden && !more` → `hidden && !more && !tabsOpen`。

- [ ] **Step 4: 样式（content.css 追加）**

```css
/* ========== 标签切换器（spec §3.3） ========== */
.doc-title-btn {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--ink);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.doc-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-title-caret { flex: none; color: var(--ink2); }
.doc-tabs {
  position: absolute;
  top: calc(100% + 6px);
  left: 8px;
  right: 8px;
  z-index: 60;
  background: var(--card);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 6px;
  display: flex;
  flex-direction: column;
  max-height: 60vh;
  overflow-y: auto;
}
.doc-tab-row { display: flex; align-items: center; gap: 2px; border-radius: 8px; }
.doc-tab-current { background: rgba(31, 63, 212, 0.08); }
.doc-tab-open {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 11px 10px;
  border: 0;
  background: none;
  text-align: left;
  font: inherit;
  font-size: 15px;
  color: var(--ink);
  cursor: pointer;
}
.doc-tab-current .doc-tab-open { color: var(--acc-text); font-weight: 600; }
.doc-tab-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-tab-close {
  flex: none;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  color: var(--ink2);
  border-radius: 8px;
  cursor: pointer;
}
.doc-tab-close:hover { background: var(--shell); color: var(--ink); }
```

（`.doc-title` 既有规则保留；按钮复用该类。）

- [ ] **Step 5: 全链** `npm test && npx tsc --noEmit && CI=1 npm run test:e2e` → 全绿

- [ ] **Step 6: 提交** `git add src/components/DocHeader.tsx src/styles/content.css tests/e2e/multi-tab.spec.ts && git commit -m "feat: 标题切换器（唤出/切换/关闭，位置恢复 ±5%）"`

---

### Task 4: 恢复与边界

**Files:**
- Test: `tests/e2e/multi-tab.spec.ts`（追加）；如需修补 → `TabsContext.tsx`/`tabs.ts`（只允许修复，不得改契约）

**Interfaces:**
- Consumes: Task 1–3 全部；fixtures `readKv/writeKv`。

- [ ] **Step 1: 写 e2e（追加）**

```ts
test('多标签：重启恢复与去重', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '文件' }).click();
  await page.getByRole('dialog', { name: '全部文档' }).getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();

  // 重启（整页重载）：标签恢复、当前文档聚焦
  await page.reload();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await page.getByRole('button', { name: '切换标签' }).click();
  const panel = page.getByRole('group', { name: '打开的标签' });
  await expect(panel.locator('.doc-tab-row')).toHaveCount(2);
  await expect(panel.locator('.doc-tab-current')).toContainText('文档 B');
  await page.keyboard.press('Escape');

  // 去重：返回首页 → 重开 B → 仍为两条（聚焦已有，不新开）
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await page.getByRole('button', { name: '切换标签' }).click();
  await expect(page.getByRole('group', { name: '打开的标签' }).locator('.doc-tab-row')).toHaveCount(2);
});

test('多标签：边界（损坏清理 / 缺失剔除）', async ({ page }) => {
  await configureAndSync(page);

  // 损坏存储 → 空标签起步（打开文档后只有 1 条）
  await writeKv(page, 'tabs', 'garbage');
  await page.reload();
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => ((await readKv(page, 'tabs')) as { list?: unknown[] } | undefined)?.list?.length)
    .toBe(1);

  // 恢复时剔除已不存在的文档（树缓存为准）
  await writeKv(page, 'tabs', {
    list: [
      { id: 't1', docPath: '已删除.md', title: '已删除', openedAt: 1 },
      { id: 't2', docPath: 'a.md', title: '文档 A', openedAt: 2 },
    ],
    activeId: 't1',
  });
  await writeKv(page, 'tree', {
    entries: [
      { path: 'a.md', sha: 'sha-a' },
      { path: '深挖/b.md', sha: 'sha-b' },
      { path: '长文档.md', sha: 'sha-long' },
    ],
  });
  await page.reload();
  await expect
    .poll(async () => {
      const raw = (await readKv(page, 'tabs')) as { list?: { docPath: string }[] } | undefined;
      return raw?.list?.map((t) => t.docPath).join(',') ?? '';
    })
    .toBe('a.md');
});
```

- [ ] **Step 2: 运行** `CI=1 npx playwright test tests/e2e/multi-tab.spec.ts` → 若红：按实现缺陷修补（TabsContext/tabs.ts），不得放宽断言

- [ ] **Step 3: 全链 + 提交** 全链全绿；`git add -A && git commit -m "test: 多标签恢复与边界（重启/去重/损坏/缺失）"`

---

### Task 5: 工艺门与文档

**Files:**
- Modify: `docs/specs/2026-10-19-md-reader-reading-ux-design.md`（§3.3 修订一句）
- Modify: `DESIGN.md`、`PRODUCT.md`
- Create: `docs/acceptance-2026-10-19-multi-tab.md`
- Modify: `package.json`（版本 → `1.3.0`）

- [ ] **Step 1:** spec §3.3 入口句修订为：「入口：点击顶栏标题（**始终可唤出**；标签 ≥2 时标题右侧出现 ▾ 指示；单标签时同样可唤出——用于关闭最后一个标签）」（消除与 §3.4 的可达性矛盾；正文其余不动）。
- [ ] **Step 2:** `DESIGN.md` 阅读页段落补标签切换器（标题按钮/▾/弹层行/关闭/当前标记/位置恢复=进度落位语义）；`PRODUCT.md` 把「阅读页多标签」从未来方向移入已支持（以文件现状措辞为准）。
- [ ] **Step 3:** 新验收清单 `docs/acceptance-2026-10-19-multi-tab.md`：§1 核心（打开两篇→标题 ▾→切换器两行/当前标记→切回恢复 ±5%→关闭当前切相邻→关最后一个回首页）；§2 边界（重启恢复/去重/损坏清理/缺失剔除/返回首页保留）；§3 回归抽查（导航语义/目录/搜索/进度/高亮/离线）；§4 证据表（本地运行、待刷新）。结果列全空。
- [ ] **Step 4:** 检测器跑一次 `node /Users/pw/.agents/skills/impeccable/scripts/detect.mjs --json src/styles src/pages src/components src/state src/lib src/App.tsx`；机械项同轮修复；不重跑。
- [ ] **Step 5:** 版本 `1.3.0`（package.json + lock）；全链（`CI=1`）+ build；计数写入清单证据表。
- [ ] **Step 6:** 提交 `git add -A && git commit -m "docs: 多标签工艺门记录、验收清单与版本 1.3.0"`

---

### Task 6: 合并部署 + 真机验收 + tag v1.3.0（用户关卡）

- [ ] **Step 1:** `git checkout main && git merge multi-tab --no-ff -m "merge: 多标签页（波2，v1.3.0）"`；合并结果全链复跑全绿。
- [ ] **Step 2:** `git push origin main` → 部署 run success → 站点 200。
- [ ] **Step 3:** 发验收请求（清单链接 + 要点）；**等用户真机验收**。
- [ ] **Step 4:** 全过 → 回填清单 → `git tag v1.3.0 && git push origin v1.3.0` → 验证。
- [ ] **Step 5:** 收尾（工作区清理 + 裁定清单交付）。有问题 → 修复轮 → 限定复审 → 重新部署 → 复验。

---

## 计划自查

- **Spec 覆盖**：§3.1→T1/T2/T4；§3.2→T2（统一登记，含首页/抽屉/搜索/互链/PrevNext 所有入口）；§3.3→T3（含修订句）；§3.4→T1/T3；§3.5→T2（返回首页保留、搜索跳转走统一规则）；§3.6→T1/T4；§5.2→T3/T4；§6→T5/T6。
- **占位扫描**：无 TBD；代码步骤含可粘贴实现或精确替换指令。
- **一致性**：`openTab/closeTab/renameTab/sanitizeTabs/pruneMissing` 签名在 T1 定义、T2 消费；`useTabs()` 面在 T2 定义、T3 消费；类名/aria 名在 T3 定义、T3/T4 测试消费；kv 键 `tabs` 形状 `{list, activeId}` 全程一致。
- **已知交叉点**：T2 的登记 effect 以 `loaded` 闸门避免与恢复竞态；T3 顶栏隐藏守卫加 `!tabsOpen`；位置恢复依赖既有进度落位（换文档补写已由 useReadingProgress 保证）。
