import { describe, expect, it } from 'vitest';
import { runPool } from '../../src/lib/pool';

describe('runPool', () => {
  it('限制并发且全部完成', async () => {
    let running = 0, peak = 0;
    const done: number[] = [];
    await runPool([...Array(10).keys()], 3, async (i) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      done.push(i); running--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(done.sort((a, b) => a - b)).toEqual([...Array(10).keys()]);
  });
});
