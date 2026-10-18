export type OrientationState = 'portrait' | 'landscape' | 'landscape-flipped';

export const DEFAULT_ORIENTATION: OrientationState = 'portrait';
export const ORIENTATION_KEY = 'orientation';

export const LOCK_TARGET: Record<OrientationState, OrientationLockType> = {
  portrait: 'portrait',
  landscape: 'landscape-primary',
  'landscape-flipped': 'landscape-secondary',
};

export function sanitizeOrientation(raw: unknown): OrientationState {
  return raw === 'portrait' || raw === 'landscape' || raw === 'landscape-flipped' ? raw : DEFAULT_ORIENTATION;
}

/** 尝试系统级方向锁定；不支持（桌面/浏览器标签未全屏）或失败返回 false。 */
export async function applyOrientation(state: OrientationState): Promise<boolean> {
  try {
    if (typeof screen === 'undefined' || !screen.orientation || typeof screen.orientation.lock !== 'function') return false;
    await screen.orientation.lock(LOCK_TARGET[state]);
    return true;
  } catch {
    return false;
  }
}
