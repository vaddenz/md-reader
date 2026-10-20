import { attemptKey, sanitizeAttempt, type MemoryAttempt } from '../../data/memory';
import type { RepoDb } from '../repoDb';
import { clearTombstone, setTombstone, tombstoneAt } from '../tombstones';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const STORE = 'mem_attempts';

interface StoredAttempt { key: IDBValidKey; value: MemoryAttempt }

/** mem_attempts 使用自增主键且 key 不在 value 里，删除时必须带上真实主键。 */
async function allWithKeys(db: RepoDb): Promise<StoredAttempt[]> {
  const tx = db.db.transaction(STORE, 'readonly');
  const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  await tx.done;
  const out: StoredAttempt[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = sanitizeAttempt(values[i]);
    if (value) out.push({ key: keys[i], value });
  }
  return out;
}

async function all(db: RepoDb): Promise<MemoryAttempt[]> {
  return (await allWithKeys(db)).map((entry) => entry.value);
}

export const memoryAttemptsCollection: SyncCollection = {
  name: COLLECTIONS.memoryAttempts,
  label: '记忆训练记录',
  async listLocal(db) {
    return (await all(db)).map((a) => {
      const { id: _id, ...payload } = a;
      return { recordId: attemptKey(a), updatedAt: a.ts, deleted: false, payload };
    });
  },
  async getLocal(db, recordId) {
    const found = (await all(db)).find((a) => attemptKey(a) === recordId);
    if (!found) return undefined;
    const { id: _id, ...payload } = found;
    return { recordId, updatedAt: found.ts, deleted: false, payload };
  },
  async applyRemote(db, record) {
    // 本地墓碑优先：与墓碑同时或更旧的远端记录不能复活已删除的训练记录。
    const deletedAt = await tombstoneAt(db, COLLECTIONS.memoryAttempts, record.recordId);
    if (deletedAt !== undefined && record.updatedAt <= deletedAt) return false;
    const found = (await allWithKeys(db)).find((entry) => attemptKey(entry.value) === record.recordId);
    if (record.deleted) {
      if (found) await db.del(STORE, found.key);
      if (deletedAt === undefined || record.updatedAt > deletedAt) {
        await setTombstone(db, COLLECTIONS.memoryAttempts, record.recordId, record.updatedAt);
      }
      return found !== undefined;
    }
    if (found) return false; // 同一稳定键的同一条记录，不覆盖
    const incoming = sanitizeAttempt(record.payload);
    if (!incoming) return false;
    const { id: _id, ...rest } = incoming;
    await db.add(STORE, rest);
    if (deletedAt !== undefined) await clearTombstone(db, COLLECTIONS.memoryAttempts, record.recordId);
    return true;
  },
  async clearBefore(db, before) {
    for (const entry of await allWithKeys(db)) {
      if (entry.value.ts <= before) await db.del(STORE, entry.key);
    }
  },
};
