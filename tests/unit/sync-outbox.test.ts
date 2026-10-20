// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { openRepoDb } from '../../src/sync/repoDb';
import {
  commitWithNotify, countOutbox, deleteOutboxIfRev, enqueueChange, readOutbox, removeOutboxAtOrBefore, seedCollectionOutbox,
} from '../../src/sync/outbox';
import type { SyncCollection } from '../../src/sync/types';

beforeEach(async () => { await clearAllData(); });

describe('outbox', () => {
  it('同一记录 upsert 去重、rev 更新；rev 不匹配不删除', async () => {
    const repo = await openRepoDb('mdreader');
    const tx = repo.db.transaction('sync_outbox', 'readwrite');
    enqueueChange(tx, { collection: 'reading.progress', recordId: 'a.md', updatedAt: 1, deleted: false });
    enqueueChange(tx, { collection: 'reading.progress', recordId: 'a.md', updatedAt: 2, deleted: false });
    await tx.done;

    const [entry] = await readOutbox(repo);
    expect(entry.updatedAt).toBe(2);
    expect(entry.rev).toBeTruthy();
    expect(await deleteOutboxIfRev(repo, entry.id, 'wrong')).toBe(false);
    expect(await countOutbox(repo)).toBe(1);
    expect(await deleteOutboxIfRev(repo, entry.id, entry.rev)).toBe(true);
    expect(await countOutbox(repo)).toBe(0);
    repo.close();
  });

  it('reset 前清理旧条目，保留 reset 自身', async () => {
    const repo = await openRepoDb('mdreader');
    const tx = repo.db.transaction('sync_outbox', 'readwrite');
    enqueueChange(tx, { collection: 'memory.srs', recordId: 'q1', updatedAt: 10, deleted: false });
    enqueueChange(tx, { collection: 'memory.srs', recordId: '__reset__', updatedAt: 20, deleted: true, payload: { before: 20 } });
    await tx.done;
    await removeOutboxAtOrBefore(repo, 'memory.srs', 20);
    const left = await readOutbox(repo);
    expect(left.map((e) => e.recordId)).toEqual(['__reset__']);
    repo.close();
  });

  it('seedCollectionOutbox 只入队 reset 之后的记录', async () => {
    const repo = await openRepoDb('mdreader');
    const collection: SyncCollection = {
      name: 'test.collection', label: 'Test',
      listLocal: async () => [
        { recordId: 'old', updatedAt: 5, deleted: false, payload: { v: 5 } },
        { recordId: 'new', updatedAt: 15, deleted: false, payload: { v: 15 } },
      ],
      getLocal: async () => undefined,
      applyRemote: async () => false,
    };
    await seedCollectionOutbox(repo, collection, 10);
    const entries = await readOutbox(repo);
    expect(entries.map((e) => e.recordId)).toEqual(['new']);
    repo.close();
  });

  it('resetAt=0 时不过滤 updatedAt=0 的记录，且 seed 不携带 payload', async () => {
    const repo = await openRepoDb('mdreader');
    const collection: SyncCollection = {
      name: 'reading.favorites', label: 'Favorites',
      listLocal: async () => [
        { recordId: 'legacy', updatedAt: 0, deleted: false, payload: null },
        { recordId: 'deleted', updatedAt: 0, deleted: true, payload: null },
      ],
      getLocal: async () => undefined,
      applyRemote: async () => false,
    };
    await seedCollectionOutbox(repo, collection, 0);
    const entries = await readOutbox(repo);
    expect(entries.map((e) => e.recordId).sort()).toEqual(['deleted', 'legacy']);
    expect(entries.every((e) => !('payload' in e))).toBe(true);
    repo.close();
  });

  it('commitWithNotify 仅在事务提交后派发 sync-dirty；提交失败不派发', async () => {
    const dispatch = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: dispatch, addEventListener: vi.fn() });
    try {
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });
      const pending = commitWithNotify({ done });
      await Promise.resolve();
      expect(dispatch).not.toHaveBeenCalled();
      resolveDone();
      await pending;
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect((dispatch.mock.calls[0][0] as Event).type).toBe('mdreader:sync-dirty');

      const failed = vi.fn();
      vi.stubGlobal('window', { dispatchEvent: failed, addEventListener: vi.fn() });
      await expect(commitWithNotify({ done: Promise.reject(new Error('abort')) })).rejects.toThrow('abort');
      expect(failed).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
