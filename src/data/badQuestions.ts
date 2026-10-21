/**
 * 坏题标记：题库文件里存在、但题干/答案本身不可用的题。
 * 按 qid（题干内容哈希）标记，只影响抽题与统计，不删除题库或既有训练进度。
 */
import type { IDBPTransaction } from 'idb';
import { kvGet, openDb } from './db';
import { serialize } from './serialize';
import { nextUpdatedAt } from '../sync/device';
import { commitWithNotify, enqueueChange } from '../sync/outbox';
import { clearTombstoneTx, putTombstone } from '../sync/tombstones';
import { COLLECTIONS } from '../sync/collections/names';

export interface BadQuestion {
  qid: string;
  bankPath: string;
  id: string;
  markedAt: number;
}

export type BadQuestionMap = Record<string, BadQuestion>;

/** 当前仓库库内的 KV 键；值为 BadQuestionMap。 */
export const BAD_QUESTIONS_KEY = 'memBadQuestions';

type BadTx = IDBPTransaction<any, any, 'readwrite'>;

export function sanitizeBadQuestion(raw: unknown): BadQuestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const qid = typeof r.qid === 'string' ? r.qid.trim() : '';
  const bankPath = typeof r.bankPath === 'string' ? r.bankPath.trim() : '';
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const markedAt = typeof r.markedAt === 'number' && Number.isFinite(r.markedAt) ? r.markedAt : 0;
  if (!qid || !bankPath || !id || markedAt <= 0) return null;
  return { qid, bankPath, id, markedAt };
}

export function sanitizeBadQuestionMap(raw: unknown): BadQuestionMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: BadQuestionMap = {};
  for (const item of Object.values(raw as Record<string, unknown>)) {
    const record = sanitizeBadQuestion(item);
    if (record) out[record.qid] = record;
  }
  return out;
}

async function readMap(): Promise<BadQuestionMap> {
  return sanitizeBadQuestionMap(await kvGet(BAD_QUESTIONS_KEY));
}

/** 已标记坏题（qid → 记录），供界面与队列使用。 */
export async function loadBadQuestionMap(): Promise<Map<string, BadQuestion>> {
  return new Map(Object.entries(await readMap()));
}

/** 导出用：按题库路径 / 题号稳定排序。 */
export async function listBadQuestions(): Promise<BadQuestion[]> {
  return Object.values(await readMap())
    .sort((a, b) => a.bankPath.localeCompare(b.bankPath) || a.id.localeCompare(b.id));
}

/** 标记一道坏题；重复标记只刷新时间戳。 */
export function markBadQuestion(input: Pick<BadQuestion, 'qid' | 'bankPath' | 'id'>): Promise<BadQuestion> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const store = tx.objectStore('kv');
    const map = sanitizeBadQuestionMap(await store.get(BAD_QUESTIONS_KEY));
    const markedAt = nextUpdatedAt(Date.now(), map[input.qid]?.markedAt ?? 0);
    const record: BadQuestion = { ...input, markedAt };
    map[record.qid] = record;
    await store.put(map, BAD_QUESTIONS_KEY);
    await clearTombstoneTx(tx, COLLECTIONS.memoryBadQuestions, record.qid);
    enqueueChange(tx, {
      collection: COLLECTIONS.memoryBadQuestions, recordId: record.qid, updatedAt: markedAt, deleted: false,
    });
    await commitWithNotify(tx);
    return record;
  });
}

/** 撤销标记；返回是否确实删掉了一条记录。 */
export function unmarkBadQuestion(qid: string): Promise<boolean> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const store = tx.objectStore('kv');
    const map = sanitizeBadQuestionMap(await store.get(BAD_QUESTIONS_KEY));
    const prev = map[qid];
    if (!prev) { await tx.done; return false; }
    delete map[qid];
    await store.put(map, BAD_QUESTIONS_KEY);
    const at = nextUpdatedAt(Date.now(), prev.markedAt);
    await putTombstone(tx, COLLECTIONS.memoryBadQuestions, qid, at);
    enqueueChange(tx, {
      collection: COLLECTIONS.memoryBadQuestions, recordId: qid, updatedAt: at, deleted: true,
    });
    await commitWithNotify(tx);
    return true;
  });
}

/** 导入合并：只写入更新的记录；在调用方事务内执行（需要 kv + sync_outbox）。 */
export async function mergeBadQuestionsTx(tx: BadTx, raw: unknown): Promise<number> {
  if (!Array.isArray(raw)) return 0;
  const store = tx.objectStore('kv');
  const map = sanitizeBadQuestionMap(await store.get(BAD_QUESTIONS_KEY));
  let changed = 0;
  for (const item of raw) {
    const record = sanitizeBadQuestion(item);
    if (!record) continue;
    const current = map[record.qid];
    if (current && current.markedAt >= record.markedAt) continue;
    map[record.qid] = record;
    await clearTombstoneTx(tx, COLLECTIONS.memoryBadQuestions, record.qid);
    enqueueChange(tx, {
      collection: COLLECTIONS.memoryBadQuestions, recordId: record.qid, updatedAt: record.markedAt, deleted: false,
    });
    changed += 1;
  }
  if (changed) await store.put(map, BAD_QUESTIONS_KEY);
  return changed;
}
