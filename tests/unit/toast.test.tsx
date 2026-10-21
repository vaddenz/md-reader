// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CACHE_REBUILT_EVENT, ToastHost, showToast } from '../../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: Array<() => void> = [];
beforeEach(() => { cleanup = []; });
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  document.body.innerHTML = '';
});

function mountHost(): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => { root.render(<ToastHost />); });
  cleanup.push(() => {
    act(() => { root.unmount(); });
    container.remove();
  });
  return container;
}

const toasts = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>('.toast')];

describe('toast', () => {
  it('容器为 aria-live=polite 的 role=status；showToast 渲染文案', () => {
    const c = mountHost();
    const host = c.querySelector('.toast-host')!;
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-live')).toBe('polite');

    act(() => { showToast('你好'); });
    expect(toasts(c).map((t) => t.textContent)).toEqual(['你好']);
    expect(toasts(c)[0].className).toContain('toast-info');
  });

  it('error 变体带 toast-error 类；多条叠放', () => {
    const c = mountHost();
    act(() => { showToast('a', { kind: 'error' }); showToast('b'); });
    expect(toasts(c).map((t) => t.textContent)).toEqual(['a', 'b']);
    expect(toasts(c)[0].className).toContain('toast-error');
    expect(toasts(c)[1].className).toContain('toast-info');
  });

  it('点按条目立即关闭', () => {
    const c = mountHost();
    act(() => { showToast('关我'); });
    act(() => { toasts(c)[0].click(); });
    expect(toasts(c)).toHaveLength(0);
  });

  it('操作按钮触发回调并关闭本条', () => {
    const c = mountHost();
    let called = 0;
    act(() => {
      showToast('已标记', { action: { label: '撤销', onAction: () => { called += 1; } } });
    });
    const action = c.querySelector<HTMLButtonElement>('.toast-action')!;
    expect(action.textContent).toBe('撤销');
    act(() => { action.click(); });
    expect(called).toBe(1);
    expect(toasts(c)).toHaveLength(0);
  });

  it('到时自动消失', async () => {
    const c = mountHost();
    act(() => { showToast('短暂', { durationMs: 30 }); });
    expect(toasts(c)).toHaveLength(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(toasts(c)).toHaveLength(0);
  });

  it('最多同时展示 3 条，超出先关最早的一条', () => {
    const c = mountHost();
    act(() => { showToast('1'); showToast('2'); showToast('3'); showToast('4'); });
    expect(toasts(c).map((t) => t.textContent)).toEqual(['2', '3', '4']);
  });

  it('缓存自愈事件 → 提示「本地缓存已重建」', () => {
    const c = mountHost();
    act(() => { window.dispatchEvent(new CustomEvent(CACHE_REBUILT_EVENT)); });
    expect(toasts(c).map((t) => t.textContent)).toEqual(['本地缓存已重建']);
  });

  it('未挂载容器时调用不抛错（静默丢弃）', () => {
    expect(() => showToast('无人接收')).not.toThrow();
  });
});
