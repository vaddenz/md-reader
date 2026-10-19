# md-reader 样式焕新 实施计划（Style Refresh）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把全站（阅读页 / 首页壳子 / 设置 / 组件细节）换装到已选定的「中文阅读器」视觉世界（微信读书一脉 + 浅蓝 `#1F3FD4` 强调），零功能行为变更，仅 spec §1.3 声明的两处适配例外。

**Architecture:** 设计令牌集中在 `base.css`（新 `--page/--shell/--card/--ink/--acc*` 体系，旧 `--c-*` 别名同值更新）→ 各表层按 spec §3 逐屏换装（结构改动仅限：首页顶栏、阅读页顶栏重组 + 底部工具条、续读胶囊、设置分组皮肤）→ 组件细节层收尾 → 工艺门（detect.mjs + DESIGN.md）→ 合并 main 部署 → 真机验收 → tag v1.2.0。

**Tech Stack:** React 18 + TS + Vite PWA；Vitest + Playwright（结构断言为硬约束）；无新增运行时依赖。

**Spec:** `docs/specs/2026-10-19-md-reader-style-refresh-design.md`（权威）；方向契约 `.impeccable/surfaces/src-pages-docpage-tsx.md`（seed `e15d6207`）。

## Global Constraints

- **不改**任何功能/数据/路由/文案语义；唯一两处行为适配 = spec §1.3-1（续读胶囊替代自动恢复）与 §1.3-2（顶栏重组 + 底部工具条，功能项一一对应）。
- 令牌值必须与 spec §2.1 逐字一致：`--page #FAF9F6`、`--shell #F0EFEA`、`--card #FFFFFF`、`--ink #17181A`、`--ink2 #5C6066`、`--line #E4E1DA`、`--acc #1F3FD4`、`--acc-text #1F3FD4`、`--acc-fill #1F3FD4`、`--hl-yellow #FFF1A8`、`--hl-red #FFD9D4`、`--danger #C0392B`；圆角 `14/10/22`（卡/控件/药丸）；海拔只声明一次（软影 `0 6px 18px rgba(40,44,52,.10)`，不再叠边框）。
- **e2e 结构契约不得破坏**（只许改「打开路径」与颜色断言）：`.tree-item`/`.tree-name`（恒 3）、`.home-recents`/`.home-favorites`、`搜索文档` 链接、按钮 aria 名 `返回首页 / 目录 / 文件 / 收藏 / 横屏 / 旋转`、`.doc-content`、`mark.hl-*` 计算背景断言按 §6 更新（`rgb(255,241,168)` / `rgb(255,217,212)`）。
- craft floor：对比度 ≥4.5:1（大字 ≥3:1）、单层海拔、无 kicker、图标全为手绘 SVG（统一 1.9–2 线宽）、选区/光标/滚动条/焦点环全部从令牌取色。
- 每任务结束：`npm test` + `npx tsc --noEmit` 全绿；触碰 e2e 的任务跑相关 spec + `npm run test:e2e`。
- 提交信息 `feat:/fix:/test:/docs:/chore:` 前缀；本计划在 `style-refresh` 工作区（`.worktrees/style-refresh`）执行，不直接动 main。

---

### Task 1: 设计令牌与全局色彩

**Files:**
- Modify: `src/styles/base.css`（`:root` 令牌块重写 + 旧别名同值更新）
- Modify: `src/styles/content.css`（删除 v1.1 遗留的 `:root { --hl-* }` 小块——已上移到 base）
- Test: `tests/e2e/highlight.spec.ts`（两处颜色断言）

**Interfaces:**
- Produces: `--page/--shell/--card/--ink/--ink2/--line/--acc/--acc-text/--acc-fill/--hl-yellow/--hl-red/--danger` 与 `--shadow-card / --r-card(14px) / --r-ctl(10px) / --r-pill(22px)`；旧 `--c-primary/--c-text/--c-bg` 保留为**同值别名**（下游任务前不改名）。
- Consumes: spec §2.1；既有 `--font-sans/--font-mono/--header-h` 不动。

- [ ] **Step 1: 先改断言（RED）**

`tests/e2e/highlight.spec.ts` 两处精确替换：
```ts
// T10 换色用例内：
await expect(page.locator('mark.hl-red')).toHaveCSS('background-color', 'rgb(255, 217, 212)'); // 原 rgb(255, 138, 128)
// T9 预置渲染用例内：
await expect(page.locator('mark.hl-yellow')).toHaveCSS('background-color', 'rgb(255, 241, 168)'); // 原 rgb(255, 235, 59)
```
Run: `npx playwright test tests/e2e/highlight.spec.ts` → Expected: 两处 FAIL（当前仍是旧黄/红）。

- [ ] **Step 2: 令牌实现（GREEN）**

`src/styles/base.css` 的 `:root` 块替换为：
```css
:root {
  /* 阅读器视觉系统（spec §2.1 · 中文阅读器世界 · 浅蓝 #1F3FD4 强调） */
  --page: #FAF9F6;
  --shell: #F0EFEA;
  --card: #FFFFFF;
  --ink: #17181A;
  --ink2: #5C6066;
  --line: #E4E1DA;
  --acc: #1F3FD4;        /* 浅蓝·图形：进度/开关/选中/焦点环（对白 ≥3:1） */
  --acc-text: #1F3FD4;   /* 浅蓝·文字：链接/百分比（纸面 7.3:1） */
  --acc-fill: #1F3FD4;   /* 浅蓝·填充：实心按钮白字（7.7:1）——三者同值，分名保留角色语义 */
  --hl-yellow: #FFF1A8;
  --hl-red: #FFD9D4;
  --danger: #C0392B;
  --shadow-card: 0 6px 18px rgba(40, 44, 52, .10);
  --r-card: 14px;
  --r-ctl: 10px;
  --r-pill: 22px;
  /* 旧别名（同值，T3–T6 逐步改用新名） */
  --c-primary: var(--acc);
  --c-text: var(--ink);
  --c-bg: var(--page);
  --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace;
  --header-h: 48px;
}
```
（保留原 `--font-sans/--font-mono/--header-h` 的实际内容不被误改——以文件现状为准合并。）

`src/styles/content.css`：删除既有 `:root { --hl-yellow: …; --hl-red: … }` 三行块（值已由 base 接管）。

- [ ] **Step 3: 运行** Run: `npx playwright test tests/e2e/highlight.spec.ts` → 全 PASS（含 12 个用例）。
- [ ] **Step 4: 回归** Run: `npm test && npx tsc --noEmit && npm run test:e2e` → 全绿（计数记入报告）。
- [ ] **Step 5: 提交**

```bash
git add src/styles/base.css src/styles/content.css tests/e2e/highlight.spec.ts
git commit -m "feat: 设计令牌与全局色彩（浅蓝 #1F3FD4 强调 / 暖白纸面）"
```

---

### Task 2: 全局表面工艺层

**Files:**
- Modify: `src/styles/base.css`（浏览器表面主题化）

**Interfaces:**
- Consumes: T1 令牌（`--acc/--acc-text/--line/--shell/--card`）。
- Produces: 全局 `::selection`、`caret-color`、焦点环、滚动条主题；body 底色。

- [ ] **Step 1: 实现**（craft floor「浏览器表面也属设计」）

`base.css` 追加：
```css
/* 浏览器表面全部从令牌取色（craft floor） */
body { background: var(--shell); color: var(--ink); }
::selection { background: rgba(31, 63, 212, .22); }
caret-color: /* 挂到 */ input, textarea, [contenteditable] { caret-color: var(--acc-text); }
:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
* { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
::-webkit-scrollbar-track { background: transparent; }
a { text-decoration-thickness: 1px; text-underline-offset: 3px; }
```
（`caret-color` 写成独立规则 `input, textarea, [contenteditable] { caret-color: var(--acc-text); }`——上行示意合并时保持合法 CSS。）

- [ ] **Step 2: 运行** Run: `npm test && npx tsc --noEmit && npm run build && npm run test:e2e` → 全绿（视觉层无断言，回归即门槛）。
- [ ] **Step 3: 提交** `git add src/styles/base.css && git commit -m "feat: 浏览器表面主题化（选区/光标/焦点/滚动条）"`

---

### Task 3: 首页与壳子换装

**Files:**
- Modify: `src/pages/HomePage.tsx`（顶栏 + 搜索行 + 继续阅读卡进度 + FileTree 卡包裹）
- Modify: `src/styles/home.css`（分组卡化重排）
- Test: `tests/e2e/progress.spec.ts`（追加首页断言——既有 `.home-*` 断言必须原样过）

**Interfaces:**
- Consumes: T1/T2 令牌；既有 `recentDocs/getProgress`（`src/data/prefs.ts`）、`FileTree`（DOM 与类名不动）、`SyncBadge`。
- Produces: 首页结构 `.home-header > .home-title(h1 知识库) + .home-settings(设置链接)`；`.home-search` 链接文字仍为「搜索文档」。

- [ ] **Step 1: 写失败 e2e**（progress.spec 追加）
```ts
test('首页壳子：标题顶栏、搜索框、继续阅读卡带进度', async ({ page }) => {
  await configureAndSync(page);
  await expect(page.getByRole('heading', { name: '知识库', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: '搜索文档' })).toBeVisible();   // 结构契约：名称不变
  await expect(page.locator('.home-recents')).toBeVisible();
  await expect(page.locator('.home-recents .home-progress')).toBeVisible();   // 新增进度条节点
});
```
Run: `npx playwright test tests/e2e/progress.spec.ts` → 新用例 FAIL（无 h1/进度条）。

- [ ] **Step 2: 实现 HomePage 结构**

把现有 `.home-top`（搜索 + 齿轮）拆成：
```tsx
<main className="home">
  <header className="home-header">
    <h1 className="home-title">知识库</h1>
    <a className="home-settings" href={SETTINGS} aria-label="设置" title="设置">
      <SettingsIcon />
    </a>
  </header>
  <SyncBadge />
  <a className="home-search" href={searchHref('')}>
    <svg className="home-search-icon" /* 原搜索 svg 不变 */ />
    <span>搜索文档</span>
  </a>
  {/* 继续阅读：保留 .home-recents 类与 h2；首条下加进度条 */}
  {recentShown.length > 0 && (
    <section className="home-section home-recents" aria-labelledby="home-recents-title">
      <h2 className="home-section-title" id="home-recents-title">继续阅读</h2>
      <ul className="home-section-list">
        {recentShown.map((r, i) => (
          <li key={r.path}>
            {docLink(r.path)}
            {i === 0 && firstRatio !== null && (
              <span className="home-progress" aria-hidden="true"><i style={{ width: `${Math.round(firstRatio * 100)}%` }} /></span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )}
  {/* 收藏 / FileTree 结构与类名原样保留；FileTree 外包一层卡： */}
  <div className="home-tree-card">{metas && <FileTree metas={metas} />}</div>
  …（其余分支照旧：home-empty 等）
```
新增读取（`firstRatio`）：
```tsx
const [firstRatio, setFirstRatio] = useState<number | null>(null);
useEffect(() => {
  let cancelled = false;
  const first = recentShown[0]?.path;
  if (!first) { setFirstRatio(null); return; }
  void getProgress(first).then((p) => { if (!cancelled) setFirstRatio(p?.ratio ?? null); }, () => {});
  return () => { cancelled = true; };
}, [recentShown, lastSyncAt]);
```
import 增 `getProgress`（`../data/prefs`）。

- [ ] **Step 3: home.css 换装**（要点，保持既有类名）
```css
.home { max-width: 640px; margin: 0 auto; padding: 0 16px 40px; }
.home-header { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.home-title { font-size: 20px; font-weight: 700; letter-spacing: .06em; margin: 0; }
.home-search { display: flex; align-items: center; gap: 8px; background: #E8E6E0; border-radius: var(--r-ctl);
  padding: 10px 12px; color: #7C7F85; font-size: 14.5px; margin: 4px 0 14px; }
.home-section-title { font-size: 13px; color: var(--ink2); font-weight: 500; margin: 16px 4px 8px; }
.home-section-list { background: var(--card); border-radius: var(--r-card); box-shadow: var(--shadow-card);
  overflow: hidden; list-style: none; margin: 0; padding: 0; }        /* 组标签在上、卡在下 */
.home-section-list li { border-bottom: 1px solid var(--line); }
.home-section-list li:last-child { border-bottom: 0; }
.home-progress { display: block; height: 3px; background: var(--line); position: relative; }
.home-progress i { position: absolute; inset: 0 auto 0 0; background: var(--acc); }
.home-tree-card { background: var(--card); border-radius: var(--r-card); box-shadow: var(--shadow-card);
  overflow: hidden; margin-top: 16px; }
.home-empty { color: var(--ink2); text-align: center; padding: 40px 0; }
```
（`docLink` 行高、hover 底灰、文件树行的分隔线按现有选择器补齐；`.home-favorites` 与 `.home-recents` 共用 `.home-section-list` 卡皮。）

- [ ] **Step 4: 运行** Run: `npx playwright test tests/e2e/progress.spec.ts tests/e2e/reader.spec.ts tests/e2e/search.spec.ts` → 全 PASS（`搜索文档`/`.home-*`/树 3 项契约未破）；`npm test && npx tsc --noEmit`。
- [ ] **Step 5: 提交** `git add src/pages/HomePage.tsx src/styles/home.css tests/e2e/progress.spec.ts && git commit -m "feat: 首页壳子换装（顶栏/搜索框/继续阅读进度卡/分组卡）"`

---

### Task 4a: 阅读页顶栏重组 + ⋯菜单 + 底部工具条

**Files:**
- Modify: `src/components/DocHeader.tsx`（返回/标题/⋯；⋯ 弹出含 文件/横屏/旋转）
- Create: `src/components/BottomBar.tsx`（目录/搜索/外观/收藏/设置）
- Modify: `src/pages/DocPage.tsx`（渲染 BottomBar；`goReadingNav` 帮助函数）
- Modify: `src/styles/content.css`（顶栏/⋯ 弹层/底栏/纸面与留白）
- Test: `tests/e2e/reader.spec.ts`（文件树打开路径 + 追加底栏用例）、`tests/e2e/orientation.spec.ts`（横屏/旋转打开路径）

**Interfaces:**
- Consumes: 现有 DocHeader props（`onOpenTree/onToggleOrientation/onFlipOrientation/onToggleFavorite` 等签名不变）；`rememberScroll`/`toRouterPath`/`searchHref`/`SETTINGS`；T1/T2 令牌。
- Produces: 按钮 aria 名**保持** `返回首页/文件/横屏/旋转/目录/收藏`；新按钮 aria 名 `更多 / 搜索 / 外观 / 设置`；底栏 `<nav className="doc-bottombar" aria-label="阅读工具">`；弹层 `<div className="doc-more" role="group" aria-label="更多操作">`（**内部用 `<button>`**，保持 `getByRole('button', {name:'文件'})` 可用）。

- [ ] **Step 1: 先改 e2e 打开路径（RED：新结构下旧路径失效）**

`tests/e2e/reader.spec.ts` 双抽屉用例内，在 `await page.getByRole('button', { name: '文件' }).click();` 之前插入：
```ts
await page.getByRole('button', { name: '更多' }).click();
```
`tests/e2e/orientation.spec.ts`：所有点击 `横屏`/`旋转` 的位置（头部切换、reject 提示、全屏门控三组）前，统一插入同一行；可在文件顶部加助手：
```ts
async function openMore(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '更多' }).click();
}
```
（其余 `旋转` 可见性断言不变——按钮仍在，只是藏于弹层。）

追加底栏用例到 reader.spec：
```ts
test('底部工具条：搜索与外观直达', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page).toHaveURL(/#\/search/);
  await page.goto('./#/doc/a.md');
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await page.getByRole('button', { name: '外观' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.getByRole('heading', { name: '阅读外观' })).toBeVisible();
});
```
Run: `npx playwright test tests/e2e/reader.spec.ts tests/e2e/orientation.spec.ts` → 因结构未改 + 新用例缺失而 FAIL。

- [ ] **Step 2: DocHeader 重组（⋯ 弹层）**

```tsx
// DocHeader.tsx —— 结构：返回 · 标题 · ⋯；⋯ 弹层承载 文件/横屏/旋转
export default function DocHeader({ title, onOpenToc, onOpenTree, favorite = false, onToggleFavorite,
  orientation, onToggleOrientation, onFlipOrientation }: DocHeaderProps) {
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!more) return;
    const onDown = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [more]);
  const act = (fn?: () => void) => { setMore(false); fn?.(); };
  return (
    <header className="doc-header" ref={moreRef}>
      <button type="button" className="doc-back" aria-label="返回首页"
        onClick={() => navigate(toRouterPath(HOME))}>…原 svg…</button>
      <span className="doc-title" title={title || undefined}>{title}</span>
      <div className="doc-header-actions">
        <button type="button" className="doc-header-btn" aria-label="更多" aria-expanded={more}
          onClick={() => setMore((v) => !v)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="5" cy="12" r="1.9" fill="currentColor" /><circle cx="12" cy="12" r="1.9" fill="currentColor" /><circle cx="19" cy="12" r="1.9" fill="currentColor" />
          </svg>
        </button>
        {more && (
          <div className="doc-more" role="group" aria-label="更多操作">
            {onOpenTree && <button type="button" className="doc-more-item" onClick={() => act(onOpenTree)}>文件</button>}
            {onToggleOrientation && (
              <button type="button" className="doc-more-item" aria-pressed={orientation !== 'portrait'}
                onClick={() => act(onToggleOrientation)}>横屏</button>
            )}
            {orientation && orientation !== 'portrait' && onFlipOrientation && (
              <button type="button" className="doc-more-item" onClick={() => act(onFlipOrientation)}>旋转</button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
```
说明：`onOpenToc`、`onToggleFavorite` **不再在 DocHeader 渲染**（移到 BottomBar）——DocHeader props 签名保留，DocPage 改传给 BottomBar。原文件中「文件/横屏/旋转」按钮块整体迁入弹层。

- [ ] **Step 3: BottomBar 组件**

```tsx
// src/components/BottomBar.tsx
import { useNavigate } from 'react-router-dom';
import { SETTINGS, searchHref, toRouterPath } from '../app/nav';

interface Props {
  onOpenToc?: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** 离开阅读页前记住滚动（与互链/抽屉跳转同口径）。 */
  remember: () => void;
}

/** 阅读页底部工具条（spec §3.2）：目录 / 搜索 / 外观 / 收藏 / 设置。 */
export default function BottomBar({ onOpenToc, favorite = false, onToggleFavorite, remember }: Props) {
  const navigate = useNavigate();
  const go = (to: string) => { remember(); navigate(toRouterPath(to)); };
  return (
    <nav className="doc-bottombar" aria-label="阅读工具">
      {onOpenToc && (
        <button type="button" className="doc-bottombar-item" aria-label="目录" onClick={onOpenToc}>
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h10" /></svg>
        </button>
      )}
      <button type="button" className="doc-bottombar-item" aria-label="搜索" onClick={() => go(searchHref(''))}>
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16.5 16.5 21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <button type="button" className="doc-bottombar-item doc-bottombar-aa" aria-label="外观" onClick={() => go(SETTINGS)}>
        <span aria-hidden="true">Aa</span>
      </button>
      {onToggleFavorite && (
        <button type="button" className="doc-bottombar-item" aria-label="收藏" aria-pressed={favorite}
          onClick={onToggleFavorite}>
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M12 3.6l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9z" /></svg>
        </button>
      )}
      <button type="button" className="doc-bottombar-item" aria-label="设置" onClick={() => go(SETTINGS)}>
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" /><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></svg>
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: DocPage 接线**

```tsx
// 组件内新增：
const goReadingNavRef = null; // 占位说明：实际实现如下——
const remember = useCallback(() => rememberScroll(locationKey, window.scrollY), [locationKey]);
// 渲染树（与 DocHeader 并列，条件与原顶栏按钮一致）：
{ready && (
  <BottomBar
    onOpenToc={tocHeadings.length > 0 ? openToc : undefined}
    favorite={favorite === true}
    onToggleFavorite={favorite === null ? undefined : toggleFav}
    remember={remember}
  />
)}
```
DocHeader 的调用处删除 `onOpenToc/onToggleFavorite`（保留 title/onOpenTree/favorite? 不再需要 favorite——**只传** `title/onOpenTree/orientation/onToggleOrientation/onFlipOrientation`），并把收藏状态改传 BottomBar。
（注意：`DocHeaderProps` 中 `onOpenToc`/`onToggleFavorite` 字段保留但 DocPage 不再传——BottomBar 接管。）

- [ ] **Step 5: 样式（content.css）**

```css
/* 顶栏：白/壳底，标题居中截断 */
.doc-header { position: sticky; top: 0; z-index: 20; height: var(--header-h);
  display: flex; align-items: center; gap: 8px; padding: 0 6px;
  background: rgba(240, 239, 234, .96); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.doc-title { flex: 1; text-align: center; font-size: 16px; font-weight: 600; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.doc-header-actions { position: relative; }
.doc-more { position: absolute; right: 4px; top: calc(100% + 6px); min-width: 132px; background: var(--card);
  border-radius: 12px; box-shadow: var(--shadow-card); padding: 6px; z-index: 60; display: flex; flex-direction: column; }
.doc-more-item { appearance: none; border: 0; background: none; text-align: left; font-size: 15px;
  padding: 11px 12px; border-radius: 8px; color: var(--ink); cursor: pointer; }
.doc-more-item:hover, .doc-more-item:focus-visible { background: var(--shell); }
.doc-more-item[aria-pressed='true'] { color: var(--acc-text); font-weight: 600; }

/* 底部工具条：毛玻璃 + 安全区 */
.doc-bottombar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; height: calc(56px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px); display: flex; justify-content: space-around; align-items: center;
  background: rgba(250, 249, 246, .96); backdrop-filter: blur(8px); border-top: 1px solid var(--line); }
.doc-bottombar-item { appearance: none; border: 0; background: none; min-width: 56px; min-height: 44px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: var(--ink2); font-size: 11px; cursor: pointer; }
.doc-bottombar-item[aria-pressed='true'], .doc-bottombar-item:hover { color: var(--acc-text); }
.doc-bottombar-aa { font-size: 17px; font-weight: 700; color: var(--ink); }

/* 纸面与底栏留白（spec §3.2） */
.doc-content { background: var(--page); padding-bottom: 108px; }   /* 合并进既有 .doc-content 规则 */
```
（`.doc-content` 原 max-width/line-height 等保留；`padding-bottom` 值与底部工具条高度匹配：56+安全区+余量。）

- [ ] **Step 6: 运行** Run: `npx playwright test tests/e2e/reader.spec.ts tests/e2e/orientation.spec.ts tests/e2e/progress.spec.ts tests/e2e/highlight.spec.ts` → 全 PASS；`npm test && npx tsc --noEmit`。
- [ ] **Step 7: 提交**

```bash
git add src/components/DocHeader.tsx src/components/BottomBar.tsx src/pages/DocPage.tsx src/styles/content.css tests/e2e/reader.spec.ts tests/e2e/orientation.spec.ts
git commit -m "feat: 阅读页顶栏重组（⋯菜单）与底部工具条"
```

---

### Task 4b: 续读胶囊（spec §1.3-1 行为适配）

**Files:**
- Modify: `src/pages/DocPage.tsx`（滚动恢复分支 + 胶囊渲染 + 滚动隐藏）
- Modify: `src/styles/content.css`（胶囊样式）
- Test: `tests/e2e/progress.spec.ts`（改写恢复用例 + 新增顶格断言）

**Interfaces:**
- Consumes: 既有恢复优先级链（scroll 记忆 → `?to=` → `?q=` → ~~进度比例~~ → 页首）；`getProgress`；`rememberScroll`。
- Produces: 胶囊按钮 `aria-label="回到上次位置"`；默认停在页首（仅进度分支被替换，记忆/锚点/搜索直达分支不动）。

- [ ] **Step 1: 改写 e2e（RED）**

progress.spec「滚到中部退出，重开恢复」用例的**后半段**替换为：
```ts
  // 重开同一篇：默认停在页首（spec §1.3-1），胶囊承载「回到上次位置」
  await page.getByRole('link', { name: 'a', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 A' })).toBeVisible();
  await expect.poll(() => scrollRatio(page)).toBeLessThan(0.05);
  await page.getByRole('button', { name: '回到上次位置' }).click();
  await expect
    .poll(async () => Math.abs((await scrollRatio(page)) - recorded), { message: '点击胶囊后恢复到 ±5% 内' })
    .toBeLessThan(0.05);
```
并追加小用例：
```ts
test('无进度的文档不出现续读胶囊', async ({ page }) => {
  await configureAndSync(page);
  await page.getByRole('link', { name: 'b', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文档 B' })).toBeVisible();
  await expect(page.getByRole('button', { name: '回到上次位置' })).toHaveCount(0);
});
```
Run: `npx playwright test tests/e2e/progress.spec.ts` → FAIL（当前会自动落位且无胶囊）。

- [ ] **Step 2: 实现（GREEN）**

`DocPage.tsx`：
1. 新状态：`const [progressHint, setProgressHint] = useState<number | null>(null);`
2. 恢复 effect（约 L209–246 的既有链）：把「无记忆/无 ?to/?q 时按进度比例滚动」的分支替换为「只 setProgressHint、不滚动」：
```ts
    // 无 scroll 记忆、无 ?to/?q（spec §1.3-1）：默认停在页首，已保存进度以「续读胶囊」呈现
    let cancelled = false;
    void getProgress(path).catch(() => undefined).then((rec) => {
      if (cancelled) return;
      setProgressHint(rec && rec.ratio > 0.05 ? rec.ratio : null);
    });
    return () => { cancelled = true; };
```
（`?to`/`?q`/记忆分支原样在前，任一命中即 return，不设 hint。）
3. 滚动自动隐藏：
```tsx
useEffect(() => {
  if (progressHint === null) return;
  const hide = () => { if (window.scrollY > 60) setProgressHint(null); };
  window.addEventListener('scroll', hide, { passive: true });
  return () => window.removeEventListener('scroll', hide);
}, [progressHint]);
```
4. 渲染（`ready` 时，工具条上方）：
```tsx
{ready && progressHint !== null && (
  <button
    type="button" className="progress-chip"
    aria-label="回到上次位置"
    onClick={() => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.round(progressHint * max));
      setProgressHint(null);
    }}
  >
    <span className="progress-chip-dot" aria-hidden="true" />
    上次读到 {Math.round(progressHint * 100)}%
  </button>
)}
```

`content.css`：
```css
.progress-chip { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  z-index: 40; display: inline-flex; align-items: center; gap: 8px; border: 0; cursor: pointer;
  background: var(--ink); color: #fff; font-size: 13px; padding: 9px 16px; border-radius: var(--r-pill);
  box-shadow: 0 8px 20px rgba(23, 24, 26, .32); }
.progress-chip-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--acc); }
```

- [ ] **Step 3: 运行** Run: `npx playwright test tests/e2e/progress.spec.ts tests/e2e/reader.spec.ts` → 全 PASS（reader 的返回来源/记忆恢复分支必须仍绿——这是本任务的回归闸）；`npm test && npx tsc --noEmit`。
- [ ] **Step 4: 提交** `git add src/pages/DocPage.tsx src/styles/content.css tests/e2e/progress.spec.ts && git commit -m "feat: 续读胶囊替代自动落位（spec §1.3-1）"`

---

### Task 5: 设置页分组化换装

**Files:**
- Modify: `src/styles/settings.css`（分组卡皮肤 + 控件样式）
- Modify: `src/pages/SettingsPage.tsx`（仅当需要把 h2 调成组标签外观——**优先纯 CSS，结构与 id 不动**）
- Test: `tests/e2e/appearance.spec.ts`、`tests/e2e/settings.spec.ts`（回归为主）

**Interfaces:**
- Consumes: T1/T2 令牌；既有选择器契约（`.settings-section`、`aria-labelledby` 标题 id、`getByRole` 控件名、`appearance-radio` 等）。
- Produces: 九个区块 = 组标签 + 白卡行；单选 ●、滑杆浅蓝钮、实心浅蓝主按钮、危险区红字按钮。

- [ ] **Step 1: 写失败断言**（appearance.spec 追加一条皮肤契约）
```ts
test('设置分组卡皮肤：区块为软影白卡、单选选中为浅蓝', async ({ page }) => {
  await configureAndSync(page);
  await page.goto('./#/settings');
  const section = page.locator('section', { has: page.getByRole('heading', { name: '阅读外观' }) });
  await expect(section).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(section).toHaveCSS('border-radius', '14px');
  await section.getByRole('radio', { name: /等线/ }).check();
  await expect(section.getByRole('radio', { name: /等线/ })).toHaveCSS('accent-color', 'rgb(31, 63, 212)');
});
```
Run: `npx playwright test tests/e2e/appearance.spec.ts` → 新用例 FAIL。

- [ ] **Step 2: settings.css 换装（要点）**
```css
.settings { max-width: 640px; margin: 0 auto; padding: 0 16px 40px; }
.settings-title { font-size: 24px; margin: 8px 0 4px; }
.settings-back { color: var(--acc-text); text-decoration: none; }
/* 区块 = 白卡；h2 作卡内组标签（结构不动，aria 不动） */
.settings-section { background: var(--card); border-radius: var(--r-card); box-shadow: var(--shadow-card);
  padding: 6px 16px 16px; margin: 18px 0 0; border-top: 0; }
.settings-section > h2 { font-size: 12.5px; font-weight: 500; color: var(--ink2); letter-spacing: .04em;
  margin: 10px 0 6px; }
.settings-section input[type='radio'] { accent-color: var(--acc-fill); width: 18px; height: 18px; }
.settings-section input[type='range'] { accent-color: var(--acc); }
.settings-section button { background: var(--acc-fill); color: #fff; border: 0; border-radius: var(--r-ctl);
  padding: 10px 18px; font-size: 15px; }
.settings-section button.ghost, .settings-section .settings-sync-row button { /* 次按钮走灰底幽灵 */
  background: var(--shell); color: var(--ink); }
.settings-error { color: var(--danger); }
.settings-ok { color: var(--acc-text); }
.settings-danger-btn { background: transparent !important; color: var(--danger); border: 1px solid var(--danger) !important; }
```
（`accent-color` 直接吃 T1 令牌；既有 `.appearance-*`/`.settings-*` 类名全部保留。次按钮判别以文件现状选择器为准，实现时逐个核对，避免把主/次按钮写反。）

- [ ] **Step 3: 运行** Run: `npx playwright test tests/e2e/appearance.spec.ts tests/e2e/settings.spec.ts tests/e2e/orientation.spec.ts` → 全 PASS；`npm test && npx tsc --noEmit`。
- [ ] **Step 4: 提交** `git add src/styles/settings.css src/pages/SettingsPage.tsx tests/e2e/appearance.spec.ts && git commit -m "feat: 设置页分组卡换装（组标签/浅蓝控件/危险区）"`

---

### Task 6: 组件细节层

**Files:**
- Modify: `src/styles/drawer.css`（抽屉 = 壳底 + 顶圆角 16 + 软影；行/选中态令牌化）
- Modify: `src/styles/toast.css`（深底圆角胶囊；错误 = `--danger` 底白字）
- Modify: `src/styles/offline-banner.css`（壳底 + 橙状态点，对比度复核）
- Modify: `src/styles/sync-badge.css`（语义色保留、按新底复核；按钮用 `--acc`）
- Modify: `src/styles/menu.css`（右键菜单白卡圆角 12 软影，行 hover 灰）
- Modify: `src/styles/content.css`（代码块深底 `#1B1D21` + hljs 配色适配；mermaid 占位虚线框；图片圆角 10；`.doc-state`/`.home-empty` 空态 = 纸面居中 + 主按钮）
- Test: 既有相关 spec 回归（`reader/highlight/settings/offline/expiry`）

**Interfaces:**
- Consumes: T1/T2 令牌；类名/文案/role 全部不变（e2e 按文本断言 toast/横幅/对话框）。
- Produces: 全站组件皮肤统一；无结构改动。

- [ ] **Step 1: 实现**（按上述清单逐文件；关键值）
```css
/* toast.css */
.toast { background: #17181A; color: #fff; border-radius: var(--r-pill); padding: 11px 18px;
  box-shadow: 0 8px 20px rgba(23, 24, 26, .32); }
.toast--error { background: var(--danger); }
/* menu.css */
.selection-menu { background: var(--card); border-radius: 12px; box-shadow: var(--shadow-card); border: 0; }
.selection-menu-item:hover, .selection-menu-item:focus-visible { background: var(--shell); }
/* content.css 代码块 */
pre.code, pre { background: #1B1D21; color: #E9EBEF; border-radius: 10px; }   /* hljs 令牌随之微调，确保 ≥4.5:1 */
```
hljs 具体 token 色以 content.css 现状逐一改到深底可读（关键字/字符串/注释三类至少复核）。

- [ ] **Step 2: 运行** Run: `npm test && npx tsc --noEmit && npm run build && npm run test:e2e` → 全绿（toast/横幅/对话框均按文本断言，不破）。
- [ ] **Step 3: 提交** `git add src/styles/ && git commit -m "feat: 组件细节层换装（抽屉/toast/横幅/菜单/代码块/空态）"`

---

### Task 7: 工艺门、文档与版本

**Files:**
- Create: `DESIGN.md`（建成世界的记录，documenter 口径）
- Create: `docs/acceptance-2026-10-19-style-refresh.md`（真机验收清单）
- Modify: `package.json` / `package-lock.json`（`1.2.0`）
- 可能的修复: 检测器发现的机械问题（对应文件）

**Interfaces:**
- Consumes: 方向契约 `.impeccable/surfaces/src-pages-docpage-tsx.md`；spec §2/§3；craft floor。
- Produces: 验收清单 = 样张五项对照 + craft 检查点 + 既有功能抽查；版本 1.2.0。

- [ ] **Step 1: 设计检测器**
Run: `node /Users/pw/.agents/skills/impeccable/scripts/detect.mjs --json src/`（一次）；对报告的机械发现逐条修复（不扩大范围），修复后**不重跑**（一次性）。
- [ ] **Step 2: 写 DESIGN.md**（记录：令牌表、字体与形状体系、组件语言、每屏结构、状态与暗/亮决定「浅色由使用场景决定：夜间躺读也用纸面浅色，暗色明确不做」）。逐字包含 spec §2.1 的令牌值。
- [ ] **Step 3: 验收清单** `docs/acceptance-2026-10-19-style-refresh.md`：
  1. 对照样张⑤：首页（顶栏/搜索框/继续阅读卡+进度条/分组卡）、阅读页（顶栏三项/底栏五项/纸面与留白/续读胶囊）、设置（九区块分组卡/浅蓝控件/危险区红）——每项留「结果」空列；
  2. craft 检查点：选区色/焦点环/滚动条、代码块深底可读、toast/横幅/菜单皮肤、对比度目测；
  3. 功能抽查：目录/文件树/搜索/收藏/进度/横屏/高亮/离线（全部走新路径）；
  4. 自动化证据表（实施方本地运行计数，标注待刷新）。
- [ ] **Step 4: 版本 + 全量链**
`package.json` → `1.2.0`（含 lock）。Run: `npm test && npm run typecheck && npm run build && npm run test:e2e` → 全绿并记录计数。
- [ ] **Step 5: 提交** `git add -A && git commit -m "docs: 工艺门记录、验收清单与版本 1.2.0"`

---

### Task 8: 合并部署、真机验收与发版（用户关卡）

- [ ] **Step 1: 合并到 main 并推送（部署）**
```bash
git checkout main && git pull && git merge style-refresh --no-ff -m "merge: 样式焕新（v1.2.0）— 中文阅读器视觉世界"
npm test && npm run test:e2e        # 合并结果必须全绿
git push origin main                # 触发部署；gh run 确认 success
```
（验收需要线上真机可访问；样式分支在验收期间**不删**，后续修复仍在 `style-refresh` 上做再合。）
- [ ] **Step 2: 用户真机验收**（提交验收清单链接，等待结果；问题 → 修复轮 → 复审 → 重新部署）
- [ ] **Step 3: 回填与发版**
验收通过 → 回填 `docs/acceptance-2026-10-19-style-refresh.md`（全项 ✅ + 日期 + 自动化证据刷新）→ `git add docs/… && git commit -m "docs: 样式焕新真机验收通过（v1.2.0）" && git push origin main` → `git tag v1.2.0 && git push origin v1.2.0`。
- [ ] **Step 4: 收尾**
删除 `.mockups/`（本地未跟踪，直接 rm）；保留方向契约（已入库）；向用户交付总结 + 验收记录 + 裁定清单。

---

## 计划自查（写完后核对）

- **Spec 覆盖**：§1.3-2 顶栏/底栏 → T4a；§1.3-1 胶囊 → T4b；§2 令牌 → T1/T2；§3.1 → T3；§3.2 → T4a/4b；§3.3 → T5；§3.4 → T6；§4 craft → T2+T7（detect）；§6 断言清单 → T1（hl 两色）+T7（全量）；§6 流程 → T7/T8。无遗漏。
- **占位扫描**：无 TBD/TODO；代码块均为可直接转写的完整实现；T5 步骤 2 的「以文件现状为准」指向唯一选择器集合并给全关键规则。
- **类型一致性**：DocHeaderProps 字段保留仅改传参（T4a Interfaces 注明）；`getProgress`/`recentDocs`/`rememberScroll`/`searchHref` 签名与现库一致；`--*` 令牌 T1 定义、T2–T6 消费。
