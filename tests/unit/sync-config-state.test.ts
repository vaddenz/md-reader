// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSyncConfig, loadSyncConfig, saveSyncConfig, syncConfigFingerprint,
} from '../../src/sync/config';
import {
  clearSyncState, cursorOf, loadSyncState, resetSyncCursors, updateRepoState,
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
});

describe('registry', () => {
  const fake: SyncBackendDefinition = {
    type: 'fake', label: 'Fake', description: 'test', fields: [{ key: 'token', label: 'Token', type: 'password', required: true }],
    validate: (v) => (v.token ? null : '缺少 token'),
    create: () => ({ test: async () => ({}), pull: async () => [], push: async () => {} }),
  };

  it('注册、查找、创建、配置判断', () => {
    registerSyncBackend(fake);
    expect(listSyncBackends().some((d) => d.type === 'fake')).toBe(true);
    const cfg = { version: 1 as const, enabled: true, autoSync: false, backend: 'fake', values: { token: 't' } };
    expect(isSyncConfigured(cfg)).toBe(true);
    expect(createSyncBackend(cfg)).toBeTruthy();
    expect(() => createSyncBackend({ ...cfg, values: {} })).toThrow('缺少 token');
    expect(shouldAutoSync(cfg, true)).toBe(false);
    expect(shouldAutoSync({ ...cfg, autoSync: true }, true)).toBe(true);
    expect(shouldAutoSync({ ...cfg, autoSync: true }, false)).toBe(false);
  });
});
