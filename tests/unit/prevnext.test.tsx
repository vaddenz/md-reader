// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import PrevNext, { orderDocPaths } from '../../src/components/PrevNext';
import type { FileMeta } from '../../src/data/db';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const meta = (path: string, title: string): FileMeta =>
  ({ path, sha: `sha-${path}`, size: 1, cached: true, title, lastUsedAt: 0 });

describe('orderDocPaths', () => {
  // Intl.Collator('zh') 的实际行为（Node 22 / Chromium 一致）：汉字按拼音排、先于拉丁字母。
  it('根文档在前；目录与目录内文件按 zh 排序；目录内深度优先', () => {
    expect(orderDocPaths(['智能体/Mem0.md', 'zz.md', 'NodeJS/内存.md', 'NodeJS/事件.md']))
      .toEqual(['zz.md', '智能体/Mem0.md', 'NodeJS/内存.md', 'NodeJS/事件.md']);
  });

  it('嵌套目录：本层文件先于子目录，子目录递归深度优先', () => {
    expect(orderDocPaths(['d2/x.md', 'a.md', 'd1/sub/y.md', 'd1/b.md']))
      .toEqual(['a.md', 'd1/b.md', 'd1/sub/y.md', 'd2/x.md']);
  });

  it('空列表与单文档', () => {
    expect(orderDocPaths([])).toEqual([]);
    expect(orderDocPaths(['only.md'])).toEqual(['only.md']);
  });
});

function renderNav(el: ReactElement): string {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => { root.render(<MemoryRouter>{el}</MemoryRouter>); });
  const html = container.innerHTML;
  act(() => { root.unmount(); });
  container.remove();
  return html;
}

describe('PrevNext', () => {
  const metas = [meta('a.md', '甲'), meta('b.md', '乙'), meta('c.md', '丙')];
  const html = (path: string, list = metas) => renderNav(<PrevNext path={path} metas={list} />);

  it('中间文档同时给出上一篇与下一篇（标题 + 路由）', () => {
    const out = html('b.md');
    expect(out).toContain('← 上一篇');
    expect(out).toContain('下一篇 →');
    expect(out).toContain('href="/doc/a.md"');
    expect(out).toContain('href="/doc/c.md"');
    expect(out).toContain('甲');
    expect(out).toContain('丙');
  });

  it('首篇无上一篇、末篇无下一篇', () => {
    expect(html('a.md')).not.toContain('← 上一篇');
    expect(html('c.md')).not.toContain('下一篇 →');
  });

  it('当前文档不在列表中（如未同步）时不渲染', () => {
    expect(html('nope.md')).toBe('');
  });
});
