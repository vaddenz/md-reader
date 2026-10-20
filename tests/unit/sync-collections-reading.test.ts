// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { getDocHighlights, addHighlight, removeHighlights } from '../../src/data/highlights';
import { getFavorites, getProgress, saveProgress, toggleFavorite } from '../../src/data/prefs';
import { openRepoDb } from '../../src/sync/repoDb';
import { progressCollection } from '../../src/sync/collections/progress';
import { favoritesCollection } from '../../src/sync/collections/favorites';
import { highlightsCollection } from '../../src/sync/collections/highlights';
import { clearTombstone, readTombstones, setTombstone, tombstoneAt } from '../../src/sync/tombstones';

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

  it('本地墓碑阻止陈旧远端 upsert 复活；更新的 upsert 复活并清墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    await repo.kvSet('progress', { 'a.md': { ratio: 0.4, updatedAt: 10 } });
    await setTombstone(repo, 'reading.progress', 'a.md', 20);
    await repo.kvSet('progress', {}); // 本地删除：记录已移除，只剩墓碑

    const stale = await progressCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.6, updatedAt: 20 }, updatedAt: 20, deleted: false,
      deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(stale).toBe(false);
    expect(await getProgress('a.md')).toBeUndefined();

    const fresh = await progressCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.8, updatedAt: 30 }, updatedAt: 30, deleted: false,
      deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(fresh).toBe(true);
    expect((await getProgress('a.md'))?.ratio).toBe(0.8);
    expect(await tombstoneAt(repo, 'reading.progress', 'a.md')).toBeUndefined();
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

  it('本地取消收藏后陈旧远端 upsert 不复活；更新的 upsert 复活并清墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    await toggleFavorite('a.md');
    const addedAt = (await repo.kvGet<Record<string, { addedAt: number }>>('favoritesV2'))!['a.md'].addedAt;
    await toggleFavorite('a.md'); // 本地删除
    const deletedAt = (await tombstoneAt(repo, 'reading.favorites', 'a.md'))!;
    expect(deletedAt).toBeGreaterThan(addedAt);

    const stale = await favoritesCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.favorites', recordId: 'a.md',
      payload: { addedAt }, updatedAt: addedAt, deleted: false,
      deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(stale).toBe(false);
    expect(await repo.kvGet('favoritesV2')).toEqual({});
    expect(await getFavorites()).toEqual([]);

    const fresh = await favoritesCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.favorites', recordId: 'a.md',
      payload: { addedAt: deletedAt + 1 }, updatedAt: deletedAt + 1, deleted: false,
      deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(fresh).toBe(true);
    expect(await repo.kvGet('favoritesV2')).toEqual({ 'a.md': { addedAt: deletedAt + 1 } });
    expect(await getFavorites()).toEqual(['a.md']);
    expect(await tombstoneAt(repo, 'reading.favorites', 'a.md')).toBeUndefined();
    repo.close();
  });
});

describe('highlights collection', () => {
  const hl = (id: string, exact: string, createdAt: number) => ({
    id, exact, prefix: '', suffix: '', decorations: [{ kind: 'bg', color: 'yellow' }], createdAt,
  });

  it('highlights：list 带 path，apply 删除 tombstone', async () => {
    const repo = await openRepoDb('mdreader');
    await addHighlight('a.md', hl('h1', '甲', 1000));
    const [local] = await highlightsCollection.listLocal(repo);
    expect(local.payload).toMatchObject({ path: 'a.md', record: { id: 'h1' } });

    await highlightsCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.highlights', recordId: 'h1', payload: null,
      updatedAt: 2000, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(await repo.kvGet('highlights')).toEqual({});
    repo.close();
  });

  it('本地删除写墓碑；陈旧远端 upsert 不复活，更新的 upsert 复活并清墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    await addHighlight('a.md', hl('h1', '甲', 1000));
    await removeHighlights('a.md', ['h1']);
    const deletedAt = (await tombstoneAt(repo, 'reading.highlights', 'h1'))!;
    expect(deletedAt).toBeGreaterThan(1000);

    const stale = await highlightsCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.highlights', recordId: 'h1',
      payload: { path: 'a.md', record: hl('h1', '甲', 1000) },
      updatedAt: 1000, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(stale).toBe(false);
    expect(await repo.kvGet('highlights')).toEqual({});
    expect(await getDocHighlights('a.md')).toEqual([]);

    const fresh = await highlightsCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.highlights', recordId: 'h1',
      payload: { path: 'a.md', record: hl('h1', '甲', deletedAt + 1) },
      updatedAt: deletedAt + 1, deleted: false, deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(fresh).toBe(true);
    expect((await getDocHighlights('a.md')).map((r) => r.id)).toEqual(['h1']);
    expect(await tombstoneAt(repo, 'reading.highlights', 'h1')).toBeUndefined();
    repo.close();
  });

  it('远端 tombstone 删除记录并写本地墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    await addHighlight('b.md', hl('h2', '乙', 1000));

    const applied = await highlightsCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.highlights', recordId: 'h2', payload: null,
      updatedAt: 2000, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(applied).toBe(true);
    expect(await getDocHighlights('b.md')).toEqual([]);
    expect(await tombstoneAt(repo, 'reading.highlights', 'h2')).toBe(2000);
    repo.close();
  });

  it('clearBefore 删除 <= 边界，保留更新的高亮', async () => {
    const repo = await openRepoDb('mdreader');
    await repo.kvSet('highlights', {
      'a.md': [hl('old', '旧', 5)],
      'b.md': [hl('fresh', '新', 6)],
    });
    await highlightsCollection.clearBefore!(repo, 5);
    expect(await repo.kvGet('highlights')).toEqual({ 'b.md': [hl('fresh', '新', 6)] });
    repo.close();
  });
});

describe('tombstones', () => {
  it('set / read / clear 记录按 collection + recordId 隔离', async () => {
    const repo = await openRepoDb('mdreader');
    await setTombstone(repo, 'reading.progress', 'a.md', 12);
    await setTombstone(repo, 'reading.favorites', 'a.md', 13);
    expect(await readTombstones(repo)).toEqual({
      'reading.progress': { 'a.md': 12 },
      'reading.favorites': { 'a.md': 13 },
    });
    expect(await tombstoneAt(repo, 'reading.progress', 'a.md')).toBe(12);
    await clearTombstone(repo, 'reading.progress', 'a.md');
    expect(await tombstoneAt(repo, 'reading.progress', 'a.md')).toBeUndefined();
    expect(await tombstoneAt(repo, 'reading.favorites', 'a.md')).toBe(13);
    repo.close();
  });
});
