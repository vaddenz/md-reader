// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../../src/data/db';
import { clearAllData, kvSet } from '../../src/data/db';
import {
  DEFAULT_APPEARANCE, FONT_WEIGHTS, appearanceStyle, getAppearance, sanitizeAppearance, saveAppearance,
} from '../../src/data/appearance';

beforeEach(async () => { await clearAllData(); });

describe('sanitizeAppearance', () => {
  it('非对象/数组回退默认', () => {
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(sanitizeAppearance([1, 2])).toEqual(DEFAULT_APPEARANCE);
  });
  it('非法字段回退默认、数值钳制到范围', () => {
    expect(sanitizeAppearance({ fontFamily: 'comic', fontSize: 99, tableScale: 0, quoteScale: 'x' }))
      .toEqual({ fontFamily: 'system', fontSize: 24, fontWeight: 400, tableScale: 0.5, quoteScale: 1 });
    expect(sanitizeAppearance({ fontSize: -5 })).toMatchObject({ fontSize: 12 });
  });
  it('合法值原样保留', () => {
    expect(sanitizeAppearance({ fontFamily: 'serif', fontSize: 20, fontWeight: 300, tableScale: 0.6, quoteScale: 0.8 }))
      .toEqual({ fontFamily: 'serif', fontSize: 20, fontWeight: 300, tableScale: 0.6, quoteScale: 0.8 });
  });
  it('字体粗细只接受 300/400/500/600，非法回退 400', () => {
    expect(FONT_WEIGHTS).toEqual([300, 400, 500, 600]);
    expect(sanitizeAppearance({ fontWeight: 300 }).fontWeight).toBe(300);
    expect(sanitizeAppearance({ fontWeight: 600 }).fontWeight).toBe(600);
    expect(sanitizeAppearance({ fontWeight: 350 }).fontWeight).toBe(400);
    expect(sanitizeAppearance({ fontWeight: 400.5 }).fontWeight).toBe(400);
    expect(sanitizeAppearance({ fontWeight: '600' }).fontWeight).toBe(400);
    expect(sanitizeAppearance({}).fontWeight).toBe(400);
  });
});

describe('getAppearance / saveAppearance', () => {
  it('未设置返回默认；保存后读回（含清洗）', async () => {
    expect(await getAppearance()).toEqual(DEFAULT_APPEARANCE);
    await saveAppearance({ fontFamily: 'xihei', fontSize: 18, fontWeight: 500, tableScale: 0.6, quoteScale: 0.8 });
    expect(await getAppearance()).toEqual({ fontFamily: 'xihei', fontSize: 18, fontWeight: 500, tableScale: 0.6, quoteScale: 0.8 });
  });
  it('kv 中被外部写坏的数据读取时被清洗', async () => {
    await kvSet('appearance', { fontSize: 'big' });
    expect(await getAppearance()).toEqual(DEFAULT_APPEARANCE);
  });
  it('读取失败时回退默认值（spec §3.1）', async () => {
    const spy = vi.spyOn(db, 'kvGet').mockRejectedValueOnce(new Error('db down'));
    expect(await getAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    // 恢复后仍能正常读回，确认 mock 未污染后续调用
    expect(await getAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it('外观跨仓库共享：写全局 localStorage，清空当前仓库库后仍可读回', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    });
    try {
      await saveAppearance({ fontFamily: 'serif', fontSize: 19, fontWeight: 500, tableScale: 0.8, quoteScale: 0.9 });
      expect(store.get('mdreader.appearance')).toContain('"fontFamily":"serif"');
      await clearAllData();
      expect(await getAppearance()).toMatchObject({ fontFamily: 'serif', fontSize: 19 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('旧版外观从 kv 读取后提升为全局', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    });
    try {
      await kvSet('appearance', { fontFamily: 'xihei', fontSize: 18 });
      expect(await getAppearance()).toMatchObject({ fontFamily: 'xihei', fontSize: 18 });
      expect(store.get('mdreader.appearance')).toContain('"fontFamily":"xihei"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('appearanceStyle', () => {
  it('生成五个 CSS 变量，字体栈按 choice 映射', () => {
    const s = appearanceStyle({ fontFamily: 'xihei', fontSize: 20, fontWeight: 500, tableScale: 0.6, quoteScale: 0.8 });
    expect(s).toEqual({
      '--r-font-family': "'LXGW Neo XiHei Screen', var(--font-sans)",
      '--r-font-size': '20px',
      '--r-font-weight': '500',
      '--r-table-scale': '0.6',
      '--r-quote-scale': '0.8',
    });
    expect(appearanceStyle(DEFAULT_APPEARANCE)['--r-font-family']).toBe('var(--font-sans)');
  });
});
