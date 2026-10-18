import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError } from '../../src/data/github';

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
}

describe('GitHubClient', () => {
  it('请求携带 Bearer 头并返回 JSON', async () => {
    const spy = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => new Response(JSON.stringify({ login: 'vaddenz' }), { status: 200 }));
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
