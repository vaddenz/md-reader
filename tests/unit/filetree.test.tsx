// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { docHref } from '../../src/app/nav';
import FileTree from '../../src/components/FileTree';
import type { FileMeta } from '../../src/data/db';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const meta = (path: string, cached = true): FileMeta =>
  ({ path, sha: `sha-${path}`, size: 1, cached, title: '', lastUsedAt: 0 });

let cleanup: Array<() => void> = [];
beforeEach(() => { cleanup = []; });
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  document.body.innerHTML = '';
});

function mount(el: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  cleanup.push(() => {
    act(() => { root.unmount(); });
    container.remove();
  });
  return container;
}

const links = (c: HTMLElement) => [...c.querySelectorAll<HTMLAnchorElement>('.tree-item')];
const linkByPath = (c: HTMLElement, path: string) =>
  links(c).find((a) => a.getAttribute('href') === docHref(path))!;
const dirToggle = (c: HTMLElement, name: string) =>
  [...c.querySelectorAll<HTMLButtonElement>('.tree-dir-toggle')]
    .find((b) => b.textContent?.includes(name))!;

const METAS = [
  meta('zz.md'),
  meta('NodeJS/事件.md'),
  meta('NodeJS/内存.md', false),
  meta('智能体/Mem0.md'),
];

describe('FileTree', () => {
  it('文件夹组在上、文件组在下（默认展开），显示名去 .md，链接为 docHref，行带图标', () => {
    const c = mount(<FileTree metas={METAS} />);
    expect([...c.querySelectorAll('.tree-group-label')].map((li) => li.textContent))
      .toEqual(['文件夹', '文件']);
    expect(links(c).map((a) => a.getAttribute('href'))).toEqual([
      docHref('智能体/Mem0.md'),
      docHref('NodeJS/内存.md'),
      docHref('NodeJS/事件.md'),
      docHref('zz.md'),
    ]);
    expect([...c.querySelectorAll('.tree-name')].map((s) => s.textContent))
      .toEqual(['Mem0', '内存', '事件', 'zz']);
    expect([...c.querySelectorAll('.tree-dir-toggle')].map((b) => b.getAttribute('aria-expanded')))
      .toEqual(['true', 'true']);
    expect(c.querySelectorAll('.tree-folder-icon')).toHaveLength(2);
    expect(c.querySelectorAll('.tree-file-icon')).toHaveLength(4);
  });

  it('目录可折叠：点击隐藏/恢复其子项', () => {
    const c = mount(<FileTree metas={METAS} />);
    const toggle = dirToggle(c, 'NodeJS');
    act(() => { toggle.click(); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(linkByPath(c, 'NodeJS/内存.md')).toBeUndefined();
    expect(linkByPath(c, '智能体/Mem0.md')).toBeDefined();

    act(() => { toggle.click(); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(linkByPath(c, 'NodeJS/内存.md')).toBeDefined();
  });

  it('未缓存文档带「未缓存」标记，已缓存的不带', () => {
    const c = mount(<FileTree metas={METAS} />);
    expect(linkByPath(c, 'NodeJS/内存.md').querySelector('.tree-badge')?.textContent).toBe('未缓存');
    expect(linkByPath(c, 'NodeJS/事件.md').querySelector('.tree-badge')).toBeNull();
  });

  it('currentPath 高亮当前项并标记 aria-current', () => {
    const c = mount(<FileTree metas={METAS} currentPath="NodeJS/事件.md" />);
    const current = linkByPath(c, 'NodeJS/事件.md');
    expect(current.className).toContain('tree-current');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(linkByPath(c, 'zz.md').className).not.toContain('tree-current');
    expect(linkByPath(c, 'zz.md').getAttribute('aria-current')).toBeNull();
  });
});
