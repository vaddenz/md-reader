// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import LlmConfigForm from '../../src/components/memory/LlmConfigForm';
import type { LlmConfig } from '../../src/data/memory';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CFG: LlmConfig = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };

let cleanup: Array<() => void> = [];
beforeEach(() => { cleanup = []; });
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  document.body.innerHTML = '';
});

function mount(cfg: LlmConfig | undefined, onChange = vi.fn()) {
  const container = document.createElement('div');
  document.body.append(container);
  const reactRoot = createRoot(container);
  act(() => { reactRoot.render(<LlmConfigForm cfg={cfg} onChange={onChange} />); });
  cleanup.push(() => {
    act(() => { reactRoot.unmount(); });
    container.remove();
  });
  return { root: container, onChange };
}

function changeValue(el: HTMLSelectElement | HTMLInputElement, value: string): void {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function save(root: HTMLElement): void {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === '保存');
  act(() => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('LlmConfigForm 思考强度', () => {
  it('默认不指定；选中后保存写入 reasoningEffort', () => {
    const { root, onChange } = mount(CFG);
    const select = root.querySelector('select')!;
    expect(select.value).toBe('');

    changeValue(select, 'max');
    save(root);
    expect(onChange).toHaveBeenCalledWith({ ...CFG, reasoningEffort: 'max' });
  });

  it('已有配置回显选中的档位', () => {
    const { root } = mount({ ...CFG, reasoningEffort: 'high' });
    expect(root.querySelector('select')!.value).toBe('high');
  });
});
