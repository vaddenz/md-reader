// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncNow: vi.fn(),
  resetRepoSeeds: vi.fn(),
  loadSyncConfig: vi.fn(),
  saveSyncConfig: vi.fn(),
  clearSyncConfig: vi.fn(),
  syncConfigFingerprint: vi.fn(),
  isSyncConfigured: vi.fn(),
  shouldAutoSync: vi.fn(),
  loadSyncState: vi.fn(),
  clearSyncState: vi.fn(),
  resetSyncCursors: vi.fn(),
  loadRepoState: vi.fn(),
}));

vi.mock('../../src/sync/config', () => ({
  clearSyncConfig: mocks.clearSyncConfig,
  loadSyncConfig: mocks.loadSyncConfig,
  sanitizeSyncConfig: (value: SyncConfig) => ({
    ...value,
    values: Object.fromEntries(Object.entries(value.values).map(([key, field]) => [key, field.trim()])),
  }),
  saveSyncConfig: mocks.saveSyncConfig,
  syncConfigFingerprint: mocks.syncConfigFingerprint,
}));
vi.mock('../../src/sync/state', () => ({
  clearSyncState: mocks.clearSyncState,
  loadSyncState: mocks.loadSyncState,
  resetSyncCursors: mocks.resetSyncCursors,
}));
vi.mock('../../src/sync/registry', () => ({
  createSyncBackend: vi.fn(() => ({ test: vi.fn().mockResolvedValue({}) })),
  isSyncConfigured: mocks.isSyncConfigured,
  shouldAutoSync: mocks.shouldAutoSync,
}));
vi.mock('../../src/sync/engine', () => ({ syncNow: mocks.syncNow, resetRepoSeeds: mocks.resetRepoSeeds }));
vi.mock('../../src/data/repos', () => ({
  loadRepoState: mocks.loadRepoState,
  repoDbName: (id: string) => id,
}));

import { DataSyncProvider, useDataSync } from '../../src/sync/DataSyncContext';
import type { SyncConfig } from '../../src/sync/types';

const config = (autoSync = false): SyncConfig => ({
  version: 1,
  enabled: true,
  autoSync,
  backend: 'neon',
  values: { endpoint: 'https://example.test', token: 'secret' },
});

let root: Root | null = null;
let currentContext: ReturnType<typeof useDataSync> | undefined;

async function mountProvider(): Promise<void> {
  root = createRoot(document.createElement('div'));
  function Probe() {
    currentContext = useDataSync();
    return null;
  }
  await act(async () => {
    root!.render(createElement(DataSyncProvider, null, createElement(Probe)));
  });
}

async function unmountProvider(): Promise<void> {
  if (!root) return;
  const mountedRoot = root;
  root = null;
  currentContext = undefined;
  await act(async () => mountedRoot.unmount());
}

function context(): ReturnType<typeof useDataSync> {
  if (!currentContext) throw new Error('DataSyncProvider has not mounted');
  return currentContext;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function dirty(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('mdreader:sync-dirty'));
  });
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setVisibility('visible');
  setOnline(true);
  vi.clearAllMocks();
  mocks.loadSyncConfig.mockReturnValue(config());
  mocks.saveSyncConfig.mockImplementation((saved: SyncConfig) => saved);
  mocks.syncConfigFingerprint.mockImplementation((value: SyncConfig) => [
    value.backend,
    value.values.endpoint ?? '',
    value.values.token ?? '',
  ].join('\n'));
  mocks.loadSyncState.mockReturnValue({ lastError: null });
  mocks.resetRepoSeeds.mockResolvedValue(undefined);
  mocks.isSyncConfigured.mockReturnValue(true);
  mocks.shouldAutoSync.mockImplementation((value: SyncConfig, online: boolean) => (
    online && value.enabled && value.autoSync && mocks.isSyncConfigured(value)
  ));
  mocks.loadRepoState.mockReturnValue({ repos: [] });
  mocks.syncNow.mockResolvedValue({
    startedAt: 1,
    finishedAt: 2,
    repos: [],
    pulled: 0,
    applied: 0,
    pushed: 0,
  });
});

afterEach(async () => {
  try {
    await unmountProvider();
  } finally {
    root = null;
    currentContext = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setVisibility('visible');
    setOnline(true);
  }
});

describe('DataSyncProvider', () => {
  it('allows manual sync when autoSync is off', async () => {
    await mountProvider();
    await act(async () => { await context().syncNow(); });

    expect(mocks.shouldAutoSync).toHaveBeenCalledWith(expect.objectContaining({ autoSync: false }), true);
    expect(mocks.syncNow).toHaveBeenCalledOnce();
  });

  it('trailing-syncs dirty events after 10 seconds and refreshes pending count after 1 second in auto mode', async () => {
    mocks.loadSyncConfig.mockReturnValue(config(true));
    await mountProvider();
    await advance(3000); // finish startup sync, isolating the dirty-triggered sync
    mocks.syncNow.mockClear();
    mocks.loadRepoState.mockClear();

    await dirty();
    await advance(999);
    expect(mocks.loadRepoState).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.loadRepoState).toHaveBeenCalledOnce();
    await advance(8999);
    expect(mocks.syncNow).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.syncNow).toHaveBeenCalledOnce();
  });

  it('caps continuously dirty auto sync at 60 seconds from the first event', async () => {
    mocks.loadSyncConfig.mockReturnValue(config(true));
    await mountProvider();
    await advance(3000);
    mocks.syncNow.mockClear();

    await dirty();
    for (let i = 0; i < 6; i += 1) {
      await advance(9000);
      await dirty();
    }
    await advance(5999);
    expect(mocks.syncNow).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.syncNow).toHaveBeenCalledOnce();
  });

  it('does not schedule a visible-refocus sync within five minutes, then does afterward', async () => {
    mocks.loadSyncConfig.mockReturnValue(config(true));
    mocks.syncNow.mockImplementation(async () => ({
      startedAt: Date.now(), finishedAt: Date.now(), repos: [], pulled: 0, applied: 0, pushed: 0,
    }));
    mocks.loadSyncState.mockReturnValue({ lastSyncAt: Date.now(), lastError: null });
    await mountProvider();
    await advance(3000); // startup sync updates the throttle timestamp
    expect(mocks.syncNow).toHaveBeenCalledOnce();

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(3000);
    expect(mocks.syncNow).toHaveBeenCalledOnce();

    await advance(5 * 60_000 + 1);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await advance(2999);
    expect(mocks.syncNow).toHaveBeenCalledOnce();
    await advance(1);
    expect(mocks.syncNow).toHaveBeenCalledTimes(2);
  });

  it('runs one follow-up sync when dirty data arrives during an active sync', async () => {
    mocks.loadSyncConfig.mockReturnValue(config(true));
    let resolveFirst!: (value: Awaited<ReturnType<typeof mocks.syncNow>>) => void;
    const deferred = new Promise<Awaited<ReturnType<typeof mocks.syncNow>>>((resolve) => { resolveFirst = resolve; });
    mocks.syncNow.mockReturnValueOnce(deferred);
    await mountProvider();
    await advance(3000);
    expect(mocks.syncNow).toHaveBeenCalledOnce();

    await dirty();
    await act(async () => {
      resolveFirst({ startedAt: 1, finishedAt: 2, repos: [], pulled: 0, applied: 0, pushed: 0 });
      await Promise.resolve();
    });
    await advance(0);
    expect(mocks.syncNow).toHaveBeenCalledTimes(2);
  });

  it('refreshes pending count after 1 second but does not sync on dirty when autoSync is off', async () => {
    await mountProvider();
    await dirty();
    await advance(999);
    expect(mocks.loadRepoState).not.toHaveBeenCalled();
    expect(mocks.syncNow).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.loadRepoState).toHaveBeenCalledOnce();
    expect(mocks.syncNow).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'startup', fire: async () => advance(3000) },
    {
      label: 'online',
      fire: async () => {
        setOnline(false);
        await mountProvider();
        await act(async () => { window.dispatchEvent(new Event('offline')); });
        setOnline(true);
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await advance(0);
      },
    },
    {
      label: 'visibility',
      fire: async () => {
        setVisibility('hidden');
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      },
    },
  ])('$label auto trigger is gated by autoSync', async ({ label, fire }) => {
    if (label !== 'online') await mountProvider();
    await fire();
    expect(mocks.syncNow).not.toHaveBeenCalled();

    // Remount with auto-sync enabled and perform the same trigger.
    await unmountProvider();
    setVisibility('visible');
    setOnline(label === 'online' ? false : true);
    mocks.loadSyncConfig.mockReturnValue(config(true));
    if (label === 'online') {
      await mountProvider();
      await act(async () => { window.dispatchEvent(new Event('offline')); });
      setOnline(true);
      await act(async () => { window.dispatchEvent(new Event('online')); });
      await advance(0);
    } else if (label === 'visibility') {
      await mountProvider();
      setVisibility('hidden');
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    } else {
      await mountProvider();
      await advance(3000);
    }
    expect(mocks.syncNow).toHaveBeenCalledOnce();
  });

  it.each(['backend', 'endpoint', 'token'] as const)('resets cursors when the saved %s changes', async (field) => {
    await mountProvider();
    const next = config();
    if (field === 'backend') next.backend = 'other';
    else next.values[field] = `changed-${field}`;
    await act(async () => { await context().saveConfig(next); });
    expect(mocks.resetSyncCursors).toHaveBeenCalledOnce();
    expect(mocks.resetRepoSeeds).toHaveBeenCalledOnce();
  });

  it('does not reset cursors for unchanged identity or autoSync changes', async () => {
    await mountProvider();
    await act(async () => { await context().saveConfig({ ...config(), autoSync: true }); });
    expect(mocks.resetSyncCursors).not.toHaveBeenCalled();
    expect(mocks.resetRepoSeeds).not.toHaveBeenCalled();
    await act(async () => context().setAutoSync(false));
    expect(mocks.resetSyncCursors).not.toHaveBeenCalled();
  });

  it('clears scheduled timers and resets provider state when config is cleared', async () => {
    mocks.loadSyncConfig.mockReturnValue(config(true));
    mocks.loadSyncState.mockReturnValue({ lastError: { message: 'old error', at: 1 } });
    await mountProvider();
    mocks.loadSyncConfig.mockReturnValue({ ...config(false), enabled: false });
    await advance(3000);
    mocks.syncNow.mockRejectedValueOnce(new Error('sync failed'));
    await act(async () => { await context().syncNow(); });
    expect(context().summary).not.toBeNull();
    expect(context().error).toBe('同步失败，请稍后重试');
    mocks.syncNow.mockClear();
    mocks.loadRepoState.mockClear();
    const baselineTimers = vi.getTimerCount();
    await dirty(); // schedules both pending refresh and delayed sync
    expect(vi.getTimerCount()).toBeGreaterThan(baselineTimers);

    await act(async () => context().clearConfig());
    expect(mocks.clearSyncConfig).toHaveBeenCalledOnce();
    expect(mocks.clearSyncState).toHaveBeenCalledOnce();
    expect(context().config.enabled).toBe(false);
    expect(context().status).toBe('disabled');
    expect(context().summary).toBeNull();
    expect(context().error).toBeNull();
    expect(context().pendingCount).toBe(0);
    expect(mocks.loadRepoState).not.toHaveBeenCalled();

    await advance(60_000);
    expect(mocks.syncNow).not.toHaveBeenCalled();
    expect(mocks.loadRepoState).not.toHaveBeenCalled();
  });
});
