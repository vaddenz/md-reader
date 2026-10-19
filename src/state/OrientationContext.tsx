import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { kvGet, kvSet } from '../data/db';
import { showToast } from '../lib/toast';
import { DEFAULT_ORIENTATION, ORIENTATION_KEY, applyOrientation, sanitizeOrientation, type OrientationState } from '../lib/orientation';

interface OrientationApi {
  state: OrientationState;
  setOrientation(next: OrientationState): void;
  toggleLandscape(): void;
  flip(): void;
}

const OrientationContext = createContext<OrientationApi | null>(null);

export function OrientationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrientationState>(DEFAULT_ORIENTATION);
  const [loaded, setLoaded] = useState(false);
  const lastLandscape = useRef<OrientationState>('landscape');

  useEffect(() => {
    let cancelled = false;
    void kvGet<unknown>(ORIENTATION_KEY).then(
      (v) => { if (!cancelled) { setState(sanitizeOrientation(v)); setLoaded(true); } },
      () => { if (!cancelled) setLoaded(true); },
    );
    return () => { cancelled = true; };
  }, []);

  // 启动时应用一次（静默：失败不打扰，用户操作时才会提示）。
  useEffect(() => {
    if (!loaded) return;
    void applyOrientation(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // spec §7.4：系统 / 用户退出全屏后重新应用锁定；回到前台时补一次（静默，不提示）。
  useEffect(() => {
    if (!loaded) return;
    const reapply = () => { void applyOrientation(state); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void applyOrientation(state); };
    document.addEventListener('fullscreenchange', reapply);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('fullscreenchange', reapply);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loaded, state]);

  useEffect(() => {
    if (state !== 'portrait') lastLandscape.current = state;
  }, [state]);

  const setOrientation = useCallback((next: OrientationState) => {
    setState(next);
    // 先落库、再锁屏：保证「系统锁定已生效」时状态已持久化，
    // 用户随即刷新/关闭也不丢（T13 的 reload 恢复用例依赖该顺序）。
    void (async () => {
      await kvSet(ORIENTATION_KEY, next).catch(() => {});
      const ok = await applyOrientation(next);
      // 回竖屏为尽力而为（退出全屏已生效）：失败不提示；横屏/翻转失败仍按安装提示口径。
      if (!ok && next !== 'portrait') showToast('当前环境不支持方向锁定：请用主屏幕应用（PWA）打开', { kind: 'error' });
    })();
  }, []);

  const toggleLandscape = useCallback(() => {
    setOrientation(state === 'portrait' ? lastLandscape.current : 'portrait');
  }, [state, setOrientation]);

  const flip = useCallback(() => {
    if (state === 'landscape') setOrientation('landscape-flipped');
    else if (state === 'landscape-flipped') setOrientation('landscape');
  }, [state, setOrientation]);

  return (
    <OrientationContext.Provider value={{ state, setOrientation, toggleLandscape, flip }}>
      {children}
    </OrientationContext.Provider>
  );
}

export function useOrientation(): OrientationApi {
  const ctx = useContext(OrientationContext);
  if (!ctx) throw new Error('useOrientation 必须在 OrientationProvider 内使用');
  return ctx;
}
