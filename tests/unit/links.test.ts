import { describe, expect, it } from 'vitest';
import { buildLinksIndex, getRelated } from '../../src/data/links';

describe('links', () => {
  it('互链索引与反向查询', () => {
    const idx = buildLinksIndex([
      { path: 'a.md', text: '见 [x](b.md) 与 [y](子/c.md)' },
      { path: 'b.md', text: '回 [a](a.md)' },
    ]);
    expect(idx['a.md']).toEqual(['b.md', '子/c.md']);
    expect(getRelated('b.md', idx)).toEqual({ out: ['a.md'], in: ['a.md'] });
  });
});
