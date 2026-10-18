// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateMermaid } from '../../src/markdown/mermaid';

// 不真渲染 mermaid：默认路径用 mock 的 loader 验证接线，渲染行为全部注入。
const { renderMermaidMock } = vi.hoisted(() => ({
  renderMermaidMock: vi.fn(async (_code: string) => '<svg data-default="1"></svg>'),
}));
vi.mock('../../src/lib/mermaid-loader', () => ({ renderMermaid: renderMermaidMock }));

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  targets: Element[] = [];
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.targets.push(el); }
  unobserve(el: Element) { this.targets = this.targets.filter((t) => t !== el); }
  disconnect() { this.disconnected = true; this.targets = []; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  root = null;
  rootMargin = '';
  thresholds: number[] = [];
  trigger(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

/** 生成与渲染器约定一致的占位节点。 */
function container(...codes: string[]): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = codes
    .map((code) => `<div class="md-mermaid" data-code="${encodeURIComponent(code)}"></div>`)
    .join('');
  return el;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  renderMermaidMock.mockClear();
  FakeIntersectionObserver.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hydrateMermaid', () => {
  it('渲染成功替换为 svg；失败降级显示源码', async () => {
    const c = container('graph TD;A-->B', 'bad');
    const render = vi.fn(async (code: string) => {
      if (code === 'bad') throw new Error('parse error');
      return '<svg></svg>';
    });
    const cleanup = hydrateMermaid(c, { render });
    await vi.waitFor(() => {
      expect(c.querySelectorAll('svg').length).toBe(1);
      expect(c.querySelector('pre')).not.toBeNull();
    });
    expect(c.textContent).toContain('bad'); // 失败块显示源码
    expect(render).toHaveBeenCalledTimes(2);

    const [ok, bad] = [...c.querySelectorAll<HTMLElement>('.md-mermaid')];
    expect(ok.classList.contains('md-mermaid-done')).toBe(true);
    expect(bad.classList.contains('md-mermaid-done')).toBe(false);
    expect(bad.querySelector('pre')!.textContent).toBe('bad');
    expect(bad.querySelector('.md-mermaid-error')).not.toBeNull(); // 错误文案
    cleanup();
  });

  it('data-code 经 decodeURIComponent 还原后传给 render', async () => {
    const src = 'graph TD\n  A[中文] --> B{判断?}\n  A -->|是| C';
    const c = container(src);
    const render = vi.fn(async () => '<svg></svg>');
    const cleanup = hydrateMermaid(c, { render });
    await vi.waitFor(() => expect(render).toHaveBeenCalledWith(src));
    cleanup();
  });

  it('渲染队列并发不超过 2，且全部完成', async () => {
    const c = container('g0', 'g1', 'g2', 'g3', 'g4');
    let running = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const render = vi.fn((_code: string) => new Promise<string>((resolve) => {
      running++;
      peak = Math.max(peak, running);
      releases.push(() => { running--; resolve('<svg></svg>'); });
    }));
    const cleanup = hydrateMermaid(c, { render });

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);
    // 逐个放行：每放行一个，队列应恰好补入下一个
    for (let expected = 3; expected <= 5; expected++) {
      releases.shift()!();
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(expected));
    }
    while (releases.length) releases.shift()!();
    await vi.waitFor(() => expect(c.querySelectorAll('svg').length).toBe(5));
    expect(peak).toBe(2);
    expect(render.mock.calls.map(([code]) => code).sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
    cleanup();
  });

  it('有 IntersectionObserver 时仅渲染进入 400px 视口的占位，清理时断开', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const c = container('g0', 'g1', 'g2');
    const render = vi.fn(async () => '<svg></svg>');
    const cleanup = hydrateMermaid(c, { render });

    const io = FakeIntersectionObserver.instances[0];
    expect(io.options).toEqual({ rootMargin: '400px' });
    expect(io.targets).toHaveLength(3);
    const [n0, n1, n2] = [...c.querySelectorAll<HTMLElement>('.md-mermaid')];
    expect(render).not.toHaveBeenCalled();

    io.trigger([{ target: n2, isIntersecting: true }]);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(render).toHaveBeenCalledWith('g2');
    expect(io.targets).toEqual([n0, n1]); // 触发过的节点不再观察

    io.trigger([{ target: n1, isIntersecting: false }]); // 未进入视口：不渲染
    await flush();
    expect(render).toHaveBeenCalledTimes(1);

    cleanup();
    expect(io.disconnected).toBe(true);
    io.trigger([{ target: n0, isIntersecting: true }]); // 清理后的回调不再触发渲染
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(c.querySelectorAll('svg').length).toBe(1);
  });

  it('清理后忽略在途结果并停止处理剩余占位', async () => {
    const c = container('g0', 'g1', 'g2', 'g3', 'g4');
    const releases: Array<() => void> = [];
    const render = vi.fn((_code: string) => new Promise<string>((resolve) => {
      releases.push(() => resolve('<svg></svg>'));
    }));
    const cleanup = hydrateMermaid(c, { render });

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    cleanup();
    while (releases.length) releases.shift()!();
    await flush(); // 放行后给微任务链排空的机会
    expect(render).toHaveBeenCalledTimes(2); // 剩余 3 个不再渲染
    expect(c.querySelectorAll('svg').length).toBe(0); // 在途结果被忽略
    expect(c.querySelectorAll('.md-mermaid-done').length).toBe(0);
  });

  it('未注入 render 时默认使用 renderMermaid', async () => {
    const c = container('graph TD;A-->B');
    const cleanup = hydrateMermaid(c);
    await vi.waitFor(() => expect(renderMermaidMock).toHaveBeenCalledWith('graph TD;A-->B'));
    await vi.waitFor(() => expect(c.querySelectorAll('svg').length).toBe(1));
    cleanup();
  });
});
