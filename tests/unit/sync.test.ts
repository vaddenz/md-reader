import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, getFile, kvGet, kvSet, listFilesMeta, markExpired, putFiles } from '../../src/data/db';
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
  it('同步写入 kv.tree（含图片 blob）、lastSyncAt 并重算 links', async () => {
    await syncRepo(mkClient({ 'a.md': '看 [b](b.md)', 'b.md': 'x', 'img/p.png': 'PNG' }), { owner: 'o', repo: 'r', branch: 'main' }, () => {});
    const tree = await kvGet<{ entries: { path: string }[] }>('tree');
    expect(tree?.entries.map((e) => e.path)).toEqual(['a.md', 'b.md', 'img/p.png']);
    expect(typeof (await kvGet('lastSyncAt'))).toBe('number');
    expect(await kvGet('links')).toEqual({ 'a.md': ['b.md'] });
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
  it('downloadDocText：本地目录树无此文件时给出可操作错误', async () => {
    await expect(downloadDocText({ getBlobText: async () => 'x' }, { owner: 'o', repo: 'r', branch: 'main' }, 'missing.md'))
      .rejects.toThrow('文件不在本地目录树中，请先更新目录');
  });
});
