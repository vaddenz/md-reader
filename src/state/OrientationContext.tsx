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

  useEffect(() => {
    if (state !== 'portrait') lastLandscape.current = state;
  }, [state]);

  const setOrientation = useCallback((next: OrientationState) => {
    setState(next);
    void kvSet(ORIENTATION_KEY, next).catch(() => {});
    void applyOrientation(next).then((ok) => {
      if (!ok) showToast('当前环境不支持方向锁定：请用主屏幕应用（PWA）打开', { kind: 'error' });
    });
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
