// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, kvGet, kvSet } from '../../src/data/db';
import { saveProgress } from '../../src/data/prefs';
import { syncAll, syncNow } from '../../src/sync/engine';
import { SYNC_COLLECTIONS } from '../../src/sync/collections';
import { readOutbox, enqueueChange } from '../../src/sync/outbox';
import { openRepoDb } from '../../src/sync/repoDb';
import { registerSyncBackend } from '../../src/sync/registry';
import { saveSyncConfig } from '../../src/sync/config';
import { SyncError, type RemoteRecord, type SyncBackend, type SyncRecord } from '../../src/sync/types';

beforeEach(async () => { await clearAllData(); });

function fakeBackend(remote: RemoteRecord[] = []) {
  const pushed: SyncRecord[][] = [];
  const backend: SyncBackend = {
    test: async () => ({}),
    pull: async () => remote,
    push: async (records) => { pushed.push([...records]); },
  };
  return { backend, pushed };
}

describe('sync engine', () => {
  it('首次同步 seed 本地进度并推送', async () => {
    await saveProgress('a.md', 0.6);
    const { backend, pushed } = fakeBackend();
    const summary = await syncAll(backend);
    expect(summary.pushed).toBeGreaterThan(0);
    expect(pushed.flat().some((r) => r.collection === 'reading.progress' && r.recordId === 'a.md')).toBe(true);
    expect(await readOutbox(await openRepoDb('mdreader'))).toEqual([]);
  });

  it('远端较新 / 相等时应用，本地较新时保留', async () => {
    await saveProgress('a.md', 0.2);
    const now = Date.now();
    const remote: RemoteRecord[] = [{
      scope: 'your-name/your-notes@main', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.9, updatedAt: now + 1000 }, updatedAt: now + 1000,
      deleted: false, deviceId: 'remote', serverUpdatedAt: 1,
    }];
    const { backend } = fakeBackend(remote);
    await syncAll(backend);
    expect((await kvGet('progress') as any)['a.md'].ratio).toBe(0.9);
  });

  it('reset 标记清理本地并过滤旧记录', async () => {
    await saveProgress('a.md', 0.5);
    const before = Date.now() + 10000;
    const remote: RemoteRecord[] = [{
      scope: 'your-name/your-notes@main', collection: 'reading.progress', recordId: '__reset__',
      payload: { before }, updatedAt: before, deleted: true, deviceId: 'remote', serverUpdatedAt: 1,
    }, {
      scope: 'your-name/your-notes@main', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.1, updatedAt: before - 1 }, updatedAt: before - 1,
      deleted: false, deviceId: 'remote', serverUpdatedAt: 2,
    }];
    const { backend } = fakeBackend(remote);
    await syncAll(backend);
    expect(await kvGet('progress')).toEqual({});
  });

  it('scope 变化时 cursor 从 0 拉取', async () => {
    const pulls: number[] = [];
    const backend: SyncBackend = {
      test: async () => ({}),
      pull: async (_scope, since) => { pulls.push(since); return []; },
      push: async () => {},
    };
    await kvSet('syncScope', 'old/scope@main');
    await syncAll(backend);
    expect(pulls).toContain(0);
  });

  it('注册全部六个集合，且 resetAt=0 不过滤 updatedAt=0', async () => {
    expect(SYNC_COLLECTIONS.map((collection) => collection.name)).toEqual([
      'reading.progress', 'reading.highlights', 'reading.favorites',
      'memory.srs', 'memory.attempts', 'memory.selection',
    ]);
    await kvSet('syncReset', { 'reading.favorites': 0 });
    const { backend } = fakeBackend([{
      scope: 'your-name/your-notes@main', collection: 'reading.favorites', recordId: 'a.md',
      payload: { addedAt: 0 }, updatedAt: 0, deleted: false, deviceId: 'remote', serverUpdatedAt: 1,
    }]);
    await syncAll(backend);
    expect(await kvGet('favoritesV2')).toEqual({ 'a.md': { addedAt: 0 } });
  });

  it('推送普通 outbox 记录时重读本地当前值，而不使用旧 payload', async () => {
    const first = fakeBackend();
    await saveProgress('a.md', 0.2);
    await syncAll(first.backend);

    const db = await openRepoDb('mdreader');
    const tx = db.db.transaction('sync_outbox', 'readwrite');
    enqueueChange(tx, {
      collection: 'reading.progress', recordId: 'a.md', updatedAt: 1,
      deleted: false, payload: { ratio: 0.1, updatedAt: 1 },
    });
    await tx.done;
    await kvSet('progress', { 'a.md': { ratio: 0.9, updatedAt: 2 } });

    const { backend, pushed } = fakeBackend();
    await syncAll(backend);
    expect(pushed.flat().find((record) => record.recordId === 'a.md')?.payload).toEqual({ ratio: 0.9, updatedAt: 2 });
  });

  it('推送 outbox 时每批最多 200 条', async () => {
    const db = await openRepoDb('mdreader');
    const tx = db.db.transaction('sync_outbox', 'readwrite');
    for (let i = 0; i < 405; i += 1) {
      enqueueChange(tx, {
        collection: 'reading.progress', recordId: `missing-${i}`, updatedAt: i + 1, deleted: true,
      });
    }
    await tx.done;

    const { backend, pushed } = fakeBackend();
    const summary = await syncAll(backend);
    expect(pushed.map((batch) => batch.length)).toEqual([200, 200, 5]);
    expect(summary.pushed).toBe(405);
  });

  it('reset outbox 推送时保留 reset payload', async () => {
    const db = await openRepoDb('mdreader');
    const tx = db.db.transaction('sync_outbox', 'readwrite');
    enqueueChange(tx, {
      collection: 'reading.progress', recordId: '__reset__', updatedAt: 42,
      deleted: true, payload: { before: 42 },
    });
    await tx.done;

    const { backend, pushed } = fakeBackend();
    await syncAll(backend);
    expect(pushed.flat().find((record) => record.recordId === '__reset__')?.payload).toEqual({ before: 42 });
  });

  it('错误摘要使用不含原始错误内容的中文消息', async () => {
    const backend: SyncBackend = {
      test: async () => ({}),
      pull: async () => { throw new SyncError('network', 'private-token-or-payload'); },
      push: async () => {},
    };
    const summary = await syncAll(backend);
    expect(summary.repos[0].error).toBe('网络连接失败，请稍后重试');
    expect(summary.repos[0].error).not.toContain('private-token-or-payload');
  });

  it('syncNow 并发调用复用同一个 activeSync Promise', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    let releasePull!: () => void;
    const waiting = new Promise<void>((resolve) => { releasePull = resolve; });
    const backend: SyncBackend = {
      test: async () => ({}),
      pull: async () => { await waiting; return []; },
      push: async () => {},
    };
    registerSyncBackend({
      type: 'sync-engine-test', label: 'test', description: 'test', fields: [], create: () => backend,
    });
    saveSyncConfig({ version: 1, enabled: true, autoSync: false, backend: 'sync-engine-test', values: {} });

    try {
      const first = syncNow();
      const second = syncNow();
      expect(second).toBe(first);
      releasePull();
      await first;
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
