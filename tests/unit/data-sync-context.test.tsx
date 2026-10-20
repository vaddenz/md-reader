// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncNow: vi.fn(),
  loadSyncConfig: vi.fn(),
  isSyncConfigured: vi.fn(),
  shouldAutoSync: vi.fn(),
  loadSyncState: vi.fn(),
}));

vi.mock('../../src/sync/config', () => ({
  clearSyncConfig: vi.fn(),
  loadSyncConfig: mocks.loadSyncConfig,
  saveSyncConfig: (config: unknown) => config,
  syncConfigFingerprint: () => 'same',
}));
vi.mock('../../src/sync/state', () => ({
  clearSyncState: vi.fn(),
  loadSyncState: mocks.loadSyncState,
  resetSyncCursors: vi.fn(),
}));
vi.mock('../../src/sync/registry', () => ({
  createSyncBackend: vi.fn(),
  isSyncConfigured: mocks.isSyncConfigured,
  shouldAutoSync: mocks.shouldAutoSync,
}));
vi.mock('../../src/sync/engine', () => ({ syncNow: mocks.syncNow }));
vi.mock('../../src/data/repos', () => ({
  loadRepoState: () => ({ repos: [] }),
  repoDbName: (id: string) => id,
}));

import { DataSyncProvider, useDataSync } from '../../src/sync/DataSyncContext';

describe('DataSyncProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.loadSyncConfig.mockReturnValue({
      version: 1,
      enabled: true,
      autoSync: false,
      backend: 'neon',
      values: { endpoint: 'https://example.test', token: 'secret' },
    });
    mocks.loadSyncState.mockReturnValue({ lastError: null });
    mocks.isSyncConfigured.mockReturnValue(true);
    mocks.shouldAutoSync.mockReturnValue(false);
    mocks.syncNow.mockResolvedValue({
      startedAt: 1,
      finishedAt: 2,
      repos: [],
      pulled: 0,
      applied: 0,
      pushed: 0,
    });
  });

  it('allows manual sync when autoSync is off', async () => {
    let sync: ReturnType<typeof useDataSync> | undefined;
    function Probe() {
      sync = useDataSync();
      return null;
    }

    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(createElement(DataSyncProvider, null, createElement(Probe)));
    });

    await act(async () => {
      await sync?.syncNow();
    });

    expect(mocks.shouldAutoSync).toHaveBeenCalledWith(expect.objectContaining({ autoSync: false }), true);
    expect(mocks.syncNow).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
