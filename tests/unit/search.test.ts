import { describe, expect, it } from 'vitest';
import { searchDocs } from '../../src/data/search';

const docs = [
  { path: '事务.md', text: '# 事务\n\nMVCC 是核心。MVCC 与锁。' },
  { path: '索引.md', text: '# 索引\n\nB+ 树与 MVCC 版本。' },
  { path: '无关.md', text: '# 其他\n\n没有关键词。' },
];

describe('searchDocs', () => {
  it('中文精确子串 + 多词 AND', () => {
    expect(searchDocs(docs, 'MVCC').map((h) => h.path)).toEqual(['事务.md', '索引.md']);
    expect(searchDocs(docs, 'MVCC 锁').map((h) => h.path)).toEqual(['事务.md']);
    expect(searchDocs(docs, 'MVCC 不存在的词')).toEqual([]);
  });
  it('英文大小写不敏感；标题命中加权', () => {
    expect(searchDocs(docs, 'mvcc').length).toBe(2);
    expect(searchDocs(docs, '事务')[0].score).toBeGreaterThan(searchDocs([{ path: 'x.md', text: '事务' }], '事务')[0].score - 100);
  });
  it('片段带上下文且不越界', () => {
    const hit = searchDocs(docs, 'MVCC')[0];
    expect(hit.snippets[0].text).toContain('MVCC');
    expect(hit.count).toBe(2);
  });
});

describe('searchDocs 补充语义', () => {
  it('空查询 / 纯空白 → []', () => {
    expect(searchDocs(docs, '')).toEqual([]);
    expect(searchDocs(docs, '   \t\n')).toEqual([]);
    expect(searchDocs([], 'MVCC')).toEqual([]);
  });

  it('多词：命中数为各词次数之和，片段按正文顺序', () => {
    const pad = 'x'.repeat(60);
    const text = `A锁${pad}MVCC${pad}锁B${pad}MVCC`;
    const hit = searchDocs([{ path: 'a.md', text }], 'MVCC 锁')[0];
    expect(hit.count).toBe(4);
    expect(hit.snippets.map((s) => s.start)).toEqual([0, 22, 86]);
    expect(hit.snippets[1].text).toContain('MVCC');
  });

  it('片段 start 为原文偏移且 clamp 到文本边界', () => {
    const text = `MVCC${'x'.repeat(100)}MVCC`;
    const hit = searchDocs([{ path: 'a.md', text }], 'MVCC')[0];
    expect(hit.snippets.map((s) => s.start)).toEqual([0, 64]);
    expect(hit.snippets[0].text.startsWith('MVCC')).toBe(true);
    expect(hit.snippets[1].text.endsWith('MVCC')).toBe(true);
    expect(hit.snippets[1].text.length).toBe(44);
    for (const s of hit.snippets) expect(text.includes(s.text)).toBe(true);
  });

  it('片段最多 3 条（count 仍为全部命中）', () => {
    const pad = 'x'.repeat(50);
    const text = `MVCC${pad}MVCC${pad}MVCC${pad}MVCC`;
    const hit = searchDocs([{ path: 'a.md', text }], 'MVCC')[0];
    expect(hit.count).toBe(4);
    expect(hit.snippets.length).toBe(3);
    expect(hit.snippets.map((s) => s.start)).toEqual([0, 14, 68]);
  });

  it('同词大小写变体命中同一处时片段去重', () => {
    const text = `${'x'.repeat(10)}MVCC${'x'.repeat(50)}`;
    const hit = searchDocs([{ path: 'a.md', text }], 'MVCC mvcc')[0];
    expect(hit.count).toBe(2);
    expect(hit.snippets.length).toBe(1);
  });

  it('文档头部多个命中：同 start 不同 end 均保留', () => {
    const text = `MVCC${'y'.repeat(20)}MVCC${'z'.repeat(100)}`;
    const hit = searchDocs([{ path: 'a.md', text }], 'MVCC')[0];
    expect(hit.count).toBe(2);
    expect(hit.snippets.map((s) => [s.start, s.text.length])).toEqual([
      [0, 44],
      [0, 68],
    ]);
  });

  it('count 非重叠计数', () => {
    expect(searchDocs([{ path: 'a.md', text: 'aaaa' }], 'aa')[0].count).toBe(2);
  });

  it('limit 默认 50，可覆盖；0 与负数 → []', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ path: `d${i}.md`, text: `# D${i}\n\nkeyword` }));
    expect(searchDocs(many, 'keyword').length).toBe(50);
    expect(searchDocs(many, 'keyword', 3).length).toBe(3);
    expect(searchDocs(many, 'keyword', 0)).toEqual([]);
    expect(searchDocs(many, 'keyword', -1)).toEqual([]);
  });

  it('同分按路径稳定排序（Intl.Collator zh 口径）', () => {
    const same = [
      { path: 'b.md', text: '# t\n\nsame' },
      { path: 'c.md', text: '# t\n\nsame' },
      { path: 'a.md', text: '# t\n\nsame' },
    ];
    expect(searchDocs(same, 'same').map((h) => h.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('标题命中 +5、路径命中 +2', () => {
    const titleDoc = { path: 'b.md', text: '# MVCC\n\n正文。' };
    const plainDoc = { path: 'a.md', text: '# 其他\n\nMVCC。' };
    const byTitle = searchDocs([plainDoc, titleDoc], 'MVCC');
    expect(byTitle.map((h) => h.path)).toEqual(['b.md', 'a.md']);
    expect(byTitle[0].score).toBe(6);
    expect(byTitle[1].score).toBe(1);

    const pathDoc = { path: 'MVCC/事务.md', text: '# 事务\n\nMVCC。' };
    const plain2 = { path: 'x/事务.md', text: '# 事务\n\nMVCC。' };
    const byPath = searchDocs([plain2, pathDoc], 'MVCC');
    expect(byPath.map((h) => h.path)).toEqual(['MVCC/事务.md', 'x/事务.md']);
    expect(byPath[0].score).toBe(3);
    expect(byPath[1].score).toBe(1);
  });

  it('title 复用 extractTitle：缺省为文件名（去 .md）', () => {
    const hit = searchDocs([{ path: '子/无标题.md', text: '没有一级标题，但有 MVCC。' }], 'MVCC')[0];
    expect(hit.title).toBe('子/无标题');
  });

  it('AND 与词序无关；仅命中标题行也算正文命中', () => {
    expect(searchDocs(docs, '锁 MVCC').map((h) => h.path)).toEqual(['事务.md']);
    const heading = searchDocs([{ path: 'h.md', text: '# MVCC\n\n无正文。' }], 'MVCC')[0];
    expect(heading.count).toBe(1);
  });
});
