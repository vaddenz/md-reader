import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, getFile, kvGet, kvSet, listFilesMeta, markExpired, putFiles, deleteFiles, touchFile, openDb, setRepoDbName, SCHEMA_VER } from '../../src/data/db';

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
  it('多仓库库作用域：文件/缓存互不可见，切回后原数据保留', async () => {
    await putFiles([{ path: 'a.md', sha: 's1', size: 2, text: 'hi', title: 'A', lastUsedAt: 100, updatedAt: 1 }]);
    try {
      await setRepoDbName('mdreader-test-scope');
      expect(await getFile('a.md')).toBeUndefined();
      await putFiles([{ path: 'b.md', sha: 's2', size: 2, text: 'yo', title: 'B', lastUsedAt: 100, updatedAt: 1 }]);
      expect(await listFilesMeta()).toHaveLength(1);
      await clearAllData(); // 删除测试库
    } finally {
      await setRepoDbName('mdreader');
    }
    expect((await getFile('a.md'))?.text).toBe('hi');
  });

  it('openDb 版本冲突时自愈且不挂起、不泄漏连接', async () => {
    // 造一个更高版本的库，使 SCHEMA_VER 更低的 open 异步失败（VersionError）
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mdreader', SCHEMA_VER + 1);
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    const healed = await openDb();
    expect(healed.objectStoreNames.contains('files')).toBe(true);
    expect(openDb()).toBe(openDb()); // 自愈后仍复用同一连接
    await kvSet('lastSyncAt', 1);
    expect(await kvGet('lastSyncAt')).toBe(1);
  });
});
