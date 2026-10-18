import { describe, expect, it } from 'vitest';
import { LOCK_TARGET, sanitizeOrientation } from '../../src/lib/orientation';

describe('sanitizeOrientation', () => {
  it('合法值保留，非法回退默认 portrait', () => {
    expect(sanitizeOrientation('landscape')).toBe('landscape');
    expect(sanitizeOrientation('landscape-flipped')).toBe('landscape-flipped');
    expect(sanitizeOrientation('portrait')).toBe('portrait');
    expect(sanitizeOrientation('diagonal')).toBe('portrait');
    expect(sanitizeOrientation(null)).toBe('portrait');
  });
});
describe('LOCK_TARGET', () => {
  it('三态映射到系统锁定值', () => {
    expect(LOCK_TARGET).toEqual({
      portrait: 'portrait', landscape: 'landscape-primary', 'landscape-flipped': 'landscape-secondary',
    });
  });
});
