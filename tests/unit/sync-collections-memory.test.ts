// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { appendAttempt, loadSrsMap, putSrs, saveSelection, getSelection } from '../../src/data/memory';
import { openRepoDb } from '../../src/sync/repoDb';
import { memorySrsCollection } from '../../src/sync/collections/memorySrs';
import { memoryAttemptsCollection } from '../../src/sync/collections/memoryAttempts';
import { memorySelectionCollection } from '../../src/sync/collections/memorySelection';
import { setTombstone, tombstoneAt } from '../../src/sync/tombstones';
import type { SrsState } from '../../src/lib/srs';

const NOW = 1_760_000_000_000;
const srs = (qid: string): SrsState => ({
  qid, bankPath: 'b', id: qid, stage: 0, dueAt: NOW, lastAt: NOW, firstAt: NOW,
  lastScore: null, verdict: 'again', reps: 1, lapses: 0,
});

beforeEach(async () => { await clearAllData(); });

it('srs：远端更新覆盖，reset 清理', async () => {
  const repo = await openRepoDb('mdreader');
  await putSrs(srs('q1'));
  await memorySrsCollection.applyRemote(repo, {
    scope: 's', collection: 'memory.srs', recordId: 'q1', payload: { ...srs('q1'), stage: 3, lastAt: NOW + 1 },
    updatedAt: NOW + 1, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
  });
  expect((await loadSrsMap()).get('q1')?.stage).toBe(3);
  await memorySrsCollection.clearBefore!(repo, NOW + 1);
  expect((await loadSrsMap()).size).toBe(0);
  repo.close();
});

it('attempts：远端新增、tombstone 删除', async () => {
  const repo = await openRepoDb('mdreader');
  await appendAttempt({
    qid: 'q1', bankPath: 'b', idLabel: 'Q1', ts: NOW, mode: 'ai', score: 80, verdict: 'good',
    answer: 'a', hit: [], missed: [], comment: '', durationMs: 1, hintUsed: false, revealed: false,
  });
  await memoryAttemptsCollection.applyRemote(repo, {
    scope: 's', collection: 'memory.attempts', recordId: `q1|${NOW}|ai`, payload: null,
    updatedAt: NOW + 1, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
  });
  expect((await repo.getAll('mem_attempts')).length).toBe(0);
  repo.close();
});

it('selection：只替换 banks/filters，保留本地训练设置', async () => {
  const repo = await openRepoDb('mdreader');
  await saveSelection({ ...(await getSelection()), banks: ['local.jsonl'], sessionSize: 50, newPerDay: 3 });
  const local = await repo.kvGet<{ updatedAt?: number }>('memSelection');
  const remoteAt = (local?.updatedAt ?? 0) + 10;
  await memorySelectionCollection.applyRemote(repo, {
    scope: 's', collection: 'memory.selection', recordId: 'selection',
    payload: { banks: ['remote.jsonl'], filters: { kinds: ['single'], chapters: [], types: [], tags: [], difficulty: [] }, updatedAt: remoteAt },
    updatedAt: remoteAt, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
  });
  const sel = await getSelection();
  expect(sel.banks).toEqual(['remote.jsonl']);
  expect(sel.sessionSize).toBe(50);
  expect(sel.newPerDay).toBe(3);
  repo.close();
});

describe('srs tombstone', () => {
  it('陈旧远端 upsert 不复活；更新的 upsert 复活并清墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    await putSrs(srs('q1'));
    await repo.del('mem_srs', 'q1');
    await setTombstone(repo, 'memory.srs', 'q1', NOW + 5);

    const stale = await memorySrsCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.srs', recordId: 'q1', payload: srs('q1'),
      updatedAt: NOW + 5, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(stale).toBe(false);
    expect((await loadSrsMap()).size).toBe(0);

    const fresh = await memorySrsCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.srs', recordId: 'q1',
      payload: { ...srs('q1'), stage: 4, lastAt: NOW + 6 },
      updatedAt: NOW + 6, deleted: false, deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(fresh).toBe(true);
    expect((await loadSrsMap()).get('q1')?.stage).toBe(4);
    expect(await tombstoneAt(repo, 'memory.srs', 'q1')).toBeUndefined();
    repo.close();
  });

  it('远端 tombstone 删除并写本地墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    await putSrs(srs('q1'));

    const applied = await memorySrsCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.srs', recordId: 'q1', payload: null,
      updatedAt: NOW + 7, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(applied).toBe(true);
    expect((await loadSrsMap()).size).toBe(0);
    expect(await tombstoneAt(repo, 'memory.srs', 'q1')).toBe(NOW + 7);
    repo.close();
  });
});

describe('attempts tombstone', () => {
  it('陈旧远端 upsert 不复活；更新的 upsert 复活并清墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    const key = `q1|${NOW}|ai`;
    await setTombstone(repo, 'memory.attempts', key, NOW + 5);

    const stale = await memoryAttemptsCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.attempts', recordId: key,
      payload: {
        qid: 'q1', bankPath: 'b', idLabel: 'Q1', ts: NOW, mode: 'ai', score: 80, verdict: 'good',
        answer: 'a', hit: [], missed: [], comment: '', durationMs: 1, hintUsed: false, revealed: false,
      },
      updatedAt: NOW + 5, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(stale).toBe(false);
    expect((await repo.getAll('mem_attempts')).length).toBe(0);

    const fresh = await memoryAttemptsCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.attempts', recordId: key,
      payload: {
        qid: 'q1', bankPath: 'b', idLabel: 'Q1', ts: NOW, mode: 'ai', score: 90, verdict: 'excellent',
        answer: 'a', hit: [], missed: [], comment: '', durationMs: 1, hintUsed: false, revealed: false,
      },
      updatedAt: NOW + 6, deleted: false, deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(fresh).toBe(true);
    expect((await repo.getAll('mem_attempts')).length).toBe(1);
    expect(await tombstoneAt(repo, 'memory.attempts', key)).toBeUndefined();
    repo.close();
  });

  it('远端 tombstone 删除并写本地墓碑', async () => {
    const repo = await openRepoDb('mdreader');
    const key = `q1|${NOW}|ai`;
    await appendAttempt({
      qid: 'q1', bankPath: 'b', idLabel: 'Q1', ts: NOW, mode: 'ai', score: 80, verdict: 'good',
      answer: 'a', hit: [], missed: [], comment: '', durationMs: 1, hintUsed: false, revealed: false,
    });

    const applied = await memoryAttemptsCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.attempts', recordId: key, payload: null,
      updatedAt: NOW + 7, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(applied).toBe(true);
    expect((await repo.getAll('mem_attempts')).length).toBe(0);
    expect(await tombstoneAt(repo, 'memory.attempts', key)).toBe(NOW + 7);
    repo.close();
  });
});

describe('selection clearBefore / tombstone', () => {
  it('clearBefore 删除 <= 边界的偏好', async () => {
    const repo = await openRepoDb('mdreader');
    await saveSelection({ ...(await getSelection()), banks: ['a.jsonl'] });
    const raw = await repo.kvGet<{ updatedAt?: number }>('memSelection');
    await memorySelectionCollection.clearBefore!(repo, raw?.updatedAt ?? 0);
    expect((await getSelection()).banks).toEqual([]);
    repo.close();
  });

  it('陈旧远端偏好不覆盖本地；更新的远端偏好覆盖', async () => {
    const repo = await openRepoDb('mdreader');
    await saveSelection({ ...(await getSelection()), banks: ['a.jsonl'] });
    const local = await repo.kvGet<{ updatedAt?: number }>('memSelection');
    expect(local?.updatedAt).toEqual(expect.any(Number));

    const stale = await memorySelectionCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.selection', recordId: 'selection',
      payload: { banks: ['stale.jsonl'], filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] }, updatedAt: (local?.updatedAt ?? 0) - 1 },
      updatedAt: (local?.updatedAt ?? 0) - 1, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(stale).toBe(false);
    expect((await getSelection()).banks).toEqual(['a.jsonl']);

    const fresh = await memorySelectionCollection.applyRemote(repo, {
      scope: 's', collection: 'memory.selection', recordId: 'selection',
      payload: { banks: ['fresh.jsonl'], filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] }, updatedAt: (local?.updatedAt ?? 0) + 1 },
      updatedAt: (local?.updatedAt ?? 0) + 1, deleted: false, deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(fresh).toBe(true);
    expect((await getSelection()).banks).toEqual(['fresh.jsonl']);
    repo.close();
  });
});
