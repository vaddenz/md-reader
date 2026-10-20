// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { resetRepoStateForTests } from '../../src/data/repos';
import { saveSyncConfig } from '../../src/sync/config';
import { openRepoDb } from '../../src/sync/repoDb';
import { DataSyncProvider, useDataSync } from '../../src/sync/DataSyncContext';
import type { SyncConfig } from '../../src/sync/types';

let root: Root | null = null;
let currentContext: ReturnType<typeof useDataSync> | undefined;

function config(endpoint: string, token: string): SyncConfig {
  return {
    version: 1,
    enabled: true,
    autoSync: false,
    backend: 'neon',
    values: { endpoint, token },
  };
}

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

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  await resetRepoStateForTests();
  await clearAllData();
});

afterEach(async () => {
  const mounted = root;
  root = null;
  currentContext = undefined;
  if (mounted) await act(async () => mounted.unmount());
  vi.unstubAllGlobals();
});

describe('DataSyncProvider saveConfig identity change', () => {
  it('clears per-repo seed/scope markers when the endpoint changes', async () => {
    saveSyncConfig(config('https://old.example/rest/v1', 'old-token'));
    const db = await openRepoDb('mdreader');
    await db.kvSet('syncSeededCollections', ['reading.progress']);
    await db.kvSet('syncScope', 'old/scope@main');

    await mountProvider();
    await act(async () => {
      await currentContext!.saveConfig(config('https://new.example/rest/v1', 'new-token'));
    });

    expect(await db.kvGet('syncSeededCollections')).toBeUndefined();
    expect(await db.kvGet('syncScope')).toBeUndefined();
    expect(localStorage.getItem('mdreader.syncConfig')).toContain('https://new.example/rest/v1');
  });
});
