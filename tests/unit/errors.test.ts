import { describe, expect, it } from 'vitest';
import type { GitHubError } from '../../src/data/github';
import { QUOTA_TEXT, githubErrorText, isQuotaError, ratelimitToastText } from '../../src/lib/errors';

describe('isQuotaError', () => {
  it('识别 QuotaExceededError（含 DOMException）与 Firefox 历史命名', () => {
    expect(isQuotaError(new DOMException('quota', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(Object.assign(new Error('x'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' }))).toBe(true);
  });

  it('普通错误 / 空值一律为 false', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
  });
});

describe('ratelimitToastText', () => {
  const NOW = 1_000_000;

  it('按 resetAt 推算等待分钟数（向上取整）', () => {
    expect(ratelimitToastText(NOW + 90_000, NOW)).toBe('GitHub 请求超限，2 分钟后重试');
    expect(ratelimitToastText(NOW + 5_000, NOW)).toBe('GitHub 请求超限，1 分钟后重试');
    expect(ratelimitToastText(NOW + 3_600_000, NOW)).toBe('GitHub 请求超限，60 分钟后重试');
  });

  it('resetAt 缺失 / 已过期 / 非法时退化为「请稍后重试」', () => {
    expect(ratelimitToastText(undefined, NOW)).toBe('GitHub 请求超限，请稍后重试');
    expect(ratelimitToastText(NOW, NOW)).toBe('GitHub 请求超限，请稍后重试');
    expect(ratelimitToastText(NOW - 1, NOW)).toBe('GitHub 请求超限，请稍后重试');
    expect(ratelimitToastText(Number.NaN, NOW)).toBe('GitHub 请求超限，请稍后重试');
  });

  it('quota 文案固定为设置页引导', () => {
    expect(QUOTA_TEXT).toBe('存储空间不足，可在设置中清除缓存');
  });
});

describe('githubErrorText', () => {
  const err = (kind: GitHubError['kind'], message = 'boom') => ({ kind, message }) as GitHubError;

  it('鉴权 / 网络错误给出固定中文文案', () => {
    expect(githubErrorText(err('auth'))).toBe('Token 无效或已过期');
    expect(githubErrorText(err('network'))).toBe('网络不可用');
  });

  it('其它错误保留 kind 与原始信息', () => {
    expect(githubErrorText(err('unknown', 'HTTP 500'))).toBe('验证失败（unknown）：HTTP 500');
  });
});
