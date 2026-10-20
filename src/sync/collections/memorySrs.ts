import { sanitizeSrs } from '../../data/memory';
import type { SrsState } from '../../lib/srs';
import { remoteWins } from '../merge';
import { clearTombstone, setTombstone, tombstoneAt } from '../tombstones';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const STORE = 'mem_srs';

export const memorySrsCollection: SyncCollection = {
  name: COLLECTIONS.memorySrs,
  label: '记忆复习进度',
  async listLocal(db) {
    const rows = (await db.getAll(STORE)).map(sanitizeSrs).filter((s): s is SrsState => s !== null);
    return rows.map((s) => ({ recordId: s.qid, updatedAt: s.lastAt, deleted: false, payload: s }));
  },
  async getLocal(db, recordId) {
    const s = sanitizeSrs(await db.get(STORE, recordId));
    return s ? { recordId, updatedAt: s.lastAt, deleted: false, payload: s } : undefined;
  },
  async applyRemote(db, record) {
    // 本地墓碑优先：与墓碑同时或更旧的远端记录不能复活已删除的 SRS。
    const deletedAt = await tombstoneAt(db, COLLECTIONS.memorySrs, record.recordId);
    if (deletedAt !== undefined && record.updatedAt <= deletedAt) return false;
    const current = sanitizeSrs(await db.get(STORE, record.recordId));
    if (!remoteWins(record.updatedAt, current?.lastAt)) return false;
    if (record.deleted) {
      if (current) await db.del(STORE, record.recordId);
      if (deletedAt === undefined || record.updatedAt > deletedAt) {
        await setTombstone(db, COLLECTIONS.memorySrs, record.recordId, record.updatedAt);
      }
      return Boolean(current);
    }
    const incoming = sanitizeSrs(record.payload);
    if (!incoming || incoming.qid !== record.recordId) return false;
    await db.put(STORE, incoming, incoming.qid);
    if (deletedAt !== undefined) await clearTombstone(db, COLLECTIONS.memorySrs, record.recordId);
    return true;
  },
  async clearBefore(db, before) {
    const rows = (await db.getAll(STORE)).map(sanitizeSrs).filter((s): s is SrsState => s !== null);
    for (const s of rows) if (s.lastAt <= before) await db.del(STORE, s.qid);
  },
};
