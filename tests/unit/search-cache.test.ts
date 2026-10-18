import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, kvSet, markExpired, putFiles, type FileRecord } from '../../src/data/db';
import { loadCachedTexts, resetSearchCacheForTests } from '../../src/data/searchCache';

function rec(path: string, text: string | null): FileRecord {
  return { path, sha: `sha-${path}`, size: text?.length ?? 0, text, title: path, lastUsedAt: 1, updatedAt: 1 };
}

beforeEach(async () => {
  await clearAllData();
  resetSearchCacheForTests();
});

describe('loadCachedTexts', () => {
  it('从元数据读取已缓存正文，跳过未缓存（text: null）文档', async () => {
    await putFiles([rec('a.md', '正文 A'), rec('b.md', null)]);
    expect(await loadCachedTexts()).toEqual([{ path: 'a.md', text: '正文 A' }]);
  });

  it('按需下载新增缓存文档后自动重建（lastSyncAt 不变）', async () => {
    await kvSet('lastSyncAt', 100);
    await putFiles([rec('a.md', '正文 A')]);
    expect((await loadCachedTexts()).map((d) => d.path)).toEqual(['a.md']);

    // 模拟 DocPage 打开过期文档 / 「纳入全文搜索」：lastSyncAt 不变，仅新增已缓存文档
    await putFiles([rec('b.md', '正文 B')]);
    expect(await loadCachedTexts()).toEqual([
      { path: 'a.md', text: '正文 A' },
      { path: 'b.md', text: '正文 B' },
    ]);
  });

  it('过期清理（markExpired）后自动重建（命中数变小）', async () => {
    await kvSet('lastSyncAt', 100);
    await putFiles([rec('a.md', '正文 A'), rec('b.md', '正文 B')]);
    expect((await loadCachedTexts()).length).toBe(2);

    await markExpired(['a.md']);
    expect(await loadCachedTexts()).toEqual([{ path: 'b.md', text: '正文 B' }]);
  });

  it('lastSyncAt 变化后重建（命中数不变也能取到新正文）', async () => {
    await kvSet('lastSyncAt', 100);
    await putFiles([rec('a.md', 'v1')]);
    expect(await loadCachedTexts()).toEqual([{ path: 'a.md', text: 'v1' }]);

    // 完整同步：同一文档 sha/正文更新 + lastSyncAt 推进
    await kvSet('lastSyncAt', 200);
    await putFiles([{ ...rec('a.md', 'v2'), sha: 'sha-a2' }]);
    expect(await loadCachedTexts()).toEqual([{ path: 'a.md', text: 'v2' }]);
  });

  it('命中数与 lastSyncAt 均不变时复用缓存（不重读正文）', async () => {
    await kvSet('lastSyncAt', 100);
    await putFiles([rec('a.md', 'v1')]);
    expect(await loadCachedTexts()).toEqual([{ path: 'a.md', text: 'v1' }]);

    // 直接改正文但不推进 lastSyncAt、不改变命中数：不满足自愈条件 → 仍返回缓存
    await putFiles([{ ...rec('a.md', 'v1-mutated'), sha: 'sha-a2' }]);
    expect(await loadCachedTexts()).toEqual([{ path: 'a.md', text: 'v1' }]);
  });
});
