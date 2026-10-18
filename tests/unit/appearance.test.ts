// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, kvSet } from '../../src/data/db';
import {
  DEFAULT_APPEARANCE, appearanceStyle, getAppearance, sanitizeAppearance, saveAppearance,
} from '../../src/data/appearance';

beforeEach(async () => { await clearAllData(); });

describe('sanitizeAppearance', () => {
  it('非对象/数组回退默认', () => {
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(sanitizeAppearance([1, 2])).toEqual(DEFAULT_APPEARANCE);
  });
  it('非法字段回退默认、数值钳制到范围', () => {
    expect(sanitizeAppearance({ fontFamily: 'comic', fontSize: 99, tableScale: 0, quoteScale: 'x' }))
      .toEqual({ fontFamily: 'system', fontSize: 24, tableScale: 0.5, quoteScale: 1 });
    expect(sanitizeAppearance({ fontSize: -5 })).toMatchObject({ fontSize: 12 });
  });
  it('合法值原样保留', () => {
    expect(sanitizeAppearance({ fontFamily: 'serif', fontSize: 20, tableScale: 0.6, quoteScale: 0.8 }))
      .toEqual({ fontFamily: 'serif', fontSize: 20, tableScale: 0.6, quoteScale: 0.8 });
  });
});

describe('getAppearance / saveAppearance', () => {
  it('未设置返回默认；保存后读回（含清洗）', async () => {
    expect(await getAppearance()).toEqual(DEFAULT_APPEARANCE);
    await saveAppearance({ fontFamily: 'xihei', fontSize: 18, tableScale: 0.6, quoteScale: 0.8 });
    expect(await getAppearance()).toEqual({ fontFamily: 'xihei', fontSize: 18, tableScale: 0.6, quoteScale: 0.8 });
  });
  it('kv 中被外部写坏的数据读取时被清洗', async () => {
    await kvSet('appearance', { fontSize: 'big' });
    expect(await getAppearance()).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('appearanceStyle', () => {
  it('生成四个 CSS 变量，字体栈按 choice 映射', () => {
    const s = appearanceStyle({ fontFamily: 'xihei', fontSize: 20, tableScale: 0.6, quoteScale: 0.8 });
    expect(s).toEqual({
      '--r-font-family': "'LXGW Neo XiHei Screen', var(--font-sans)",
      '--r-font-size': '20px',
      '--r-table-scale': '0.6',
      '--r-quote-scale': '0.8',
    });
    expect(appearanceStyle(DEFAULT_APPEARANCE)['--r-font-family']).toBe('var(--font-sans)');
  });
});
