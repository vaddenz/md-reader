import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearSyncConfig,
  loadSyncConfig,
  saveSyncConfig,
  syncConfigFingerprint,
} from './config';
import { clearSyncState, loadSyncState, resetSyncCursors } from './state';
import { createSyncBackend, isSyncConfigured, shouldAutoSync } from './registry';
import { syncNow as runEngineSync, type SyncSummary } from './engine';
import { countOutbox } from './outbox';
import { openRepoDb } from './repoDb';
import { loadRepoState, repoDbName } from '../data/repos';
import type { SyncConfig, TestResult } from './types';
import { SyncError } from './types';

interface DataSyncContextValue {
  config: SyncConfig;
  status: 'disabled' | 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'error';
  summary: SyncSummary | null;
  error: string | null;
  pendingCount: number;
  warning: string | null;
  syncNow(): Promise<void>;
  testConnection(values: Readonly<Record<string, string>>): Promise<TestResult>;
  saveConfig(next: SyncConfig): void;
  setAutoSync(on: boolean): void;
  disable(): void;
  clearConfig(): void;
  refreshPendingCount(): Promise<void>;
}

const Ctx = createContext<DataSyncContextValue>(null!);

export const useDataSync = () => useContext(Ctx);

export function DataSyncProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SyncConfig>(() => loadSyncConfig());
  const [status, setStatus] = useState<DataSyncContextValue['status']>('idle');
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(() => loadSyncState().lastError?.message ?? null);
  const [pendingCount, setPendingCount] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const onlineRef = useRef(online);
  const previousOnlineRef = useRef(online);
  const timerRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const dirtySinceRef = useRef<number | null>(null);

  const refreshPendingCount = useCallback(async () => {
    const state = loadRepoState();
    let total = 0;
    for (const repo of state.repos) {
      let db: Awaited<ReturnType<typeof openRepoDb>> | undefined;
      try {
        db = await openRepoDb(repoDbName(repo.id));
        total += await countOutbox(db);
      } catch {
        // 单个库被阻塞时忽略，其余仓库仍然统计。
      } finally {
        db?.close();
      }
    }
    setPendingCount(total);
  }, []);

  const schedulePendingRefresh = useCallback(() => {
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      void refreshPendingCount();
    }, 1000);
  }, [refreshPendingCount]);

  const runSync = useCallback(async () => {
    if (!config.enabled || !isSyncConfigured(config) || !onlineRef.current) return;
    setStatus('syncing');
    setError(null);
    try {
      const result = await runEngineSync();
      dirtySinceRef.current = null;
      setSummary(result);
      setStatus('idle');
      setError(null);
      await refreshPendingCount();
    } catch (err) {
      setStatus('error');
      setError(err instanceof SyncError ? err.message : '同步失败，请稍后重试');
    }
  }, [config, refreshPendingCount]);

  const schedule = useCallback((delayMs: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void runSync();
    }, delayMs);
  }, [runSync]);

  const scheduleDirtySync = useCallback(() => {
    const now = Date.now();
    if (dirtySinceRef.current === null) dirtySinceRef.current = now;
    const elapsed = now - dirtySinceRef.current;
    schedule(Math.min(10_000, Math.max(0, 60_000 - elapsed)));
  }, [schedule]);

  // 自动同步默认关闭；启动调度只有在启用且配置有效时才生效。
  useEffect(() => {
    const returnedOnline = online && !previousOnlineRef.current;
    previousOnlineRef.current = online;
    if (!shouldAutoSync(config, online)) return;
    schedule(returnedOnline ? 0 : 3000);
  }, [config, online, schedule]);

  useEffect(() => {
    const onOnline = () => {
      onlineRef.current = true;
      setOnline(true);
    };
    const onOffline = () => {
      onlineRef.current = false;
      setOnline(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (shouldAutoSync(config, online)) void runSync();
      } else if (shouldAutoSync(config, online)) {
        schedule(3000);
      }
    };
    const onDirty = () => {
      if (!shouldAutoSync(config, online)) {
        dirtySinceRef.current = null;
        schedulePendingRefresh();
        return;
      }
      scheduleDirtySync();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('mdreader:sync-dirty', onDirty);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mdreader:sync-dirty', onDirty);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    };
  }, [config, online, runSync, schedule, scheduleDirtySync, schedulePendingRefresh]);

  const saveConfig = useCallback((next: SyncConfig) => {
    const saved = saveSyncConfig({ ...next, enabled: true });
    if (syncConfigFingerprint(config) !== syncConfigFingerprint(saved)) resetSyncCursors();
    setConfig(saved);
    setError(null);
    setStatus(isSyncConfigured(saved) ? 'idle' : 'unconfigured');
    if (!saved.autoSync) dirtySinceRef.current = null;
    void refreshPendingCount();
  }, [config, refreshPendingCount]);

  const setAutoSync = useCallback((on: boolean) => {
    const saved = saveSyncConfig({ ...config, autoSync: on });
    setConfig(saved);
    if (!on) dirtySinceRef.current = null;
    if (on && shouldAutoSync(saved, online)) schedule(3000);
  }, [config, online, schedule]);

  const disable = useCallback(() => {
    const saved = saveSyncConfig({ ...config, enabled: false });
    setConfig(saved);
    dirtySinceRef.current = null;
    setStatus('disabled');
  }, [config]);

  const clearConfig = useCallback(() => {
    clearSyncConfig();
    clearSyncState();
    const next = loadSyncConfig();
    setConfig(next);
    setSummary(null);
    setError(null);
    setWarning(null);
    setStatus('disabled');
    setPendingCount(0);
    dirtySinceRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    timerRef.current = null;
    pendingTimerRef.current = null;
  }, []);

  const testConnection = useCallback(async (values: Readonly<Record<string, string>>) => {
    const backend = createSyncBackend({ ...config, values: { ...config.values, ...values } });
    const result = await backend.test();
    setWarning(result.warning ?? null);
    return result;
  }, [config]);

  useEffect(() => {
    onlineRef.current = online;
    if (!config.enabled) setStatus('disabled');
    else if (!isSyncConfigured(config)) setStatus('unconfigured');
    else if (!online) setStatus('offline');
    else if (status !== 'syncing') setStatus(error ? 'error' : 'idle');
  }, [config, online, error, status]);

  const value = useMemo<DataSyncContextValue>(() => ({
    config,
    status,
    summary,
    error,
    pendingCount,
    warning,
    syncNow: async () => { await runSync(); },
    testConnection,
    saveConfig,
    setAutoSync,
    disable,
    clearConfig,
    refreshPendingCount,
  }), [
    config,
    status,
    summary,
    error,
    pendingCount,
    warning,
    runSync,
    testConnection,
    saveConfig,
    setAutoSync,
    disable,
    clearConfig,
    refreshPendingCount,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
