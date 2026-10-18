/**
 * Screen Orientation API 的锁定部分（WICG 非标准 API，TS 的 DOM lib 未收录）：
 * 仅在已安装 PWA / 全屏的 Chrome Android 可用；桌面与普通标签页调用会被拒绝。
 * 这里补全类型，供 src/lib/orientation.ts 使用。
 */
type OrientationLockType =
  | 'any'
  | 'landscape'
  | 'landscape-primary'
  | 'landscape-secondary'
  | 'natural'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary';

interface ScreenOrientation {
  lock(orientation: OrientationLockType): Promise<void>;
}
