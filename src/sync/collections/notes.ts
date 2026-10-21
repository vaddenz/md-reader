import { sanitizeNotes, type NoteRecord } from '../../data/notes';
import { remoteWins } from '../merge';
import { clearTombstone, setTombstone, tombstoneAt } from '../tombstones';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const KEY = 'notes';

interface Payload { path: string; record: NoteRecord }

function findRecord(map: Record<string, NoteRecord[]>, id: string): { path: string; record: NoteRecord } | undefined {
  for (const [path, list] of Object.entries(map)) {
    const record = list.find((r) => r.id === id);
    if (record) return { path, record };
  }
  return undefined;
}

export const notesCollection: SyncCollection = {
  name: COLLECTIONS.notes,
  label: '笔记',
  async listLocal(db) {
    const map = sanitizeNotes(await db.kvGet(KEY));
    const out = [];
    for (const [path, list] of Object.entries(map)) {
      for (const record of list) {
        out.push({
          recordId: record.id,
          updatedAt: record.updatedAt,
          deleted: false,
          payload: { path, record },
        });
      }
    }
    return out;
  },
  async getLocal(db, recordId) {
    const found = findRecord(sanitizeNotes(await db.kvGet(KEY)), recordId);
    return found
      ? { recordId, updatedAt: found.record.updatedAt, deleted: false, payload: found }
      : undefined;
  },
  async applyRemote(db, record) {
    // 本地墓碑优先：与墓碑同时或更旧的远端记录不能复活已删除的笔记。
    const deletedAt = await tombstoneAt(db, COLLECTIONS.notes, record.recordId);
    if (deletedAt !== undefined && record.updatedAt <= deletedAt) return false;
    const map = sanitizeNotes(await db.kvGet(KEY));
    const found = findRecord(map, record.recordId);
    if (!remoteWins(record.updatedAt, found?.record.updatedAt)) return false;
    if (record.deleted) {
      if (found) {
        map[found.path] = map[found.path].filter((r) => r.id !== record.recordId);
        if (!map[found.path].length) delete map[found.path];
        await db.kvSet(KEY, map);
      }
      if (deletedAt === undefined || record.updatedAt > deletedAt) {
        await setTombstone(db, COLLECTIONS.notes, record.recordId, record.updatedAt);
      }
      return Boolean(found);
    }
    const payload = record.payload as Payload | null;
    if (!payload || typeof payload !== 'object') return false;
    if (typeof payload.path !== 'string' || !payload.path) return false;
    const incoming = sanitizeNotes({ [payload.path]: [payload.record] })[payload.path]?.[0];
    if (!incoming || incoming.id !== record.recordId) return false;
    if (found) {
      map[found.path] = map[found.path].filter((r) => r.id !== record.recordId);
      if (!map[found.path].length) delete map[found.path];
    }
    map[payload.path] = [...(map[payload.path] ?? []), incoming];
    await db.kvSet(KEY, map);
    if (deletedAt !== undefined) await clearTombstone(db, COLLECTIONS.notes, record.recordId);
    return true;
  },
  async clearBefore(db, before) {
    const map = sanitizeNotes(await db.kvGet(KEY));
    let changed = false;
    for (const [path, list] of Object.entries(map)) {
      const rest = list.filter((r) => r.updatedAt > before);
      if (rest.length !== list.length) {
        changed = true;
        if (rest.length) map[path] = rest;
        else delete map[path];
      }
    }
    if (changed) await db.kvSet(KEY, map);
  },
};
