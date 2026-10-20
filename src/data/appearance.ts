import type { CSSProperties } from 'react';
import { kvGet, kvSet } from './db';
import { serialize } from './serialize';

export type FontChoice = 'system' | 'xihei' | 'serif';

export const FONT_WEIGHTS = [300, 400, 500, 600] as const;

export type ReaderFontWeight = (typeof FONT_WEIGHTS)[number];

export interface ReaderAppearance {
  fontFamily: FontChoice;
  fontSize: number;   // px
  fontWeight: ReaderFontWeight; // 300/400/500/600，仅正文
  tableScale: number; // 相对正文比例
  quoteScale: number;
}

export const FONT_SIZE_RANGE = { min: 12, max: 24 } as const;
export const SCALE_RANGE = { min: 0.5, max: 1.2 } as const;

export const DEFAULT_APPEARANCE: ReaderAppearance = {
  fontFamily: 'system', fontSize: 17, fontWeight: 400, tableScale: 0.95, quoteScale: 1,
};

export const FONT_STACKS: Record<FontChoice, string> = {
  system: 'var(--font-sans)',
  xihei: "'LXGW Neo XiHei Screen', var(--font-sans)",
  serif: "'Noto Serif SC', serif",
};

const APPEARANCE_KEY = 'appearance';
/** 全局外观（跨仓库共享）：localStorage 优先，kv 保留为镜像/旧数据迁移源。 */
const GLOBAL_APPEARANCE_KEY = 'mdreader.appearance';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const isReaderFontWeight = (v: unknown): v is ReaderFontWeight =>
  typeof v === 'number' && (FONT_WEIGHTS as readonly number[]).includes(v);

export function sanitizeAppearance(raw: unknown): ReaderAppearance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_APPEARANCE };
  const rec = raw as Partial<ReaderAppearance>;
  return {
    fontFamily: rec.fontFamily === 'xihei' || rec.fontFamily === 'serif' ? rec.fontFamily : 'system',
    fontSize: Number.isFinite(rec.fontSize) ? clamp(rec.fontSize as number, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max) : DEFAULT_APPEARANCE.fontSize,
    fontWeight: isReaderFontWeight(rec.fontWeight) ? rec.fontWeight : DEFAULT_APPEARANCE.fontWeight,
    tableScale: Number.isFinite(rec.tableScale) ? clamp(rec.tableScale as number, SCALE_RANGE.min, SCALE_RANGE.max) : DEFAULT_APPEARANCE.tableScale,
    quoteScale: Number.isFinite(rec.quoteScale) ? clamp(rec.quoteScale as number, SCALE_RANGE.min, SCALE_RANGE.max) : DEFAULT_APPEARANCE.quoteScale,
  };
}

function readGlobalAppearance(): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(GLOBAL_APPEARANCE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeGlobalAppearance(a: ReaderAppearance): void {
  try {
    globalThis.localStorage?.setItem(GLOBAL_APPEARANCE_KEY, JSON.stringify(a));
  } catch {
    // localStorage 不可用时退化为当前仓库库内的 kv 镜像
  }
}

export async function getAppearance(): Promise<ReaderAppearance> {
  const global = readGlobalAppearance();
  if (global !== undefined) return sanitizeAppearance(global);
  try {
    const stored = await kvGet<unknown>(APPEARANCE_KEY);
    const clean = sanitizeAppearance(stored);
    // 旧版外观存在仓库库中：首次读取时提升为全局，切换仓库后保持一致。
    if (stored !== undefined) writeGlobalAppearance(clean);
    return clean;
  } catch {
    // spec §3.1：kv 读取失败时回退默认值
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: ReaderAppearance): Promise<void> {
  const clean = sanitizeAppearance(a);
  writeGlobalAppearance(clean);
  return serialize(async () => { await kvSet(APPEARANCE_KEY, clean); });
}

/** 危险区清除全局外观（当前仓库库内的 kv 镜像随清库一并删除）。 */
export function clearGlobalAppearance(): void {
  try {
    globalThis.localStorage?.removeItem(GLOBAL_APPEARANCE_KEY);
  } catch {
    // 忽略
  }
}

/** appearanceStyle 返回值：CSSProperties 基础上带上五个可索引的自定义属性（供单测/消费方直接读取）。 */
export type AppearanceStyle = CSSProperties & Record<
  '--r-font-family' | '--r-font-size' | '--r-font-weight' | '--r-table-scale' | '--r-quote-scale',
  string
>;

export function appearanceStyle(a: ReaderAppearance): AppearanceStyle {
  return {
    '--r-font-family': FONT_STACKS[a.fontFamily],
    '--r-font-size': `${a.fontSize}px`,
    '--r-font-weight': String(a.fontWeight),
    '--r-table-scale': String(a.tableScale),
    '--r-quote-scale': String(a.quoteScale),
  };
}
