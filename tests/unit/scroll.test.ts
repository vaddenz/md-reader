import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 最小可用的 sessionStorage 替身（Node 环境没有 Web Storage）。 */
function fakeSessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('scroll 历史滚动记忆', () => {
  it('rememberScroll 记录后 takeScroll 取走并消费（第二次为 undefined）', async () => {
    const { rememberScroll, takeScroll } = await import('../../src/app/scroll');
    rememberScroll('k1', 120);
    expect(takeScroll('k1')).toBe(120);
    expect(takeScroll('k1')).toBeUndefined();
  });

  it('未知 key 返回 undefined', async () => {
    const { takeScroll } = await import('../../src/app/scroll');
    expect(takeScroll('ghost')).toBeUndefined();
  });

  it('负数钳制为 0、小数取整', async () => {
    const { rememberScroll, takeScroll } = await import('../../src/app/scroll');
    rememberScroll('neg', -30);
    expect(takeScroll('neg')).toBe(0);
    rememberScroll('frac', 12.7);
    expect(takeScroll('frac')).toBe(13);
  });

  it('keyFromLocation 取 location.key', async () => {
    const { keyFromLocation } = await import('../../src/app/scroll');
    expect(keyFromLocation({ key: 'default' })).toBe('default');
    expect(keyFromLocation({ key: 'abc123' })).toBe('abc123');
  });

  it('sessionStorage 持久化：模块重载后仍能取到', async () => {
    vi.stubGlobal('sessionStorage', fakeSessionStorage());
    const first = await import('../../src/app/scroll');
    first.rememberScroll('k2', 456);

    vi.resetModules();
    const second = await import('../../src/app/scroll');
    expect(second.takeScroll('k2')).toBe(456);
  });

  it('持久化数据损坏时不抛出（丢弃后按无记录处理）', async () => {
    const broken = fakeSessionStorage();
    broken.setItem('mdreader.scroll', '{not json');
    vi.stubGlobal('sessionStorage', broken);
    const { takeScroll } = await import('../../src/app/scroll');
    expect(takeScroll('k')).toBeUndefined();
  });

  it('无 sessionStorage（Node 环境）时纯内存工作且不抛错', async () => {
    const { rememberScroll, takeScroll } = await import('../../src/app/scroll');
    rememberScroll('k3', 10);
    expect(takeScroll('k3')).toBe(10);
  });
});
