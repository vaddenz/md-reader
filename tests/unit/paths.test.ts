import { describe, expect, it } from 'vitest';
import { normalizeRepoPath, resolveAssetPath, resolveMdLink } from '../../src/data/paths';

describe('paths', () => {
  it('相对链接解析', () => {
    expect(resolveMdLink('智能体/Mem0.md', '../NodeJS/事件与循环机制.md')).toEqual({ path: 'NodeJS/事件与循环机制.md' });
    expect(resolveMdLink('a.md', './b.md')).toEqual({ path: 'b.md' });
    expect(resolveMdLink('a.md', 'NodeJS/x.md#第三章')).toEqual({ path: 'NodeJS/x.md', anchor: '第三章' });
    expect(resolveMdLink('a.md', '#自己的锚点')).toEqual({ path: 'a.md', anchor: '自己的锚点' });
  });
  it('URL 编码与非法输入', () => {
    expect(resolveMdLink('a.md', encodeURI('子目录/中文 文件.md'))).toEqual({ path: '子目录/中文 文件.md' });
    expect(resolveMdLink('a.md', 'https://x.com/a.md')).toBeNull();
    expect(resolveMdLink('a.md', 'img.png')).toBeNull();
  });
  it('normalize 与资源路径', () => {
    expect(normalizeRepoPath('./a/../b/./c.md')).toBe('b/c.md');
    expect(resolveAssetPath('智能体/Mem0.md', '../assets/pic 1.png')).toBe('assets/pic 1.png');
    expect(resolveAssetPath('a.md', 'https://x/p.png')).toBeNull();
  });
});
