import { sanitizeProgress } from '../../data/prefs';
import { remoteWins } from '../merge';
import { clearTombstone, setTombstone, tombstoneAt } from '../tombstones';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const KEY = 'progress';

export const progressCollection: SyncCollection = {
  name: COLLECTIONS.progress,
  label: '阅读进度',
  async listLocal(db) {
    const map = sanitizeProgress(await db.kvGet(KEY));
    return Object.entries(map).map(([recordId, rec]) => ({
      recordId, updatedAt: rec.updatedAt, deleted: false, payload: rec,
    }));
  },
  async getLocal(db, recordId) {
    const rec = sanitizeProgress(await db.kvGet(KEY))[recordId];
    return rec ? { recordId, updatedAt: rec.updatedAt, deleted: false, payload: rec } : undefined;
  },
  async applyRemote(db, record) {
    const deletedAt = await tombstoneAt(db, COLLECTIONS.progress, record.recordId);
    if (deletedAt !== undefined && record.updatedAt <= deletedAt) return false;
    const map = sanitizeProgress(await db.kvGet(KEY));
    const current = map[record.recordId];
    if (!remoteWins(record.updatedAt, current?.updatedAt)) return false;
    if (record.deleted) {
      if (current) {
        delete map[record.recordId];
        await db.kvSet(KEY, map);
      }
      if (deletedAt === undefined || record.updatedAt > deletedAt) {
        await setTombstone(db, COLLECTIONS.progress, record.recordId, record.updatedAt);
      }
      return Boolean(current);
    }
    const incoming = sanitizeProgress({ [record.recordId]: record.payload })[record.recordId];
    if (!incoming) return false;
    map[record.recordId] = incoming;
    await db.kvSet(KEY, map);
    if (deletedAt !== undefined) await clearTombstone(db, COLLECTIONS.progress, record.recordId);
    return true;
  },
  async clearBefore(db, before) {
    const map = sanitizeProgress(await db.kvGet(KEY));
    let changed = false;
    for (const [path, rec] of Object.entries(map)) {
      if (rec.updatedAt <= before) { delete map[path]; changed = true; }
    }
    if (changed) await db.kvSet(KEY, map);
  },
};
