import { describe, expect, it } from 'vitest';
import { timeAgo } from '../../src/lib/format';

describe('timeAgo', () => {
  const now = 1_700_000_000_000;

  it('30 秒内 → 刚刚', () => {
    expect(timeAgo(now - 30_000, now)).toBe('刚刚');
  });

  it('5 分钟 → 5 分钟前', () => {
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 分钟前');
  });

  it('3 天 → 3 天前', () => {
    expect(timeAgo(now - 3 * 24 * 60 * 60_000, now)).toBe('3 天前');
  });

  it('边界：59 秒 → 刚刚，60 秒 → 1 分钟前，60 分 → 1 小时前，24 小时 → 1 天前', () => {
    expect(timeAgo(now - 59_000, now)).toBe('刚刚');
    expect(timeAgo(now - 60_000, now)).toBe('1 分钟前');
    expect(timeAgo(now - 60 * 60_000, now)).toBe('1 小时前');
    expect(timeAgo(now - 24 * 60 * 60_000, now)).toBe('1 天前');
  });

  it('默认取当前时间；未来时间戳按「刚刚」处理', () => {
    expect(timeAgo(Date.now())).toBe('刚刚');
    expect(timeAgo(now + 5_000, now)).toBe('刚刚');
  });
});
