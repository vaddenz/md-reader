import { kvGet, kvSet } from './db';
import { serialize } from './serialize';

export interface Decoration { kind: 'bg'; color: string }
export interface HighlightRecord {
  id: string; exact: string; prefix: string; suffix: string;
  decorations: Decoration[]; createdAt: number;
}
export type HighlightMap = Record<string, HighlightRecord[]>;

/** 颜色注册表（渲染与菜单共用；加新颜色 = 加一项 + 一个 CSS 变量）。 */
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: '高亮·黄', cssVar: '--hl-yellow' },
  { id: 'red', label: '高亮·红', cssVar: '--hl-red' },
] as const;

export const HIGHLIGHT_FORMAT_VERSION = 1;
const HIGHLIGHTS_KEY = 'highlights';

function sanitizeRecord(raw: unknown): HighlightRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Partial<HighlightRecord>;
  if (typeof rec.id !== 'string' || !rec.id) return null;
  if (typeof rec.exact !== 'string' || !rec.exact) return null;
  const decorations: Decoration[] = Array.isArray(rec.decorations)
    ? rec.decorations
        .filter((d): d is Decoration =>
          !!d && typeof d === 'object' && (d as Decoration).kind === 'bg' && typeof (d as Decoration).color === 'string')
        .map((d) => ({ kind: 'bg', color: d.color }))
    : [];
  return {
    id: rec.id, exact: rec.exact,
    prefix: typeof rec.prefix === 'string' ? rec.prefix : '',
    suffix: typeof rec.suffix === 'string' ? rec.suffix : '',
    decorations,
    createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0,
  };
}

export function sanitizeHighlights(raw: unknown): HighlightMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: HighlightMap = {};
  for (const [path, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const records = list.map(sanitizeRecord).filter((r): r is HighlightRecord => r !== null);
    if (records.length) out[path] = records;
  }
  return out;
}

async function readAll(): Promise<HighlightMap> {
  return sanitizeHighlights(await kvGet<unknown>(HIGHLIGHTS_KEY));
}

export async function getHighlights(): Promise<HighlightMap> { return readAll(); }

export async function getDocHighlights(path: string): Promise<HighlightRecord[]> {
  return (await readAll())[path] ?? [];
}

export function addHighlight(path: string, rec: HighlightRecord): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    all[path] = [...(all[path] ?? []), rec];
    await kvSet(HIGHLIGHTS_KEY, all);
  });
}

export function removeHighlights(path: string, ids: string[]): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    const rest = (all[path] ?? []).filter((r) => !ids.includes(r.id));
    if (rest.length) all[path] = rest; else delete all[path];
    await kvSet(HIGHLIGHTS_KEY, all);
  });
}

/** 导出（含孤儿记录）；格式带版本号。 */
export async function exportHighlights(): Promise<string> {
  return JSON.stringify({ formatVersion: HIGHLIGHT_FORMAT_VERSION, exportedAt: Date.now(), highlights: await readAll() }, null, 2);
}

/** 导入合并：键 = path + exact + decorations；重复跳过、不覆盖本地已有。 */
export function importHighlights(json: string): Promise<{ imported: number; skipped: number }> {
  return serialize(async () => {
    const parsed = JSON.parse(json) as { formatVersion?: unknown; highlights?: unknown };
    if (parsed?.formatVersion !== HIGHLIGHT_FORMAT_VERSION) throw new Error('不支持的格式版本');
    const incoming = sanitizeHighlights(parsed.highlights);
    const all = await readAll();
    let imported = 0; let skipped = 0;
    const key = (p: string, r: HighlightRecord) => `${p}\u0000${r.exact}\u0000${JSON.stringify(r.decorations)}`;
    for (const [path, list] of Object.entries(incoming)) {
      const existing = new Set((all[path] ?? []).map((r) => key(path, r)));
      for (const r of list) {
        if (existing.has(key(path, r))) { skipped += 1; continue; }
        existing.add(key(path, r));
        all[path] = [...(all[path] ?? []), r];
        imported += 1;
      }
    }
    await kvSet(HIGHLIGHTS_KEY, all);
    return { imported, skipped };
  });
}
