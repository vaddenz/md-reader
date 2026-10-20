import { sanitizeHighlights, type HighlightRecord } from '../../data/highlights';
import { remoteWins } from '../merge';
import { clearTombstone, setTombstone, tombstoneAt } from '../tombstones';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const KEY = 'highlights';

interface Payload { path: string; record: HighlightRecord }

function findRecord(map: Record<string, HighlightRecord[]>, id: string): { path: string; record: HighlightRecord } | undefined {
  for (const [path, list] of Object.entries(map)) {
    const record = list.find((r) => r.id === id);
    if (record) return { path, record };
  }
  return undefined;
}

export const highlightsCollection: SyncCollection = {
  name: COLLECTIONS.highlights,
  label: '文本高亮',
  async listLocal(db) {
    const map = sanitizeHighlights(await db.kvGet(KEY));
    const out = [];
    for (const [path, list] of Object.entries(map)) {
      for (const record of list) {
        out.push({ recordId: record.id, updatedAt: record.createdAt, deleted: false, payload: { path, record } });
      }
    }
    return out;
  },
  async getLocal(db, recordId) {
    const found = findRecord(sanitizeHighlights(await db.kvGet(KEY)), recordId);
    return found ? { recordId, updatedAt: found.record.createdAt, deleted: false, payload: found } : undefined;
  },
  async applyRemote(db, record) {
    // 本地墓碑优先：与墓碑同时或更旧的远端记录不能复活已删除的高亮。
    const deletedAt = await tombstoneAt(db, COLLECTIONS.highlights, record.recordId);
    if (deletedAt !== undefined && record.updatedAt <= deletedAt) return false;
    const map = sanitizeHighlights(await db.kvGet(KEY));
    const found = findRecord(map, record.recordId);
    if (!remoteWins(record.updatedAt, found?.record.createdAt)) return false;
    if (record.deleted) {
      if (found) {
        map[found.path] = map[found.path].filter((r) => r.id !== record.recordId);
        if (!map[found.path].length) delete map[found.path];
        await db.kvSet(KEY, map);
      }
      if (deletedAt === undefined || record.updatedAt > deletedAt) {
        await setTombstone(db, COLLECTIONS.highlights, record.recordId, record.updatedAt);
      }
      return Boolean(found);
    }
    const payload = record.payload as Payload | null;
    if (!payload || typeof payload !== 'object') return false;
    if (typeof payload.path !== 'string' || !payload.path) return false;
    const incoming = sanitizeHighlights({ [payload.path]: [payload.record] })[payload.path]?.[0];
    if (!incoming || incoming.id !== record.recordId) return false;
    if (found) {
      map[found.path] = map[found.path].filter((r) => r.id !== record.recordId);
      if (!map[found.path].length) delete map[found.path];
    }
    map[payload.path] = [...(map[payload.path] ?? []), incoming];
    await db.kvSet(KEY, map);
    if (deletedAt !== undefined) await clearTombstone(db, COLLECTIONS.highlights, record.recordId);
    return true;
  },
  async clearBefore(db, before) {
    const map = sanitizeHighlights(await db.kvGet(KEY));
    let changed = false;
    for (const [path, list] of Object.entries(map)) {
      const rest = list.filter((r) => r.createdAt > before);
      if (rest.length !== list.length) { changed = true; if (rest.length) map[path] = rest; else delete map[path]; }
    }
    if (changed) await db.kvSet(KEY, map);
  },
};
