// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { getProgress, saveProgress } from '../../src/data/prefs';
import { openRepoDb } from '../../src/sync/repoDb';
import { progressCollection } from '../../src/sync/collections/progress';
import { favoritesCollection } from '../../src/sync/collections/favorites';

beforeEach(async () => { await clearAllData(); });

describe('progress collection', () => {
  it('list / apply newer / apply tombstone / equal 远端获胜', async () => {
    const repo = await openRepoDb('mdreader');
    await saveProgress('a.md', 0.4, 'h');
    expect((await progressCollection.listLocal(repo))[0]).toMatchObject({ recordId: 'a.md', updatedAt: expect.any(Number) });

    const applied = await progressCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.9, updatedAt: 9999999999999 }, updatedAt: 9999999999999,
      deleted: false, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(applied).toBe(true);
    expect((await getProgress('a.md'))?.ratio).toBe(0.9);

    await progressCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.progress', recordId: 'a.md', payload: null,
      updatedAt: 9999999999999, deleted: true, deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(await getProgress('a.md')).toBeUndefined();
    repo.close();
  });

  it('clearBefore 删除 <= 边界，保留更新的进度', async () => {
    const repo = await openRepoDb('mdreader');
    await repo.kvSet('progress', {
      old: { ratio: 0.1, updatedAt: 5 },
      fresh: { ratio: 0.2, updatedAt: 6 },
    });
    await progressCollection.clearBefore!(repo, 5);
    expect(await repo.kvGet('progress')).toEqual({ fresh: { ratio: 0.2, updatedAt: 6 } });
    repo.close();
  });
});

describe('favorites collection', () => {
  it('legacy 迁移 + apply 删除', async () => {
    const repo = await openRepoDb('mdreader');
    await repo.kvSet('favorites', ['a.md']);
    const listed = await favoritesCollection.listLocal(repo);
    expect(listed[0]).toMatchObject({ recordId: 'a.md', updatedAt: 0 });
    await favoritesCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.favorites', recordId: 'a.md', payload: null,
      updatedAt: 10, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(await repo.kvGet('favoritesV2')).toEqual({});
    repo.close();
  });

  it('clearBefore 删除 <= 边界，保留更新的收藏', async () => {
    const repo = await openRepoDb('mdreader');
    await repo.kvSet('favoritesV2', { old: { addedAt: 5 }, fresh: { addedAt: 6 } });
    await favoritesCollection.clearBefore!(repo, 5);
    expect(await repo.kvGet('favoritesV2')).toEqual({ fresh: { addedAt: 6 } });
    repo.close();
  });
});
