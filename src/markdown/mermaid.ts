import { runPool } from '../lib/pool';
import { renderMermaid } from '../lib/mermaid-loader';

export interface MermaidDeps {
  /** 渲染实现；默认动态加载真实 mermaid（测试注入假实现）。 */
  render?(code: string): Promise<string>;
}

/**
 * 为容器内每个 `div.md-mermaid[data-code]` 占位挂上懒渲染管线：
 * 进入视口 400px 内才入队（并发上限 2）→ 成功替换为 SVG 并加
 * `md-mermaid-done`；失败降级为 `<pre>` 源码 + 错误文案（不抛出）。
 * 返回清理函数：断开观察、停止处理剩余占位、忽略在途渲染结果。
 */
export function hydrateMermaid(container: HTMLElement, deps: MermaidDeps = {}): () => void {
  const render = deps.render ?? renderMermaid;
  const pending: HTMLElement[] = [];
  const started = new WeakSet<HTMLElement>();
  let disposed = false;
  let observer: IntersectionObserver | null = null;
  let draining = false;

  const fallback = (node: HTMLElement, code: string): void => {
    const pre = document.createElement('pre');
    pre.textContent = code;
    const note = document.createElement('p');
    note.className = 'md-mermaid-error';
    note.textContent = '图表渲染失败，已显示源码';
    node.replaceChildren(pre, note);
    node.classList.add('md-mermaid-failed');
  };

  const process = async (node: HTMLElement): Promise<void> => {
    if (disposed) return;
    const raw = node.getAttribute('data-code') ?? '';
    let code = raw;
    try {
      code = decodeURIComponent(raw);
    } catch {
      // 非法编码（仅可能来自人工改 DOM）：按原文处理
    }
    try {
      const svg = await render(code);
      if (disposed) return; // 在途渲染完成但已清理：不再改动 DOM
      node.innerHTML = svg;
      node.classList.add('md-mermaid-done');
    } catch {
      if (disposed) return;
      fallback(node, code);
    }
  };

  /** 把当前待处理占位交给 runPool（限 2）；处理期间新入队的留到下一轮。 */
  const pump = (): void => {
    if (draining || disposed) return;
    const batch = pending.splice(0);
    if (batch.length === 0) return;
    draining = true;
    void runPool(batch, 2, process)
      .catch(() => { /* process 不抛出；兜底防未处理拒绝 */ })
      .finally(() => {
        draining = false;
        pump();
      });
  };

  const enqueue = (node: HTMLElement): boolean => {
    if (disposed || started.has(node)) return false;
    started.add(node);
    pending.push(node);
    return true;
  };

  const nodes = [...container.querySelectorAll<HTMLElement>('.md-mermaid[data-code]')];

  if (typeof IntersectionObserver === 'undefined') {
    // jsdom 等无 IO 环境：立即处理全部占位
    for (const node of nodes) enqueue(node);
    pump();
  } else {
    observer = new IntersectionObserver(
      (entries) => {
        let added = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          if (enqueue(entry.target as HTMLElement)) added = true;
        }
        if (added) pump();
      },
      { rootMargin: '400px' },
    );
    for (const node of nodes) observer.observe(node);
  }

  return () => {
    disposed = true;
    observer?.disconnect();
    observer = null;
    pending.length = 0;
  };
}
