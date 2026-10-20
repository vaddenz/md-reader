// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, closeDb, openDb, openNamedDb } from '../../src/data/db';
import { getDeviceId, nextUpdatedAt, repoScope } from '../../src/sync/device';
import { openRepoDb } from '../../src/sync/repoDb';

const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

beforeEach(async () => {
  vi.stubGlobal('localStorage', storage);
  store.clear();
  await clearAllData();
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllGlobals();
});

describe('IndexedDB v3', () => {
  it('新增 sync_outbox，旧数据仍可读', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mdreader', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['files', 'blobs', 'kv', 'mem_banks', 'mem_srs', 'mem_attempts']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(42, 'legacy');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    expect(db.objectStoreNames.contains('sync_outbox')).toBe(true);
    expect((await db.get('kv', 'legacy'))).toBe(42);
    const tx = db.transaction('sync_outbox', 'readonly');
    expect(tx.store.indexNames.contains('collection')).toBe(true);
  });

  it('openNamedDb 打开非当前仓库库，调用方可关闭', async () => {
    const db = await openNamedDb('mdreader-test-other');
    expect(db.objectStoreNames.contains('sync_outbox')).toBe(true);
    db.close();
    await openNamedDb('mdreader-test-other').then((d) => d.close());
  });
});

describe('device / scope / 时间戳', () => {
  it('设备 ID 稳定；缺失时生成并写回', () => {
    const a = getDeviceId();
    expect(a).toBe(getDeviceId());
    expect(localStorage.getItem('mdreader.syncDeviceId')).toBe(a);
  });

  it('nextUpdatedAt 严格递增，且至少大于 atLeast', () => {
    const a = nextUpdatedAt(1000);
    const b = nextUpdatedAt(1000);
    const c = nextUpdatedAt(1000, 5000);
    expect(a).toBeGreaterThanOrEqual(1000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(5000);
  });

  it('repoScope 归一化 owner/repo，保留 branch 大小写', () => {
    expect(repoScope(' VaddenZ ', 'My-Notes', 'Feature/X')).toBe('vaddenz/my-notes@Feature/X');
  });
});

describe('openRepoDb', () => {
  it('当前库 active=true 且 close 不关闭全局连接', async () => {
    const db = await openRepoDb('mdreader');
    expect(db.active).toBe(true);
    db.close();
    expect((await openDb()).objectStoreNames.contains('sync_outbox')).toBe(true);
  });
});
