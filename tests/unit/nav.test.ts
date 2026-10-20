import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigateFunction } from 'react-router-dom';
import { docHref, goBackOrHome, searchHref, toRouterPath } from '../../src/app/nav';

describe('nav', () => {
  it('文档链接对路径与中文正确编码', () => {
    expect(docHref('智能体/Mem0.md')).toBe('#/doc/' + encodeURIComponent('智能体/Mem0.md'));
  });
  it('带锚点与搜索参数', () => {
    expect(docHref('a.md', { to: '第-1-章' })).toBe('#/doc/a.md?to=' + encodeURIComponent('第-1-章'));
    expect(docHref('a.md', { q: 'MVCC', i: 2 })).toBe('#/doc/a.md?q=MVCC&i=2');
  });
  it('搜索链接', () => {
    expect(searchHref('gVisor 沙箱')).toBe('#/search?q=' + encodeURIComponent('gVisor 沙箱'));
  });
  it('toRouterPath：应用内 href → react-router 路径', () => {
    expect(toRouterPath('#/')).toBe('/');
    expect(toRouterPath('#/doc/a.md')).toBe('/doc/a.md');
    expect(toRouterPath('#/setup?reauth=1')).toBe('/setup?reauth=1');
    expect(toRouterPath('/x')).toBe('/x');
  });
  describe('goBackOrHome：返回语义（回到来源；无应用内历史回首页）', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    it('有应用内历史（idx > 0）→ navigate(-1)', () => {
      vi.stubGlobal('window', { history: { state: { idx: 2 } } });
      const navigate = vi.fn();
      goBackOrHome(navigate as unknown as NavigateFunction);
      expect(navigate).toHaveBeenCalledWith(-1);
    });
    it('无应用内历史（idx 缺省/0）→ 回首页', () => {
      vi.stubGlobal('window', { history: { state: { idx: 0 } } });
      const navigate = vi.fn();
      goBackOrHome(navigate as unknown as NavigateFunction);
      expect(navigate).toHaveBeenCalledWith('/');
    });
  });
});
