import { sanitizeSelection } from '../../data/memory';
import { remoteWins } from '../merge';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const KEY = 'memSelection';

type Raw = Record<string, unknown> | undefined;

function payloadOf(raw: Raw) {
  const sel = sanitizeSelection(raw ?? {});
  return {
    banks: sel.banks,
    filters: sel.filters,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

export const memorySelectionCollection: SyncCollection = {
  name: COLLECTIONS.memorySelection,
  label: '题库偏好',
  async listLocal(db) {
    const raw = await db.kvGet<Raw>(KEY);
    if (!raw) return [];
    return [{ recordId: 'selection', updatedAt: payloadOf(raw).updatedAt, deleted: false, payload: payloadOf(raw) }];
  },
  async getLocal(db, recordId) {
    if (recordId !== 'selection') return undefined;
    const raw = await db.kvGet<Raw>(KEY);
    return raw ? { recordId, updatedAt: payloadOf(raw).updatedAt, deleted: false, payload: payloadOf(raw) } : undefined;
  },
  async applyRemote(db, record) {
    const raw = await db.kvGet<Raw>(KEY);
    const current = raw ? payloadOf(raw).updatedAt : undefined;
    if (!remoteWins(record.updatedAt, current)) return false;
    if (record.deleted) {
      if (!raw) return false;
      await db.del('kv', KEY);
      return true;
    }
    if (!record.payload || typeof record.payload !== 'object') return false;
    const incoming = sanitizeSelection(record.payload);
    // sessionSize/newPerDay 是跨仓库共享的本地训练设置，远端只能更新题库与筛选。
    const prev = sanitizeSelection(raw ?? {});
    const next = {
      ...prev,
      banks: incoming.banks,
      filters: incoming.filters,
      updatedAt: record.updatedAt,
    };
    await db.kvSet(KEY, next);
    return true;
  },
  async clearBefore(db, before) {
    const raw = await db.kvGet<Raw>(KEY);
    if (raw && payloadOf(raw).updatedAt <= before) await db.del('kv', KEY);
  },
};
