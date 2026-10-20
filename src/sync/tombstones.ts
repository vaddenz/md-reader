import type { IDBPTransaction } from 'idb';
import type { RepoDb } from './repoDb';

/**
 * 本地墓碑：记录「本机确认删除」的时间，防止删除后又被远端陈旧 upsert 复活。
 * kv.syncTombstones = Record<collection, Record<recordId, deletedAt>>。
 * 墓碑只在本地删除/远端删除时写入，本地重新编辑时清除。
 */
export type TombstoneMap = Record<string, Record<string, number>>;

const KEY = 'syncTombstones';

// 与 outbox 一致：idb 的 schema 泛型跨模块很难精确匹配，这里只约束用到的 kv 操作。
type TombstoneTx = IDBPTransaction<any, any, 'readwrite'>;

function sanitizeTombstones(raw: unknown): TombstoneMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: TombstoneMap = {};
  for (const [collection, records] of Object.entries(raw as Record<string, unknown>)) {
    if (!collection || !records || typeof records !== 'object' || Array.isArray(records)) continue;
    const map: Record<string, number> = {};
    for (const [recordId, at] of Object.entries(records as Record<string, unknown>)) {
      if (!recordId || typeof at !== 'number' || !Number.isFinite(at)) continue;
      map[recordId] = at;
    }
    if (Object.keys(map).length > 0) out[collection] = map;
  }
  return out;
}

export async function readTombstones(db: RepoDb): Promise<TombstoneMap> {
  return sanitizeTombstones(await db.kvGet<unknown>(KEY));
}

export async function tombstoneAt(db: RepoDb, collection: string, recordId: string): Promise<number | undefined> {
  return (await readTombstones(db))[collection]?.[recordId];
}

/** 在已包含 kv 的读写事务中写入墓碑（与数据/outbox 同事务）。 */
export async function putTombstone(
  tx: TombstoneTx,
  collection: string,
  recordId: string,
  at: number,
): Promise<void> {
  const store = tx.objectStore('kv');
  const all = sanitizeTombstones(await store.get(KEY));
  all[collection] = { ...(all[collection] ?? {}), [recordId]: at };
  await store.put(all, KEY);
}

/** 在已包含 kv 的读写事务中清除墓碑（本地重新编辑时使用）。 */
export async function clearTombstoneTx(
  tx: TombstoneTx,
  collection: string,
  recordId: string,
): Promise<void> {
  const store = tx.objectStore('kv');
  const all = sanitizeTombstones(await store.get(KEY));
  const records = all[collection];
  if (!records || !(recordId in records)) return;
  delete records[recordId];
  if (Object.keys(records).length === 0) delete all[collection];
  await store.put(all, KEY);
}

/** 独立事务版本：非当前仓库 / 测试用。 */
export async function setTombstone(
  db: RepoDb,
  collection: string,
  recordId: string,
  at: number,
): Promise<void> {
  const tx = db.db.transaction('kv', 'readwrite');
  await putTombstone(tx, collection, recordId, at);
  await tx.done;
}

export async function clearTombstone(db: RepoDb, collection: string, recordId: string): Promise<void> {
  const tx = db.db.transaction('kv', 'readwrite');
  await clearTombstoneTx(tx, collection, recordId);
  await tx.done;
}
