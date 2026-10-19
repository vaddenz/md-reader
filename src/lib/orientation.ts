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

/**
 * 尝试系统级方向锁定；不支持或失败返回 false。
 * 平台事实：`screen.orientation.lock()` 实际要求全屏上下文（MDN：仅在浏览器上下文全屏时可用；
 * 部分设备上独立窗口 PWA 也不豁免）。因此锁被拒且当前不在全屏时，先请求全屏再重试一次；
 * 请求全屏同样失败（无手势/被策略拒绝）才算失败。
 */
export async function applyOrientation(state: OrientationState): Promise<boolean> {
  try {
    if (typeof screen === 'undefined' || !screen.orientation || typeof screen.orientation.lock !== 'function') return false;

    if (state === 'portrait') {
      // 回到竖屏：先退出「为横屏锁定而进入」的全屏（竖屏不请求全屏）；
      // 锁定为尽力而为——失败返回 false，由调用方决定是否提示。
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      await screen.orientation.lock(LOCK_TARGET[state]);
      return true;
    }

    try {
      await screen.orientation.lock(LOCK_TARGET[state]);
      return true;
    } catch {
      // 锁被拒：未全屏则在（用户手势）上下文内进入全屏后重试；已在全屏仍失败则放弃。
      if (document.fullscreenElement || typeof document.documentElement.requestFullscreen !== 'function') return false;
      await document.documentElement.requestFullscreen();
      await screen.orientation.lock(LOCK_TARGET[state]);
      return true;
    }
  } catch {
    return false;
  }
}
