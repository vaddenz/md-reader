import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { kvGet, openDb } from '../../src/data/db';

describe('IndexedDB v1 → v2 升级', () => {
  it('旧数据保留，新 store 可用', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mdreader', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['files', 'blobs', 'kv']) db.createObjectStore(name);
      };
      req.onsuccess = () => {
        const db = req.result;
        const put = db.transaction('kv', 'readwrite').objectStore('kv').put(42, 'legacy');
        put.onsuccess = () => { db.close(); resolve(); };
        put.onerror = () => reject(put.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    expect(db.objectStoreNames.contains('mem_banks')).toBe(true);
    expect(db.objectStoreNames.contains('mem_srs')).toBe(true);
    expect(db.objectStoreNames.contains('mem_attempts')).toBe(true);
    expect(await kvGet('legacy')).toBe(42);
  });
});
