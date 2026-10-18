import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { SETUP, toRouterPath } from '../app/nav';
import { kvGet } from '../data/db';
import { GitHubClient, GitHubError } from '../data/github';
import { sweepExpired, syncRepo, type SyncProgress } from '../data/sync';
import { useOnline } from '../hooks/useOnline';
import { AUTH_EXPIRED_TEXT, QUOTA_TEXT, isQuotaError, ratelimitToastText } from '../lib/errors';
import { timeAgo } from '../lib/format';
import { showToast } from '../lib/toast';
import { useToken } from './TokenContext';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';
export interface RepoConfig { owner: string; repo: string; branch: string }

interface SyncCtx {
  status: SyncStatus;
  progress: SyncProgress | null;
  lastSyncAt: number | null;
  error: GitHubError | null;
  syncNow(): Promise<void>;
  timeAgo(ts: number): string;
}

const Ctx = createContext<SyncCtx>(null!);

/** 首次成功同步后申请持久化存储（幂等：已持久化则跳过，失败静默忽略）。 */
async function requestPersistentStorage(): Promise<void> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist || (await storage.persisted())) return;
    await storage.persist();
  } catch {
    // 申请失败不影响同步结果（部分浏览器未实现 persist）
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { token } = useToken();
  const online = useOnline();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [error, setError] = useState<GitHubError | null>(null);
  const running = useRef(false);

  const syncNow = useCallback(async (): Promise<void> => {
    if (running.current) return; // 防重入：同步中再次触发直接忽略
    running.current = true;
    try {
      const cfg = await kvGet<RepoConfig>('config');
      if (!cfg || !token) {
        navigate(toRouterPath(SETUP));
        return;
      }
      setStatus('syncing');
      setError(null);
      await syncRepo(new GitHubClient(token), cfg, setProgress);
      await sweepExpired().catch(() => {}); // 同步完成后本地清理（失败不影响结果）
      await requestPersistentStorage();
      setLastSyncAt(Date.now());
      setStatus(navigator.onLine ? 'idle' : 'offline'); // 取完成时刻的实时状态（同步期间可能掉线）
    } catch (err) {
      // 存储超限（IndexedDB 写入）不是 GitHubError：单独映射，提示清理缓存后仍保留其余状态
      if (isQuotaError(err)) {
        setError(new GitHubError('unknown', QUOTA_TEXT));
        setStatus('error');
        showToast(QUOTA_TEXT, { kind: 'error' });
        return;
      }
      const gerr = err instanceof GitHubError
        ? err
        : new GitHubError('unknown', err instanceof Error ? err.message : String(err));
      setError(gerr);
      if (gerr.kind === 'auth') {
        // 缓存保留，仅引导重新授权（T22：toast 替代 window.alert + ?reauth=1 变体）
        showToast(AUTH_EXPIRED_TEXT, { kind: 'error' });
        setStatus('error');
        navigate(toRouterPath(`${SETUP}?reauth=1`));
      } else if (gerr.kind === 'ratelimit') {
        showToast(ratelimitToastText(gerr.resetAt), { kind: 'error' });
        setStatus('error');
      } else if (gerr.kind === 'network') {
        setStatus('offline');
      } else {
        setStatus('error');
      }
    } finally {
      setProgress(null);
      running.current = false;
    }
  }, [token, navigate]);

  // 刷新页面后徽标仍能显示「上次同步 X」
  useEffect(() => {
    void kvGet<number>('lastSyncAt')
      .then((v) => { if (typeof v === 'number') setLastSyncAt(v); })
      .catch(() => {});
  }, []);

  // 离线 → 橙点；恢复在线交由下方自动同步触发
  useEffect(() => {
    if (!online) setStatus('offline');
    else setStatus((s) => (s === 'offline' ? 'idle' : s));
  }, [online]);

  // navigate 的身份随路由变化，自动同步经 ref 取最新 syncNow，避免每次导航后重复同步
  const syncRef = useRef(syncNow);
  useEffect(() => { syncRef.current = syncNow; }, [syncNow]);

  // 启动时：先本地清理；无 Token 时停留/跳转引导页（spec §3 无 Token 不可用）；
  // 有 token && config 且在线时后台静默同步；恢复在线/配置 Token 后同样触发。
  // 注意：依赖不含 navigate（其身份随路由变化，入依赖会导致每次导航都重跑本效应）；
  // 此处只用绝对路径导航，闭包中的旧实例仍然有效。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await sweepExpired().catch(() => {});
      if (cancelled) return;
      if (!token) {
        // 已在引导页则不重复导航（避免 setup 页反复跳转自身）
        if (!window.location.hash.startsWith('#/setup')) navigate(toRouterPath(SETUP));
        return;
      }
      if (!online) return;
      const cfg = await kvGet<RepoConfig>('config').catch(() => undefined);
      if (!cancelled && cfg) void syncRef.current();
    })();
    return () => { cancelled = true; };
  }, [token, online]);

  const value = useMemo(
    () => ({ status, progress, lastSyncAt, error, syncNow, timeAgo }),
    [status, progress, lastSyncAt, error, syncNow],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSync = () => useContext(Ctx);
