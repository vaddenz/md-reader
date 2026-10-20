import type { IDBPTransaction } from 'idb';
import { RESET_RECORD_ID } from './collections/names';
import type { RepoDb } from './repoDb';
import type { SyncCollection } from './types';

export const OUTBOX_STORE = 'sync_outbox';

export interface OutboxEntry {
  id: string;
  collection: string;
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  rev: string;
  payload?: unknown;
}

export interface OutboxChange {
  collection: string;
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  payload?: unknown;
}

// idb 的 schema 泛型在跨模块时很难精确匹配；这里用宽类型，调用点仍然只操作 sync_outbox。
type OutboxTx = IDBPTransaction<any, any, 'readwrite'>;

function newRev(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fallthrough */ }
  return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function outboxId(collection: string, recordId: string): string {
  return `${collection}\u0000${recordId}`;
}

/** 在已包含 sync_outbox 的读写事务中入队 / 覆盖一条变更。 */
export function enqueueChange(tx: OutboxTx, change: OutboxChange): void {
  const entry: OutboxEntry = {
    id: outboxId(change.collection, change.recordId),
    collection: change.collection,
    recordId: change.recordId,
    updatedAt: change.updatedAt,
    deleted: change.deleted,
    rev: newRev(),
    ...(change.payload !== undefined ? { payload: change.payload } : {}),
  };
  void tx.objectStore(OUTBOX_STORE).put(entry);
}

export async function readOutbox(db: RepoDb): Promise<OutboxEntry[]> {
  return db.getAll<OutboxEntry>(OUTBOX_STORE);
}

export async function countOutbox(db: RepoDb): Promise<number> {
  return (await readOutbox(db)).length;
}

export async function deleteOutboxIfRev(db: RepoDb, id: string, rev: string): Promise<boolean> {
  const tx = db.db.transaction(OUTBOX_STORE, 'readwrite');
  const store = tx.objectStore(OUTBOX_STORE);
  const current = await store.get(id) as OutboxEntry | undefined;
  if (!current || current.rev !== rev) { await tx.done; return false; }
  await store.delete(id);
  await tx.done;
  return true;
}

export async function removeOutboxAtOrBefore(db: RepoDb, collection: string, before: number): Promise<void> {
  const tx = db.db.transaction(OUTBOX_STORE, 'readwrite');
  const store = tx.objectStore(OUTBOX_STORE);
  const all = await store.getAll() as OutboxEntry[];
  for (const entry of all) {
    if (entry.collection !== collection) continue;
    if (entry.recordId === RESET_RECORD_ID) continue;
    if (entry.updatedAt <= before) await store.delete(entry.id);
  }
  await tx.done;
}

export async function seedCollectionOutbox(
  db: RepoDb,
  collection: SyncCollection,
  resetAt: number,
): Promise<void> {
  const records = await collection.listLocal(db);
  const tx = db.db.transaction(OUTBOX_STORE, 'readwrite');
  for (const record of records) {
    // resetAt=0 表示没有 reset；不能把 updatedAt=0 的旧收藏/旧偏好过滤掉。
    if (resetAt > 0 && record.updatedAt <= resetAt) continue;
    enqueueChange(tx, {
      collection: collection.name,
      recordId: record.recordId,
      updatedAt: record.updatedAt,
      deleted: record.deleted,
      // 普通 seed 条目不带 payload：推送时从本地读当前值，避免 seed 后又被编辑时推送旧数据。
    });
  }
  await tx.done;
}
