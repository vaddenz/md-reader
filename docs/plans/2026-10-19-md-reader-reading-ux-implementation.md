# 阅读体验修订（波1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 v1.2.0 验收反馈的 4 项功能问题，并把阅读页重构为沉浸形态（去底栏、悬浮目录、⋯ 菜单收口、外观面板、顶栏自动隐藏）、优化首页（继续阅读卡片 / 文件夹置顶+图标 / 同步弱化）——波1，验收后发 v1.2.0。

**Architecture:** 全部改动都在既有「中文阅读器」视觉世界内（令牌取自 `base.css`，DESIGN.md 为权威）。阅读页入口从固定底栏迁移为「悬浮目录按钮 + ⋯ 菜单 + 阅读内外观面板」；恢复链回到 v1.x 默认落位；首页信息层级重排。纯前端，无新依赖、零数据迁移。

**Tech Stack:** React 18 + TS + Vite PWA；Playwright e2e + Vitest 单测；CSS 令牌系统。

**Spec:** `docs/specs/2026-10-19-md-reader-reading-ux-design.md`（本计划逐条实现其 §1/§2/§4 与 §5.1/§6 的波1 部分；执行者先读 spec，再读本计划）

**工作区:** `/Users/pw/workspace/src/md-reader/.worktrees/reading-ux`（分支 `reading-ux`，基于 `main@5a0b573`）。所有命令都在此目录执行。

## Global Constraints

- **令牌取色**：不得新增硬编码颜色；复用 `base.css` 令牌（`--page/--shell/--card/--ink/--ink2/--line/--acc/--acc-text/--acc-fill/--shadow-card/--r-card/--r-ctl/--r-pill`）。既有字面量（如 `.sync-dot-*`）保持不动。
- **结构契约**：`.tree-item` 恒 3；按钮 aria 名保留：`返回首页/目录/搜索/收藏/取消收藏/设置/文件/横屏/旋转/更多/更新目录`；首页 `搜索文档` 链接文案与 `.home-recents`/`.home-favorites` 区块类名保留；`DocHeader` 弹层内一律普通 `<button>`（非 menuitem）。
- **断言纪律**：既有 e2e 断言不得弱化；只为本计划声明的行为变化改写。每任务结束必须全链全绿：`npm test && npx tsc --noEmit && npm run test:e2e`。
- **文案零改动**（除菜单新增项「搜索/收藏/外观/设置」与既定移除项）。
- **无新增运行时依赖**；零数据迁移（prefs 不新增字段；悬浮按钮位置存 localStorage 键 `mdreader.toc-fab`）。
- 每个任务一个提交，提交信息用任务内给定值。

## 任务总览

| # | 任务 | 主要文件 | 规格 |
| --- | --- | --- | --- |
| 1 | 目录抽屉定位当前章节 | `TocDrawer.tsx` / `toc.css` / `reader.spec` | §1.2 |
| 2 | ⋯ 横屏/旋转不关菜单 | `DocHeader.tsx` / `orientation.spec` | §1.3 |
| 3 | 回退胶囊：默认恢复阅读位置 | `DocPage.tsx` / `content.css` / `progress.spec` | §1.4 |
| 4 | 阅读内外观面板（不跳转） | 新 `AppearanceControls/AppearanceSheet` / `BottomBar` / `DocPage` | §1.1, §2.5 |
| 5 | 悬浮目录按钮（拖拽+持久化） | 新 `FloatingTocButton` / `BottomBar` / `content.css` / `toc.test` | §2.3 |
| 6 | 底栏移除 + ⋯ 菜单收口 | `DocHeader` / `DocPage` / 删 `BottomBar` / 多 spec | §2.2, §2.4 |
| 7 | 顶栏滚动自动隐藏 | `DocHeader` / `content.css` / `fixtures.ts` / 多 spec | §2.1 |
| 8 | 首页优化（卡片/分组/页脚） | `HomePage` / `home.css` / `FileTree` / `sync-badge.css` | §4 |
| 9 | 工艺门与文档 | `DESIGN.md` / 验收清单 / detect 一次 | §6 |
| 10 | 合并部署 + 真机验收 + tag | git / 用户关卡 | §6 |

---

### Task 1: 目录抽屉定位当前章节

**Files:**
- Modify: `src/components/TocDrawer.tsx`
- Modify: `src/styles/toc.css:28-32`
- Test: `tests/e2e/reader.spec.ts`（追加用例）

**Interfaces:**
- Consumes: `useScrollSpy`（既有，返回当前激活标题 id）、`Drawer`（`.drawer-body` 为滚动容器）。
- Produces: 抽屉打开时自动把 `.toc-current` 滚到可视区——无对外接口变化。

- [ ] **Step 1: 写失败用例（追加到 reader.spec.ts 末尾）**

```ts
test('目录抽屉：打开时定位到当前章节', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: '长文档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '长文档' })).toBeVisible();

  // 滚到文档中部（20 节的中间），等待 scroll-spy 更新
  await page.evaluate(() => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.round(max * 0.5));
  });
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
  await expect(page.locator('.toc-item.toc-current')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const item = document.querySelector('.toc-item.toc-current');
        const body = item?.closest('.drawer-body');
        if (!item || !body) return false;
        const i = item.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        const center = i.top + i.height / 2;
        return center >= b.top && center <= b.bottom;
      }),
    )
    .toBe(true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/reader.spec.ts -g "定位到当前章节"`
Expected: FAIL —— `.toc-current` 存在但不在抽屉可视区内（poll 超时）。

- [ ] **Step 3: 实现（TocDrawer.tsx）**

```tsx
import { useCallback, useEffect, useMemo, useRef } from 'react';
// …
export default function TocDrawer({ headings, onClose }: TocDrawerProps) {
  const ids = useMemo(() => headings.map((h) => h.id), [headings]);
  const current = useScrollSpy(ids);
  const scrolledRef = useRef(false);

  // 打开时把激活项滚到抽屉可视区（居中；仅首次，不播放平滑动画）——spec §1.2
  useEffect(() => {
    if (scrolledRef.current || !current) return;
    scrolledRef.current = true;
    document.querySelector<HTMLElement>('.toc-item.toc-current')?.scrollIntoView({ block: 'center' });
  }, [current]);
  // …其余不变
```

`toc.css` 的 `.toc-current` 改为：

```css
.toc-current {
  color: var(--acc-text);
  background: rgba(31, 63, 212, 0.08);
  font-weight: 600;
}
```

- [ ] **Step 4: 运行确认通过 + 全链**

Run: `npx playwright test tests/e2e/reader.spec.ts -g "定位到当前章节"` → PASS
Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿（记录计数）

- [ ] **Step 5: 提交**

```bash
git add src/components/TocDrawer.tsx src/styles/toc.css tests/e2e/reader.spec.ts
git commit -m "feat: 目录抽屉打开时定位到当前章节"
```

---

### Task 2: ⋯ 菜单「横屏/旋转」不关闭菜单

**Files:**
- Modify: `src/components/DocHeader.tsx:56-59, 102-116`
- Test: `tests/e2e/orientation.spec.ts`

**Interfaces:**
- Produces: `actStay(fn)`（就地切换类菜单项不关闭弹层）——Task 6 的「收藏」项复用。

- [ ] **Step 1: 改 e2e 并补断言（orientation.spec.ts）**

- 第一处（`头部横屏开关与旋转`）：`横屏` 点击后菜单保持打开——
  `:36-37` 之后追加 `await expect(page.getByRole('group', { name: '更多操作' })).toBeVisible();`；
  删除 `:39` 的 `await openMore(page);`（菜单仍开，`旋转` 就地出现，直接点 `:40`），注释改为「横屏后菜单保持打开（spec §1.3）」。
- 第二处（`浏览器标签：锁被拒时…`）：删除 `:98` 的 `await openMore(page);`（`:99` 直接点「横屏」回竖屏），注释同步。

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/orientation.spec.ts`
Expected: FAIL —— 横屏点击后 `.doc-more` 已关闭（新断言不满足 / 旋转按钮不可见）。

- [ ] **Step 3: 实现（DocHeader.tsx）**

```tsx
  const act = (fn?: () => void) => {
    setMore(false);
    fn?.();
  };

  /** 就地切换类菜单项（横屏/旋转/收藏）：不关闭弹层，便于连续操作（spec §1.3 / §2.4）。 */
  const actStay = (fn?: () => void) => {
    fn?.();
  };
```

`横屏` 项 `onClick={() => actStay(onToggleOrientation)}`；`旋转` 项 `onClick={() => actStay(onFlipOrientation)}`。其余不动。

- [ ] **Step 4: 全链**

Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿

- [ ] **Step 5: 提交**

```bash
git add src/components/DocHeader.tsx tests/e2e/orientation.spec.ts
git commit -m "feat: ⋯ 菜单横屏/旋转点击后保持打开"
```

---

### Task 3: 回退胶囊——打开文档默认恢复阅读位置（§1.4）

**Files:**
- Modify: `src/pages/DocPage.tsx`（状态 103 行、恢复链 285-317、胶囊隐藏 effect 319-325、胶囊 JSX 539-554）
- Modify: `src/styles/content.css:116-135`（删 `.progress-chip*`）
- Test: `tests/e2e/progress.spec.ts`（主用例回归、删胶囊用例）

**Interfaces:**
- Produces: 打开文档的恢复链 = 滚动记忆 → `?to=` → `?q=` → **进度比例自动落位**（v1.x 行为）；`progressHint` 状态与胶囊彻底移除。

- [ ] **Step 1: 改写 e2e（progress.spec.ts）**

主用例（`:12-43`）改写为：

```ts
test('阅读进度：滚到中部退出，重开自动恢复到记录比例（±5%）', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.waitForTimeout(300); // 初次打开（无进度 → 页首）的恢复落定，避免与应用自身的 scrollTo 竞争

  // 滚到约 50%
  await page.evaluate(() => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.round(max * 0.5));
  });
  await page.waitForTimeout(1200); // 等一个节流窗口：进度落盘（≥1s）
  const recorded = await scrollRatio(page);
  expect(recorded).toBeGreaterThan(0.4);
  expect(recorded).toBeLessThan(0.6);

  // 退出到首页：新历史条目没有 scroll 记忆 → 重开时按已保存进度默认落位（spec §1.4）
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page.getByRole('link', { name: '搜索文档' })).toBeVisible();
  await expect(page.locator('.home-recents')).toBeVisible();

  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => Math.abs((await scrollRatio(page)) - recorded), { message: '重开后恢复到 ±5% 内' })
    .toBeLessThan(0.05);
});
```

删除「无进度的文档不出现续读胶囊」（`:45-50`），替换为：

```ts
test('无进度的文档默认停在页首', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect.poll(() => scrollRatio(page)).toBeLessThan(0.05);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/progress.spec.ts`
Expected: FAIL —— 重开停在页首（胶囊方案），自动落位断言不满足。

- [ ] **Step 3: 实现（DocPage.tsx）**

1. 删除 `const [progressHint, setProgressHint] = useState<number | null>(null);`（103 行）。
2. 恢复链入口的胶囊清理删除（286-287 两行：注释 + `setProgressHint(null);`）。
3. 恢复链尾部分支（309-316）替换为：

```tsx
    // 无 scroll 记忆、无 ?to/?q：按已保存进度默认落位（spec §1.4，v1.x 行为）。
    // ratio ≤ 5% 视为「已在首屏」，不滚动。
    let cancelled = false;
    let frame = 0;
    void getProgress(path).catch(() => undefined).then((rec) => {
      if (cancelled || !rec || rec.ratio <= 0.05) return;
      frame = window.requestAnimationFrame(() => {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.round(rec.ratio * max));
        rememberScroll(locationKey, window.scrollY); // 落位写回记忆，下次同条目直接命中记忆分支
      });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
```

4. 删除胶囊隐藏 effect（319-325，含注释）。
5. 删除胶囊 JSX 块（539-554，含注释）。
6. `content.css`：删除 `/* ========== 续读胶囊… ========== */` 整块（116-135，含 `.progress-chip` 与 `.progress-chip-dot`）。

- [ ] **Step 4: 全链**

Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿（`reader.spec` 的记忆/锚点恢复闸必须保持绿）

- [ ] **Step 5: 提交**

```bash
git add src/pages/DocPage.tsx src/styles/content.css tests/e2e/progress.spec.ts
git commit -m "feat: 打开文档默认恢复阅读进度（移除续读胶囊）"
```

---

### Task 4: 阅读内外观面板（外观入口不再跳转设置页）

**Files:**
- Create: `src/components/AppearanceControls.tsx`（共享控件组）
- Create: `src/components/AppearanceSheet.tsx`（阅读内半屏面板）
- Create: `src/styles/appearance.css`（从 settings.css 剪切 `.appearance-*` 控件规则）
- Create: `src/styles/appearance-sheet.css`
- Modify: `src/components/AppearanceSection.tsx`（改用共享控件）
- Modify: `src/components/BottomBar.tsx`（`外观` 改开面板，不再 `go(SETTINGS)`）
- Modify: `src/pages/DocPage.tsx`（面板状态 + 渲染 + 传 prop）
- Test: `tests/e2e/reader.spec.ts`（追加用例）

**Interfaces:**
- Produces: `<AppearanceControls value={ReaderAppearance} onChange={(next) => void} />`；`<AppearanceSheet value onChange onClose />`（挂载即打开）；`BottomBar` 新增 prop `onOpenAppearance?: () => void`。Task 6 的 ⋯「外观」项复用 `onOpenAppearance`。

- [ ] **Step 1: 写失败用例（reader.spec.ts）**

```ts
test('阅读内外观面板：不跳转、调整实时生效、Esc 关闭', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  await page.getByRole('button', { name: '外观' }).click();
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toBeVisible();
  await expect(page).toHaveURL(/#\/doc\//); // 不跳设置页

  const slider = page.locator('.appearance-sheet input[type="range"]').first();
  await slider.fill('19');
  await expect(page.locator('.doc-content')).toHaveCSS('--r-font-size', '19px'); // 实时生效

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '阅读外观' })).toHaveCount(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/reader.spec.ts -g "阅读内外观面板"`
Expected: FAIL —— 点击后跳去 `#/settings`（无面板）。

- [ ] **Step 3: 抽取共享控件**

1. 新建 `src/styles/appearance.css`：把 `settings.css` 中 `.appearance-row`、`.appearance-radio`、`.appearance-slider` 的全部规则**原样剪切**过来（含媒体查询内的相关规则；`.appearance-preview` 及设置页其余样式留在 settings.css）。
2. 新建 `src/components/AppearanceControls.tsx`：

```tsx
import {
  FONT_SIZE_RANGE, SCALE_RANGE, type FontChoice, type ReaderAppearance,
} from '../data/appearance';
import '../styles/appearance.css';

const FONT_OPTIONS: { id: FontChoice; label: string }[] = [
  { id: 'system', label: '系统默认' },
  { id: 'xihei', label: '等线（霞鹜新晰黑）' },
  { id: 'serif', label: '宋体（思源宋体）' },
];

interface Props {
  value: ReaderAppearance;
  onChange: (next: ReaderAppearance) => void;
}

/** 阅读外观控件组（字体/正文字号/表格与引用比例）：设置页外观区与阅读内面板共用（单源）。 */
export default function AppearanceControls({ value, onChange }: Props) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <div className="appearance-row" role="radiogroup" aria-label="正文字体">
        {FONT_OPTIONS.map((o) => (
          <label key={o.id} className="appearance-radio">
            <input
              type="radio" name="appearance-font" checked={value.fontFamily === o.id}
              onChange={() => onChange({ ...value, fontFamily: o.id })}
            />
            {o.label}
          </label>
        ))}
      </div>
      <label className="appearance-slider">
        正文字号 <output>{value.fontSize}px</output>
        <input type="range" min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} step={1} value={value.fontSize}
          onChange={(e) => onChange({ ...value, fontSize: Number(e.target.value) })} />
      </label>
      <label className="appearance-slider">
        表格字号比例 <output>{pct(value.tableScale)}</output>
        <input type="range" min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} value={value.tableScale}
          onChange={(e) => onChange({ ...value, tableScale: Number(e.target.value) })} />
      </label>
      <label className="appearance-slider">
        引用字号比例 <output>{pct(value.quoteScale)}</output>
        <input type="range" min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} value={value.quoteScale}
          onChange={(e) => onChange({ ...value, quoteScale: Number(e.target.value) })} />
      </label>
    </>
  );
}
```

3. `AppearanceSection.tsx`：删除内联控件（`FONT_OPTIONS` 常量与三组控件 JSX），改为 `<AppearanceControls value={a} onChange={update} />`；`FONT_OPTIONS`/`FontChoice` 等不再使用的导入清理；预览块与 `settings-note` 保留。

- [ ] **Step 4: 面板组件**

新建 `src/components/AppearanceSheet.tsx`：

```tsx
import { useEffect, useRef } from 'react';
import { saveAppearance, type ReaderAppearance } from '../data/appearance';
import { showToast } from '../lib/toast';
import AppearanceControls from './AppearanceControls';
import '../styles/appearance-sheet.css';

interface Props {
  value: ReaderAppearance;
  onChange: (next: ReaderAppearance) => void;
  onClose: () => void;
}

/** 阅读内外观面板（spec §2.5）：半屏底部 sheet；调整实时生效、防抖落盘、卸载冲刷。 */
export default function AppearanceSheet({ value, onChange, onClose }: Props) {
  const timer = useRef(0);
  const pending = useRef<ReaderAppearance | null>(null);

  const flush = () => {
    const v = pending.current;
    if (!v) return;
    pending.current = null;
    void saveAppearance(v).catch(() => showToast('外观设置保存失败', { kind: 'error' }));
  };
  useEffect(() => () => { window.clearTimeout(timer.current); flush(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (next: ReaderAppearance) => {
    onChange(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  };

  return (
    <div className="appearance-overlay" onClick={onClose}>
      <div
        className="appearance-sheet"
        role="dialog"
        aria-label="阅读外观"
        onClick={(e) => e.stopPropagation()}
      >
        <AppearanceControls value={value} onChange={update} />
      </div>
    </div>
  );
}
```

新建 `src/styles/appearance-sheet.css`：

```css
/* 阅读内外观面板（spec §2.5） */
.appearance-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(23, 24, 26, 0.32);
  display: flex;
  align-items: flex-end;
}
.appearance-sheet {
  width: 100%;
  max-height: 72vh;
  overflow-y: auto;
  background: var(--card);
  border-radius: var(--r-card) var(--r-card) 0 0;
  box-shadow: var(--shadow-card);
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom, 0px));
}
```

- [ ] **Step 5: 接线（BottomBar + DocPage）**

`BottomBar.tsx`：Props 增 `onOpenAppearance?: () => void;`；`外观` 按钮 `onClick={() => onOpenAppearance?.()}`（删除 `go(SETTINGS)` 调用；`go` 仍被搜索/设置使用）。

`DocPage.tsx`：
- import `AppearanceSheet`；
- 新增 `const [appearanceOpen, setAppearanceOpen] = useState(false);`
- `BottomBar` 增加 `onOpenAppearance={() => setAppearanceOpen(true)}`；
- 在抽屉区附近渲染：`{appearanceOpen && (<AppearanceSheet value={appearance} onChange={setAppearance} onClose={() => setAppearanceOpen(false)} />)}`

- [ ] **Step 6: 全链**

Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿（`appearance.spec` 的设置页断言必须保持绿——控件抽取是原样剪切）

- [ ] **Step 7: 提交**

```bash
git add src/components/AppearanceControls.tsx src/components/AppearanceSheet.tsx src/components/AppearanceSection.tsx src/styles/appearance.css src/styles/appearance-sheet.css src/components/BottomBar.tsx src/pages/DocPage.tsx tests/e2e/reader.spec.ts
git commit -m "feat: 阅读内外观面板（外观入口不再跳转设置页）"
```

---

### Task 5: 悬浮目录按钮（可拖拽、吸附边缘、位置持久化）

**Files:**
- Create: `src/components/FloatingTocButton.tsx`
- Modify: `src/components/BottomBar.tsx`（移除 `目录` 项与 `onOpenToc` prop）
- Modify: `src/pages/DocPage.tsx`（渲染悬浮按钮、停止向 BottomBar 传 `onOpenToc`）
- Modify: `src/styles/content.css`（追加 `.doc-toc-fab`）
- Test: `tests/e2e/reader.spec.ts`、`tests/unit/toc.test.tsx`

**Interfaces:**
- Produces: `<FloatingTocButton onOpen={() => void} />`；localStorage 键 `mdreader.toc-fab` 存 `{ side: 'left'|'right'; y: number }`（y=0 表示默认垂直 55%）。`BottomBar` 不再含目录入口（避免与悬浮按钮同名冲突）。

- [ ] **Step 1: 写失败用例**

reader.spec.ts 追加：

```ts
test('悬浮目录按钮：点击开目录、拖拽后位置持久化', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  const fab = page.getByRole('button', { name: '目录' });
  await expect(fab).toBeVisible();

  // 拖到左侧偏上：down → move → up
  const box = (await fab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(40, 200, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await fab.boundingBox())!.x).toBeLessThan(80);

  // 刷新后仍在左侧（持久化）
  await page.reload();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect
    .poll(async () => (await page.getByRole('button', { name: '目录' }).boundingBox())!.x)
    .toBeLessThan(80);

  // 点击（非拖拽）打开目录
  await page.getByRole('button', { name: '目录' }).click();
  await expect(page.getByRole('dialog', { name: '目录' })).toBeVisible();
});
```

toc.test.tsx：删除 `BottomBar：提供 onOpenToc…` 用例（`:236-254`）与 `BottomBar` import，新增：

```tsx
it('FloatingTocButton：渲染「目录」按钮并回调', () => {
  const onOpen = vi.fn();
  const view = mount(<FloatingTocButton onOpen={onOpen} />);
  const btn = view.container.querySelector<HTMLButtonElement>('button[aria-label="目录"]');
  expect(btn).not.toBeNull();
  act(() => { btn!.click(); });
  expect(onOpen).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/reader.spec.ts -g "悬浮目录按钮"` → FAIL（无悬浮按钮；且此刻页面上只有底栏的「目录」）
Run: `npm test` → FAIL（FloatingTocButton 不存在）

- [ ] **Step 3: 实现 FloatingTocButton.tsx**

```tsx
import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'mdreader.toc-fab';
const BTN = 44;

interface Stored { side: 'left' | 'right'; y: number }

function readStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { side: 'right', y: 0 };
    const v = JSON.parse(raw) as Partial<Stored>;
    return { side: v.side === 'left' ? 'left' : 'right', y: Number.isFinite(v.y) ? (v.y as number) : 0 };
  } catch {
    return { side: 'right', y: 0 };
  }
}

/** 垂直位置 clamp：顶栏下方 ~ 底部安全区上方。 */
function clampY(y: number): number {
  const min = 64;
  const max = Math.max(min, window.innerHeight - 132);
  return Math.min(max, Math.max(min, y));
}

interface Props { onOpen: () => void }

/** 悬浮目录按钮（spec §2.3）：点击开目录；可拖拽，松手吸附最近边缘，位置按设备持久化。 */
export default function FloatingTocButton({ onOpen }: Props) {
  const [pos, setPos] = useState<Stored>(() => readStored());
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const onResize = () => setPos((p) => ({ ...p, y: p.y === 0 ? 0 : clampY(p.y) }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
    suppressClick.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    d.moved = true;
    suppressClick.current = true;
    setDragPos({ x: e.clientX - BTN / 2, y: e.clientY - BTN / 2 });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const moved = d.moved;
    setDragPos(null);
    if (!moved) return;
    const next: Stored = {
      side: e.clientX < window.innerWidth / 2 ? 'left' : 'right',
      y: clampY(e.clientY - BTN / 2),
    };
    setPos(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
  };

  const style: React.CSSProperties = dragPos
    ? { left: dragPos.x, top: dragPos.y }
    : pos.y === 0
      ? ({ [pos.side]: 12, top: '55%' } as React.CSSProperties)
      : ({ [pos.side]: 12, top: pos.y } as React.CSSProperties);

  return (
    <button
      type="button"
      className={dragPos ? 'doc-toc-fab doc-toc-fab-dragging' : 'doc-toc-fab'}
      aria-label="目录"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onOpen();
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h10" />
      </svg>
    </button>
  );
}
```

- [ ] **Step 4: 接线与样式**

`BottomBar.tsx`：删除 `onOpenToc` prop 与「目录」按钮块；注释更新为「搜索 / 外观 / 收藏 / 设置」。

`DocPage.tsx`：`BottomBar` 去掉 `onOpenToc={...}`；在 `<DocHeader …/>` 之后渲染：

```tsx
      {ready && tocHeadings.length > 0 && !tocOpen && (
        <FloatingTocButton onOpen={openToc} />
      )}
```

`content.css` 追加：

```css
/* ========== 悬浮目录按钮（spec §2.3） ========== */
.doc-toc-fab {
  position: fixed;
  z-index: 25;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: var(--card);
  color: var(--ink);
  box-shadow: var(--shadow-card);
  cursor: grab;
  touch-action: none;
}
.doc-toc-fab-dragging { opacity: .85; transform: scale(1.06); cursor: grabbing; }
```

- [ ] **Step 5: 全链**

Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿（既有 `目录` 用例此时命中悬浮按钮，唯一匹配）

- [ ] **Step 6: 提交**

```bash
git add src/components/FloatingTocButton.tsx src/components/BottomBar.tsx src/pages/DocPage.tsx src/styles/content.css tests/e2e/reader.spec.ts tests/unit/toc.test.tsx
git commit -m "feat: 悬浮目录按钮（可拖拽、吸附边缘、位置持久化）"
```

---

### Task 6: 底栏移除 + ⋯ 菜单收口（搜索/收藏/外观/文件/横屏/旋转/设置）

**Files:**
- Delete: `src/components/BottomBar.tsx`
- Modify: `src/components/DocHeader.tsx`
- Modify: `src/pages/DocPage.tsx`
- Modify: `src/styles/content.css`（删 `.doc-bottombar*`；两处 108px → 32px）
- Test: `tests/e2e/reader.spec.ts`、`tests/e2e/progress.spec.ts`、`tests/unit/toc.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `onOpenAppearance`、Task 5 的悬浮按钮、Task 2 的 `actStay`。
- Produces: `DocHeaderProps` 新增 `remember?: () => void; favorite?: boolean; onToggleFavorite?: () => void; onOpenAppearance?: () => void;`，删除死 prop `onOpenToc`。

- [ ] **Step 1: 改写 e2e**

reader.spec.ts 的「底部工具条：搜索与外观直达」（`:96-107`）整体替换为：

```ts
test('⋯ 菜单：搜索/设置导航（底栏已移除）', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect(page.locator('.doc-bottombar')).toHaveCount(0);

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page).toHaveURL(/#\/search/);

  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
});
```

Task 4 新增的面板用例：入口改为 ⋯——`外观` 点击前先 `await page.getByRole('button', { name: '更多' }).click();`。

progress.spec.ts 收藏用例（`:66-93`）中星标交互改走 ⋯（收藏点击后菜单保持打开）：

```ts
  // 未收藏 → ⋯ 菜单点「收藏」→ 已收藏（aria-pressed 切换；菜单保持打开）
  await page.getByRole('button', { name: '更多' }).click();
  const star = page.getByRole('button', { name: '收藏', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // 首页出现「收藏」区块，直达该文档
  await page.keyboard.press('Escape'); // 关掉 ⋯ 再点顶栏
  await page.getByRole('button', { name: '返回首页' }).click();
```

后续「从收藏区进入 → 取消收藏」段同样改为：开 ⋯ → 点 `取消收藏` → 断言 `收藏` aria-pressed false → Escape → 返回首页。

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/reader.spec.ts tests/e2e/progress.spec.ts` → FAIL（底栏仍在、菜单无搜索/设置/收藏）

- [ ] **Step 3: DocHeader 菜单收口**

Props 变更：删 `onOpenToc`；增 `remember?: () => void; favorite?: boolean; onToggleFavorite?: () => void; onOpenAppearance?: () => void;`。弹层渲染（顺序固定）：

```tsx
        {more && (
          <div className="doc-more" role="group" aria-label="更多操作">
            <button type="button" className="doc-more-item" onClick={() => act(() => { remember?.(); navigate(toRouterPath(searchHref(''))); })}>
              搜索
            </button>
            {onToggleFavorite && (
              <button
                type="button"
                className="doc-more-item"
                aria-pressed={favorite === true}
                onClick={() => actStay(onToggleFavorite)}
              >
                {favorite ? '取消收藏' : '收藏'}
              </button>
            )}
            {onOpenAppearance && (
              <button type="button" className="doc-more-item" onClick={() => act(onOpenAppearance)}>
                外观
              </button>
            )}
            {onOpenTree && (
              <button type="button" className="doc-more-item" onClick={() => act(onOpenTree)}>
                文件
              </button>
            )}
            {onToggleOrientation && (
              <button
                type="button"
                className="doc-more-item"
                aria-pressed={orientation !== 'portrait'}
                onClick={() => actStay(onToggleOrientation)}
              >
                横屏
              </button>
            )}
            {orientation && orientation !== 'portrait' && onFlipOrientation && (
              <button type="button" className="doc-more-item" onClick={() => actStay(onFlipOrientation)}>
                旋转
              </button>
            )}
            <button type="button" className="doc-more-item" onClick={() => act(() => { remember?.(); navigate(toRouterPath(SETTINGS)); })}>
              设置
            </button>
          </div>
        )}
```

import 更新：`import { HOME, SETTINGS, searchHref, toRouterPath } from '../app/nav';`；组件 doc 注释同步（入口迁移说明）。

- [ ] **Step 4: DocPage 接线 + 删底栏 + 留白**

`DocPage.tsx`：删 `BottomBar` import 与渲染块；`<DocHeader …/>` 增加 `remember={remember} favorite={favorite === true} onToggleFavorite={favorite === null ? undefined : toggleFav} onOpenAppearance={() => setAppearanceOpen(true)}`；`remember` 的注释更新为「⋯ 菜单导航前记住滚动」。

删除 `src/components/BottomBar.tsx`。

`content.css`：删除 `.doc-bottombar*` 整块（80-114）；`:162` 与 `:480` 两处 `padding: 0 16px calc(108px + env(safe-area-inset-bottom, 0px));` → `padding: 0 16px calc(32px + env(safe-area-inset-bottom, 0px));`（`:479` 注释改为「底部安全区与悬浮按钮留白（工具条已移除）」）。

- [ ] **Step 5: 单测更新**

toc.test.tsx：新增 DocHeader 菜单行为用例（沿用该文件既有 MemoryRouter 挂载模式）：

```tsx
  it('DocHeader ⋯：横屏点击后保持打开、搜索点击后关闭', () => {
    const view = mount(
      <MemoryRouter future={future}>
        <DocHeader title="标题" onToggleOrientation={() => {}} />
      </MemoryRouter>,
    );
    const more = view.container.querySelector<HTMLButtonElement>('button[aria-label="更多"]');
    act(() => { more!.click(); });
    const item = (text: string) =>
      Array.from(view.container.querySelectorAll<HTMLButtonElement>('.doc-more button'))
        .find((b) => b.textContent === text)!;
    act(() => { item('横屏').click(); });
    expect(view.container.querySelector('.doc-more')).not.toBeNull();
    act(() => { item('搜索').click(); });
    expect(view.container.querySelector('.doc-more')).toBeNull();
  });
```

- [ ] **Step 6: 全链**

Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: 底栏移除与 ⋯ 菜单收口（搜索/收藏/外观/设置）"
```

---

### Task 7: 顶栏滚动自动隐藏（沉浸）

**Files:**
- Modify: `src/components/DocHeader.tsx`
- Modify: `src/styles/content.css`（`.doc-header` 过渡与隐藏态）
- Modify: `tests/e2e/fixtures.ts`（`revealHeader` 助手）
- Test: `tests/e2e/reader.spec.ts`（追加用例）；受影响的既有用例补唤出步骤

**Interfaces:**
- Produces: `revealHeader(page)`（fixtures 导出）；顶栏 class 契约 `.doc-header--hidden`（测试断言用）。

- [ ] **Step 1: 助手 + 失败用例**

fixtures.ts 追加：

```ts
/** 顶栏自动隐藏（spec §2.1）后，用小幅上滑唤出（40px，不破坏相对位置断言）。 */
export async function revealHeader(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollBy(0, -40));
  await page.waitForTimeout(120);
}
```

reader.spec.ts 追加：

```ts
test('顶栏自动隐藏：下滑隐藏、上滑显示', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();

  const header = page.locator('.doc-header');
  await expect.poll(async () => (await header.boundingBox())!.y).toBeGreaterThanOrEqual(0);

  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(async () => (await header.boundingBox())!.y).toBeLessThan(-20);

  await page.evaluate(() => window.scrollBy(0, -60));
  await expect.poll(async () => (await header.boundingBox())!.y).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/reader.spec.ts -g "顶栏自动隐藏"` → FAIL（滚下后顶栏仍可见）

- [ ] **Step 3: 实现（DocHeader.tsx）**

```tsx
  // 沉浸（spec §2.1）：正文下滑隐藏顶栏、上滑/回到顶部显示；⋯ 弹层打开期间不隐藏。
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;
        lastY = y;
        if (y <= 80 || delta < -4) setHidden(false);
        else if (delta > 4 && y > 120) setHidden(true);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
```

`header` 元素 class：`hidden && !more ? 'doc-header doc-header--hidden' : 'doc-header'`。

`content.css`：

```css
.doc-header {
  /* …既有属性… */
  transition: transform .18s ease;
}
.doc-header--hidden {
  transform: translateY(-100%);
}
@media (prefers-reduced-motion: reduce) {
  .doc-header { transition: none; }
}
```

- [ ] **Step 4: 既有用例受影响处补唤出（不得弱化断言）**

已知一处：`progress.spec.ts` 主用例中「滚到 50% 后点返回首页」前插入 `await revealHeader(page);`（并 import 该助手）。**其余以全链实测为准**：任何因顶栏隐藏而点击失败的用例，统一在该次点击前插入 `revealHeader(page)`；断言本身不动。

- [ ] **Step 5: 全链**

Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: 顶栏滚动自动隐藏（沉浸）"
```

---

### Task 8: 首页优化（继续阅读卡片 / 文件夹置顶+图标 / 同步信息弱化）

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Modify: `src/styles/home.css`
- Modify: `src/components/FileTree.tsx`
- Modify: `src/styles/sync-badge.css`
- Test: `tests/e2e/progress.spec.ts`（首页壳子用例更新）

**Interfaces:**
- Produces: 新类契约 `.home-cards/.home-card/.home-card-link/.home-card-name/.home-card-meta/.home-card-ring/.home-card-pct`、`.home-footer`、`.tree-group-label/.tree-file-icon/.tree-folder-icon`；`.home-recents`/`.home-favorites`/`.tree-item` 契约不变。

- [ ] **Step 1: 更新 e2e（progress.spec.ts 首页壳子用例）**

`:52-64` 改为：

```ts
test('首页壳子：标题顶栏、搜索框、继续阅读卡片与文件分组', async ({ page }) => {
  await configureAndSync(page);

  // 预置一篇的阅读进度（壳子用例只关心首页渲染，不经由滚动落盘）
  await writeKv(page, 'progress', { 'a.md': { ratio: 0.5, updatedAt: Date.now() } });
  await page.reload();
  await expect(page.locator('.tree-item')).toHaveCount(3);

  await expect(page.getByRole('heading', { name: '知识库', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: '搜索文档' })).toBeVisible(); // 结构契约：名称不变

  // 继续阅读：横向卡片 + 进度百分比
  await expect(page.locator('.home-recents .home-card')).toHaveCount(1);
  await expect(page.locator('.home-recents .home-card-pct')).toHaveText('50%');

  // 文件列表：文件夹组在上、文件组在下，带图标
  await expect(page.locator('.tree-group-label')).toHaveText(['文件夹', '文件']);
  await expect(page.locator('.tree-folder-icon')).toHaveCount(1);
  await expect(page.locator('.tree-file-icon')).toHaveCount(3);

  // 同步信息弱化到页脚（更新目录仍在，可点）
  await expect(page.locator('.home-footer .sync-refresh')).toBeVisible();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/progress.spec.ts -g "首页壳子"` → FAIL（无 `.home-card` / 分组标签）

- [ ] **Step 3: HomePage：继续阅读卡片 + 页脚**

- 状态：`firstRatio` 改为 `recentRatios: Record<string, number>`；effect 改为并行读取 `recentShown` 全部进度：

```tsx
  const [recentRatios, setRecentRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      recentShown.map(async (r) => [r.path, (await getProgress(r.path))?.ratio ?? 0] as const),
    ).then(
      (pairs) => { if (!cancelled) setRecentRatios(Object.fromEntries(pairs)); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [recentShown, lastSyncAt]);
```

- 继续阅读区块 JSX：

```tsx
      {recentShown.length > 0 && (
        <section className="home-section home-recents" aria-labelledby="home-recents-title">
          <h2 className="home-section-title" id="home-recents-title">继续阅读</h2>
          <ul className="home-cards">
            {recentShown.map((r) => {
              const ratio = recentRatios[r.path] ?? 0;
              return (
                <li key={r.path} className="home-card">
                  <a className="home-card-link" href={docHref(r.path)}>
                    <span className="home-card-name">{known.get(r.path)?.title || r.path}</span>
                    <span className="home-card-meta">
                      <svg className="home-card-ring" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--line)" strokeWidth="3" />
                        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--acc)" strokeWidth="3"
                          strokeDasharray={`${Math.round(ratio * 56.5)} 56.5`} strokeLinecap="round"
                          transform="rotate(-90 12 12)" />
                      </svg>
                      <span className="home-card-pct">{Math.round(ratio * 100)}%</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
```

- 顶部 `<SyncBadge />`（`:98`）移到 `<main>` 末尾：

```tsx
      <footer className="home-footer">
        <SyncBadge />
      </footer>
    </main>
```

- [ ] **Step 4: FileTree：文件夹置顶 + 分组标签 + 图标**

- `renderItem`：`.tree-name` 前插入文件图标（`aria-hidden` 内联 svg，`className="tree-file-icon"`，24×16 视图，`d="M7 3h7l4 4v14H7z"` + `d="M14 3v4h4"`）。
- 目录 toggle：名称前插入文件夹图标（`className="tree-folder-icon"`，`d="M3 6h6l2 2h10v12H3z"`）。
- 根 `<ul>`：目录组移到根文件之前，并加分组标签：

```tsx
      <ul className="tree-list">
        {tree.dirs.length > 0 && <li className="tree-group-label" aria-hidden="true">文件夹</li>}
        {tree.dirs.map((dir) => {
          /* …原目录块整体上移到根文件之前，逻辑不变… */
        })}
        {tree.root.length > 0 && <li className="tree-group-label" aria-hidden="true">文件</li>}
        {tree.root.map(renderItem)}
      </ul>
```

（`flattenTree`/`buildTree` 数据层不动——仅渲染顺序。）

- [ ] **Step 5: 样式（home.css / sync-badge.css）**

home.css 追加：

```css
/* 继续阅读：横向卡片（spec §4.1） */
.home-cards {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 2px 2px 8px;
  margin: 0;
  list-style: none;
  scroll-snap-type: x proximity;
}
.home-card {
  flex: 0 0 72%;
  scroll-snap-align: start;
}
.home-card-link {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 92px;
  padding: 14px;
  background: var(--card);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-card);
  text-decoration: none;
  color: var(--ink);
}
.home-card-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.home-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  font-size: 12px;
  color: var(--ink2);
  font-variant-numeric: tabular-nums;
}
.home-card-ring { flex: none; }

/* 页脚：同步信息弱化（spec §4.3） */
.home-footer {
  margin-top: 18px;
}

/* 文件树：分组标签与图标（spec §4.2） */
.tree-group-label {
  padding: 10px 8px 4px;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--ink2);
}
.tree-file-icon,
.tree-folder-icon {
  flex: none;
  color: var(--ink2);
}
```

（`.tree-item` 与 `.tree-dir-toggle` 若为块级布局，改为 `display: flex; align-items: center; gap: 6px;` 以对齐图标——以文件现状为准微调。）

sync-badge.css 改为紧凑页脚口径（保留 `.sync-dot*`、`.sync-spin` 与动画不动）：

```css
.sync-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 0 4px;
  font-size: 12px;
  color: var(--ink2);
}
.sync-badge-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sync-refresh {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.sync-refresh:disabled { opacity: .55; cursor: default; }
@media (hover: hover) {
  .sync-badge-status:hover,
  .sync-refresh:not(:disabled):hover { color: var(--acc-text); }
}
```

（`.sync-dot` 缩到 8px 可选；`.sync-badge-text`、`.sync-icon` 保留。）

- [ ] **Step 6: 全链**

Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿（reader.spec 的「上次同步」与 auth/highlight 的「更新目录」点击均须保持绿）

- [ ] **Step 7: 提交**

```bash
git add src/pages/HomePage.tsx src/styles/home.css src/components/FileTree.tsx src/styles/sync-badge.css tests/e2e/progress.spec.ts
git commit -m "feat: 首页优化（继续阅读卡片/文件夹置顶+图标/同步信息弱化）"
```

---

### Task 9: 工艺门与文档

**Files:**
- Create: `docs/acceptance-2026-10-19-reading-ux.md`
- Modify: `DESIGN.md`
- （版本保持 `1.2.0`，不 bump）

- [ ] **Step 1: 设计检测器（只跑一次）**

Run: `node /Users/pw/.agents/skills/impeccable/scripts/detect.mjs --json src/styles src/pages src/components src/App.tsx`
记录 JSON 发现；机械项同轮修复；修不了的列「留给终审」；**不重跑**。

- [ ] **Step 2: DESIGN.md 同步（按建成态）**

- 移除：续读胶囊、底部工具条条目；
- 新增：悬浮目录按钮（拖拽/吸附/持久化）、⋯ 菜单七项与关闭规则、阅读内外观面板、顶栏自动隐藏、首页继续阅读卡片/文件夹分组图标/页脚同步弱化；
- 校验每条事实对着源码成立（行距 1.9 / tabular-nums 等既有条目不动）。

- [ ] **Step 3: 验收清单**

新建 `docs/acceptance-2026-10-19-reading-ux.md`，三节 + 证据表（结构沿用 `docs/acceptance-2026-10-19-style-refresh.md` 体例）：

- §1 修复项对照（4 项：外观不跳转 / 目录定位 / 横屏菜单不关 / 默认恢复进度）——「结果」列留空；
- §2 重构与首页专项（悬浮按钮拖拽与记忆、⋯ 七项、自动隐藏、卡片/分组/页脚）——结果列留空；
- §3 功能回归抽查（目录/文件树/搜索/收藏/进度/横屏旋转/高亮/离线）——结果列留空；
- §4 自动化证据表：本轮全链计数（标注「实施方本地运行，验收人未复跑，结果待刷新」）。

- [ ] **Step 4: 全链 + 提交**

Run: `npm test && npx tsc --noEmit && npm run build && npm run test:e2e` → 全绿（计数写入清单）
```bash
git add -A
git commit -m "docs: 工艺门记录与验收清单（阅读体验修订）"
```

---

### Task 10: 合并部署 + 真机验收 + tag v1.2.0（用户关卡）

- [ ] **Step 1:** `git checkout main && git pull && git merge reading-ux --no-ff -m "merge: 阅读体验修订（波1，v1.2.0）"`；合并结果上全链复跑全绿。
- [ ] **Step 2:** `git push origin main` → 等部署 run success → 站点 200。
- [ ] **Step 3:** 向用户发验收请求（清单链接 + 要点）；**等待用户真机验收结果**。
- [ ] **Step 4:** 全过 → 回填清单 → `git tag v1.2.0 && git push origin main --tags` → 验证远端标签。
- [ ] **Step 5:** 收尾：清理工作区与 `.mockups/`；收集台账 Ruling 行入交付总结；`finishing-a-development-branch`。
- 若有问题：修复轮 → 限定复审 → 重新部署 → 复验（分支 `reading-ux` 验收期内不删）。

---

## 计划自查

- **Spec 覆盖**：§1.1→T4/T6；§1.2→T1；§1.3→T2；§1.4→T3；§2.1→T7；§2.2→T6；§2.3→T5；§2.4→T6（顺序=搜索/收藏/外观/文件/横屏/旋转/设置）；§2.5→T4；§4.1/4.2/4.3→T8；§5.1→各任务测试步骤；§6→T9/T10。无遗漏。
- **占位扫描**：无 TBD/TODO；所有代码步骤含可粘贴代码或精确到行号的替换指令。
- **一致性**：`actStay`（T2）→ T6 复用；`onOpenAppearance`（T4）→ T6 复用；`revealHeader`（T7）→ 仅 T7 内使用；`.doc-toc-fab`/`.home-card*`/`.tree-group-label` 类名在测试与样式中一致；T4 用例入口在 T6 显式改写（避免漂移）。
- **已知交叉点**：T5 期间「目录」唯一匹配（底栏目录同任务移除）；T7 会波及滚动后点顶栏的既有用例——以全链实测清单为准补 `revealHeader`，不得弱化断言。
