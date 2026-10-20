import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, loadToken, maskToken, saveToken } from '../../src/lib/token';

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

describe('maskToken', () => {
  it('短 Token 全部遮蔽，中等 Token 只露末 4 位，长 Token 露前缀 + 末 4 位', () => {
    expect(maskToken('ghp_x')).toBe('••••');
    expect(maskToken('shorttok')).toBe('••••');
    expect(maskToken('ghp_1234567890')).toBe('••••7890');
    expect(maskToken('ghp_e2e_fake_token_1234')).toBe('ghp_e2e_fake…1234');
  });

  it('永不返回完整 Token', () => {
    const token = 'github_pat_abcdefghijklmnopqrstuvwxyz';
    expect(maskToken(token)).not.toBe(token);
    expect(maskToken(token)).toContain('…');
  });
});
