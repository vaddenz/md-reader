import { describe, expect, it } from 'vitest';
import { buildTree, flattenTree } from '../../src/lib/tree';

describe('tree', () => {
  it('根文档与子目录分组，中文按本地排序（实测：Intl.Collator("zh") 汉字在拉丁字母之前、汉字按拼音）', () => {
    const t = buildTree(['zz.md', 'NodeJS/事件.md', 'NodeJS/内存.md', '智能体/Mem0.md']);
    expect(t.root.map((i) => i.path)).toEqual(['zz.md']);
    expect(t.dirs.map((d) => d.name)).toEqual(['智能体', 'NodeJS']);
    expect(flattenTree(t)).toEqual(['zz.md', '智能体/Mem0.md', 'NodeJS/内存.md', 'NodeJS/事件.md']);
  });

  it('显示名为文件名去 .md（嵌套路径取最后一段）', () => {
    const t = buildTree(['NodeJS/内存.md', 'd1/sub/y.md']);
    expect(t.dirs.find((d) => d.name === 'NodeJS')?.items[0].name).toBe('内存');
    expect(t.dirs.find((d) => d.name === 'd1')?.items[0]).toEqual({ path: 'd1/sub/y.md', name: 'y' });
  });

  it('目录内排序与 PrevNext.orderDocPaths 同口径：本层文件在前、子目录在后，子目录递归深度优先', () => {
    const t = buildTree(['d2/x.md', 'a.md', 'd1/sub/y.md', 'd1/b.md']);
    expect(t.dirs.map((d) => d.name)).toEqual(['d1', 'd2']);
    expect(flattenTree(t)).toEqual(['a.md', 'd1/b.md', 'd1/sub/y.md', 'd2/x.md']);
  });

  it('空列表', () => {
    expect(buildTree([])).toEqual({ root: [], dirs: [] });
    expect(flattenTree({ root: [], dirs: [] })).toEqual([]);
  });
});
