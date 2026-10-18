import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, loadToken, saveToken } from '../../src/lib/token';

// node 环境下无 localStorage，用最小 mock 替代（不做浏览器行为模拟）
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
});

beforeEach(() => { localStorage.clear?.(); });

describe('token 存储', () => {
  it('保存/读取/清除', () => {
    expect(loadToken()).toBeNull();
    saveToken('ghp_x');
    expect(loadToken()).toBe('ghp_x');
    expect(store.get('mdreader.token')).toBe('ghp_x');
    clearToken();
    expect(loadToken()).toBeNull();
  });
});
