import { expect, type Page } from '@playwright/test';

/**
 * GitHub API mock（P2 e2e 基座，P3/P4 复用）：
 * 所有请求都在浏览器内被 page.route 拦截，绝不触达真实 api.github.com。
 * 另附 IndexedDB 直读/直改辅助（P4 过期与缓存保留用例）。
 */

const OWNER = 'your-name';
const REPO = 'your-notes';
const BRANCH = 'main';

export interface GitHubMockOptions {
  /** 预置到 localStorage 的 Token（跳过引导页）；不传则用例走表单配置流程。 */
  token?: string;
  /** 所有 API 端点返回 401（模拟 Token 无效 / 运行中失效授权）。 */
  failAuth?: boolean;
  /** 所有 API 请求直接网络失败（模拟断网）。 */
  failNetwork?: boolean;
}

export interface GitHubMock {
  /** 目录树请求次数（每次同步恰好请求一次），供用例断言自动同步行为。 */
  syncCalls(): number;
  /** 运行中切换鉴权失败（401，全部端点）：用于「已有缓存后同步遇 401」场景。 */
  setFailAuth(value: boolean): void;
  /**
   * 运行中切换网络失败。注意：page.route 的拦截响应不经过网络栈，
   * Playwright 的 `context.setOffline(true)` 不会让被拦截的请求失败（实测），
   * 离线用例若要断言「下载失败」需同时开启本开关。
   */
  setFailNetwork(value: boolean): void;
  /** 运行时改文档：换 sha + 换正文；整页加载或「更新目录」同步后拉到新正文。 */
  updateDoc(path: string, text: string): void;
}

/** a.md 正文填充：把页面撑到足够高，用于验证滚动位置的记录与恢复。 */
const A_FILLER = Array.from(
  { length: 22 },
  (_, i) => `第 ${i + 1} 段：这是一段用于撑开页面高度的中文测试文本，用来验证滚动位置的记录与恢复是否准确。`,
).join('\n\n');

/** a.md：页内锚点（#标题）、高亮/删除线、首尾各一个互链。 */
const A_MD = [
  '# 文档 A',
  '',
  '用于端到端测试的文档 A，包含 ==高亮文本==、~~删除文本~~、**加粗文本**、页内锚点与站内互链。',
  '',
  '- [跳到「标题」](#标题)',
  '- [去深挖 b](深挖/b.md)',
  '',
  A_FILLER,
  '',
  '## 标题',
  '',
  '这里是被页内锚点链接指向的「标题」小节，位于文档靠下的位置。',
  '',
  '文末再补一段，确保标题之后仍有内容可滚动。',
  '',
  '文末补充用于搜索直达：MVCC 并发控制与版本可见性。',
  '',
  '[去深挖 b](深挖/b.md)',
  '',
].join('\n');

/** b.md：mermaid 图（首屏内，懒渲染立即入队）+ 回链 a.md。 */
const B_MD = [
  '# 文档 B',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[开始] --> B{判断}',
  '  B -->|是| C[结束]',
  '  B -->|否| A',
  '```',
  '',
  '```js',
  'const answer = 42;',
  '```',
  '',
  '回到 [文档 A](../a.md)。',
  '',
].join('\n');

/** 长文档.md：约 20 个标题（每节含 MVCC，用于搜索排序：命中数最多排第一）。 */
const LONG_MD = [
  '# 长文档',
  '',
  '> 引用块示例：用于验证引用字号比例。',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 表格文本 | 示例 |',
  '',
  ...Array.from({ length: 20 }, (_, i) => `## 第 ${i + 1} 节\n\n第 ${i + 1} 节的正文内容，包含 MVCC 版本控制。\n`),
].join('\n');

/** 记忆助手 e2e 题库：5 道合法题（问答 ×2、单选、多选、追问）+ 1 行坏行。 */
export const BANK_PATH = '题库/示例题库.jsonl';
export const BANK_TEXT = [
  JSON.stringify({ id: 'Q1.1', type: '概念', chapter: '1. 基础', question: '什么是事件循环？', hint: '想 libuv', answer: '- 事件循环负责调度异步回调。\n- 由 libuv 提供。', tags: ['事件循环'] }),
  JSON.stringify({ id: 'Q1.2', type: '概念', chapter: '1. 基础', question: '什么是微任务？', answer: '- Promise 回调进入微任务队列。' }),
  JSON.stringify({ id: 'Q2.1', kind: 'single', type: '辨析', chapter: '2. 进阶', question: '负责事件循环的内置依赖库是？', options: [{ key: 'A', text: 'libuv' }, { key: 'B', text: 'V8' }, { key: 'C', text: 'zlib' }], correct: ['A'], answer: 'libuv 提供事件循环与线程池。' }),
  JSON.stringify({ id: 'Q2.2', kind: 'multiple', type: '辨析', chapter: '2. 进阶', question: '以下哪些是内置依赖库？', options: [{ key: 'A', text: 'V8' }, { key: 'B', text: 'libuv' }, { key: 'C', text: 'React' }], correct: ['A', 'B'] }),
  JSON.stringify({ id: 'Q2.3', type: '追问', chapter: '2. 进阶', question: 'poll 阻塞时来了 I/O 会怎样？', answer: '- 会被唤醒处理。', followUpOf: 'Q1.1' }),
  '坏行',
].join('\n') + '\n';

/** sha → 正文（sha 为固定假值，与目录树一一对应）。 */
const DOCS: Record<string, string> = {
  'sha-a': A_MD,
  'sha-b': B_MD,
  'sha-long': LONG_MD,
  'sha-bank': BANK_TEXT,
};

const TREE = [
  { path: 'a.md', mode: '100644', type: 'blob', sha: 'sha-a', size: A_MD.length },
  { path: '深挖/b.md', mode: '100644', type: 'blob', sha: 'sha-b', size: B_MD.length },
  { path: '长文档.md', mode: '100644', type: 'blob', sha: 'sha-long', size: LONG_MD.length },
  { path: BANK_PATH, mode: '100644', type: 'blob', sha: 'sha-bank', size: BANK_TEXT.length },
];

export async function installGitHubMock(page: Page, opts: GitHubMockOptions = {}): Promise<GitHubMock> {
  let syncCalls = 0;
  let failAuth = opts.failAuth === true;
  let failNetwork = opts.failNetwork === true;
  // 可变副本：updateDoc 在运行中替换 sha 与正文（TREE/DOCS 为模块级常量，保持只读）。
  let tree = TREE.map((e) => ({ ...e }));
  const docs: Record<string, string> = { ...DOCS };

  if (opts.token !== undefined) {
    await page.addInitScript((t) => {
      try { localStorage.setItem('mdreader.token', t); } catch { /* 忽略 */ }
    }, opts.token);
  }

  await page.route('https://api.github.com/**', async (route) => {
    if (failNetwork) {
      await route.abort('failed');
      return;
    }

    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

    if (failAuth) return json({ message: 'Bad credentials' }, 401);
    if (url.pathname === '/user') {
      return json({ login: OWNER });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}`) {
      return json({ default_branch: BRANCH });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}`) {
      syncCalls += 1;
      return json({ sha: 'tree-sha', truncated: false, tree });
    }
    const blob = /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/(.+)$/.exec(url.pathname);
    if (blob) {
      const text = docs[decodeURIComponent(blob[1])];
      if (text === undefined) return json({ message: 'Not Found' }, 404);
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: text });
    }
    return json({ message: 'Not Found' }, 404);
  });

  return {
    syncCalls: () => syncCalls,
    setFailAuth: (value) => { failAuth = value; },
    setFailNetwork: (value) => { failNetwork = value; },
    updateDoc: (path, text) => {
      const entry = tree.find((e) => e.path === path);
      if (!entry) throw new Error(`updateDoc：未知路径 ${path}`);
      const sha = `${entry.sha}-v${Date.now()}`;
      docs[sha] = text;
      entry.sha = sha;
      entry.size = text.length;
    },
  };
}

/**
 * 无 Token 引导 → 表单配置 Token → 首页出现 3 篇文档（自动同步完成，正文已缓存）。
 * 供 T18 搜索用例复用（T16 reader.spec 保留其本地版本，未改动）。
 */
export async function configureAndSync(page: Page, token = 'ghp_e2e_fake_token'): Promise<GitHubMock> {
  const mock = await installGitHubMock(page);
  await page.goto('./');
  await page.waitForURL(/#\/setup$/);

  await page.getByPlaceholder('粘贴 Fine-grained PAT').fill(token);
  await page.getByRole('button', { name: '验证并保存' }).click();

  await page.waitForURL(/#\/$/);
  await expect(page.locator('.tree-item')).toHaveCount(3);
  return mock;
}

/** 顶栏自动隐藏（spec §2.1）后，用小幅上滑唤出（40px，不破坏相对位置断言）。 */
export async function revealHeader(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollBy(0, -40));
  await page.waitForTimeout(120);
}

/* ---------------------------------------------------------------------------
 * IndexedDB 辅助（P4）：在页面内用独立连接直读/直改应用数据（应用自持连接不受影响）。
 * 记录结构见 src/data/db.ts 的 FileRecord；打开前建 store 的写法与 settings.spec 一致。
 * ------------------------------------------------------------------------- */

/** files 记录中用例关心的字段。 */
export interface FileRecordLite {
  text: string | null;
  lastUsedAt: number;
}

/** 读取 files 记录（text/lastUsedAt）；记录不存在或读取失败返回 null。 */
export async function readFileRecord(page: Page, path: string): Promise<FileRecordLite | null> {
  return page.evaluate(
    (p) =>
      new Promise<FileRecordLite | null>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const get = db.transaction('files', 'readonly').objectStore('files').get(p);
            get.onsuccess = () => {
              const rec = get.result as { text?: string | null; lastUsedAt?: number } | undefined;
              resolve(rec ? { text: rec.text ?? null, lastUsedAt: rec.lastUsedAt ?? 0 } : null);
              db.close();
            };
            get.onerror = () => { resolve(null); db.close(); };
          } catch {
            resolve(null);
            db.close();
          }
        };
      }),
    path,
  );
}

/** files 记录数（-1 = 打开/读取失败）。 */
export async function countFiles(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onerror = () => resolve(-1);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const count = db.transaction('files', 'readonly').objectStore('files').count();
            count.onsuccess = () => { resolve(count.result); db.close(); };
            count.onerror = () => { resolve(-1); db.close(); };
          } catch {
            resolve(-1);
            db.close();
          }
        };
      }),
  );
}

/**
 * 把某篇文档的 lastUsedAt 改为 N 天前（默认 8 天 > 7 天 TTL）；
 * 下次整页加载时应用启动流程的 sweepExpired 会将其正文置空（text → null）。
 */
export async function expireDoc(page: Page, path: string, daysAgo = 8): Promise<void> {
  const at = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const ok = await page.evaluate(
    (args) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const store = db.transaction('files', 'readwrite').objectStore('files');
            const get = store.get(args.path);
            get.onsuccess = () => {
              const rec = get.result as { lastUsedAt?: number } | undefined;
              if (!rec) { resolve(false); db.close(); return; }
              rec.lastUsedAt = args.at;
              const put = store.put(rec, args.path);
              put.onsuccess = () => { resolve(true); db.close(); };
              put.onerror = () => { resolve(false); db.close(); };
            };
            get.onerror = () => { resolve(false); db.close(); };
          } catch {
            resolve(false);
            db.close();
          }
        };
      }),
    { path, at },
  );
  if (!ok) throw new Error(`expireDoc 失败：未找到或无法更新 files 记录 ${path}`);
}

/** 写入 kv 键（测试预置数据用）。 */
export async function writeKv(page: Page, key: string, value: unknown): Promise<void> {
  const ok = await page.evaluate(
    (args) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const put = db.transaction('kv', 'readwrite').objectStore('kv').put(args.value, args.key);
            put.onsuccess = () => { resolve(true); db.close(); };
            put.onerror = () => { resolve(false); db.close(); };
          } catch { resolve(false); db.close(); }
        };
      }),
    { key, value },
  );
  if (!ok) throw new Error(`writeKv 失败：${key}`);
}

/** 读取 kv 键；不存在或失败返回 undefined。 */
export async function readKv(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (k) =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const name of ['files', 'blobs', 'kv']) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
          }
        };
        req.onerror = () => resolve(undefined);
        req.onsuccess = () => {
          const db = req.result;
          try {
            const get = db.transaction('kv', 'readonly').objectStore('kv').get(k);
            get.onsuccess = () => { resolve(get.result); db.close(); };
            get.onerror = () => { resolve(undefined); db.close(); };
          } catch { resolve(undefined); db.close(); }
        };
      }),
    key,
  );
}

/** 读取任意 object store 的全部记录（无 key）或单条（有 key）；失败返回 null。 */
export async function readStore(page: Page, store: string, key?: string): Promise<unknown> {
  return page.evaluate(
    (args) =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction(args.store, 'readonly');
            const op = args.key === undefined ? tx.objectStore(args.store).getAll() : tx.objectStore(args.store).get(args.key);
            op.onsuccess = () => { resolve(op.result ?? null); db.close(); };
            op.onerror = () => { resolve(null); db.close(); };
          } catch { resolve(null); db.close(); }
        };
        req.onerror = () => resolve(null);
      }),
    { store, key },
  );
}
