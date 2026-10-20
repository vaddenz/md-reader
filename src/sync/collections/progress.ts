import { sanitizeProgress } from '../../data/prefs';
import { remoteWins } from '../merge';
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
    const map = sanitizeProgress(await db.kvGet(KEY));
    const current = map[record.recordId];
    if (!remoteWins(record.updatedAt, current?.updatedAt)) return false;
    if (record.deleted) {
      if (!current) return false;
      delete map[record.recordId];
      await db.kvSet(KEY, map);
      return true;
    }
    const incoming = sanitizeProgress({ [record.recordId]: record.payload })[record.recordId];
    if (!incoming) return false;
    map[record.recordId] = incoming;
    await db.kvSet(KEY, map);
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
