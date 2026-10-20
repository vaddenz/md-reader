import { favoritesMapFrom } from '../../data/prefs';
import { remoteWins } from '../merge';
import { clearTombstone, setTombstone, tombstoneAt } from '../tombstones';
import type { RepoDb } from '../repoDb';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const V2 = 'favoritesV2';
const LEGACY = 'favorites';

/** 读取 / 迁移 V2：旧 `favorites` string[] 按顺序映射 addedAt 后删除，避免丢失老数据。 */
async function readMap(db: RepoDb) {
  const v2 = await db.kvGet(V2);
  const map = favoritesMapFrom(v2, v2 === undefined ? await db.kvGet(LEGACY) : undefined);
  if (v2 === undefined) {
    await db.kvSet(V2, map);
    await db.db.delete('kv', LEGACY);
  }
  return map;
}

export const favoritesCollection: SyncCollection = {
  name: COLLECTIONS.favorites,
  label: '收藏',
  async listLocal(db) {
    const map = await readMap(db);
    return Object.entries(map).map(([recordId, rec]) => ({
      recordId, updatedAt: rec.addedAt, deleted: false, payload: rec,
    }));
  },
  async getLocal(db, recordId) {
    const rec = (await readMap(db))[recordId];
    return rec ? { recordId, updatedAt: rec.addedAt, deleted: false, payload: rec } : undefined;
  },
  async applyRemote(db, record) {
    const deletedAt = await tombstoneAt(db, COLLECTIONS.favorites, record.recordId);
    if (deletedAt !== undefined && record.updatedAt <= deletedAt) return false;
    const map = await readMap(db);
    const current = map[record.recordId];
    if (!remoteWins(record.updatedAt, current?.addedAt)) return false;
    if (record.deleted) {
      if (current) {
        delete map[record.recordId];
        await db.kvSet(V2, map);
      }
      if (deletedAt === undefined || record.updatedAt > deletedAt) {
        await setTombstone(db, COLLECTIONS.favorites, record.recordId, record.updatedAt);
      }
      return Boolean(current);
    }
    if (!record.payload || typeof record.payload !== 'object') return false;
    const addedAt = Number((record.payload as { addedAt?: unknown }).addedAt);
    map[record.recordId] = { addedAt: Number.isFinite(addedAt) ? addedAt : record.updatedAt };
    await db.kvSet(V2, map);
    if (deletedAt !== undefined) await clearTombstone(db, COLLECTIONS.favorites, record.recordId);
    return true;
  },
  async clearBefore(db, before) {
    const map = await readMap(db);
    let changed = false;
    for (const [path, rec] of Object.entries(map)) {
      if (rec.addedAt <= before) { delete map[path]; changed = true; }
    }
    if (changed) await db.kvSet(V2, map);
  },
};
