import type { Page } from '@playwright/test';

/**
 * GitHub API mock（P2 e2e 基座，P3/P4 复用）：
 * 所有请求都在浏览器内被 page.route 拦截，绝不触达真实 api.github.com。
 */

const OWNER = 'vaddenz';
const REPO = 'interview';
const BRANCH = 'main';

export interface GitHubMockOptions {
  /** 预置到 localStorage 的 Token（跳过引导页）；不传则用例走表单配置流程。 */
  token?: string;
  /** `/user` 返回 401（模拟 Token 无效）。 */
  failAuth?: boolean;
  /** 所有 API 请求直接网络失败（模拟断网）。 */
  failNetwork?: boolean;
}

export interface GitHubMock {
  /** 目录树请求次数（每次同步恰好请求一次），供用例断言自动同步行为。 */
  syncCalls(): number;
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
  '用于端到端测试的文档 A，包含 ==高亮文本==、~~删除文本~~、页内锚点与站内互链。',
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
  '回到 [文档 A](../a.md)。',
  '',
].join('\n');

/** 长文档.md：约 20 个标题。 */
const LONG_MD = [
  '# 长文档',
  '',
  ...Array.from({ length: 20 }, (_, i) => `## 第 ${i + 1} 节\n\n第 ${i + 1} 节的正文内容。\n`),
].join('\n');

/** sha → 正文（sha 为固定假值，与目录树一一对应）。 */
const DOCS: Record<string, string> = {
  'sha-a': A_MD,
  'sha-b': B_MD,
  'sha-long': LONG_MD,
};

const TREE = [
  { path: 'a.md', mode: '100644', type: 'blob', sha: 'sha-a', size: A_MD.length },
  { path: '深挖/b.md', mode: '100644', type: 'blob', sha: 'sha-b', size: B_MD.length },
  { path: '长文档.md', mode: '100644', type: 'blob', sha: 'sha-long', size: LONG_MD.length },
];

export async function installGitHubMock(page: Page, opts: GitHubMockOptions = {}): Promise<GitHubMock> {
  let syncCalls = 0;

  if (opts.token !== undefined) {
    await page.addInitScript((t) => {
      try { localStorage.setItem('mdreader.token', t); } catch { /* 忽略 */ }
    }, opts.token);
  }

  await page.route('https://api.github.com/**', async (route) => {
    if (opts.failNetwork) {
      await route.abort('failed');
      return;
    }

    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

    if (url.pathname === '/user') {
      return opts.failAuth ? json({ message: 'Bad credentials' }, 401) : json({ login: OWNER });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}`) {
      return json({ default_branch: BRANCH });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}`) {
      syncCalls += 1;
      return json({ sha: 'tree-sha', truncated: false, tree: TREE });
    }
    const blob = /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/(.+)$/.exec(url.pathname);
    if (blob) {
      const text = DOCS[decodeURIComponent(blob[1])];
      if (text === undefined) return json({ message: 'Not Found' }, 404);
      return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: text });
    }
    return json({ message: 'Not Found' }, 404);
  });

  return { syncCalls: () => syncCalls };
}
