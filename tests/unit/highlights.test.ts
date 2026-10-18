import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, kvSet } from '../../src/data/db';
import {
  addHighlight, exportHighlights, getDocHighlights, importHighlights, removeHighlights,
  sanitizeHighlights, type HighlightRecord,
} from '../../src/data/highlights';

const rec = (id: string, exact: string, color = 'yellow'): HighlightRecord => ({
  id, exact, prefix: '前文', suffix: '后文',
  decorations: [{ kind: 'bg', color }], createdAt: 1000,
});

beforeEach(async () => { await clearAllData(); });

describe('sanitizeHighlights', () => {
  it('非对象返回空；丢弃非法记录、保留未知颜色 decoration', () => {
    expect(sanitizeHighlights(null)).toEqual({});
    expect(sanitizeHighlights({ 'a.md': [
      rec('h1', '有效'),
      { id: '', exact: '缺 id' },
      { id: 'h2', exact: 42 },
      { id: 'h3', exact: '未知色', decorations: [{ kind: 'bg', color: 'green' }] },
    ] })).toEqual({
      'a.md': [
        rec('h1', '有效'),
        { id: 'h3', exact: '未知色', prefix: '', suffix: '', decorations: [{ kind: 'bg', color: 'green' }], createdAt: 0 },
      ],
    });
  });
  it('未知 kind 的 decoration 原样保留（向前兼容）；仅非法项丢弃', () => {
    expect(sanitizeHighlights({ 'a.md': [
      { id: 'h4', exact: '未知 kind', decorations: [{ kind: 'underline', style: 'wavy', color: 'red' }] },
      { id: 'h5', exact: '非法项', decorations: [null, 42, 'bg', { color: 'red' }] },
    ] })).toEqual({
      'a.md': [
        { id: 'h4', exact: '未知 kind', prefix: '', suffix: '', decorations: [{ kind: 'underline', style: 'wavy', color: 'red' }], createdAt: 0 },
        { id: 'h5', exact: '非法项', prefix: '', suffix: '', decorations: [], createdAt: 0 },
      ],
    });
  });
});

describe('add / remove / 读回', () => {
  it('追加与按 id 移除，均经串行化 RMW', async () => {
    await addHighlight('a.md', rec('h1', '甲'));
    await addHighlight('a.md', rec('h2', '乙', 'red'));
    expect((await getDocHighlights('a.md')).map((r) => r.id)).toEqual(['h1', 'h2']);
    await removeHighlights('a.md', ['h1']);
    expect((await getDocHighlights('a.md')).map((r) => r.id)).toEqual(['h2']);
  });
  it('kv 脏数据读取时被清洗', async () => {
    await kvSet('highlights', 'oops');
    expect(await getDocHighlights('a.md')).toEqual([]);
  });
});

describe('export / import', () => {
  it('导出带 formatVersion；导入合并去重（path+exact+decorations）', async () => {
    await addHighlight('a.md', rec('h1', '甲'));
    const json = await exportHighlights();
    expect(JSON.parse(json)).toMatchObject({ formatVersion: 1 });
    // 再导入同一份：全部跳过
    expect(await importHighlights(json)).toEqual({ imported: 0, skipped: 1 });
    // 清空后导入：恢复 1 条
    await clearAllData();
    expect(await importHighlights(json)).toEqual({ imported: 1, skipped: 0 });
    expect((await getDocHighlights('a.md')).map((r) => r.exact)).toEqual(['甲']);
  });
  it('版本不符抛错', async () => {
    await expect(importHighlights(JSON.stringify({ formatVersion: 99 }))).rejects.toThrow('不支持的格式版本');
  });
});
