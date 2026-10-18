import { describe, expect, it } from 'vitest';
import { bytesToText, timeAgo } from '../../src/lib/format';

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

describe('bytesToText', () => {
  it('字节级：0 与非法值（负/NaN/Infinity）兜底为 0 B', () => {
    expect(bytesToText(0)).toBe('0 B');
    expect(bytesToText(-1)).toBe('0 B');
    expect(bytesToText(NaN)).toBe('0 B');
    expect(bytesToText(Infinity)).toBe('0 B');
  });

  it('B 与 KB 边界：1023 → 1023 B，1024 → 1.0 KB', () => {
    expect(bytesToText(512)).toBe('512 B');
    expect(bytesToText(1023)).toBe('1023 B');
    expect(bytesToText(1024)).toBe('1.0 KB');
    expect(bytesToText(1536)).toBe('1.5 KB');
  });

  it('MB / GB / TB 按 1024 进位，保留 1 位小数', () => {
    expect(bytesToText(1024 ** 2)).toBe('1.0 MB');
    expect(bytesToText(2.5 * 1024 ** 2)).toBe('2.5 MB');
    expect(bytesToText(1024 ** 3)).toBe('1.0 GB');
    expect(bytesToText(1024 ** 4)).toBe('1.0 TB');
  });
});
