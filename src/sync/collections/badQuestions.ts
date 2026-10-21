import { BAD_QUESTIONS_KEY, sanitizeBadQuestion, sanitizeBadQuestionMap } from '../../data/badQuestions';
import { remoteWins } from '../merge';
import { clearTombstone, setTombstone, tombstoneAt } from '../tombstones';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

export const badQuestionsCollection: SyncCollection = {
  name: COLLECTIONS.memoryBadQuestions,
  label: '坏题标记',
  async listLocal(db) {
    const map = sanitizeBadQuestionMap(await db.kvGet(BAD_QUESTIONS_KEY));
    return Object.values(map).map((record) => ({
      recordId: record.qid, updatedAt: record.markedAt, deleted: false, payload: record,
    }));
  },
  async getLocal(db, recordId) {
    const record = sanitizeBadQuestionMap(await db.kvGet(BAD_QUESTIONS_KEY))[recordId];
    return record ? { recordId, updatedAt: record.markedAt, deleted: false, payload: record } : undefined;
  },
  async applyRemote(db, record) {
    // 本地墓碑优先：与墓碑同时或更旧的远端记录不能复活已撤销的标记。
    const deletedAt = await tombstoneAt(db, COLLECTIONS.memoryBadQuestions, record.recordId);
    if (deletedAt !== undefined && record.updatedAt <= deletedAt) return false;
    const map = sanitizeBadQuestionMap(await db.kvGet(BAD_QUESTIONS_KEY));
    const current = map[record.recordId];
    if (!remoteWins(record.updatedAt, current?.markedAt)) return false;
    if (record.deleted) {
      if (current) {
        delete map[record.recordId];
        await db.kvSet(BAD_QUESTIONS_KEY, map);
      }
      if (deletedAt === undefined || record.updatedAt > deletedAt) {
        await setTombstone(db, COLLECTIONS.memoryBadQuestions, record.recordId, record.updatedAt);
      }
      return Boolean(current);
    }
    const incoming = sanitizeBadQuestion(record.payload);
    if (!incoming || incoming.qid !== record.recordId) return false;
    map[incoming.qid] = incoming;
    await db.kvSet(BAD_QUESTIONS_KEY, map);
    if (deletedAt !== undefined) await clearTombstone(db, COLLECTIONS.memoryBadQuestions, record.recordId);
    return true;
  },
  async clearBefore(db, before) {
    const map = sanitizeBadQuestionMap(await db.kvGet(BAD_QUESTIONS_KEY));
    let changed = false;
    for (const [qid, record] of Object.entries(map)) {
      if (record.markedAt <= before) {
        delete map[qid];
        changed = true;
      }
    }
    if (changed) await db.kvSet(BAD_QUESTIONS_KEY, map);
  },
};
