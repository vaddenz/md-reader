import { kvGet, openDb } from './db';
import { serialize } from './serialize';
import { nextUpdatedAt } from '../sync/device';
import { commitWithNotify, enqueueChange } from '../sync/outbox';
import { clearTombstoneTx, putTombstone } from '../sync/tombstones';
import { COLLECTIONS } from '../sync/collections/names';

export interface Decoration {
  kind: string;           // v1 仅渲染 'bg'；未知 kind 保留数据
  color?: string;
  [key: string]: unknown; // 未知字段原样保留（向前兼容）
}
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
    ? rec.decorations.filter(
        (d): d is Decoration => !!d && typeof d === 'object' && typeof (d as Decoration).kind === 'string',
      )
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

/** 追加高亮：记录与 outbox 同事务提交（并清掉同 id 的本地墓碑）。 */
export function addHighlight(path: string, rec: HighlightRecord): Promise<void> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeHighlights(await kv.get(HIGHLIGHTS_KEY));
    all[path] = [...(all[path] ?? []), rec];
    await kv.put(all, HIGHLIGHTS_KEY);
    await clearTombstoneTx(tx, COLLECTIONS.highlights, rec.id);
    enqueueChange(tx, {
      collection: COLLECTIONS.highlights, recordId: rec.id, updatedAt: rec.createdAt, deleted: false,
    });
    await commitWithNotify(tx);
  });
}

/** 按 id 删除高亮：仅对本地实际存在的记录写墓碑并入队 tombstone，时间戳单调递增。 */
export function removeHighlights(path: string, ids: string[]): Promise<void> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeHighlights(await kv.get(HIGHLIGHTS_KEY));
    const list = all[path] ?? [];
    const found = list.filter((r) => ids.includes(r.id));
    const rest = list.filter((r) => !ids.includes(r.id));
    if (rest.length) all[path] = rest; else delete all[path];
    await kv.put(all, HIGHLIGHTS_KEY);
    const now = Date.now();
    for (const rec of found) {
      const at = nextUpdatedAt(now, rec.createdAt);
      await putTombstone(tx, COLLECTIONS.highlights, rec.id, at);
      enqueueChange(tx, {
        collection: COLLECTIONS.highlights, recordId: rec.id, updatedAt: at, deleted: true,
      });
    }
    await commitWithNotify(tx);
  });
}

/** 导出（含孤儿记录）；格式带版本号。 */
export async function exportHighlights(): Promise<string> {
  return JSON.stringify({ formatVersion: HIGHLIGHT_FORMAT_VERSION, exportedAt: Date.now(), highlights: await readAll() }, null, 2);
}

/** 导入合并：键 = path + exact + decorations；重复跳过、不覆盖本地已有；新记录入队并清墓碑。 */
export function importHighlights(json: string): Promise<{ imported: number; skipped: number }> {
  return serialize(async () => {
    const parsed = JSON.parse(json) as { formatVersion?: unknown; highlights?: unknown };
    if (parsed?.formatVersion !== HIGHLIGHT_FORMAT_VERSION) throw new Error('不支持的格式版本');
    const incoming = sanitizeHighlights(parsed.highlights);
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeHighlights(await kv.get(HIGHLIGHTS_KEY));
    let imported = 0; let skipped = 0;
    const key = (p: string, r: HighlightRecord) => `${p}\u0000${r.exact}\u0000${JSON.stringify(r.decorations)}`;
    for (const [path, list] of Object.entries(incoming)) {
      const existing = new Set((all[path] ?? []).map((r) => key(path, r)));
      for (const r of list) {
        if (existing.has(key(path, r))) { skipped += 1; continue; }
        existing.add(key(path, r));
        all[path] = [...(all[path] ?? []), r];
        await clearTombstoneTx(tx, COLLECTIONS.highlights, r.id);
        enqueueChange(tx, {
          collection: COLLECTIONS.highlights, recordId: r.id, updatedAt: r.createdAt, deleted: false,
        });
        imported += 1;
      }
    }
    await kv.put(all, HIGHLIGHTS_KEY);
    await commitWithNotify(tx);
    return { imported, skipped };
  });
}
