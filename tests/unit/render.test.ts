import { describe, expect, it } from 'vitest';
import { renderDoc } from '../../src/markdown/render';

const base = { path: 'a.md', knownPaths: new Set(['a.md', '子/b.md', '图片/x.png']) };

describe('renderDoc', () => {
  it('标题 id 用 github-slugger 且重复标题去重', () => {
    const { html, headings } = renderDoc('# 标题\n\n## 标题\n', base);
    expect(headings.map((h) => h.id)).toEqual(['标题', '标题-1']);
    expect(html).toContain('id="标题"');
    expect(html).toContain('id="标题-1"');
  });
  it('单换行变 <br>、高亮与删除线', () => {
    const { html } = renderDoc('l1\nl2\n\n==高亮== 和 ~~删除~~', base);
    expect(html).toContain('l1<br>');
    expect(html).toContain('<mark>高亮</mark>');
    expect(html).toContain('<s>删除</s>');
  });
  it('裸 URL 自动链接且外链新开窗口', () => {
    const { html } = renderDoc('见 https://example.com/x', base);
    expect(html).toMatch(/href="https:\/\/example.com\/x"[^>]*target="_blank"/);
  });
  it('互链改写为应用内路由；缺失目标标记 data-dead', () => {
    expect(renderDoc('去 [b](子/b.md#第三章)', base).html).toContain(
      'href="#/doc/' + encodeURIComponent('子/b.md') + '?to=' + encodeURIComponent('第三章') + '"');
    expect(renderDoc('去 [x](没有.md)', base).html).toContain('data-dead="文件不存在"');
  });
  it('图片相对路径进 data-repo-src，外链保留', () => {
    expect(renderDoc('![p](图片/x.png)', base).html).toContain('data-repo-src="图片/x.png"');
    expect(renderDoc('![p](https://o/x.png)', base).html).toContain('src="https://o/x.png"');
  });
  it('mermaid fence 转占位 div，普通代码块走高亮且带复制按钮', () => {
    expect(renderDoc('```mermaid\ngraph TD;A-->B\n```', base).html).toContain('class="md-mermaid"');
    const code = renderDoc('```python\nprint(1)\n```', base).html;
    expect(code).toContain('code-copy');
    expect(code).toContain('hljs');
  });
  it('锚点内链保持 #slug 原样', () => {
    expect(renderDoc('见 [top](#标题)', base).html).toContain('href="#标题"');
  });
  it('非 .md 的相对引用标记 data-dead=无法在应用内打开', () => {
    expect(renderDoc('看 [图](图片/x.png)', base).html).toContain('data-dead="无法在应用内打开"');
  });
  it('连续渲染互不串扰：先前返回的 headings 不被后续渲染污染', () => {
    const first = renderDoc('# 甲\n', base);
    renderDoc('# 乙\n\n## 甲\n', base);
    expect(first.headings).toEqual([{ id: '甲', text: '甲', level: 1 }]);
    expect(first.html).toContain('id="甲"');
  });
});
