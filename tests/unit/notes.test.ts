import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, kvSet, openDb } from '../../src/data/db';
import {
  addNote, getDocNotes, getNotes, removeNotes, sanitizeNotes, updateNote,
  type NoteAnchor,
} from '../../src/data/notes';
import { resetDeviceCacheForTests } from '../../src/sync/device';
import type { OutboxEntry } from '../../src/sync/outbox';

const anchor = (exact: string): NoteAnchor => ({ exact, prefix: '前文', suffix: '后文' });

async function outbox(): Promise<OutboxEntry[]> {
  return (await openDb()).getAll('sync_outbox') as Promise<OutboxEntry[]>;
}

beforeEach(async () => {
  await clearAllData();
  resetDeviceCacheForTests();
});

describe('sanitizeNotes', () => {
  it('非对象返回空；丢弃缺 id/exact/body 的记录，缺失时间按 0 处理', () => {
    expect(sanitizeNotes(null)).toEqual({});
    expect(sanitizeNotes({ 'a.md': [
      { id: 'n1', exact: '有效', body: '内容', prefix: '前', suffix: '后', createdAt: 1, updatedAt: 2 },
      { id: '', exact: '缺 id', body: '内容' },
      { id: 'n2', exact: 42, body: '内容' },
      { id: 'n3', exact: '缺正文' },
      { id: 'n4', exact: '缺时间', body: '' },
    ] })).toEqual({
      'a.md': [
        { id: 'n1', exact: '有效', body: '内容', prefix: '前', suffix: '后', createdAt: 1, updatedAt: 2 },
        { id: 'n4', exact: '缺时间', body: '', prefix: '', suffix: '', createdAt: 0, updatedAt: 0 },
      ],
    });
  });

  it('丢弃空路径与非法分组；无有效记录的分组不保留', () => {
    expect(sanitizeNotes({ '': [{ id: 'n', exact: 'x', body: 'y' }], 'a.md': 'oops' })).toEqual({});
  });
});

describe('add / update / remove / 读回', () => {
  it('新增裁掉首尾空白并持久化；同一文档按写入顺序读回', async () => {
    const first = await addNote('a.md', anchor('甲'), '  第一条  ', 1000);
    const second = await addNote('a.md', anchor('乙'), '第二条', 2000);
    expect(first).toMatchObject({ exact: '甲', prefix: '前文', suffix: '后文', body: '第一条', createdAt: 1000, updatedAt: 1000 });
    expect(second.body).toBe('第二条');
    expect((await getDocNotes('a.md')).map((r) => r.id)).toEqual([first.id, second.id]);
    expect((await getNotes())['a.md']).toHaveLength(2);
  });

  it('编辑正文刷新 updatedAt；记录不存在返回 null', async () => {
    const rec = await addNote('a.md', anchor('甲'), '旧内容', 1000);
    const updated = await updateNote('a.md', rec.id, '新内容', 1500);
    expect(updated).toMatchObject({ id: rec.id, body: '新内容', createdAt: 1000 });
    expect(updated!.updatedAt).toBeGreaterThan(1000);
    expect((await getDocNotes('a.md'))[0].body).toBe('新内容');
    expect(await updateNote('a.md', 'missing', 'x', 2000)).toBeNull();
  });

  it('正文未变化时不产生新的同步时间戳', async () => {
    const rec = await addNote('a.md', anchor('甲'), '内容', 1000);
    const same = await updateNote('a.md', rec.id, '内容', 2000);
    expect(same?.updatedAt).toBe(rec.updatedAt);
  });

  it('按 id 删除；其它文档不受影响', async () => {
    const rec = await addNote('a.md', anchor('甲'), '内容', 1000);
    await addNote('b.md', anchor('乙'), '另一篇', 2000);
    await removeNotes('a.md', [rec.id]);
    expect(await getDocNotes('a.md')).toEqual([]);
    expect((await getDocNotes('b.md')).map((r) => r.body)).toEqual(['另一篇']);
  });

  it('kv 脏数据读取时被清洗', async () => {
    await kvSet('notes', 'oops');
    expect(await getDocNotes('a.md')).toEqual([]);
  });
});

describe('笔记 outbox', () => {
  it('新增入队 upsert；编辑入队新时间戳；删除入队 tombstone', async () => {
    const rec = await addNote('a.md', anchor('甲'), '内容', 1000);
    const [added] = await outbox();
    expect(added).toMatchObject({
      collection: 'reading.notes', recordId: rec.id, deleted: false, updatedAt: 1000,
    });

    const updated = await updateNote('a.md', rec.id, '改后', 1500);
    const edit = (await outbox()).find((e) => e.recordId === rec.id)!;
    expect(edit).toMatchObject({ collection: 'reading.notes', deleted: false, updatedAt: updated!.updatedAt });
    expect(edit.updatedAt).toBeGreaterThan(1000);

    await removeNotes('a.md', [rec.id]);
    const removed = (await outbox()).find((e) => e.recordId === rec.id)!;
    expect(removed.deleted).toBe(true);
    expect(removed.updatedAt).toBeGreaterThan(edit.updatedAt);
  });
});
