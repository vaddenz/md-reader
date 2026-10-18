import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, getFile, kvGet, kvSet, listFilesMeta, markExpired, putFiles, deleteFiles, touchFile, openDb } from '../../src/data/db';

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
  it('openDb 版本冲突时自愈且不挂起、不泄漏连接', async () => {
    // 造一个更高版本的库，使 SCHEMA_VER=1 的 open 异步失败（VersionError）
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mdreader', 2);
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
