import type { Mermaid } from 'mermaid';

/**
 * mermaid 模块与 `initialize` 仅执行一次；`import()` 让 mermaid 成为独立
 * chunk（代码分割），首屏与未含图表的文档不为其付出加载成本。
 */
let mod: Promise<Mermaid> | null = null;
let seq = 0;

/** 把一段 mermaid 源码渲染为 SVG 字符串；mermaid 加载/渲染失败时 reject。 */
export function renderMermaid(code: string): Promise<string> {
  mod ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      fontFamily: 'inherit',
    });
    return m.default;
  });
  return mod.then((m) => m.render(`mmd-${++seq}`, code)).then((r) => r.svg);
}
