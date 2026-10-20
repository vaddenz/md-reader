/**
 * 用户可见错误文案映射（T22）：纯函数，便于单测；由 SyncContext / 各页面在 catch 中调用。
 */

import type { GitHubError } from '../data/github';

export const AUTH_EXPIRED_TEXT = '登录已过期，请重新授权（本地缓存已保留）';
export const QUOTA_TEXT = '存储空间不足，可在设置中清除缓存';

/** IndexedDB / localStorage 写入超限（含 Firefox 历史命名 NS_ERROR_DOM_QUOTA_REACHED）。 */
export function isQuotaError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : (err as { name?: unknown } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/**
 * 限流提示：由 GitHubError.resetAt（X-RateLimit-Reset，ms）推算等待分钟数（向上取整，最少 1 分钟）；
 * resetAt 缺失或已过期时退化为「请稍后重试」。
 */
export function ratelimitToastText(resetAt?: number, now: number = Date.now()): string {
  const waitMs = typeof resetAt === 'number' && Number.isFinite(resetAt) ? resetAt - now : 0;
  if (waitMs <= 0) return 'GitHub 请求超限，请稍后重试';
  return `GitHub 请求超限，${Math.max(1, Math.ceil(waitMs / 60_000))} 分钟后重试`;
}

/** Token 校验失败文案：引导页与设置页共用，避免两处映射漂移。 */
export function githubErrorText(err: GitHubError): string {
  switch (err.kind) {
    case 'auth': return 'Token 无效或已过期';
    case 'network': return '网络不可用';
    default: return `验证失败（${err.kind}）：${err.message}`;
  }
}
