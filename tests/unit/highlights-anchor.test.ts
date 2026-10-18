// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyHighlights, buildHaystack, contentRange, locateAnchor, markClassFor, rangeIntersectsExcluded,
  removeMarks, selectionToAnchor, visibleText, wrapRange,
} from '../../src/markdown/highlights';
import type { HighlightRecord } from '../../src/data/highlights';

const CONTEXT = 32;

function rec(id: string, exact: string, prefix = '', suffix = '', color = 'yellow'): HighlightRecord {
  return { id, exact, prefix, suffix, decorations: [{ kind: 'bg', color }], createdAt: 1 };
}

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'doc-content';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('buildHaystack', () => {
  it('跳过代码/按钮/脚本，块边界插入换行', () => {
    const el = mount('<p>甲</p><pre><code>乙</code><button class="code-copy">复制</button></pre><p>丙</p>');
    const h = buildHaystack(el);
    expect(h.text).toBe('甲\n丙');
  });
  it('行内元素间不插分隔符', () => {
    const el = mount('<p>前<strong>中</strong>后</p>');
    expect(buildHaystack(el).text).toBe('前中后');
  });
});

describe('locateAnchor', () => {
  it('精确匹配返回区间', () => {
    const el = mount('<p>实验证明，MVCC 可以避免读写冲突，提升并发性能。</p>');
    const h = buildHaystack(el);
    const got = locateAnchor(h, { exact: 'MVCC 可以避免读写冲突', prefix: '实验证明，', suffix: '，提升并发性能' });
    expect(got).not.toBeNull();
    expect(h.text.slice(got!.start, got!.end)).toBe('MVCC 可以避免读写冲突');
  });
  it('多处候选用上下文消歧', () => {
    const el = mount('<p>甲处有性能优化方案。</p><p>乙处有性能优化思路。</p>');
    const h = buildHaystack(el);
    const got = locateAnchor(h, { exact: '性能优化', prefix: '乙处有', suffix: '思路' });
    expect(h.text.slice(got!.start, got!.end)).toBe('性能优化');
    expect(h.text.slice(0, got!.start).endsWith('乙处有')).toBe(true);
  });
  it('空白差异（换行/缩进）归一化匹配', () => {
    const el = mount('<p>第一段。</p><p>第二段</p>');
    const h = buildHaystack(el);
    // 存储时 exact 跨块（含空格），实际 haystack 是 '\n'
    const got = locateAnchor(h, { exact: '第一段。 第二段', prefix: '', suffix: '' });
    expect(got).not.toBeNull();
  });
  it('找不到返回 null（孤儿）', () => {
    const el = mount('<p>完全不同。</p>');
    expect(locateAnchor(buildHaystack(el), { exact: '找不到的句子', prefix: '', suffix: '' })).toBeNull();
  });
});

describe('wrapRange / removeMarks', () => {
  it('包裹单个文本节点，文本不变、带类与 data 属性', () => {
    const el = mount('<p>实验证明，MVCC 可以避免读写冲突。</p>');
    const h = buildHaystack(el);
    const got = locateAnchor(h, { exact: 'MVCC', prefix: '', suffix: '' })!;
    const marks = wrapRange(el, h, got.start, got.end, 'hl hl-yellow', 'h1');
    expect(marks).toHaveLength(1);
    expect(el.querySelector('mark.hl-yellow')?.getAttribute('data-hl-id')).toBe('h1');
    expect(el.textContent).toBe('实验证明，MVCC 可以避免读写冲突。');
    removeMarks(el, ['h1']);
    expect(el.querySelector('mark')).toBeNull();
  });
  it('跨行内元素包裹为多个 mark，文本保持', () => {
    const el = mount('<p>前<strong>中</strong>后</p>');
    const h = buildHaystack(el);
    const got = locateAnchor(h, { exact: '前中后', prefix: '', suffix: '' })!;
    const marks = wrapRange(el, h, got.start, got.end, 'hl hl-red', 'h2');
    expect(marks.length).toBe(3);
    expect(el.textContent).toBe('前中后');
  });
});

describe('applyHighlights', () => {
  it('逐条重锚；冲突时先到先得（后者跳过但保留记录）', () => {
    const el = mount('<p>甲甲甲甲乙乙乙。</p>');
    const applied = applyHighlights(el, [rec('h1', '甲甲'), rec('h2', '甲甲甲乙')]);
    expect(applied.size).toBe(1);
    expect(applied.has('h1')).toBe(true);
    expect(el.querySelectorAll('mark').length).toBe(1);
  });
  it('孤儿记录不渲染、不报错', () => {
    const el = mount('<p>只有这些。</p>');
    const applied = applyHighlights(el, [rec('h1', '不存在')]);
    expect(applied.size).toBe(0);
  });
  it('未知颜色不渲染（markClassFor 返回 null）', () => {
    expect(markClassFor(rec('h1', 'x', '', '', 'green'))).toBeNull();
    expect(markClassFor(rec('h2', 'x'))).toBe('hl hl-yellow');
  });
});

describe('selectionToAnchor / rangeIntersectsExcluded', () => {
  it('选区 → 锚点信息（跨行内元素）', () => {
    const el = mount('<p>前<strong>中</strong>后</p>');
    const text = el.querySelector('strong')!.firstChild!;
    const range = document.createRange();
    range.setStart(el.querySelector('p')!.firstChild!, 1); // “中”前
    range.setEnd(text, 1);
    const got = selectionToAnchor(el, range);
    expect(got?.anchor.exact).toBe('中');
  });
  it('与代码块相交判定', () => {
    const el = mount('<p>正文</p><pre><code>代码</code></pre>');
    const codeText = el.querySelector('code')!.firstChild!;
    const r1 = document.createRange(); r1.selectNodeContents(codeText);
    expect(rangeIntersectsExcluded(el, r1)).toBe(true);
    const r2 = document.createRange(); r2.selectNodeContents(el.querySelector('p')!.firstChild!);
    expect(rangeIntersectsExcluded(el, r2)).toBe(false);
  });
});

describe('contentRange / visibleText', () => {
  it('范围从首个到末个非排除区文本节点：首尾排除区不在选区内', () => {
    const el = mount('<button class="code-copy">复制</button><p>正文</p><p>结尾</p><pre><code>代码</code></pre>');
    expect(contentRange(el)?.toString()).toBe('正文结尾');
  });
  // DOM Range 是连续区间，无法「挖掉」中间的排除区（浏览器同此语义）：
  // 中间排除区仍会被 toString() 包含，故复制路径改用 visibleText 过滤（见下）。
  it('中间排除区仍被 Range 语义包含（复制路径依赖 visibleText）', () => {
    const el = mount('<p>正文</p><pre><code>代码</code><button class="code-copy">复制</button></pre><p>结尾</p>');
    expect(contentRange(el)?.toString()).toBe('正文代码复制结尾');
  });
  it('无可用文本返回 null', () => {
    const el = mount('<pre><code>只有代码</code></pre>');
    expect(contentRange(el)).toBeNull();
  });
  it('visibleText 跳过排除区（代码块与复制按钮），块间换行分隔', () => {
    const el = mount('<p>正文</p><pre><code>代码</code><button class="code-copy">复制</button></pre><p>结尾</p>');
    expect(visibleText(el)).toBe('正文\n结尾');
  });
});

// 以下为 T8 实现自审补充的回归用例（不在任务 brief 清单内）：
// surroundContents 会把文本节点在区间起点处截断，同一文本节点内的多处高亮必须都能渲染。
describe('applyHighlights 回归：同一文本节点内多处高亮', () => {
  it('同节点两处不相邻高亮都渲染、文本保持', () => {
    const el = mount('<p>abc def ghi</p>');
    const applied = applyHighlights(el, [rec('h1', 'abc'), rec('h2', 'ghi')]);
    expect([...applied.keys()]).toEqual(['h1', 'h2']);
    expect(el.querySelectorAll('mark').length).toBe(2);
    expect(el.textContent).toBe('abc def ghi');
  });
  it('同节点两处相接高亮都渲染、文本保持', () => {
    const el = mount('<p>abc def ghi</p>');
    const applied = applyHighlights(el, [rec('h1', 'abc '), rec('h2', 'def')]);
    expect(applied.size).toBe(2);
    expect(el.querySelectorAll('mark').length).toBe(2);
    expect(el.textContent).toBe('abc def ghi');
  });
});
