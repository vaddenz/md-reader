// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import DocHeader from '../../src/components/DocHeader';
import TocDrawer from '../../src/components/TocDrawer';
import { useScrollSpy } from '../../src/hooks/useScrollSpy';
import type { Heading } from '../../src/markdown/render';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- rAF 手动队列：flush() 手动推进一帧，便于断言节流与计算结果 ----
let frames: FrameRequestCallback[] = [];
const origRaf = window.requestAnimationFrame;
const origCancel = window.cancelAnimationFrame;

beforeEach(() => {
  frames = [];
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  window.requestAnimationFrame = origRaf;
  window.cancelAnimationFrame = origCancel;
  document.body.innerHTML = '';
});

/** 手动执行当前排队的 rAF 回调（在 act 中，避免 React 状态更新告警）。 */
function flush(): void {
  act(() => {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(0);
  });
}

const rect = (top: number): DOMRect =>
  ({
    top, bottom: top + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** 在 body 中造一个带 id、可定制纵向位置的标题元素（模拟正文标题）。 */
function addHeading(id: string, top: number): HTMLElement {
  const el = document.createElement('h2');
  el.id = id;
  el.getBoundingClientRect = () => rect(top);
  document.body.append(el);
  return el;
}
function setTop(el: HTMLElement, top: number): void {
  el.getBoundingClientRect = () => rect(top);
}

// ---- 挂载助手：自动记录 root，afterEach 兜底卸载，避免监听器跨用例泄漏 ----
let cleanup: Array<() => void> = [];
beforeEach(() => { cleanup = []; });
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

function mount(el: ReactElement): { container: HTMLElement; root: ReturnType<typeof createRoot>; unmount: () => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  const unmount = () => {
    act(() => { root.unmount(); });
    container.remove();
  };
  cleanup.push(unmount);
  return { container, root, unmount };
}

function SpyHarness({ ids, offset }: { ids: string[]; offset?: number }) {
  const current = useScrollSpy(ids, offset);
  return <span data-spy>{current ?? 'null'}</span>;
}
const spyText = (container: HTMLElement): string | null =>
  container.querySelector('[data-spy]')?.textContent ?? null;

describe('useScrollSpy', () => {
  it('取判定线以上最后一个标题；滚动后更新', () => {
    addHeading('a', 200);
    addHeading('b', 60);
    const c = addHeading('c', -30);
    const { container } = mount(<SpyHarness ids={['a', 'b', 'c']} offset={72} />);
    flush();
    expect(spyText(container)).toBe('c');

    setTop(c, 300); // c 滚到判定线下方 → 回退到 b
    act(() => { window.dispatchEvent(new Event('scroll')); });
    flush();
    expect(spyText(container)).toBe('b');
  });

  it('跳过 ids 中不存在的元素', () => {
    addHeading('a', 100);
    addHeading('b', -5);
    const { container } = mount(<SpyHarness ids={['a', 'ghost', 'b']} offset={72} />);
    flush();
    expect(spyText(container)).toBe('b');
  });

  it('所有标题都在判定线下方时返回 null', () => {
    addHeading('a', 100);
    addHeading('b', 300);
    const { container } = mount(<SpyHarness ids={['a', 'b']} offset={72} />);
    flush();
    expect(spyText(container)).toBe('null');
  });

  it('ids 变化后按新列表重算', () => {
    addHeading('a', -10);
    addHeading('b', 300);
    const { container, root } = mount(<SpyHarness ids={['a', 'b']} offset={72} />);
    flush();
    expect(spyText(container)).toBe('a');

    act(() => { root.render(<SpyHarness ids={['b']} offset={72} />); });
    flush();
    expect(spyText(container)).toBe('null');
  });

  it('rAF 节流：连续多次 scroll 只排一帧', () => {
    addHeading('a', -10);
    const { container } = mount(<SpyHarness ids={['a']} offset={72} />);
    flush(); // 挂载时的初始一帧
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
    });
    expect(frames).toHaveLength(1);
    flush();
    expect(spyText(container)).toBe('a');
  });

  it('卸载时移除 scroll/resize 监听', () => {
    addHeading('a', -10);
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = mount(<SpyHarness ids={['a']} offset={72} />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});

const HEADINGS: Heading[] = [
  { id: 'h1', text: '第一章', level: 1 },
  { id: 'h2', text: '第一节', level: 2 },
  { id: 'h3', text: '小节', level: 3 },
  { id: 'h4', text: '细节', level: 4 },
];

describe('TocDrawer', () => {
  const scrollIntoView = vi.fn();
  const origScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = origScrollIntoView;
  });

  const itemByText = (container: HTMLElement, text: string): HTMLButtonElement =>
    [...container.querySelectorAll<HTMLButtonElement>('.toc-item')].find((b) => b.textContent === text)!;

  it('渲染 dialog 与全部标题按钮，带层级类名', () => {
    const { container } = mount(<TocDrawer headings={HEADINGS} onClose={() => {}} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe('目录');
    expect(container.querySelectorAll('.toc-item')).toHaveLength(4);
    expect(container.querySelector('.toc-h1')?.textContent).toBe('第一章');
    expect(container.querySelector('.toc-h4')?.textContent).toBe('细节');
  });

  it('点击标题：平滑滚动到对应元素并关闭', () => {
    const onClose = vi.fn();
    addHeading('h2', 500);
    const { container } = mount(<TocDrawer headings={HEADINGS} onClose={onClose} />);
    act(() => { itemByText(container, '第一节').click(); });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击背景关闭；点击抽屉内部不关闭', () => {
    const onClose = vi.fn();
    const { container } = mount(<TocDrawer headings={HEADINGS} onClose={onClose} />);
    act(() => { container.querySelector<HTMLElement>('.drawer-panel')!.click(); });
    expect(onClose).not.toHaveBeenCalled();

    act(() => { container.querySelector<HTMLElement>('.drawer-overlay')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('关闭按钮与 Esc 均可关闭', () => {
    const onClose = vi.fn();
    const { container } = mount(<TocDrawer headings={HEADINGS} onClose={onClose} />);
    act(() => { container.querySelector<HTMLButtonElement>('.drawer-close')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('当前阅读位置高亮（scroll-spy），随滚动更新', () => {
    addHeading('h1', 300);
    addHeading('h2', 40);
    addHeading('h3', -200);
    const h4 = addHeading('h4', -400);
    const { container } = mount(<TocDrawer headings={HEADINGS} onClose={() => {}} />);
    flush();
    expect(container.querySelector('.toc-current')?.textContent).toBe('细节');

    setTop(h4, 500);
    act(() => { window.dispatchEvent(new Event('scroll')); });
    flush();
    expect(container.querySelector('.toc-current')?.textContent).toBe('小节');
  });
});

describe('DocHeader 顶栏入口', () => {
  const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

  it('提供 onOpenToc 时渲染「目录」按钮并回调；否则不渲染', () => {
    const onOpenToc = vi.fn();
    const withBtn = mount(
      <MemoryRouter future={future}>
        <DocHeader title="标题" onOpenToc={onOpenToc} />
      </MemoryRouter>,
    );
    const btn = withBtn.container.querySelector<HTMLButtonElement>('button[aria-label="目录"]');
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(onOpenToc).toHaveBeenCalledTimes(1);

    const without = mount(
      <MemoryRouter future={future}>
        <DocHeader title="标题" />
      </MemoryRouter>,
    );
    expect(without.container.querySelector('button[aria-label="目录"]')).toBeNull();
  });

  it('提供 onOpenTree 时渲染「文件」按钮并回调；否则不渲染', () => {
    const onOpenTree = vi.fn();
    const withBtn = mount(
      <MemoryRouter future={future}>
        <DocHeader title="标题" onOpenTree={onOpenTree} />
      </MemoryRouter>,
    );
    const btn = withBtn.container.querySelector<HTMLButtonElement>('button[aria-label="文件"]');
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(onOpenTree).toHaveBeenCalledTimes(1);

    const without = mount(
      <MemoryRouter future={future}>
        <DocHeader title="标题" />
      </MemoryRouter>,
    );
    expect(without.container.querySelector('button[aria-label="文件"]')).toBeNull();
  });
});
