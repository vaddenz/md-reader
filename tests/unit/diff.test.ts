import { describe, expect, it } from 'vitest';
import { diffTree } from '../../src/data/sync';

describe('diffTree', () => {
  const remote = [
    { path: 'a.md', sha: 's1', size: 1, type: 'blob' as const },
    { path: 'b.md', sha: 's2', size: 1, type: 'blob' as const },
  ];
  it('四态：新增/修改/删除/无变化', () => {
    const d = diffTree({ 'a.md': 's1', 'c.md': 'sX' }, remote);
    expect(d.added.map((e) => e.path)).toEqual(['b.md']);
    expect(d.updated).toEqual([]);
    expect(d.deleted).toEqual(['c.md']);
    const d2 = diffTree({ 'a.md': 'old', 'b.md': 's2' }, remote);
    expect(d2.updated.map((e) => e.path)).toEqual(['a.md']);
    expect(diffTree({ 'a.md': 's1', 'b.md': 's2' }, remote)).toEqual({ added: [], updated: [], deleted: [] });
  });
});
