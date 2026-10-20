// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSyncConfig, loadSyncConfig, saveSyncConfig, syncConfigFingerprint,
} from '../../src/sync/config';
import {
  clearSyncState, cursorOf, loadSyncState, resetSyncCursors, saveSyncState, updateRepoState,
} from '../../src/sync/state';
import {
  createSyncBackend, isSyncConfigured, listSyncBackends, registerSyncBackend, shouldAutoSync,
} from '../../src/sync/registry';
import type { SyncBackendDefinition } from '../../src/sync/types';

const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

beforeEach(() => {
  vi.stubGlobal('localStorage', storage);
  store.clear();
  clearSyncState();
});

describe('sync config', () => {
  it('默认 autoSync=false；值 trim、只保留字符串', () => {
    expect(loadSyncConfig()).toMatchObject({ version: 1, enabled: false, autoSync: false, backend: 'neon' });
    saveSyncConfig({
      version: 1, enabled: true, autoSync: true, backend: 'neon',
      values: { endpoint: ' https://x/ ', token: ' t ', bad: 42 as unknown as string },
    });
    expect(loadSyncConfig()).toEqual({
      version: 1, enabled: true, autoSync: true, backend: 'neon',
      values: { endpoint: 'https://x', token: 't' },
    });
    expect(syncConfigFingerprint(loadSyncConfig())).toContain('neon');
    clearSyncConfig();
    expect(loadSyncConfig().enabled).toBe(false);
  });

  it('endpoint 去尾斜杠；enabled/autoSync 仅字面 true 生效', () => {
    const saved = saveSyncConfig({
      version: 1,
      enabled: 'yes' as unknown as boolean,
      autoSync: 1 as unknown as boolean,
      backend: 'neon',
      values: { endpoint: ' https://x/// ', token: ' t ' },
    });
    expect(saved).toEqual({
      version: 1, enabled: false, autoSync: false, backend: 'neon',
      values: { endpoint: 'https://x', token: 't' },
    });
    expect(loadSyncConfig()).toEqual(saved);
  });
});

describe('sync state', () => {
  it('cursor 与 lastSync 持久化；reset 只清 cursor', () => {
    updateRepoState('a/b@main', { cursor: 1234 });
    expect(cursorOf('a/b@main')).toBe(1234);
    resetSyncCursors();
    expect(cursorOf('a/b@main')).toBe(0);
    expect(loadSyncState().lastSyncAt).toBeNull();
    clearSyncState();
    expect(loadSyncState()).toMatchObject({ lastSyncAt: null, lastError: null, repos: {} });
  });

  it('setItem 失败后仍返回内存中的最新 cursor', () => {
    updateRepoState('a/b@main', { cursor: 1 });
    expect(cursorOf('a/b@main')).toBe(1);
    vi.stubGlobal('localStorage', {
      ...storage,
      setItem: () => { throw new Error('quota exceeded'); },
    } as Storage);
    updateRepoState('a/b@main', { cursor: 2 });
    expect(store.get('mdreader.syncState')).toContain('"cursor":1');
    expect(cursorOf('a/b@main')).toBe(2);
  });

  it('reset 保留全局 lastSyncAt/lastError，清每 scope cursor', () => {
    saveSyncState({
      version: 1,
      lastSyncAt: 111,
      lastError: { message: 'boom', at: 222 },
      repos: { 'a/b@main': { cursor: 9, lastSyncAt: 5 } },
    });
    resetSyncCursors();
    const state = loadSyncState();
    expect(state.lastSyncAt).toBe(111);
    expect(state.lastError).toEqual({ message: 'boom', at: 222 });
    expect(state.repos['a/b@main']).toEqual({ cursor: 0, lastSyncAt: null });
  });
});

describe('registry', () => {
  const fake: SyncBackendDefinition = {
    type: 'fake', label: 'Fake', description: 'test', fields: [{ key: 'token', label: 'Token', type: 'password', required: true }],
    validate: (v) => (v.token ? null : '缺少 token'),
    create: () => ({ test: async () => ({}), pull: async () => [], push: async () => {} }),
  };
  const cfg = { version: 1 as const, enabled: true, autoSync: false, backend: 'fake', values: { token: 't' } };

  it('注册、查找、创建、配置判断', () => {
    registerSyncBackend(fake);
    expect(listSyncBackends().some((d) => d.type === 'fake')).toBe(true);
    expect(isSyncConfigured(cfg)).toBe(true);
    expect(createSyncBackend(cfg)).toBeTruthy();
    expect(() => createSyncBackend({ ...cfg, values: {} })).toThrow('缺少 token');
    expect(shouldAutoSync(cfg, true)).toBe(false);
    expect(shouldAutoSync({ ...cfg, autoSync: true }, true)).toBe(true);
    expect(shouldAutoSync({ ...cfg, autoSync: true, enabled: false }, true)).toBe(false);
    expect(shouldAutoSync({ ...cfg, autoSync: true }, false)).toBe(false);
  });

  it('禁用或未知后端时视为未配置', () => {
    registerSyncBackend(fake);
    expect(isSyncConfigured({ ...cfg, enabled: false })).toBe(false);
    expect(isSyncConfigured({ ...cfg, backend: 'nope' })).toBe(false);
  });
});
