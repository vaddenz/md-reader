# md-reader 实施计划（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个个人自用的 PWA 阅读器：用浏览器舒适地阅读私有 GitHub 仓库 `vaddenz/interview` 中的 Markdown（中文排版 / mermaid / 图片 / 搜索 / 离线 / 灵活目录跳转）。

**Architecture:** 纯静态前端（React + Vite），hash 路由；内容通过 Fine-grained PAT 直连 `api.github.com` 按 git blob SHA 增量同步到 IndexedDB，全量离线可用；渲染内核 markdown-it（工程配置已按真实语料校准，见 Spec §2）；部署于 GitHub Pages。

**Tech Stack:** React 18 / TypeScript / Vite / react-router-dom(hash) / vite-plugin-pwa / markdown-it + markdown-it-mark + github-slugger / mermaid / highlight.js / idb；测试 Vitest + Playwright。

**Spec:** `docs/specs/2026-10-18-md-reader-design.md`（本计划的依据；执行者需同时阅读）

## Global Constraints（全局约束，所有任务默认遵守）

- 工作目录：**`~/workspace/src/md-reader`**（所有命令在此执行；该目录已初始化 git，`main` 分支）。
- Node ≥ 20；使用 npm；不加锁文件以外的工具链（不加 ESLint/Prettier，质量线用 `tsc --noEmit` + 测试）。
- **出站请求仅允许 `https://api.github.com`**；禁止任何 CDN、第三方字体、图标库、分析脚本；图标一律内联 SVG 或本地资源。
- 渲染口径（不得更改）：`html:false`、`breaks:true`、`linkify:true`、`typographer:false`、`==高亮==`（markdown-it-mark）、标题 id 用 github-slugger **裸 slug**（不加 `user-content-` 前缀）。
- **缓存过期（2026-10-18 新增，用户确认）**：正文缓存 7 天未使用自动清理（时钟 = `lastUsedAt`；收藏**不豁免**）；点击未缓存文档按需重下；目录（首页与文件树抽屉）提供「更新目录」手动刷新按钮；搜索**直接跳过**未缓存文档并支持「纳入全文搜索」。
- 界面文案中文；站点启用 `noindex,nofollow`；README、应用「关于」页、引导页三处保留「**个人自用，非通用 Markdown 阅读器**」声明。
- 仓库中**不得提交**：真实 token、个人内容、真实语料拷贝、截图；e2e 全部 mock `api.github.com`。
- 依赖版本按本计划 package.json 的 caret 范围；个别版本号若已不存在，安装该 major 的最新兼容版并在 commit message 说明（不得引入计划外依赖，测试专用依赖除外——计划中已列明）。
- 提交信息格式：`<type>: <中文简述>`（type ∈ feat/fix/test/docs/chore/ci）。
- Vite `base: '/md-reader/'`；hash 路由；不依赖服务端 404 重写。

---

## 文件结构总览（File Structure）

```
md-reader/
├─ .github/workflows/deploy.yml      # Pages 部署
├─ public/                            # favicon.svg, icon-192/512.png（脚本生成）
├─ scripts/                           # gen-icons.mjs, corpus.mjs, conformance.mjs
├─ src/
│  ├─ main.tsx  App.tsx  constants.ts
│  ├─ app/          # nav.ts（路由构造）, scroll.ts（滚动/历史管理）, Shell.tsx
│  ├─ pages/        # Setup / Home / Doc / Search / Settings
│  ├─ components/   # FileTree, TocDrawer, SyncBadge, MermaidBlock, RelatedDocs, OfflineBanner, BackToSource …
│  ├─ markdown/     # render.ts, images.ts, mermaid.ts, highlight.ts
│  ├─ data/         # db.ts, github.ts, sync.ts, paths.ts, links.ts, search.ts, prefs.ts
│  ├─ state/        # TokenContext, SyncContext, DocsContext
│  ├─ lib/          # pool.ts, token.ts, mermaid-loader.ts, format.ts, text.ts
│  └─ styles/       # base.css, content.css, home.css
├─ tests/unit/      # Vitest（逻辑与 DOM 工具）
├─ tests/e2e/       # Playwright（mock api.github.com）
└─ docs/            # specs/ 与 plans/
```

---

# P0 · 脚手架与部署链路

> 阶段验收：手机打开占位页并「添加到主屏幕」。

### Task 1: 项目脚手架与质量基线

**Files:**
- Create: `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`vitest.config.ts`
- Create: `src/main.tsx`、`src/App.tsx`、`src/constants.ts`、`src/styles/base.css`
- Create: `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: `src/constants.ts` 导出 `APP_TITLE: string`、`DEFAULT_REPO: { owner: string; repo: string; branch: string }`（后续所有任务依赖）。

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "md-reader",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "icons": "node scripts/gen-icons.mjs",
    "corpus": "node scripts/corpus.mjs",
    "conformance": "node scripts/conformance.mjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "idb": "^8.0.0",
    "markdown-it": "^14.1.0",
    "markdown-it-mark": "^4.0.0",
    "github-slugger": "^2.0.0",
    "mermaid": "^11.4.0",
    "highlight.js": "^11.10.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/markdown-it": "^14.1.2",
    "@types/node": "^22.10.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.0",
    "vite-plugin-pwa": "^0.21.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3: 写 `vite.config.ts`（本任务先不加 PWA，Task 3 补）**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/md-reader/',
  plugins: [react()],
});
```

- [ ] **Step 4: 写 `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="theme-color" content="#1f6feb" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <title>知识库</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: 写 `src/constants.ts`、`src/main.tsx`、`src/App.tsx`、`src/styles/base.css`**

```ts
// src/constants.ts
export const APP_TITLE = '知识库';
export const DEFAULT_REPO = { owner: 'vaddenz', repo: 'interview', branch: 'main' } as const;
```

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/base.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

```tsx
// src/App.tsx（Task 2 替换为路由，本任务先占位）
import { APP_TITLE } from './constants';

export default function App() {
  return <h1>{APP_TITLE} · 占位页</h1>;
}
```

```css
/* src/styles/base.css */
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC",
    "Source Han Sans SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --c-primary: #1f6feb;
  --c-text: #24292f;
  --c-bg: #ffffff;
  --header-h: 48px;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--c-text);
  background: var(--c-bg);
  line-height: 1.6;
}
```

- [ ] **Step 6: 写 `vitest.config.ts` 与冒烟测试**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'], environment: 'node' },
});
```

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from 'vitest';
import { APP_TITLE, DEFAULT_REPO } from '../../src/constants';

describe('常量', () => {
  it('标题与默认仓库配置就绪', () => {
    expect(APP_TITLE).toBe('知识库');
    expect(DEFAULT_REPO).toEqual({ owner: 'vaddenz', repo: 'interview', branch: 'main' });
  });
});
```

- [ ] **Step 7: 安装与验证**

```bash
npm install
npm run typecheck        # 期望：无错误
npm test                 # 期望：1 passed
npm run build            # 期望：tsc 通过，dist/ 生成
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: 项目脚手架与质量基线"
```

### Task 2: 路由骨架与应用外壳

**Files:**
- Create: `src/app/nav.ts`、`src/app/Shell.tsx`
- Create: `src/pages/HomePage.tsx`、`src/pages/DocPage.tsx`、`src/pages/SearchPage.tsx`、`src/pages/SettingsPage.tsx`、`src/pages/SetupPage.tsx`（均为占位内容）
- Modify: `src/App.tsx`
- Test: `tests/unit/nav.test.ts`

**Interfaces:**
- Produces: `nav.ts` 导出 `docHref(path: string, opts?: { to?: string; q?: string; i?: number }): string`、`searchHref(q: string): string`、`HOME = '#/'`、`SETUP = '#/setup'`、`SETTINGS = '#/settings'`（后续所有导航必须用它构造，不得手拼字符串）。

- [ ] **Step 1: 写失败测试 `tests/unit/nav.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { docHref, searchHref } from '../../src/app/nav';

describe('nav', () => {
  it('文档链接对路径与中文正确编码', () => {
    expect(docHref('智能体/Mem0.md')).toBe('#/doc/' + encodeURIComponent('智能体/Mem0.md'));
  });
  it('带锚点与搜索参数', () => {
    expect(docHref('a.md', { to: '第-1-章' })).toBe('#/doc/a.md?to=' + encodeURIComponent('第-1-章'));
    expect(docHref('a.md', { q: 'MVCC', i: 2 })).toBe('#/doc/a.md?q=MVCC&i=2');
  });
  it('搜索链接', () => {
    expect(searchHref('gVisor 沙箱')).toBe('#/search?q=' + encodeURIComponent('gVisor 沙箱'));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/nav.test.ts` — 期望 FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/app/nav.ts`**

```ts
export const HOME = '#/';
export const SETUP = '#/setup';
export const SETTINGS = '#/settings';

export function docHref(path: string, opts?: { to?: string; q?: string; i?: number }): string {
  const base = `#/doc/${encodeURIComponent(path)}`;
  const params = new URLSearchParams();
  if (opts?.to) params.set('to', opts.to);
  if (opts?.q) params.set('q', opts.q);
  if (opts?.i !== undefined) params.set('i', String(opts.i));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function searchHref(q: string): string {
  return `#/search?q=${encodeURIComponent(q)}`;
}
```

- [ ] **Step 4: 写五个占位页面与 `src/app/Shell.tsx`、改 `src/App.tsx`**

```tsx
// src/app/Shell.tsx
import { Outlet } from 'react-router-dom';

export default function Shell() {
  return (
    <div className="shell">
      <Outlet />
    </div>
  );
}
```

```tsx
// src/App.tsx
import { createHashRouter, RouterProvider } from 'react-router-dom';
import Shell from './app/Shell';
import HomePage from './pages/HomePage';
import DocPage from './pages/DocPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';

const router = createHashRouter([
  { path: '/', element: <Shell />, children: [
    { index: true, element: <HomePage /> },
    { path: 'doc/*', element: <DocPage /> },
    { path: 'search', element: <SearchPage /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: 'setup', element: <SetupPage /> },
  ]},
]);

export default function App() {
  return <RouterProvider router={router} />;
}
```

各占位页面导出同名组件，内容为 `<h1>页面名</h1>`（后续任务逐个替换）。

- [ ] **Step 5: 验证**

```bash
npm test && npm run typecheck && npm run dev   # 浏览器打开 http://localhost:5173/md-reader/#/ 应显示首页；#/settings 可切换
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: hash 路由骨架与页面占位"
```

### Task 3: PWA 壳（图标生成脚本、manifest、Service Worker）

**Files:**
- Create: `scripts/gen-icons.mjs`、`public/favicon.svg`
- Modify: `vite.config.ts`（加 VitePWA）

- [ ] **Step 1: 写图标生成脚本（纯 Node，无依赖）**

```js
// scripts/gen-icons.mjs — 生成 public/icon-192.png 与 icon-512.png（纯色底 + 三条白色"文本行"）
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
};

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [0x1f, 0x6f, 0xeb], fg = [0xff, 0xff, 0xff];
  const barH = Math.round(size * 0.055), gap = Math.round(size * 0.10);
  const w1 = Math.round(size * 0.52), w2 = Math.round(size * 0.36);
  const x0 = Math.round(size * 0.24), y0 = Math.round(size * 0.34);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, bg);
  for (let row = 0; row < 3; row++) {
    const w = row === 2 ? w2 : w1;
    for (let y = y0 + row * (barH + gap); y < y0 + row * (barH + gap) + barH; y++)
      for (let x = x0; x < x0 + w; x++) put(x, y, fg);
  }
  return px;
}

mkdirSync('public', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, png(size, icon(size)));
  console.log(`public/icon-${size}.png 已生成`);
}
```

- [ ] **Step 2: 写 `public/favicon.svg` 并运行生成**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#1f6feb"/>
  <rect x="8" y="10" width="16" height="2.4" rx="1.2" fill="#fff"/>
  <rect x="8" y="15" width="16" height="2.4" rx="1.2" fill="#fff"/>
  <rect x="8" y="20" width="11" height="2.4" rx="1.2" fill="#fff"/>
</svg>
```

Run: `npm run icons` — 期望输出两行，`ls -l public/*.png` 两个文件均 > 0 字节。

- [ ] **Step 3: 在 `vite.config.ts` 中加 PWA**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/md-reader/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '知识库', short_name: '知识库', lang: 'zh-CN',
        description: '个人自用：私有仓库 Markdown 阅读器',
        start_url: './', scope: './', display: 'standalone',
        theme_color: '#1f6feb', background_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
});
```

- [ ] **Step 4: 验证**

```bash
npm run build
ls dist/manifest.webmanifest dist/sw.js dist/icon-192.png   # 三个文件均存在
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: PWA 图标生成脚本与 manifest/SW 配置"
```

### Task 4: GitHub Actions 部署与远端仓库

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: 写部署工作流**

```yaml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
        with:
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 创建远端仓库并推送（需要本机 `gh` 已登录 vaddenz）**

```bash
gh repo create vaddenz/md-reader --public --source . --remote origin --push
git push -u origin main
```

- [ ] **Step 3: 验证部署**

```bash
gh run watch --repo vaddenz/md-reader   # 等 Action 成功
curl -sI https://vaddenz.github.io/md-reader/ | head -3   # 期望 200
curl -s https://vaddenz.github.io/md-reader/ | grep -o 'noindex' | head -1  # 期望输出 noindex
```

- [ ] **Step 4: 用户手机验收（P0 关卡）**

安卓 Chrome 打开 `https://vaddenz.github.io/md-reader/` → 显示占位页 → 菜单「添加到主屏幕」成功、图标正常。**通过后进入 P1。**

- [ ] **Step 5: Commit（如推送后有本地改动）**

```bash
git add -A && git commit -m "ci: Pages 部署工作流"
```

---

# P1 · 数据层（Token / 同步 / 本地库）

> 阶段验收：手机同步 43 篇进 IndexedDB；断网可打开。

### Task 5: IndexedDB 数据层与并发工具

**Files:**
- Create: `src/data/db.ts`、`src/lib/pool.ts`
- Test: `tests/unit/db.test.ts`、`tests/unit/pool.test.ts`

**Interfaces:**
- Produces（后续全部依赖）:
  - `db.ts`: `FileRecord{path,sha,size,text:string|null,title,lastUsedAt,updatedAt}`、`TreeEntry{path,sha,size,type}`、`openDb()`、`getFile(path)`、`putFiles(FileRecord[])`、`deleteFiles(paths:string[])`、`listFilesMeta(): Promise<{path,sha,size,cached,title,lastUsedAt}[]>`、`markExpired(paths:string[])`（`text → null`，保留其余字段）、`touchFile(path, at?)`（刷新 `lastUsedAt`）、`getBlob(sha)`、`putBlob(sha, blob)`、`kvGet<T>(key)`、`kvSet(key, value)`、`storageEstimate()`、`clearAllData()`
  - `kv` 键约定：`config` `{owner,repo,branch}`、`tree` `{syncedAt, entries: TreeEntry[]}`（**含 md 与图片**，供路径→sha 查询）、`links` `{[from:string]: string[]}`、`favorites` `string[]`、`progress` `{[path]:{ratio:number;headingId?:string;updatedAt:number}}`、`lastDoc` `string`、`lastSyncAt` `number`
  - `pool.ts`: `runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>, opts?: { signal?: AbortSignal }): Promise<void>`

- [ ] **Step 1: 写失败测试 `tests/unit/pool.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { runPool } from '../../src/lib/pool';

describe('runPool', () => {
  it('限制并发且全部完成', async () => {
    let running = 0, peak = 0;
    const done: number[] = [];
    await runPool([...Array(10).keys()], 3, async (i) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      done.push(i); running--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(done.sort((a, b) => a - b)).toEqual([...Array(10).keys()]);
  });
});
```

- [ ] **Step 2: 实现 `src/lib/pool.ts`**

```ts
export async function runPool<T>(
  items: T[], limit: number,
  worker: (item: T, index: number) => Promise<void>,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}
```

- [ ] **Step 3: 写失败测试 `tests/unit/db.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, getFile, kvGet, kvSet, listFilesMeta, markExpired, putFiles, deleteFiles, touchFile } from '../../src/data/db';

beforeEach(async () => { await clearAllData(); });

describe('db', () => {
  it('文件写入/读取/删除/元数据（含过期字段）', async () => {
    await putFiles([{ path: 'a.md', sha: 's1', size: 2, text: 'hi', title: 'A', lastUsedAt: 100, updatedAt: 1 }]);
    expect((await getFile('a.md'))?.text).toBe('hi');
    expect(await listFilesMeta()).toEqual([{ path: 'a.md', sha: 's1', size: 2, cached: true, title: 'A', lastUsedAt: 100 }]);
    await deleteFiles(['a.md']);
    expect(await getFile('a.md')).toBeUndefined();
  });
  it('markExpired 清正文保元数据；touchFile 刷新时钟', async () => {
    await putFiles([{ path: 'a.md', sha: 's1', size: 2, text: 'hi', title: 'A', lastUsedAt: 100, updatedAt: 1 }]);
    await markExpired(['a.md']);
    expect(await getFile('a.md')).toMatchObject({ text: null, sha: 's1', title: 'A', lastUsedAt: 100 });
    expect((await listFilesMeta())[0].cached).toBe(false);
    await touchFile('a.md', 999);
    expect((await getFile('a.md'))?.lastUsedAt).toBe(999);
  });
  it('kv 读写与清理', async () => {
    await kvSet('lastSyncAt', 123);
    expect(await kvGet('lastSyncAt')).toBe(123);
    await clearAllData();
    expect(await kvGet('lastSyncAt')).toBeUndefined();
  });
});
```

- [ ] **Step 4: 实现 `src/data/db.ts`**

```ts
import { openDB, type IDBPDatabase } from 'idb';

export interface FileRecord { path: string; sha: string; size: number; text: string | null; title: string; lastUsedAt: number; updatedAt: number }
export interface TreeEntry { path: string; sha: string; size: number; type: 'blob' }

const DB_NAME = 'mdreader';
const SCHEMA_VER = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function open(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, SCHEMA_VER, {
    upgrade(db) {
      for (const name of ['files', 'blobs', 'kv'] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    },
  });
}

export function openDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch(async () => {
      // 自愈：结构损坏/版本冲突 → 删库重建
      await clearAllData();
      dbPromise = null;
      return open();
    });
  }
  return dbPromise;
}

export async function getFile(path: string): Promise<FileRecord | undefined> {
  return (await openDb()).get('files', path);
}
export async function putFiles(files: FileRecord[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  await Promise.all([...files.map((f) => tx.store.put(f, f.path)), tx.done]);
}
export async function deleteFiles(paths: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  await Promise.all([...paths.map((p) => tx.store.delete(p)), tx.done]);
}
export interface FileMeta { path: string; sha: string; size: number; cached: boolean; title: string; lastUsedAt: number }
export async function listFilesMeta(): Promise<FileMeta[]> {
  const all = await (await openDb()).getAll('files');
  return all.map(({ path, sha, size, text, title, lastUsedAt }) => ({ path, sha, size, cached: text !== null, title, lastUsedAt }));
}
export async function markExpired(paths: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  await Promise.all([
    ...paths.map(async (p) => {
      const rec = await tx.store.get(p);
      if (rec) await tx.store.put({ ...rec, text: null, updatedAt: Date.now() }, p);
    }),
    tx.done,
  ]);
}
export async function touchFile(path: string, at = Date.now()): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  const rec = await tx.store.get(path);
  if (rec) await tx.store.put({ ...rec, lastUsedAt: at }, path);
  await tx.done;
}
export async function getBlob(sha: string) {
  return (await (await openDb()).get('blobs', sha)) as { sha: string; blob: Blob; updatedAt: number } | undefined;
}
export async function putBlob(sha: string, blob: Blob): Promise<void> {
  await (await openDb()).put('blobs', { sha, blob, updatedAt: Date.now() }, sha);
}
export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await openDb()).get('kv', key) as Promise<T | undefined>;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await openDb()).put('kv', value, key);
}
export async function storageEstimate() {
  const e = await navigator.storage?.estimate?.();
  return { usage: e?.usage ?? 0, quota: e?.quota ?? 0 };
}
export async function clearAllData(): Promise<void> {
  try {
    const db = dbPromise ? await dbPromise.catch(() => null) : null;
    if (db) db.close();
    dbPromise = null;
    await indexedDB.deleteDatabase(DB_NAME);
  } finally {
    dbPromise = null;
  }
}
```

- [ ] **Step 5: 验证**

```bash
npx vitest run tests/unit/pool.test.ts tests/unit/db.test.ts   # 期望全 PASS
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: IndexedDB 数据层与并发池工具"
```

### Task 6: GitHub API 客户端

**Files:**
- Create: `src/data/github.ts`
- Test: `tests/unit/github.test.ts`

**Interfaces:**
- Produces:
  - `class GitHubClient { constructor(token: string); getUser(): Promise<{login:string}>; getRepo(owner,repo): Promise<{default_branch:string}>; getTree(owner,repo,branch): Promise<TreeEntry[]>; getBlobText(owner,repo,sha): Promise<string>; getBlobBytes(owner,repo,sha): Promise<Blob> }`
  - `class GitHubError extends Error { kind: 'auth'|'notfound'|'ratelimit'|'network'|'unknown'; status?: number; resetAt?: number }`

- [ ] **Step 1: 写失败测试**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError } from '../../src/data/github';

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
}

describe('GitHubClient', () => {
  it('请求携带 Bearer 头并返回 JSON', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ login: 'vaddenz' }), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const me = await new GitHubClient('t').getUser();
    expect(me.login).toBe('vaddenz');
    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Bearer t');
  });
  it('401 → auth 错误', async () => {
    stub(401, {});
    await expect(new GitHubClient('t').getUser()).rejects.toMatchObject({ kind: 'auth' });
  });
  it('403 且限流 → ratelimit 错误带 resetAt', async () => {
    stub(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1000' });
    await expect(new GitHubClient('t').getUser()).rejects.toMatchObject({ kind: 'ratelimit', resetAt: 1000000 });
  });
  it('getTree 过滤 blob 并拒绝 truncated', async () => {
    stub(200, { tree: [{ path: 'a.md', sha: 's1', size: 1, type: 'blob' }, { path: 'd', sha: 's2', size: 0, type: 'tree' }] });
    expect(await new GitHubClient('t').getTree('o', 'r', 'main')).toEqual([{ path: 'a.md', sha: 's1', size: 1, type: 'blob' }]);
    stub(200, { tree: [], truncated: true });
    await expect(new GitHubClient('t').getTree('o', 'r', 'main')).rejects.toBeInstanceOf(GitHubError);
  });
});
```

- [ ] **Step 2: 实现 `src/data/github.ts`**

```ts
import type { TreeEntry } from './db';

export type GitHubErrorKind = 'auth' | 'notfound' | 'ratelimit' | 'network' | 'unknown';

export class GitHubError extends Error {
  constructor(public kind: GitHubErrorKind, message: string, public status?: number, public resetAt?: number) {
    super(message);
    this.name = 'GitHubError';
  }
}

const API = 'https://api.github.com';

export class GitHubClient {
  constructor(private token: string) {}

  private async request(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(API + path, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      });
    } catch {
      throw new GitHubError('network', '网络不可用');
    }
    if (res.status === 401) throw new GitHubError('auth', 'Token 无效或已过期', 401);
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      throw new GitHubError('ratelimit', 'API 限流', 403, reset);
    }
    if (res.status === 404) throw new GitHubError('notfound', '仓库或文件不存在', 404);
    if (!res.ok) throw new GitHubError('unknown', `GitHub API 错误 ${res.status}`, res.status);
    return res;
  }

  async getUser(): Promise<{ login: string }> {
    return (await this.request('/user')).json();
  }
  async getRepo(owner: string, repo: string): Promise<{ default_branch: string }> {
    return (await this.request(`/repos/${owner}/${repo}`)).json();
  }
  async getTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
    const res = await this.request(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const data = await res.json();
    if (data.truncated) throw new GitHubError('unknown', '仓库目录树过大（truncated）');
    return (data.tree as TreeEntry[]).filter((e) => e.type === 'blob');
  }
  async getBlobText(owner: string, repo: string, sha: string): Promise<string> {
    return (await this.request(`/repos/${owner}/${repo}/git/blobs/${sha}`, 'application/vnd.github.raw')).text();
  }
  async getBlobBytes(owner: string, repo: string, sha: string): Promise<Blob> {
    return (await this.request(`/repos/${owner}/${repo}/git/blobs/${sha}`, 'application/vnd.github.raw')).blob();
  }
}
```

- [ ] **Step 3: 验证并提交**

```bash
npx vitest run tests/unit/github.test.ts && npm run typecheck
git add -A && git commit -m "feat: GitHub API 客户端与错误分类"
```

### Task 7: Token 管理与引导页

**Files:**
- Create: `src/lib/token.ts`、`src/state/TokenContext.tsx`、`src/pages/SetupPage.tsx`（替换占位）
- Test: `tests/unit/token.test.ts`
- Modify: `src/app/Shell.tsx`（包 Provider）

**Interfaces:**
- Produces: `token.ts`：`loadToken(): string | null`、`saveToken(t: string): void`、`clearToken(): void`（localStorage 键 `mdreader.token`）；`TokenContext`：`useToken(): { token: string | null; setToken(t: string): void; clear(): void }`。

- [ ] **Step 1: 写失败测试**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { clearToken, loadToken, saveToken } from '../../src/lib/token';

beforeEach(() => { localStorage.clear?.(); });

describe('token 存储', () => {
  it('保存/读取/清除', () => {
    expect(loadToken()).toBeNull();
    saveToken('ghp_x');
    expect(loadToken()).toBe('ghp_x');
    clearToken();
    expect(loadToken()).toBeNull();
  });
});
```

（vitest environment 为 node，`localStorage` 不存在时该测试会失败——在 `src/lib/token.ts` 中用 `globalThis.localStorage` 访问；若 node 环境无该 API，Step 2 中给测试文件头部加 `import 'fake-indexeddb/auto'` 不解决——改为在 `tests/unit/token.test.ts` 顶部自建最小 mock：）

```ts
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
```

- [ ] **Step 2: 实现 `src/lib/token.ts` 与 `src/state/TokenContext.tsx`**

```ts
// src/lib/token.ts
const KEY = 'mdreader.token';
export function loadToken(): string | null { return globalThis.localStorage?.getItem(KEY) ?? null; }
export function saveToken(t: string): void { globalThis.localStorage?.setItem(KEY, t); }
export function clearToken(): void { globalThis.localStorage?.removeItem(KEY); }
```

```tsx
// src/state/TokenContext.tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { clearToken, loadToken, saveToken } from '../lib/token';

interface TokenCtx { token: string | null; setToken(t: string): void; clear(): void }
const Ctx = createContext<TokenCtx>(null!);

export function TokenProvider({ children }: { children: ReactNode }) {
  const [token, set] = useState<string | null>(() => loadToken());
  const setToken = useCallback((t: string) => { saveToken(t); set(t); }, []);
  const clear = useCallback(() => { clearToken(); set(null); }, []);
  return <Ctx.Provider value={{ token, setToken, clear }}>{children}</Ctx.Provider>;
}
export const useToken = () => useContext(Ctx);
```

- [ ] **Step 3: 实现 `src/pages/SetupPage.tsx`（含创建指引与校验）**

要点（完整实现按此结构）：
- 未登录时展示 4 步图文指引：打开 GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained**；`Repository access` 选 `vaddenz/interview`；`Permissions → Contents: Read-only`；生成后粘贴。
- 输入框 >「验证并保存」按钮：`new GitHubClient(token).getUser()` 成功 → `setToken` → `kvSet('config', DEFAULT_REPO)`（若不存在）→ `navigate(HOME)`；失败按 `GitHubError.kind` 显示对应文案（auth=「Token 无效」，network=「网络不可用」）。
- 页脚声明：「本应用仅供个人自用（非通用 Markdown 阅读器）」。

- [ ] **Step 4: 验证**

```bash
npx vitest run tests/unit/token.test.ts && npm run typecheck && npm run dev
# 手动：访问 #/setup，粘贴任意假 token，应显示「Token 无效或已过期」
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Token 管理与引导页"
```

### Task 8: 同步引擎（增量、断点、互链索引）

**Files:**
- Create: `src/data/paths.ts`、`src/data/links.ts`、`src/data/sync.ts`、`src/lib/text.ts`
- Test: `tests/unit/paths.test.ts`、`tests/unit/diff.test.ts`、`tests/unit/links.test.ts`、`tests/unit/sync.test.ts`

**Interfaces:**
- Produces:
  - `paths.ts`: `normalizeRepoPath(p:string):string`、`resolveMdLink(fromPath:string, href:string): {path:string; anchor?:string} | null`、`resolveAssetPath(fromPath:string, src:string): string | null`、`isDoc(p):boolean`、`isImage(p):boolean`
  - `links.ts`: `buildLinksIndex(docs:{path:string;text:string}[]): Record<string,string[]>`、`getRelated(path:string, index:Record<string,string[]>): { out: string[]; in: string[] }`
  - `sync.ts`: `diffTree(localShaByPath:Record<string,string>, remote:TreeEntry[])`、`syncRepo(client, cfg, onProgress, opts?): Promise<SyncResult>`、`sweepExpired(ttlMs?): Promise<number>`（清理超期正文，返回清理数）、`downloadDocText(client, cfg, path): Promise<string>`（按需下载未缓存文档并刷新 `lastUsedAt`）、类型 `SyncProgress{phase:'tree'|'download'|'cleanup'|'done';done:number;total:number}`、`SyncResult{added:number;updated:number;deleted:number;totalDocs:number;bytes:number}`
  - `lib/text.ts`: `extractTitle(md: string, fallback?: string): string`（取首个 `# ` 标题；缺省用文件名去 `.md`）

- [ ] **Step 1: 写失败测试（paths / diff / links）**

```ts
// tests/unit/paths.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeRepoPath, resolveAssetPath, resolveMdLink } from '../../src/data/paths';

describe('paths', () => {
  it('相对链接解析', () => {
    expect(resolveMdLink('智能体/Mem0.md', '../NodeJS/事件与循环机制.md')).toEqual({ path: 'NodeJS/事件与循环机制.md' });
    expect(resolveMdLink('a.md', './b.md')).toEqual({ path: 'b.md' });
    expect(resolveMdLink('a.md', 'NodeJS/x.md#第三章')).toEqual({ path: 'NodeJS/x.md', anchor: '第三章' });
    expect(resolveMdLink('a.md', '#自己的锚点')).toEqual({ path: 'a.md', anchor: '自己的锚点' });
  });
  it('URL 编码与非法输入', () => {
    expect(resolveMdLink('a.md', encodeURI('子目录/中文 文件.md'))).toEqual({ path: '子目录/中文 文件.md' });
    expect(resolveMdLink('a.md', 'https://x.com/a.md')).toBeNull();
    expect(resolveMdLink('a.md', 'img.png')).toBeNull();
  });
  it('normalize 与资源路径', () => {
    expect(normalizeRepoPath('./a/../b/./c.md')).toBe('b/c.md');
    expect(resolveAssetPath('智能体/Mem0.md', '../assets/pic 1.png')).toBe('assets/pic 1.png');
    expect(resolveAssetPath('a.md', 'https://x/p.png')).toBeNull();
  });
});

// tests/unit/diff.test.ts
import { describe, expect, it } from 'vitest';
import { diffTree } from '../../src/data/sync';

describe('diffTree', () => {
  const remote = [
    { path: 'a.md', sha: 's1', size: 1, type: 'blob' as const },
    { path: 'b.md', sha: 's2', size: 1, type: 'blob' as const },
  ];
  it('四态：新增/修改/删除/无变化', () => {
    const d = diffTree({ 'a.md': 's1', 'c.md': 'sX' }, remote);
    expect(d.added.map((e) => e.path)).toEqual(['b.md']);
    expect(d.updated).toEqual([]);
    expect(d.deleted).toEqual(['c.md']);
    const d2 = diffTree({ 'a.md': 'old', 'b.md': 's2' }, remote);
    expect(d2.updated.map((e) => e.path)).toEqual(['a.md']);
    expect(diffTree({ 'a.md': 's1', 'b.md': 's2' }, remote)).toEqual({ added: [], updated: [], deleted: [] });
  });
});

// tests/unit/links.test.ts
import { describe, expect, it } from 'vitest';
import { buildLinksIndex, getRelated } from '../../src/data/links';

describe('links', () => {
  it('互链索引与反向查询', () => {
    const idx = buildLinksIndex([
      { path: 'a.md', text: '见 [x](b.md) 与 [y](子/c.md)' },
      { path: 'b.md', text: '回 [a](a.md)' },
    ]);
    expect(idx['a.md']).toEqual(['b.md', '子/c.md']);
    expect(getRelated('b.md', idx)).toEqual({ out: ['a.md'], in: ['a.md'] });
  });
});
```

- [ ] **Step 2: 实现三模块**

```ts
// src/data/paths.ts
export const isDoc = (p: string) => p.endsWith('.md');
export const isImage = (p: string) => /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(p);

export function normalizeRepoPath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function decode(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function resolveMdLink(fromPath: string, href: string): { path: string; anchor?: string } | null {
  if (/^(https?:|mailto:|tel:|data:)/i.test(href)) return null;
  if (href.startsWith('#')) return { path: fromPath, anchor: decode(href.slice(1)) ?? undefined };
  const [rawPath, rawAnchor] = href.split('#');
  const decoded = decode(rawPath) ?? rawPath;
  if (!decoded.endsWith('.md')) return null;
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const joined = decoded.startsWith('/') ? decoded.slice(1) : (dir ? `${dir}/${decoded}` : decoded);
  return { path: normalizeRepoPath(joined), anchor: rawAnchor ? decode(rawAnchor) ?? rawAnchor : undefined };
}

export function resolveAssetPath(fromPath: string, src: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(src)) return null;
  const decoded = decode(src) ?? src;
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const joined = decoded.startsWith('/') ? decoded.slice(1) : (dir ? `${dir}/${decoded}` : decoded);
  return normalizeRepoPath(joined);
}
```

```ts
// src/data/links.ts
import { resolveMdLink } from './paths';

export function buildLinksIndex(docs: { path: string; text: string }[]): Record<string, string[]> {
  const known = new Set(docs.map((d) => d.path));
  const out: Record<string, string[]> = {};
  for (const doc of docs) {
    const targets = new Set<string>();
    for (const m of doc.text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)\s]*)?\)/g)) {
      const hit = resolveMdLink(doc.path, m[1]);
      if (hit && known.has(hit.path) && hit.path !== doc.path) targets.add(hit.path);
    }
    if (targets.size) out[doc.path] = [...targets];
  }
  return out;
}

export function getRelated(path: string, index: Record<string, string[]>) {
  const out = index[path] ?? [];
  const inbound: string[] = [];
  for (const [from, to] of Object.entries(index)) if (to.includes(path)) inbound.push(from);
  return { out, in: inbound };
}
```

```ts
// src/lib/text.ts
/** 提取文档标题：首个一级标题；缺省用文件名（去 .md）。 */
export function extractTitle(md: string, fallback = ''): string {
  const m = /^#\s+(.+)$/m.exec(md);
  if (m) return m[1].trim();
  return fallback.replace(/\.md$/, '');
}
```

```ts
// src/data/sync.ts
import type { GitHubClient } from './github';
import { deleteFiles, getFile, kvGet, kvSet, listFilesMeta, markExpired, putFiles, type TreeEntry } from './db';
import { buildLinksIndex } from './links';
import { isDoc } from './paths';
import { extractTitle } from '../lib/text';
import { runPool } from '../lib/pool';

export interface SyncProgress { phase: 'tree' | 'download' | 'cleanup' | 'done'; done: number; total: number }
export interface SyncResult { added: number; updated: number; deleted: number; totalDocs: number; bytes: number }

export function diffTree(localShaByPath: Record<string, string>, remote: TreeEntry[]) {
  const added: TreeEntry[] = [], updated: TreeEntry[] = [];
  for (const e of remote) {
    const l = localShaByPath[e.path];
    if (l === undefined) added.push(e);
    else if (l !== e.sha) updated.push(e);
  }
  const remotePaths = new Set(remote.map((e) => e.path));
  const deleted = Object.keys(localShaByPath).filter((p) => !remotePaths.has(p));
  return { added, updated, deleted };
}

export const EXPIRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 清理超过 ttl 未使用的文档正文（text → null），返回清理数量。 */
export async function sweepExpired(ttlMs = EXPIRY_TTL_MS, now = Date.now()): Promise<number> {
  const metas = await listFilesMeta();
  const expired = metas.filter((m) => m.cached && now - m.lastUsedAt > ttlMs).map((m) => m.path);
  if (expired.length) await markExpired(expired);
  await kvSet('lastSweepAt', now);
  return expired.length;
}

/** 按需下载未缓存文档（从本地目录树取 sha），写入并刷新 lastUsedAt。 */
export async function downloadDocText(
  client: Pick<GitHubClient, 'getBlobText'>,
  cfg: { owner: string; repo: string; branch: string },
  path: string,
): Promise<string> {
  const tree = await kvGet<{ entries: TreeEntry[] }>('tree');
  const entry = tree?.entries.find((e) => e.path === path);
  if (!entry) throw new Error('文件不在本地目录树中，请先更新目录');
  const text = await client.getBlobText(cfg.owner, cfg.repo, entry.sha);
  const now = Date.now();
  await putFiles([{ path, sha: entry.sha, size: entry.size, text, title: extractTitle(text, path), lastUsedAt: now, updatedAt: now }]);
  return text;
}

export async function syncRepo(
  client: Pick<GitHubClient, 'getTree' | 'getBlobText'>,
  cfg: { owner: string; repo: string; branch: string },
  onProgress: (p: SyncProgress) => void,
  opts?: { signal?: AbortSignal },
): Promise<SyncResult> {
  onProgress({ phase: 'tree', done: 0, total: 1 });
  const tree = await client.getTree(cfg.owner, cfg.repo, cfg.branch);
  const docs = tree.filter((e) => isDoc(e.path));

  const metas = await listFilesMeta();
  const metaByPath = Object.fromEntries(metas.map((m) => [m.path, m]));
  const local = Object.fromEntries(metas.map((m) => [m.path, m.sha]));
  const { added, updated, deleted } = diffTree(local, docs);

  // 已过期（未缓存）的文档：只更新记录的 sha，不下载（用户点击时按需下载）
  const updatedExpired = updated.filter((e) => metaByPath[e.path]?.cached === false);
  const queue = [...added, ...updated.filter((e) => metaByPath[e.path]?.cached !== false)];
  let done = 0, bytes = 0;

  if (updatedExpired.length) {
    const now = Date.now();
    await putFiles(updatedExpired.map((e) => {
      const m = metaByPath[e.path]!;
      return { path: e.path, sha: e.sha, size: e.size, text: null, title: m.title, lastUsedAt: m.lastUsedAt, updatedAt: now };
    }));
  }

  await runPool(queue, 4, async (e) => {
    const text = await client.getBlobText(cfg.owner, cfg.repo, e.sha);
    const now = Date.now();
    await putFiles([{ path: e.path, sha: e.sha, size: e.size, text, title: extractTitle(text, e.path), lastUsedAt: now, updatedAt: now }]);
    done++; bytes += text.length;
    onProgress({ phase: 'download', done, total: queue.length });
  }, opts);

  if (deleted.length) { onProgress({ phase: 'cleanup', done: 0, total: 1 }); await deleteFiles(deleted); }

  await kvSet('tree', { syncedAt: Date.now(), entries: tree });   // 含图片，供路径→sha
  await kvSet('lastSyncAt', Date.now());
  const allDocs = await Promise.all(docs.map(async (e) => ({ path: e.path, text: (await getFile(e.path))?.text ?? '' })));
  await kvSet('links', buildLinksIndex(allDocs.filter((d) => d.text)));

  onProgress({ phase: 'done', done, total: queue.length });
  return { added: added.length, updated: updated.length, deleted: deleted.length, totalDocs: docs.length, bytes };
}
```

（实现要求：import 列表必须与代码中使用完全一致，不允许保留任何未使用的 import。）

- [ ] **Step 3: 写 `tests/unit/sync.test.ts`（mock client + fake-indexeddb）**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, getFile, kvSet, listFilesMeta, markExpired, putFiles } from '../../src/data/db';
import { downloadDocText, sweepExpired, syncRepo, type SyncProgress } from '../../src/data/sync';

beforeEach(async () => { await clearAllData(); });

function mkClient(files: Record<string, string>) {
  const shas = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, `sha-${p}`]));
  return {
    getTree: async () => Object.entries(files).map(([path, c]) => ({ path, sha: shas[path], size: c.length, type: 'blob' as const })),
    getBlobText: async (_o: string, _r: string, sha: string) => files[Object.keys(shas).find((p) => shas[p] === sha)!],
  };
}

describe('syncRepo', () => {
  it('全量同步写入并构建互链索引', async () => {
    const events: SyncProgress[] = [];
    const res = await syncRepo(mkClient({ 'a.md': '看 [b](b.md)', 'b.md': 'x' }), { owner: 'o', repo: 'r', branch: 'main' }, (p) => events.push(p));
    expect(res).toMatchObject({ added: 2, updated: 0, deleted: 0, totalDocs: 2 });
    expect((await listFilesMeta()).length).toBe(2);
    expect(events.at(-1)?.phase).toBe('done');
  });
  it('增量：只下载变更，并处理删除', async () => {
    const c1 = mkClient({ 'a.md': 'v1', 'b.md': 'x' });
    await syncRepo(c1, { owner: 'o', repo: 'r', branch: 'main' }, () => {});
    const spy = vi.fn(async (_o: string, _r: string, sha: string) => (sha === 'sha-changed' ? 'v2' : 'x'));
    const c2 = { getTree: async () => [{ path: 'a.md', sha: 'sha-changed', size: 2, type: 'blob' as const }], getBlobText: spy };
    const res = await syncRepo(c2 as never, { owner: 'o', repo: 'r', branch: 'main' }, () => {});
    expect(res).toMatchObject({ added: 0, updated: 1, deleted: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('过期文档：sha 变化只更新记录、不下载', async () => {
    await syncRepo(mkClient({ 'a.md': 'v1', 'b.md': 'x' }), { owner: 'o', repo: 'r', branch: 'main' }, () => {});
    await markExpired(['a.md']);
    const spy = vi.fn(async () => 'v2');
    const c2 = {
      getTree: async () => [
        { path: 'a.md', sha: 'sha-a2', size: 2, type: 'blob' as const },
        { path: 'b.md', sha: 'sha-b.md', size: 1, type: 'blob' as const },
      ],
      getBlobText: spy,
    };
    const res = await syncRepo(c2 as never, { owner: 'o', repo: 'r', branch: 'main' }, () => {});
    expect(res).toMatchObject({ added: 0, updated: 1, deleted: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(await getFile('a.md')).toMatchObject({ sha: 'sha-a2', text: null });
  });
  it('sweepExpired 清理超期正文；downloadDocText 按需重下并刷新时钟', async () => {
    await putFiles([{ path: 'a.md', sha: 's1', size: 2, text: 'hi', title: 'A', lastUsedAt: Date.now() - 8 * 24 * 3600 * 1000, updatedAt: 1 }]);
    expect(await sweepExpired()).toBe(1);
    expect((await getFile('a.md'))?.text).toBeNull();
    await kvSet('tree', { syncedAt: 0, entries: [{ path: 'a.md', sha: 's1', size: 2, type: 'blob' }] });
    const text = await downloadDocText({ getBlobText: async () => 'fresh' }, { owner: 'o', repo: 'r', branch: 'main' }, 'a.md');
    expect(text).toBe('fresh');
    expect((await getFile('a.md'))?.text).toBe('fresh');
    expect((await getFile('a.md'))!.lastUsedAt).toBeGreaterThan(Date.now() - 1000);
  });
});
```

- [ ] **Step 4: 运行全部单测并修复**

```bash
npm test && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 同步引擎（增量 diff、并发下载、互链索引）"
```

### Task 9: 同步状态 UI 与自动同步

**Files:**
- Create: `src/state/SyncContext.tsx`、`src/components/SyncBadge.tsx`、`src/hooks/useOnline.ts`
- Modify: `src/app/Shell.tsx`、`src/pages/HomePage.tsx`（挂载 SyncBadge）

**Interfaces:**
- Produces: `useSync(): { status: 'idle'|'syncing'|'offline'|'error'; progress: SyncProgress | null; lastSyncAt: number | null; error: GitHubError | null; syncNow(): Promise<void>; timeAgo(ts:number): string }`

- [ ] **Step 1: 实现 `useOnline` + `SyncContext`**

行为规范：
- Shell 挂载后：先执行 `sweepExpired()`（本地清理 7 天未使用的正文），再在 `token && config` 存在且在线时 → `syncNow()`（后台静默，`status:'syncing'` 只显示小圆点）。
- `syncNow()`：读 `config`；无 → 跳 `SETUP`；执行 `syncRepo`；同步成功后再次执行 `sweepExpired()`；首次成功同步后调用 `navigator.storage.persist()`；期间进度写入 state；`GitHubError.kind==='auth'` → 提示并跳 Setup（缓存不清）；`network` → `status:'offline'`。
- `useOnline`：`online/offline` 事件 + `navigator.onLine`。

```ts
// src/hooks/useOnline.ts
import { useEffect, useState } from 'react';
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
```

`SyncContext` 实现要点（完整实现按此）：`createContext` + `useState`；`syncNow` 用 `useRef` 防重入；`timeAgo`（`刚刚 / n 分钟前 / n 小时前 / n 天前`）放在 `src/lib/format.ts` 并配单测（`tests/unit/format.test.ts`：now-30s→「刚刚」，now-5min→「5 分钟前」，now-3d→「3 天前」）。

- [ ] **Step 2: 实现 `SyncBadge`（含「更新目录」手动刷新按钮）并挂到首页顶部**

显示：状态点（灰=idle / 蓝转=同步中+n·共m / 红=错误 / 橙=离线）+「上次同步 X」+ **「更新目录」按钮（触发 `syncNow()`，同步中旋转并禁用）**；点按徽标同样触发 `syncNow()`。

- [ ] **Step 3: 验证（真实数据手动走查，作为 P1 验收前的本机检查）**

```bash
npm run dev
# 浏览器：#/setup 粘贴真实 token → 回首页 → 观察同步完成；DevTools → Application → IndexedDB 应看到 43 条 files
# 断网（DevTools Offline）→ 刷新 → 页面正常、SyncBadge 显示离线
```

- [ ] **Step 4: 用户手机验收（P1 关卡）**

手机访问占位页 → 配置 token → 同步完成 → 飞行模式下可重新打开应用且不报错。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 同步状态与自动同步（含存储持久化申请）"
```

---

# P2 · 渲染内核与阅读器

> 阶段验收：mermaid / 高亮 / 互链 / TOC / 返回 全可用。

### Task 10: 渲染内核（markdown-it 全套自定义规则）

**Files:**
- Create: `src/markdown/render.ts`、`src/lib/hljs.ts`
- Test: `tests/unit/render.test.ts`

**Interfaces:**
- Produces:
  - `renderDoc(src: string, opts: { path: string; knownPaths: Set<string> }): { html: string; headings: Heading[] }`
  - `Heading { id: string; text: string; level: number }`
  - 约定：`.md` 目标存在 → `href="#/doc/<encodeURIComponent(path)>[?to=anchor]"` + `class="in-app-link"`；目标不存在 → `href="#"` + `data-dead="文件不存在"`；图片 → `class="md-img"` + `data-repo-src`（仓库路径）或保留外链 `src`；mermaid → `<div class="md-mermaid" data-code="<encodeURIComponent后的源码>"></div>`；其他代码块 → `<div class="code-block"><button class="code-copy">复制</button><pre><code class="hljs">…</code></pre></div>`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { renderDoc } from '../../src/markdown/render';

const base = { path: 'a.md', knownPaths: new Set(['a.md', '子/b.md', '图片/x.png']) };

describe('renderDoc', () => {
  it('标题 id 用 github-slugger 且重复标题去重', () => {
    const { html, headings } = renderDoc('# 标题\n\n## 标题\n', base);
    expect(headings.map((h) => h.id)).toEqual(['标题', '标题-1']);
    expect(html).toContain('id="标题"');
    expect(html).toContain('id="标题-1"');
  });
  it('单换行变 <br>、高亮与删除线', () => {
    const { html } = renderDoc('l1\nl2\n\n==高亮== 和 ~~删除~~', base);
    expect(html).toContain('l1<br>');
    expect(html).toContain('<mark>高亮</mark>');
    expect(html).toContain('<s>删除</s>');
  });
  it('裸 URL 自动链接且外链新开窗口', () => {
    const { html } = renderDoc('见 https://example.com/x', base);
    expect(html).toMatch(/href="https:\/\/example.com\/x"[^>]*target="_blank"/);
  });
  it('互链改写为应用内路由；缺失目标标记 data-dead', () => {
    expect(renderDoc('去 [b](子/b.md#第三章)', base).html).toContain(
      'href="#/doc/' + encodeURIComponent('子/b.md') + '?to=' + encodeURIComponent('第三章') + '"');
    expect(renderDoc('去 [x](没有.md)', base).html).toContain('data-dead="文件不存在"');
  });
  it('图片相对路径进 data-repo-src，外链保留', () => {
    expect(renderDoc('![p](图片/x.png)', base).html).toContain('data-repo-src="图片/x.png"');
    expect(renderDoc('![p](https://o/x.png)', base).html).toContain('src="https://o/x.png"');
  });
  it('mermaid fence 转占位 div，普通代码块走高亮且带复制按钮', () => {
    expect(renderDoc('```mermaid\ngraph TD;A-->B\n```', base).html).toContain('class="md-mermaid"');
    const code = renderDoc('```python\nprint(1)\n```', base).html;
    expect(code).toContain('code-copy');
    expect(code).toContain('hljs');
  });
  it('锚点内链保持 #slug 原样', () => {
    expect(renderDoc('见 [top](#标题)', base).html).toContain('href="#标题"');
  });
});
```

（说明：删除线语法 `~~` 若某些 markdown-it 版本未默认开启，可显式 `md.enable('strikethrough')`。）

- [ ] **Step 2: 实现 `src/lib/hljs.ts` 与 `src/markdown/render.ts`**

```ts
// src/lib/hljs.ts
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

for (const [name, lang] of Object.entries({ bash, c, cpp, csharp, css, dockerfile, go, java, javascript, json, kotlin, markdown, python, rust, sql, typescript, xml, yaml })) {
  hljs.registerLanguage(name, lang);
}
export { hljs };
```

```ts
// src/markdown/render.ts
import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import GithubSlugger from 'github-slugger';
import type Token from 'markdown-it/lib/token.mjs';
import { hljs } from '../lib/hljs';
import { resolveAssetPath, resolveMdLink } from '../data/paths';

export interface Heading { id: string; text: string; level: number }
export interface RenderOptions { path: string; knownPaths: Set<string> }

const md = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false, highlight: null })
  .use(mark);

function inlineText(token: Token): string {
  let out = '';
  for (const child of token.children ?? []) {
    if (child.type === 'text' || child.type === 'code_inline') out += child.content;
  }
  return out;
}

export function renderDoc(src: string, opts: RenderOptions): { html: string; headings: Heading[] } {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  const env = { headings, slugger, opts };

  md.core.ruler.push('heading_ids', (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const t = state.tokens[i];
      if (t.type === 'heading_open') {
        const inline = state.tokens[i + 1];
        const text = inlineText(inline);
        const id = (env.slugger as GithubSlugger).slug(text);
        t.attrSet('id', id);
        env.headings.push({ id, text, level: Number(t.tag.slice(1)) });
      }
    }
    return true;
  });

  md.renderer.rules.link_open = (tokens, idx) => {
    const token = tokens[idx];
    const href = token.attrGet('href') ?? '';
    if (href.startsWith('#')) {
      // 原地锚点：保持原样，浏览器原生处理
    } else {
      const resolved = resolveMdLink(opts.path, href);
      if (resolved) {
        if (opts.knownPaths.has(resolved.path)) {
          const to = resolved.anchor ? `?to=${encodeURIComponent(resolved.anchor)}` : '';
          token.attrSet('href', `#/doc/${encodeURIComponent(resolved.path)}${to}`);
          token.attrSet('class', 'in-app-link');
        } else {
          token.attrSet('href', '#');
          token.attrSet('data-dead', '文件不存在');
        }
      } else if (/^(https?:|mailto:)/i.test(href)) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener');
      } else if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        // 其他相对引用（非 .md / 非外链，如指向仓库内图片或代码文件）
        token.attrSet('href', '#');
        token.attrSet('data-dead', '无法在应用内打开');
      }
    }
    return md.renderer.renderToken(tokens, idx, {});
  };

  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    const alt = token.content ?? '';
    if (/^(https?:|data:|blob:)/i.test(src)) {
      return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}" loading="lazy" class="md-img">`;
    }
    const repoPath = resolveAssetPath(opts.path, src) ?? src;
    return `<img alt="${md.utils.escapeHtml(alt)}" loading="lazy" class="md-img" data-repo-src="${md.utils.escapeHtml(repoPath)}">`;
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim();
    const code = token.content;
    if (info === 'mermaid') {
      return `<div class="md-mermaid" data-code="${encodeURIComponent(code)}"></div>`;
    }
    const lang = info.split(/\s+/)[0] || '';
    let highlighted: string;
    try {
      highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : md.utils.escapeHtml(code);
    } catch {
      highlighted = md.utils.escapeHtml(code);
    }
    return `<div class="code-block"><button class="code-copy" type="button">复制</button><pre><code class="hljs">${highlighted}</code></pre></div>`;
  };

  const html = md.render(src, env);
  return { html, headings: env.headings };
}
```

实现注意：
- token 类型引用路径以所装 markdown-it 版本为准（`markdown-it/lib/token.mjs` 或 `@types/markdown-it` 的 `Token`）；typecheck 报错时按其导出修正。

- [ ] **Step 3: 运行测试直至全绿，再补一个真实语料抽查测试**

```bash
npx vitest run tests/unit/render.test.ts
# 追加 tests/unit/render-corpus.test.ts（可选、本地有语料时跑）：读取 ../interview 目录渲染全部 md，
# 断言：= 0 个 <mark> 出现在非预期文本（直接统计总数应与语料中 == 高亮用法一致，语料当前为 0）、
# 断言 mermaid div 数量 = 语料 ```mermaid 出现处数（29 文件）。
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: markdown 渲染内核（锚点/互链/图片/mermaid/代码高亮）"
```

### Task 11: 图片管线（懒加载 → 鉴权拉取 → 本地缓存）

**Files:**
- Create: `src/markdown/images.ts`
- Test: `tests/unit/images.test.ts`（jsdom 环境）

**Interfaces:**
- Produces: `hydrateImages(container: HTMLElement, deps: { fetchBlob(path: string): Promise<Blob> }): () => void`（返回清理函数；对每个 `img.md-img[data-repo-src]`：IntersectionObserver 进入视口 400px 内 → `fetchBlob` → ObjectURL 设置 `src` → 离开卸载时 revoke）。

- [ ] **Step 1: 写失败测试（jsdom）**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { hydrateImages } from '../../src/markdown/images';

describe('hydrateImages', () => {
  it('为 data-repo-src 图片设置 src 并在清理时 revoke', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<img class="md-img" data-repo-src="a/b.png" alt="x">';
    const fetchBlob = vi.fn(async () => new Blob(['x'], { type: 'image/png' }));
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    (URL.createObjectURL as unknown) = vi.fn(() => 'blob:fake');
    const cleanup = hydrateImages(container, { fetchBlob });
    await vi.waitFor(() => expect(container.querySelector('img')!.src).toContain('blob:fake'));
    expect(fetchBlob).toHaveBeenCalledWith('a/b.png');
    cleanup();
    expect(revoke).toHaveBeenCalled();
  });
});
```

（jsdom 无 IntersectionObserver：`src/markdown/images.ts` 内需提供兜底——当 `IntersectionObserver` 不存在时立即处理全部图片。实现按此。）

- [ ] **Step 2: 实现 `src/markdown/images.ts`**

逻辑：选择器 `img.md-img[data-repo-src]`；`observe`（rootMargin `400px`）；命中后：查 `getBlob(sha)`（sha 由 `kvGet('tree')` 的 entries 按 path 查得）→ 命中直接用；未命中 `fetchBlob` → `putBlob`；`createObjectURL` 赋 src 并移除 `data-repo-src`；失败时设置 `alt` 文本可见（加 class `md-img-error`）；清理函数 revoke 所有 URL、断开 observer。

- [ ] **Step 3: 验证并提交**

```bash
npx vitest run tests/unit/images.test.ts && npm run typecheck
git add -A && git commit -m "feat: 图片懒加载与鉴权缓存管线"
```

### Task 12: Mermaid 懒渲染

**Files:**
- Create: `src/lib/mermaid-loader.ts`、`src/markdown/mermaid.ts`
- Test: `tests/unit/mermaid.test.ts`（jsdom，仅测占位提取与队列行为，不真渲染）

**Interfaces:**
- Produces: `hydrateMermaid(container: HTMLElement, deps?: { render?: (code: string) => Promise<string> }): () => void`（对 `div.md-mermaid[data-code]` 逐个懒渲染；成功 → `innerHTML = svg` + `class="md-mermaid-done"`；失败 → 展示 `<pre>` 源码 + 错误文案；渲染依赖可注入以便测试）。

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { hydrateMermaid } from '../../src/markdown/mermaid';

describe('hydrateMermaid', () => {
  it('渲染成功替换为 svg；失败降级显示源码', async () => {
    const c = document.createElement('div');
    c.innerHTML =
      '<div class="md-mermaid" data-code="' + encodeURIComponent('graph TD;A-->B') + '"></div>' +
      '<div class="md-mermaid" data-code="' + encodeURIComponent('bad') + '"></div>';
    const render = vi.fn(async (code: string) => { if (code === 'bad') throw new Error('parse error'); return '<svg></svg>'; });
    const cleanup = hydrateMermaid(c, { render });
    await vi.waitFor(() => expect(c.querySelectorAll('svg').length).toBe(1));
    expect(c.textContent).toContain('bad');           // 失败块显示源码
    expect(render).toHaveBeenCalledTimes(2);
    cleanup();
  });
});
```

- [ ] **Step 2: 实现 loader 与 hydrate**

```ts
// src/lib/mermaid-loader.ts
let p: Promise<{ render(id: string, code: string): Promise<{ svg: string }> }> | null = null;
let seq = 0;
export function renderMermaid(code: string): Promise<string> {
  p ??= import('mermaid').then((m) => {
    m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' });
    return m.default as never;
  });
  return p.then((m) => m.render(`mmd-${++seq}`, code)).then((r) => r.svg);
}
```

`src/markdown/mermaid.ts`：IntersectionObserver（rootMargin `400px`，不存在则立即处理）逐个入队；用 `runPool(pending, 2, ...)` 限并行 2；默认 `render = renderMermaid`（可注入）。

- [ ] **Step 3: 验证并提交**

```bash
npx vitest run tests/unit/mermaid.test.ts && npm run typecheck && npm run build   # 确认 mermaid 是独立 chunk
ls dist/assets | grep -i mermaid
git add -A && git commit -m "feat: mermaid 懒渲染（代码分割、失败降级、并行≤2）"
```

### Task 13: 阅读页（正文 + 顶栏 + 上下篇）

**Files:**
- Create: `src/pages/DocPage.tsx`（替换占位）、`src/components/PrevNext.tsx`、`src/components/DocHeader.tsx`
- Create: `src/styles/content.css`
- Modify: `src/main.tsx` 或 `App.tsx` 引入样式

**Interfaces:**
- Consumes: `renderDoc`、`hydrateImages`、`hydrateMermaid`、`nav.docHref`、`listFilesMeta` + `getFile`。
- Produces: 阅读页 DOM 约定（后续任务依赖）：正文容器 `class="doc-content"`；顶栏 `class="doc-header"`；标题节点带 `id`。

- [ ] **Step 1: 实现 DocPage 核心逻辑**

流程：解析路由 `params['*']` → decode 得到 path → `getFile(path)`，三分支：
1. 无记录 → 显示「文档不存在/尚未同步」+ 返回首页按钮；
2. `text === null`（已过期）→ 加载态中调 `downloadDocText(client, cfg, path)`（`useToken()` + `kvGet('config')`）；成功 → 继续渲染；离线/失败 → 显示「该文档未缓存，需联网下载后阅读」+ 重试按钮；
3. 正常 → 继续渲染。
渲染分支统一：`renderDoc(text, { path, knownPaths })`（knownPaths：`listFilesMeta()` 缓存于 DocsContext 或本页 `useEffect` 加载）→ `dangerouslySetInnerHTML` 注入 `div.doc-content` → `useEffect` 里 `hydrateImages` + `hydrateMermaid`，清理返回函数 → **`touchFile(path)` 刷新过期时钟** → `?to=` 参数 → `document.getElementById(to)` `scrollIntoView()`；`?q=`/`?i=` → 走 Task 18 的高亮（本任务先忽略）→ 底部 `<PrevNext>`（由排序后的文档路径列表计算前后）。

样式要点（`content.css`）：`.doc-content { max-width: 46rem; margin: 0 auto; padding: 0 16px 96px; font-size: 17px; line-height: 1.8; }`；标题、表格（`display:block; overflow-x:auto`）、`pre`、引用块、`mark`（`background:#fff8c5`）、`s`、`img.md-img { max-width:100%; height:auto }`、`.md-mermaid { overflow-x:auto }`、`h1..h4 { scroll-margin-top: calc(var(--header-h) + 12px) }`；顶栏吸顶 `position: sticky`。

- [ ] **Step 2: 验证**

```bash
npm run typecheck && npm run dev
# 真实 token 走查：打开任一文档 → 中文排版可读、代码块有复制按钮、复制可用、表格可横滑
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: 阅读页与中文排版样式"
```

### Task 14: TOC 抽屉与 scroll-spy

**Files:**
- Create: `src/components/TocDrawer.tsx`、`src/hooks/useScrollSpy.ts`
- Modify: `src/pages/DocPage.tsx`（顶栏加入口）

**Interfaces:**
- Produces: `useScrollSpy(ids: string[], offset?: number): string | null`（滚动位置上方最近的标题 id）。

- [ ] **Step 1: 实现 `useScrollSpy`（纯滚动计算，含兜底）**

逻辑：`requestAnimationFrame` 节流的 scroll 监听；取所有 `#id` 元素 `getBoundingClientRect().top <= offset`（默认 `header-h + 24`）中最后一个；无 IntersectionObserver 依赖，纯计算，便于稳定。

- [ ] **Step 2: 实现 `TocDrawer`**

要点：`headings`（来自 renderDoc）按层级缩进渲染（h1–h4）；当前项高亮（useScrollSpy）；点击 → `scrollIntoView({ behavior: 'smooth' })` + 关闭抽屉；抽屉为底部弹出 sheet（移动端单手可及），最大高度 60vh 内部滚动；aria-label。

- [ ] **Step 3: 手动验证（长文档）**

`npm run dev` → 打开《智能体开发知识要点_2026年10月》→ TOC 打开、滚动高亮、点击跳转、顶栏不遮挡。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 文档内 TOC 抽屉与 scroll-spy"
```

### Task 15: 文件树（首页 + 抽屉）与树排序

**Files:**
- Create: `src/lib/tree.ts`、`src/components/FileTree.tsx`、`src/styles/home.css`
- Modify: `src/pages/HomePage.tsx`（替换占位）
- Test: `tests/unit/tree.test.ts`

**Interfaces:**
- Produces: `buildTree(paths: string[]): { root: TreeItem[]; dirs: { name: string; items: TreeItem[] }[] }`；`TreeItem { path: string; name: string }`；`flattenTree(tree): string[]`（供 PrevNext 使用，按深度优先顺序）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { buildTree, flattenTree } from '../../src/lib/tree';

describe('tree', () => {
  it('根文档与子目录分组，中文按本地排序（实测：Intl.Collator("zh") 汉字在拉丁字母之前、汉字按拼音）', () => {
    const t = buildTree(['zz.md', 'NodeJS/事件.md', 'NodeJS/内存.md', '智能体/Mem0.md']);
    expect(t.root.map((i) => i.path)).toEqual(['zz.md']);
    expect(t.dirs.map((d) => d.name)).toEqual(['智能体', 'NodeJS']);
    expect(flattenTree(t)).toEqual(['zz.md', '智能体/Mem0.md', 'NodeJS/内存.md', 'NodeJS/事件.md']);
  });
});
```

- [ ] **Step 2: 实现 `tree.ts`（`Intl.Collator('zh')` 排序、name 去 `.md`）与 `FileTree.tsx`（可折叠目录、当前项高亮；**未缓存文档显示「未缓存」小标记**，数据来自 `listFilesMeta()` 的 `cached` 字段）**

- [ ] **Step 3: 实现首页：搜索入口（跳 `searchHref('')` 不预填）+ 同步徽标（含「更新目录」按钮）+ 文件树（含未缓存标记）；样式 home.css（列表触达区 ≥44px 高）**

- [ ] **Step 4: 验证并提交**

```bash
npx vitest run tests/unit/tree.test.ts && npm run typecheck && npm run dev
git add -A && git commit -m "feat: 文件树与首页"
```

### Task 16: 历史栈、滚动恢复、返回来源、双抽屉收敛 + e2e 基座

**Files:**
- Create: `src/app/scroll.ts`、`src/components/BackToSource.tsx`
- Create: `tests/e2e/fixtures.ts`、`tests/e2e/reader.spec.ts`、`playwright.config.ts`
- Modify: `src/pages/DocPage.tsx`（顶栏：返回、文件树抽屉入口、返回来源条）、`src/app/Shell.tsx`

**Interfaces:**
- Produces:
  - `scroll.ts`: `rememberScroll(key: string, y: number): void`、`takeScroll(key: string): number | undefined`、`keyFromLocation(loc: Location): string`（location.key；sessionStorage 持久化 + 内存缓存）
  - e2e：`installGitHubMock(page, opts: { token?: string; failAuth?: boolean }): Promise<{ syncCalls(): number }>`，供 P3/P4 复用。

- [ ] **Step 1: 实现 `scroll.ts` 与接入**

DocPage：进入前（导航离开时 via `useBlocker`? 简化：滚动节流写入当前 key；离开时不特殊处理——因为是持续性记录）→ 打开时若无 `?to/?q` 则 `takeScroll(key)` 恢复，无记录则读 `progress`（Task 19 前先跳过）；「返回来源」：DocPage 读取 `location.state?.from`（由 in-app link 点击拦截写入 `{ from: location.pathname + location.search }`——通过 `onClick` 委托容器内 `a.in-app-link` 完成：`navigate(href, { state: { from: current } })`，同时 `rememberScroll(currentKey, scrollY)`）。

- [ ] **Step 2: 写 e2e fixtures（mock GitHub API）**

要点：`page.route('https://api.github.com/**')`；按 URL 分发：`/user` → `{login:'vaddenz'}`（`failAuth` 时 401）；`/repos/vaddenz/interview` → `{default_branch:'main'}`；`/git/trees/main?recursive=1` → fixture 树（文档：`a.md`、`深挖/b.md`（含 mermaid + 互链 + 高亮/删除线）、`长文档.md`（20 个标题））；`/git/blobs/<sha>` → 对应内容文本。fixture 内容用中文，含 `# 标题`、`## 标题`（重复）、`==高亮==`、`~~删除~~`、mermaid 块、`[去 b](深挖/b.md)`、`](#标题)`。

- [ ] **Step 3: 写 `reader.spec.ts`（P2 全链路）**

用例：配置 token → 同步完成（首页出现 3 篇）→ 打开 `a.md` → 点 TOC 跳 `#标题` → 返回；打开 `深挖/b.md` → mermaid 占位被替换为 `svg`（`await expect(page.locator('svg')).toBeVisible()`）→ 点互链 → 「返回来源」可见 → 点击后回到 `a.md` 且滚动位置近似还原（±50px）。

- [ ] **Step 4: `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173/md-reader/', ...devices['Pixel 7'] },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/md-reader/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 5: 运行 e2e 至全绿**

```bash
npx playwright install chromium   # 首次
npm run test:e2e
```

- [ ] **Step 6: 用户手机验收（P2 关卡）**：真实仓库走查 mermaid / 高亮 / 互链 / TOC / 返回手势。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: 历史栈与滚动恢复、返回来源、双 drawer；e2e 基座"
```

---

# P3 · 搜索、收藏进度、关联、设置、离线打磨

### Task 17: 搜索引擎

**Files:**
- Create: `src/data/search.ts`
- Test: `tests/unit/search.test.ts`

**Interfaces:**
- Produces: `searchDocs(docs: {path:string;text:string}[], query: string, limit?: number): SearchHit[]`；`SearchHit { path: string; title: string; count: number; score: number; snippets: { text: string; start: number }[] }`；`extractTitle` 复用 Task 8 的 `src/lib/text.ts`（不重复实现）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { searchDocs } from '../../src/data/search';

const docs = [
  { path: '事务.md', text: '# 事务\n\nMVCC 是核心。MVCC 与锁。' },
  { path: '索引.md', text: '# 索引\n\nB+ 树与 MVCC 版本。' },
  { path: '无关.md', text: '# 其他\n\n没有关键词。' },
];

describe('searchDocs', () => {
  it('中文精确子串 + 多词 AND', () => {
    expect(searchDocs(docs, 'MVCC').map((h) => h.path)).toEqual(['事务.md', '索引.md']);
    expect(searchDocs(docs, 'MVCC 锁').map((h) => h.path)).toEqual(['事务.md']);
    expect(searchDocs(docs, 'MVCC 不存在的词')).toEqual([]);
  });
  it('英文大小写不敏感；标题命中加权', () => {
    expect(searchDocs(docs, 'mvcc').length).toBe(2);
    expect(searchDocs(docs, '事务')[0].score).toBeGreaterThan(searchDocs([{ path: 'x.md', text: '事务' }], '事务')[0].score - 100);
  });
  it('片段带上下文且不越界', () => {
    const hit = searchDocs(docs, 'MVCC')[0];
    expect(hit.snippets[0].text).toContain('MVCC');
    expect(hit.count).toBe(2);
  });
});
```

- [ ] **Step 2: 实现**：大小写归一（`toLowerCase`）后 `indexOf` 循环计数与定位；`score = count + 5 * titleHits + 2 * pathHits`；snippets 取前 3 处（start±40，clamp）；`limit` 默认 50。

- [ ] **Step 3: 验证并提交**

```bash
npx vitest run tests/unit/search.test.ts && npm run typecheck
git add -A && git commit -m "feat: 全文搜索引擎（子串 AND、加权排序、片段）"
```

### Task 18: 搜索页、命中高亮与直达

**Files:**
- Create: `src/pages/SearchPage.tsx`（替换占位）、`src/markdown/highlight.ts`
- Test: `tests/unit/highlight.test.ts`（jsdom）、`tests/e2e/search.spec.ts`
- Modify: `src/pages/DocPage.tsx`（消费 `?q=&i=`）

**Interfaces:**
- Produces: `highlightInContainer(container: HTMLElement, query: string, opts?: { max?: number }): HTMLElement[]`（返回命中元素数组，按文档顺序；跳过 `script/style/mark` 与已有命中）。

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { highlightInContainer } from '../../src/markdown/highlight';

describe('highlightInContainer', () => {
  it('跨文本节点高亮且上限生效', () => {
    const c = document.createElement('div');
    c.innerHTML = '<p>MVCC 与 mvcc</p><pre><code>MVCC</code></pre><p>MVCC MVCC</p>';
    const hits = highlightInContainer(c, 'MVCC', { max: 2 });
    expect(hits.length).toBe(2);
    expect(c.querySelectorAll('mark.search-mark').length).toBe(2);
  });
});
```

- [ ] **Step 2: 实现 highlight.ts（TreeWalker + 大小写不敏感 + max 上限）与 SearchPage**

SearchPage：读 `?q=`，无词时展示提示；有词：
1. `listFilesMeta()` → **未缓存文档（`cached === false`）直接跳过**；若存在未缓存文档，顶部显示「N 篇文档未缓存（已过期），未参与搜索」+「纳入全文搜索」按钮；
2. 已缓存文档 `getFile` 取文本（模块级 Map 缓存，同步完成时失效）→ `searchDocs` → 结果卡片（标题、路径、命中数、前 2 条片段，命中词用 `<mark>`）→ 点击 → `navigate(docHref(path, { q, i: snippetIndex }))`；
3. 「纳入全文搜索」：对未缓存文档并发 4 调 `downloadDocText`（带进度），完成后刷新缓存并重新搜索（下载即刷新其 `lastUsedAt`）。

DocPage：`useEffect` 渲染后若有 `q`：`highlightInContainer(contentEl, q)` → 滚动到 `hits[i] ?? hits[0]`。

- [ ] **Step 3: e2e：搜索 → 直达高亮**

用例：打开 `#/search?q=MVCC` → 结果列出 → 点击第 2 条 → 文档打开且 `mark.search-mark` 可见、页面滚动位置 > 0。

- [ ] **Step 4: 验证并提交**

```bash
npx vitest run tests/unit/highlight.test.ts && npm run test:e2e && npm run typecheck
git add -A && git commit -m "feat: 搜索页与命中直达高亮"
```

### Task 19: 收藏与阅读进度

**Files:**
- Create: `src/data/prefs.ts`、`src/hooks/useReadingProgress.ts`
- Modify: `src/pages/DocPage.tsx`（星标 + 进度记录/恢复）、`src/pages/HomePage.tsx`（继续阅读 / 收藏区块）
- Test: `tests/unit/prefs.test.ts`（fake-indexeddb）、`tests/e2e/progress.spec.ts`

**Interfaces:**
- Produces: `prefs.ts`：`toggleFavorite(path): Promise<string[]>`、`getFavorites(): Promise<string[]>`、`saveProgress(path, ratio, headingId?): Promise<void>`、`getProgress(path)`、`recentDocs(limit = 3): Promise<{path:string;updatedAt:number}[]>`

- [ ] **Step 1: 写失败测试（fake-indexeddb）**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { getFavorites, getProgress, recentDocs, saveProgress, toggleFavorite } from '../../src/data/prefs';

beforeEach(async () => { await clearAllData(); });

describe('prefs', () => {
  it('收藏开关幂等', async () => {
    expect(await toggleFavorite('a.md')).toEqual(['a.md']);
    expect(await toggleFavorite('a.md')).toEqual([]);
    expect(await getFavorites()).toEqual([]);
  });
  it('进度写入与最近阅读排序', async () => {
    await saveProgress('a.md', 0.5);
    await new Promise((r) => setTimeout(r, 5)); // 拉开 updatedAt，避免同毫秒并列
    await saveProgress('b.md', 0.1);
    expect((await getProgress('a.md'))?.ratio).toBe(0.5);
    const recents = await recentDocs(3);
    expect(recents[0].path).toBe('b.md');
  });
});
```

- [ ] **Step 2: 实现 prefs.ts（kv 读写合并；recentDocs 按 progress.updatedAt 降序）与 hooks（1s 节流 + visibilitychange 补写；打开时无 `?to/?q` 且无 scroll 记忆 → 恢复 ratio）**

- [ ] **Step 3: 首页区块：继续阅读（recentDocs）+ 收藏（favorites 列表），空态不渲染区块**

- [ ] **Step 4: e2e：滚动到中部 → 退出 → 重开 → 恢复（±5%）；星标 → 首页出现**

- [ ] **Step 5: 验证并提交**

```bash
npx vitest run tests/unit/prefs.test.ts && npm run test:e2e && npm run typecheck
git add -A && git commit -m "feat: 收藏与阅读进度（含首页区块）"
```

### Task 20: 关联文档面板

**Files:**
- Create: `src/components/RelatedDocs.tsx`
- Modify: `src/pages/DocPage.tsx`（正文底部插入）
- Test: `tests/unit/links-related.test.ts`

**Interfaces:**
- Consumes: `kvGet('links')`、`getRelated`；面板最多各展示 8 条 chips。

- [ ] **Step 1: 写失败测试**（在 links.test.ts 追加 `getRelated` 边界：空索引、自引用排除、仅 inbound）

- [ ] **Step 2: 实现组件：`引用本文的（in）` + `本文引用的（out）`；均无则整块不渲染；点击走 `docHref`**

- [ ] **Step 3: 验证并提交**

```bash
npx vitest run tests/unit/links.test.ts && npm run typecheck
git add -A && git commit -m "feat: 关联文档面板（引用/被引用互跳）"
```

### Task 21: 设置页与「关于」（定位声明）

**Files:**
- Create: `src/pages/SettingsPage.tsx`（替换占位）、`src/components/AboutSection.tsx`
- Modify: `src/lib/format.ts`（增加 `bytesToText(n)`）
- Test: `tests/unit/format.test.ts`（补充 `bytesToText` 用例）

**Interfaces:**
- Produces: 设置页行为契约——修改仓库配置需「保存」才写入 `kv.config`；「立即同步」调 `syncNow`；「清除全部数据」二次确认后 `clearAllData()` + `clearToken()` + 跳 `SETUP`。

- [ ] **Step 1: 实现设置页**

区块：① Token（掩码显示 + 更换 → 内联输入校验后保存 + 清除）；② 仓库（owner/repo/branch 三输入 + 保存；默认值来自 `DEFAULT_REPO`）；③ 同步（立即同步 + 上次同步时间 + 进度）；④ 存储（`storageEstimate` + bytesToText + 缓存统计「已缓存 N 篇 / 未缓存 M 篇」，来自 `listFilesMeta()` 的 `cached`）；⑤ 危险区（清除全部数据，`window.confirm` 二次确认）；⑥ 关于：版本号（`import pkg from '../../package.json'`，resolveJsonModule 已开）、定位声明全文（**个人自用，非通用 Markdown 阅读器**）、隐私说明（token 仅存本机、仅访问 api.github.com）。

- [ ] **Step 2: 验证并提交**

```bash
npx vitest run tests/unit/format.test.ts && npm run typecheck
git add -A && git commit -m "feat: 设置页与关于（个人自用声明）"
```

### Task 22: 离线与错误态打磨

**Files:**
- Create: `src/components/OfflineBanner.tsx`、`src/lib/toast.tsx`
- Modify: `src/pages/SetupPage.tsx`（reauth 变体）、`src/pages/DocPage.tsx`（不存在文案）

- [ ] **Step 1: 实现离线横幅**（`useOnline` + SyncContext：离线时顶部黄色条「离线模式 · 上次同步 X」；恢复在线自动隐藏并触发一次同步）

- [ ] **Step 2: 实现 toast 与错误映射**：401 → `navigate(SETUP + '?reauth=1')` + 顶部「登录已过期，请重新授权（本地缓存已保留）」；ratelimit → 「GitHub 请求超限，X 分钟后重试」；quota → 「存储空间不足，可在设置中清除缓存」；缓存损坏自愈 → 一次性提示「本地缓存已重建」。

- [ ] **Step 3: 空态检查**：引导页、空仓库（0 文档）、搜索无结果、读取不存在的文档、**未缓存文档离线打开（「需联网下载后阅读」+ 重试）** 5 类文案就位。

- [ ] **Step 4: 验证并提交**

```bash
npm run test:e2e && npm run typecheck
git add -A && git commit -m "feat: 离线横幅与错误态完善"
```

---

# P4 · 测试补全、语料脚本、验收

### Task 23: e2e 全场景补全

**Files:**
- Create: `tests/e2e/offline.spec.ts`、`tests/e2e/auth.spec.ts`、`tests/e2e/pwa.spec.ts`、`tests/e2e/expiry.spec.ts`
- Modify: 既有 spec（如需）

- [ ] **Step 1: `offline.spec.ts`**：完成首同步 → `context.setOffline(true)` → reload → 首页与文档可用、搜索可用；`setOffline(false)` → 恢复。
- [ ] **Step 2: `auth.spec.ts`**：以 `failAuth` 安装 mock → 引导页显示「Token 无效」；预置有效缓存后在文档页触发 401（切换 mock）→ 跳 Setup 且 IndexedDB 数据仍在（`page.evaluate` 检查 `indexedDB.databases()`）。
- [ ] **Step 3: `pwa.spec.ts`**：首访后 `navigator.serviceWorker.ready` 完成；`link[rel=manifest]` 存在且 fetch 200；`meta[name=robots][content*=noindex]` 存在。
- [ ] **Step 4: `expiry.spec.ts`**：同步完成后用 `page.evaluate` 将某篇的 `lastUsedAt` 改为 8 天前 → reload → 断言该篇 `text === null`（IndexedDB）且目录出现「未缓存」标记 → 点击该文档 → mock 返回内容 → 正常渲染且 `text` 重新写入；`setOffline(true)` 后点击另一篇过期文档 → 显示「需联网下载后阅读」。

- [ ] **Step 5: 运行全部并提交**

```bash
npm run test:e2e && npm test && npm run typecheck
git add -A && git commit -m "test: e2e 全场景（离线/失效授权/PWA）"
```

### Task 24: 语料体检与渲染对拍脚本

**Files:**
- Create: `scripts/corpus.mjs`、`scripts/conformance.mjs`

- [ ] **Step 1: 写 `scripts/corpus.mjs`**

用法：`npm run corpus -- ~/workspace/src/interview`。实现：遍历 `*.md` → 用 `github-slugger` 与行级解析校验全部 `](#...)` 链接（复用本计划 §2-1 方法）→ `markdown-it`+`mark` 渲染统计 `<mark>` 数 → 统计 mermaid fence 数 → 输出报表；失败项非零退出。

```js
// scripts/corpus.mjs（核心逻辑）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import GithubSlugger from 'github-slugger';

const root = process.argv[2];
if (!root) { console.error('用法: npm run corpus -- <markdown 目录>'); process.exit(2); }
// …walk 收集 .md（跳过 .git/node_modules）…详见实现：collect(root)
// 输出：files / total bytes / headings / anchorLinks / unresolved / markCount / mermaidBlocks
```

（实现按注释补齐 walk/report，逻辑与 `tests/unit/render-corpus.test.ts` 一致。）

- [ ] **Step 2: 写 `scripts/conformance.mjs`（可选工具）**

用法：`GH_TOKEN=xxx npm run conformance -- <仓库内 md 相对路径>`；`POST /markdown`? 不——用 `GET /repos/{o}/{r}/contents/{path}` + `Accept: application/vnd.github.html+json` 拿官方 HTML → 提取 `<a id="user-content-…">` 的 slug 集合（去前缀）→ 与本地 `github-slugger` 生成集合比对 → 输出差异。需要 `conformance.mjs` 内解析目标仓库 owner/repo/ref（默认 `vaddenz/interview@main`，可用环境变量覆盖）。

- [ ] **Step 3: 运行实测**

```bash
npm run corpus -- ~/workspace/src/interview   # 期望：unresolved=0；mark 计数=0；mermaid 块 29 文件命中
GH_TOKEN=$(gh auth token) npm run conformance -- AGENTS.md   # 期望：slug 差异 0
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: 语料体检与渲染对拍脚本"
```

### Task 25: 使用文档、真机验收与 v1 发布

**Files:**
- Modify: `README.md`（保持「个人自用」声明置顶不动，追加开发/自用小节）
- Create: `docs/acceptance-2026-10-18.md`（真机验收记录）

- [ ] **Step 1: README 追加小节**：运行方式（`npm i && npm run dev` / `npm run build`）、Token 创建步骤（仅指向 GitHub 官方设置页的文字步骤，不含链接外跳依赖）、部署说明（本人 fork/自建需将 `base` 与仓库名对齐并自行承担兼容性）、测试命令（`npm test` / `npm run test:e2e` / `npm run corpus`）。**顶部「仅供个人使用」声明保持原样**。

- [ ] **Step 2: 执行真机验收清单（Spec §12.5 全部条目，含过期清理与目录手动更新），逐条记录结果到 `docs/acceptance-2026-10-18.md`（通过/失败/备注）**

- [ ] **Step 3: 修复验收发现的问题（若涉及计划外变更，先与用户确认）**

- [ ] **Step 4: 打标签并推送**

```bash
git add -A && git commit -m "docs: 使用说明与真机验收记录"
git tag v1.0.0 && git push origin main --tags
```

---

## Self-Review 记录（作者自查）

**1. Spec 覆盖检查**

| Spec 章节 | 落实任务 |
| --- | --- |
| §3 产品形态/首次流 | T1–T4、T7、T9 |
| §4 导航七项 | T2（路由）、T13/14（TOC）、T15（文件树）、T16（历史/返回来源）、T18（搜索直达）、T20（关联） |
| §5 数据与同步 | T5、T6、T8、T9 |
| §6 渲染内核 | T10–T12、T13（排版） |
| §7 搜索 | T17、T18 |
| §8 收藏与进度 | T19 |
| §9 安全与隐私 | 全局约束 + T21（关于页/清除数据）+ T23（noindex 断言） |
| §10 工程结构 | 文件结构总览 + 各任务 |
| §11 部署 | T3、T4 |
| §12 测试与验收 | 各任务内嵌 + T23、T24、T25 |
| §13 阶段 | P0–P4 分组即阶段 |
| §14 风险 | 错误态 T22；断点续传由 sha diff 天然满足（T8） |

**2. 占位符扫描**：逐任务检查——所有代码步骤均为可落地的具体实现或明确的实现要点；无 “TBD/TODO/类似 Task N”。初审发现的 6 处问题（2 处刻意校对点、2 处测试语义瑕疵、1 处冗余分支、1 处毫秒并列风险）已在提交前全部修正。

**3. 类型一致性**：`TreeEntry/FileRecord`（T5）↔ `GitHubClient`（T6）↔ `syncRepo`（T8）；`docHref`（T2）被 T13/T18/T20 复用；`hydrateImages`（T11）/`hydrateMermaid`（T12）签名与 T13 的调用一致；`SearchHit`（T17）与 T18 页面一致；`search-mark` 类名在 T18 测试与实现中一致。

**4. 已知取舍**：e2e 全部 mock（不触网）；私有语料不进仓库（corpus 脚本按本地路径运行）；渲染对拍为可选工具。

**5. 2026-10-18 设计更新（缓存过期 + 目录手动更新）**：已落入 Global Constraints 与 T5/T8/T9/T13/T15/T17/T18/T21/T22/T23/T25——过期清理（`sweepExpired`）、按需重下（`downloadDocText`）、搜索跳过未缓存并支持「纳入全文搜索」、SyncBadge 含「更新目录」按钮、文件树未缓存标记。
