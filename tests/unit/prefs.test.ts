import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, kvGet, kvSet, openDb } from '../../src/data/db';
import { getFavorites, getProgress, recentDocs, saveProgress, toggleFavorite } from '../../src/data/prefs';
import type { OutboxEntry } from '../../src/sync/outbox';

async function outbox(): Promise<OutboxEntry[]> {
  const db = await openDb();
  return db.getAll('sync_outbox') as Promise<OutboxEntry[]>;
}

beforeEach(async () => { await clearAllData(); });

describe('prefs', () => {
  it('收藏开关幂等', async () => {
    expect(await toggleFavorite('a.md')).toEqual(['a.md']);
    expect(await toggleFavorite('a.md')).toEqual([]);
    expect(await getFavorites()).toEqual([]);
  });

  it('收藏按加入顺序追加、互不影响', async () => {
    await toggleFavorite('a.md');
    await toggleFavorite('b.md');
    expect(await getFavorites()).toEqual(['a.md', 'b.md']);
    await toggleFavorite('a.md'); // 取消中间一项，其余保持原顺序
    expect(await getFavorites()).toEqual(['b.md']);
  });

  it('进度写入与最近阅读排序', async () => {
    await saveProgress('a.md', 0.5);
    await new Promise((r) => setTimeout(r, 5)); // 拉开 updatedAt，避免同毫秒并列
    await saveProgress('b.md', 0.1);
    expect((await getProgress('a.md'))?.ratio).toBe(0.5);
    const recents = await recentDocs(3);
    expect(recents[0].path).toBe('b.md');
  });

  it('进度合并：不覆盖其他文档、保留 headingId、钳制比例', async () => {
    await saveProgress('a.md', 0.5, '标题');
    await saveProgress('b.md', 0.2);
    expect(await getProgress('a.md')).toMatchObject({ ratio: 0.5, headingId: '标题' });
    expect(await getProgress('b.md')).toMatchObject({ ratio: 0.2 });

    await saveProgress('a.md', 1.7);
    expect((await getProgress('a.md'))?.ratio).toBe(1);
    await saveProgress('c.md', -0.3);
    expect((await getProgress('c.md'))?.ratio).toBe(0);

    expect(await getProgress('b.md')).toBeDefined(); // 合并不丢其他条目
  });

  it('recentDocs 按 updatedAt 降序并受 limit 限制；未知文档返回 undefined', async () => {
    await saveProgress('a.md', 0.1);
    await new Promise((r) => setTimeout(r, 5));
    await saveProgress('b.md', 0.2);
    await new Promise((r) => setTimeout(r, 5));
    await saveProgress('c.md', 0.3);
    expect((await recentDocs(2)).map((r) => r.path)).toEqual(['c.md', 'b.md']);
    expect(await recentDocs(0)).toEqual([]);
    expect(await getProgress('ghost.md')).toBeUndefined();
  });

  it('损坏的 kv 数据按空处理（不抛出）', async () => {
    await kvSet('favorites', { nope: true });
    await kvSet('progress', 'broken');
    expect(await getFavorites()).toEqual([]);
    expect(await getProgress('a.md')).toBeUndefined();
    expect(await recentDocs()).toEqual([]);
  });

  it('saveProgress 原子写 outbox，recordId=path', async () => {
    await saveProgress('a.md', 0.5);
    const [entry] = await outbox();
    expect(entry).toMatchObject({ collection: 'reading.progress', recordId: 'a.md', deleted: false });
    expect(entry.updatedAt).toBeGreaterThan(0);
  });

  it('收藏迁移为 favoritesV2，并写 upsert / tombstone', async () => {
    await kvSet('favorites', ['a.md', 'b.md']);
    expect(await getFavorites()).toEqual(['a.md', 'b.md']);
    expect(await kvGet('favoritesV2')).toEqual({ 'a.md': { addedAt: 0 }, 'b.md': { addedAt: 1 } });
    expect(await kvGet('favorites')).toBeUndefined();

    await toggleFavorite('a.md'); // 删除 → tombstone
    const entries = await outbox();
    const a = entries.find((e) => e.recordId === 'a.md')!;
    expect(a.deleted).toBe(true);
    await toggleFavorite('a.md'); // 重新收藏 → upsert 覆盖同一条
    const again = (await outbox()).find((e) => e.recordId === 'a.md')!;
    expect(again.deleted).toBe(false);
    expect(again.rev).not.toBe(a.rev);
  });
});
