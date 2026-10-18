// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { highlightInContainer, termRanges } from '../../src/markdown/highlight';

function container(html: string): HTMLElement {
  const c = document.createElement('div');
  c.innerHTML = html;
  return c;
}

describe('highlightInContainer', () => {
  it('跨文本节点高亮且上限生效', () => {
    const c = document.createElement('div');
    c.innerHTML = '<p>MVCC 与 mvcc</p><pre><code>MVCC</code></pre><p>MVCC MVCC</p>';
    const hits = highlightInContainer(c, 'MVCC', { max: 2 });
    expect(hits.length).toBe(2);
    expect(c.querySelectorAll('mark.search-mark').length).toBe(2);
  });

  it('多词按空白切分、大小写不敏感，逐处命中', () => {
    const c = container('<p>MVCC 与锁：mvcc 与锁</p>');
    const hits = highlightInContainer(c, 'mvcc 锁');
    expect(hits.map((m) => m.textContent)).toEqual(['MVCC', '锁', 'mvcc', '锁']);
    expect(hits.every((m) => m.className === 'search-mark')).toBe(true);
  });

  it('跳过 script/style 与既有 mark，不重复高亮', () => {
    const c = container(
      '<p><mark>MVCC</mark> MVCC</p><script>var MVCC = 1;</script><style>/* MVCC */</style>',
    );
    const hits = highlightInContainer(c, 'MVCC');
    expect(hits).toHaveLength(1);
    expect(hits[0].textContent).toBe('MVCC');
    expect(c.querySelectorAll('mark.search-mark')).toHaveLength(1);
    expect(c.querySelector('p mark')?.className).toBe(''); // 既有 mark 原样保留
  });

  it('默认上限 200', () => {
    const c = container(`<p>${Array.from({ length: 250 }, () => 'MVCC').join(' ')}</p>`);
    const hits = highlightInContainer(c, 'MVCC');
    expect(hits).toHaveLength(200);
    expect(c.querySelectorAll('mark.search-mark')).toHaveLength(200);
  });

  it('返回元素按文档顺序；命中文本与原文一致', () => {
    const c = container('<p>MVCC</p><p>mvcc 结尾</p>');
    const hits = highlightInContainer(c, 'MVCC');
    expect(hits).toHaveLength(2);
    expect(hits[0].textContent).toBe('MVCC');
    expect(hits[1].textContent).toBe('mvcc');
    expect(
      hits[0].compareDocumentPosition(hits[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('空查询 / 纯空白 / max 0 → 无高亮', () => {
    const c = container('<p>MVCC</p>');
    expect(highlightInContainer(c, '')).toEqual([]);
    expect(highlightInContainer(c, '   ')).toEqual([]);
    expect(highlightInContainer(c, 'MVCC', { max: 0 })).toEqual([]);
    expect(c.querySelectorAll('mark.search-mark')).toHaveLength(0);
  });

  it('重叠词合并为一个 mark；正文文本内容不变', () => {
    const c = container('<p>a MVCC b</p>');
    const hits = highlightInContainer(c, 'mv mvcc');
    expect(hits).toHaveLength(1);
    expect(hits[0].textContent).toBe('MVCC');
    expect(c.textContent).toBe('a MVCC b');
  });

  it('非重叠计数与 searchDocs 口径一致（aaaa 搜 aa → 2 处）', () => {
    const c = container('<p>aaaa</p>');
    const hits = highlightInContainer(c, 'aa');
    expect(hits.map((m) => m.textContent)).toEqual(['aa', 'aa']);
    expect(c.textContent).toBe('aaaa');
  });

  it('同一文本节点多处命中：保留命中前后的文本节点', () => {
    const c = container('<p>前 MVCC 中 MVCC 后</p>');
    const hits = highlightInContainer(c, 'MVCC');
    expect(hits).toHaveLength(2);
    expect(c.querySelector('p')?.textContent).toBe('前 MVCC 中 MVCC 后');
  });
});

describe('termRanges', () => {
  it('多词命中区间合并、按位置排序', () => {
    expect(termRanges('MVCC 与锁', 'mvcc 锁')).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 7 },
    ]);
  });

  it('无命中 / 空查询 → []', () => {
    expect(termRanges('abc', 'xyz')).toEqual([]);
    expect(termRanges('abc', '  ')).toEqual([]);
  });
});
