import { kvGet, openDb } from './db';
import { serialize } from './serialize';
import { nextUpdatedAt } from '../sync/device';
import { commitWithNotify, enqueueChange } from '../sync/outbox';
import { clearTombstoneTx, putTombstone } from '../sync/tombstones';
import { COLLECTIONS } from '../sync/collections/names';

/** 笔记锚点：与高亮共用 TextQuote 口径（exact + 前后文），仓库改动后仍能重锚。 */
export interface NoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface NoteRecord extends NoteAnchor {
  id: string;
  /** 笔记正文；保留用户输入的多行纯文本，首尾空白在保存时裁掉。 */
  body: string;
  createdAt: number;
  /** 同步 LWW 时间戳：新增/编辑各更新一次。 */
  updatedAt: number;
}

export type NoteMap = Record<string, NoteRecord[]>;

const NOTES_KEY = 'notes';

function sanitizeRecord(raw: unknown): NoteRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Partial<NoteRecord>;
  if (typeof rec.id !== 'string' || !rec.id) return null;
  if (typeof rec.exact !== 'string' || !rec.exact) return null;
  if (typeof rec.body !== 'string') return null;
  const createdAt = typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt) ? rec.createdAt : 0;
  const updatedAt = typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt)
    ? rec.updatedAt
    : createdAt;
  return {
    id: rec.id,
    exact: rec.exact,
    prefix: typeof rec.prefix === 'string' ? rec.prefix : '',
    suffix: typeof rec.suffix === 'string' ? rec.suffix : '',
    body: rec.body,
    createdAt,
    updatedAt,
  };
}

export function sanitizeNotes(raw: unknown): NoteMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: NoteMap = {};
  for (const [path, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!path || !Array.isArray(list)) continue;
    const records = list.map(sanitizeRecord).filter((r): r is NoteRecord => r !== null);
    if (records.length) out[path] = records;
  }
  return out;
}

async function readAll(): Promise<NoteMap> {
  return sanitizeNotes(await kvGet<unknown>(NOTES_KEY));
}

export async function getNotes(): Promise<NoteMap> {
  return readAll();
}

export async function getDocNotes(path: string): Promise<NoteRecord[]> {
  return (await readAll())[path] ?? [];
}

/** 新增笔记：正文、记录与 outbox 同事务提交，并清掉同 id 的本地墓碑。 */
export function addNote(
  path: string,
  anchor: NoteAnchor,
  body: string,
  now = Date.now(),
): Promise<NoteRecord> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeNotes(await kv.get(NOTES_KEY));
    const at = nextUpdatedAt(now);
    const record: NoteRecord = {
      id: crypto.randomUUID(),
      exact: anchor.exact,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      body: body.trim(),
      createdAt: at,
      updatedAt: at,
    };
    all[path] = [...(all[path] ?? []), record];
    await kv.put(all, NOTES_KEY);
    await clearTombstoneTx(tx, COLLECTIONS.notes, record.id);
    enqueueChange(tx, {
      collection: COLLECTIONS.notes, recordId: record.id, updatedAt: record.updatedAt, deleted: false,
    });
    await commitWithNotify(tx);
    return record;
  });
}

/** 编辑笔记正文；记录不存在时返回 null（例如已被其它设备删除）。 */
export function updateNote(
  path: string,
  id: string,
  body: string,
  now = Date.now(),
): Promise<NoteRecord | null> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeNotes(await kv.get(NOTES_KEY));
    const list = all[path] ?? [];
    const found = list.find((r) => r.id === id);
    if (!found) {
      await tx.done;
      return null;
    }
    const nextBody = body.trim();
    if (nextBody === found.body) {
      await tx.done;
      return found;
    }
    const record: NoteRecord = {
      ...found,
      body: nextBody,
      updatedAt: nextUpdatedAt(now, found.updatedAt),
    };
    all[path] = list.map((r) => (r.id === id ? record : r));
    await kv.put(all, NOTES_KEY);
    await clearTombstoneTx(tx, COLLECTIONS.notes, id);
    enqueueChange(tx, {
      collection: COLLECTIONS.notes, recordId: id, updatedAt: record.updatedAt, deleted: false,
    });
    await commitWithNotify(tx);
    return record;
  });
}

/** 删除笔记：仅对本地实际存在的记录写墓碑并入队 tombstone，时间戳单调递增。 */
export function removeNotes(path: string, ids: string[]): Promise<void> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeNotes(await kv.get(NOTES_KEY));
    const list = all[path] ?? [];
    const found = list.filter((r) => ids.includes(r.id));
    const rest = list.filter((r) => !ids.includes(r.id));
    if (rest.length) all[path] = rest;
    else delete all[path];
    await kv.put(all, NOTES_KEY);
    const now = Date.now();
    for (const rec of found) {
      const at = nextUpdatedAt(now, rec.updatedAt);
      await putTombstone(tx, COLLECTIONS.notes, rec.id, at);
      enqueueChange(tx, {
        collection: COLLECTIONS.notes, recordId: rec.id, updatedAt: at, deleted: true,
      });
    }
    await commitWithNotify(tx);
  });
}
