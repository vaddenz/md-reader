import { describe, expect, it } from 'vitest';
import { buildLinksIndex, filterKnown, getRelated } from '../../src/data/links';

describe('links', () => {
  it('互链索引与反向查询', () => {
    const idx = buildLinksIndex([
      { path: 'a.md', text: '见 [x](b.md) 与 [y](子/c.md)' },
      { path: 'b.md', text: '回 [a](a.md)' },
    ]);
    expect(idx['a.md']).toEqual(['b.md', '子/c.md']);
    expect(getRelated('b.md', idx)).toEqual({ out: ['a.md'], in: ['a.md'] });
  });

  it('空索引 / 未知路径：双向均为空', () => {
    expect(getRelated('a.md', {})).toEqual({ out: [], in: [] });
    const idx = buildLinksIndex([{ path: 'a.md', text: '[去](b.md)' }]);
    expect(getRelated('ghost.md', idx)).toEqual({ out: [], in: [] });
  });

  it('自引用双向排除：显式链接自己不建索引，残留自引用也不出现在结果里', () => {
    // 正文写 [自己](a.md) → 索引不记录该目标
    expect(buildLinksIndex([{ path: 'a.md', text: '[自己](a.md)' }])).toEqual({});
    // 外部/损坏索引里残留自引用 → 查询时仍排除
    expect(getRelated('a.md', { 'a.md': ['a.md', 'b.md'], 'b.md': ['a.md'] }))
      .toEqual({ out: ['b.md'], in: ['b.md'] });
  });

  it('仅 inbound：无人引用时 out 为空、in 有值', () => {
    const idx = buildLinksIndex([{ path: 'a.md', text: '[去](b.md)' }]);
    expect(getRelated('b.md', idx)).toEqual({ out: [], in: ['a.md'] });
  });

  it('filterKnown：按已知路径过滤、去重、按序截断到 limit', () => {
    const known = new Set(['a.md', 'b.md', 'c.md']);
    expect(filterKnown(['a.md', 'ghost.md', 'b.md'], known, 8)).toEqual(['a.md', 'b.md']);
    expect(filterKnown(['a.md', 'a.md', 'b.md'], known, 8)).toEqual(['a.md', 'b.md']);
    expect(filterKnown(['a.md', 'b.md', 'c.md'], known, 2)).toEqual(['a.md', 'b.md']);
    expect(filterKnown(['ghost.md'], known, 8)).toEqual([]);
    expect(filterKnown([], known, 8)).toEqual([]);
  });
});
