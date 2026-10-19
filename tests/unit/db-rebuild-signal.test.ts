// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/data/db';

describe('db 自愈信号（T22）', () => {
  it('版本冲突自愈重建成功后派发一次 mdreader:cache-rebuilt', async () => {
    // 造一个更高版本的库，使 SCHEMA_VER 更低的 open 异步失败（VersionError）→ 走自愈路径
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mdreader', 3);
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });

    const events: Event[] = [];
    const onRebuilt = (e: Event) => events.push(e);
    window.addEventListener('mdreader:cache-rebuilt', onRebuilt);
    try {
      const db = await openDb();
      expect(db.objectStoreNames.contains('files')).toBe(true);
      // 信号在重建成功后的微任务中派发
      await new Promise((r) => setTimeout(r, 0));
      expect(events).toHaveLength(1);
    } finally {
      window.removeEventListener('mdreader:cache-rebuilt', onRebuilt);
    }
  });

  it('正常打开（无自愈）不派发信号', async () => {
    const events: Event[] = [];
    const onRebuilt = (e: Event) => events.push(e);
    window.addEventListener('mdreader:cache-rebuilt', onRebuilt);
    try {
      await openDb(); // 上一个用例已自愈出 v2 库，这里直接复用
      await new Promise((r) => setTimeout(r, 0));
      expect(events).toHaveLength(0);
    } finally {
      window.removeEventListener('mdreader:cache-rebuilt', onRebuilt);
    }
  });
});
