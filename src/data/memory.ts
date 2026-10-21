/**
 * 记忆训练数据层：选择配置 / 模型配置（kv）、进度（mem_srs）、记录（mem_attempts）、
 * 会话（kv memSession）、统计、导出/导入。数据只存本机。
 */
import { kvGet, kvSet, openDb } from './db';
import { serialize } from './serialize';
import { addDays, dayStart, isMastered, MAX_STAGE, type SrsState, type Verdict } from '../lib/srs';
import { nextUpdatedAt } from '../sync/device';
import { commitWithNotify, enqueueChange } from '../sync/outbox';
import { clearTombstoneTx } from '../sync/tombstones';
import { COLLECTIONS, RESET_RECORD_ID } from '../sync/collections/names';

/** 推理强度：与 OpenCode / OpenAI 兼容接口的 `reasoning_effort` 对齐。 */
export type LlmReasoningEffort = 'low' | 'high' | 'max';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 可选：不填则由服务端决定（多数模型默认开启思考）。 */
  reasoningEffort?: LlmReasoningEffort;
}

export interface MemoryFilters {
  kinds: string[];
  chapters: string[];
  types: string[];
  tags: string[];
  difficulty: string[];
}

export interface MemorySelection {
  banks: string[];
  filters: MemoryFilters;
  /** 0 = 不限。 */
  sessionSize: number;
  newPerDay: number;
  /** 题库/筛选的同步版本；仅 banks/filters 变化时刷新，训练设置变化不刷新。 */
  updatedAt?: number;
}

export const SESSION_SIZE_CHOICES = [0, 10, 20, 50];

export const DEFAULT_SELECTION: MemorySelection = {
  banks: [],
  filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] },
  sessionSize: 20,
  newPerDay: 10,
};

export interface MemoryAttempt {
  id?: number;
  qid: string;
  bankPath: string;
  idLabel: string;
  ts: number;
  mode: 'ai' | 'self' | 'choice';
  score: number | null;
  verdict: Verdict;
  answer: string;
  hit: string[];
  missed: string[];
  picked?: string[];
  correct?: string[];
  comment: string;
  durationMs: number;
  hintUsed: boolean;
  revealed: boolean;
}

export interface MemorySession {
  createdAt: number;
  items: { qid: string; bankPath: string; id: string }[];
  index: number;
  answered: number;
  scores: number[];
  startedAt: number;
}

export interface MemoryStats {
  practiced: number;
  mastered: number;
  avgAiScore: number | null;
  /** 近 7 天（含今日，本地日界起算）AI 评分均分；无记录为 null。 */
  avgAiScore7d: number | null;
  verdictCounts: Record<Verdict, number>;
  streak: number;
  practicedToday: number;
  dueToday: number;
  due3: number;
  due7: number;
  trend: { day: number; count: number; avgScore: number | null }[];
}

const SELECTION_KEY = 'memSelection';
const LLM_KEY = 'llmConfig';
const SESSION_KEY = 'memSession';
/** 跨仓库共享的记忆设置：训练题量/每日新题、AI 模型。bank/filter 仍按仓库库存储。 */
const GLOBAL_TRAINING_KEY = 'mdreader.memoryTraining';
const GLOBAL_LLM_KEY = 'mdreader.llmConfig';
const VERDICTS: Verdict[] = ['excellent', 'good', 'hard', 'again'];
const MODES: MemoryAttempt['mode'][] = ['ai', 'self', 'choice'];

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) if (typeof item === 'string' && item.trim()) out.push(item.trim());
  return out;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readGlobalJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeGlobalJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage 不可用时退化为按仓库库存储
  }
}

function readGlobalTraining(): Pick<MemorySelection, 'sessionSize' | 'newPerDay'> | null {
  const raw = readGlobalJson(GLOBAL_TRAINING_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const size = num(r.sessionSize, DEFAULT_SELECTION.sessionSize);
  return {
    sessionSize: SESSION_SIZE_CHOICES.includes(size) ? size : DEFAULT_SELECTION.sessionSize,
    newPerDay: Math.min(50, Math.max(0, Math.round(num(r.newPerDay, DEFAULT_SELECTION.newPerDay)))),
  };
}

/** 记录去重键（导入合并与列表展开共用）：同题、同毫秒、同形态视为同一条。 */
export function attemptKey(a: Pick<MemoryAttempt, 'qid' | 'ts' | 'mode'>): string {
  return `${a.qid}|${a.ts}|${a.mode}`;
}

export function sanitizeSelection(raw: unknown): MemorySelection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SELECTION, filters: { ...DEFAULT_SELECTION.filters } };
  const r = raw as Record<string, unknown>;
  const f = (r.filters && typeof r.filters === 'object' && !Array.isArray(r.filters)) ? r.filters as Record<string, unknown> : {};
  const rawSize = num(r.sessionSize, DEFAULT_SELECTION.sessionSize);
  const sessionSize = SESSION_SIZE_CHOICES.includes(rawSize) ? rawSize : DEFAULT_SELECTION.sessionSize;
  const newPerDay = Math.min(50, Math.max(0, Math.round(num(r.newPerDay, 10))));
  return {
    banks: strArray(r.banks),
    filters: {
      kinds: strArray(f.kinds).filter((k) => ['qa', 'single', 'multiple'].includes(k)),
      chapters: strArray(f.chapters),
      types: strArray(f.types),
      tags: strArray(f.tags),
      difficulty: strArray(f.difficulty),
    },
    sessionSize,
    newPerDay,
    ...(typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? { updatedAt: r.updatedAt } : {}),
  };
}

export async function getSelection(): Promise<MemorySelection> {
  const sel = sanitizeSelection(await kvGet(SELECTION_KEY));
  const global = readGlobalTraining();
  if (global) return { ...sel, ...global };
  // 旧版按仓库存储：首次读取时把题量/每日新题提升为全局。
  writeGlobalJson(GLOBAL_TRAINING_KEY, { sessionSize: sel.sessionSize, newPerDay: sel.newPerDay });
  return sel;
}

export function saveSelection(sel: MemorySelection): Promise<void> {
  const clean = sanitizeSelection(sel);
  return serialize(async () => {
    writeGlobalJson(GLOBAL_TRAINING_KEY, { sessionSize: clean.sessionSize, newPerDay: clean.newPerDay });
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const prev = sanitizeSelection(await kv.get(SELECTION_KEY));
    // 训练设置（sessionSize/newPerDay）跨仓库共享但不参与同步：只有题库/筛选变化才刷新版本。
    const changed = JSON.stringify(prev.banks) !== JSON.stringify(clean.banks)
      || JSON.stringify(prev.filters) !== JSON.stringify(clean.filters);
    const updatedAt = changed ? nextUpdatedAt(Date.now(), prev.updatedAt ?? 0) : prev.updatedAt;
    const next: MemorySelection = { ...clean, ...(updatedAt !== undefined ? { updatedAt } : {}) };
    await kv.put(next, SELECTION_KEY);
    if (changed) {
      enqueueChange(tx, {
        collection: COLLECTIONS.memorySelection, recordId: 'selection',
        updatedAt: updatedAt ?? nextUpdatedAt(), deleted: false,
      });
    }
    await commitWithNotify(tx);
  });
}

const REASONING_EFFORTS: LlmReasoningEffort[] = ['low', 'high', 'max'];

export function sanitizeLlmConfig(raw: unknown): LlmConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : '';
  const model = typeof r.model === 'string' ? r.model.trim() : '';
  if (!baseUrl || !apiKey || !model) return undefined;
  const effort = r.reasoningEffort;
  const reasoningEffort = REASONING_EFFORTS.find((v) => v === effort);
  return reasoningEffort ? { baseUrl, apiKey, model, reasoningEffort } : { baseUrl, apiKey, model };
}

export async function getLlmConfig(): Promise<LlmConfig | undefined> {
  const global = readGlobalJson(GLOBAL_LLM_KEY);
  if (global !== undefined) {
    const clean = sanitizeLlmConfig(global);
    if (clean) return clean;
  }
  try {
    const stored = await kvGet(LLM_KEY);
    const clean = sanitizeLlmConfig(stored);
    // 旧版模型配置存在仓库库中：首次读取时提升为全局，切换仓库后无需重填 Key。
    if (clean) writeGlobalJson(GLOBAL_LLM_KEY, clean);
    return clean;
  } catch {
    return undefined;
  }
}

export function saveLlmConfig(cfg: LlmConfig): Promise<void> {
  const clean: LlmConfig = {
    baseUrl: cfg.baseUrl.trim(),
    apiKey: cfg.apiKey.trim(),
    model: cfg.model.trim(),
    ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}),
  };
  writeGlobalJson(GLOBAL_LLM_KEY, clean);
  return serialize(() => kvSet(LLM_KEY, clean));
}

/** 危险区清除全局记忆设置（训练偏好与模型配置）；仓库库内的选择/记录由清库流程处理。 */
export function clearGlobalMemorySettings(): void {
  try {
    globalThis.localStorage?.removeItem(GLOBAL_TRAINING_KEY);
    globalThis.localStorage?.removeItem(GLOBAL_LLM_KEY);
  } catch {
    // 忽略
  }
}

export function sanitizeSrs(raw: unknown): SrsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.qid !== 'string' || !r.qid) return null;
  if (typeof r.bankPath !== 'string' || typeof r.id !== 'string') return null;
  const verdict = VERDICTS.includes(r.verdict as Verdict) ? (r.verdict as Verdict) : 'again';
  const stage = Math.min(MAX_STAGE, Math.max(0, Math.round(num(r.stage, 0))));
  const lastAt = num(r.lastAt, 0);
  return {
    qid: r.qid,
    bankPath: r.bankPath,
    id: r.id,
    stage,
    dueAt: num(r.dueAt, 0),
    lastAt,
    firstAt: num(r.firstAt, lastAt),
    lastScore: typeof r.lastScore === 'number' && Number.isFinite(r.lastScore) ? r.lastScore : null,
    verdict,
    reps: Math.max(0, Math.round(num(r.reps, 0))),
    lapses: Math.max(0, Math.round(num(r.lapses, 0))),
  };
}

export function sanitizeAttempt(raw: unknown): MemoryAttempt | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.qid !== 'string' || !r.qid) return null;
  if (typeof r.bankPath !== 'string') return null;
  const mode = MODES.includes(r.mode as MemoryAttempt['mode']) ? (r.mode as MemoryAttempt['mode']) : 'ai';
  const verdict = VERDICTS.includes(r.verdict as Verdict) ? (r.verdict as Verdict) : 'again';
  return {
    ...(typeof r.id === 'number' ? { id: r.id } : {}),
    qid: r.qid,
    bankPath: r.bankPath,
    idLabel: typeof r.idLabel === 'string' ? r.idLabel : '',
    ts: num(r.ts, 0),
    mode,
    score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null,
    verdict,
    answer: typeof r.answer === 'string' ? r.answer : '',
    hit: strArray(r.hit),
    missed: strArray(r.missed),
    ...(Array.isArray(r.picked) ? { picked: strArray(r.picked) } : {}),
    ...(Array.isArray(r.correct) ? { correct: strArray(r.correct) } : {}),
    comment: typeof r.comment === 'string' ? r.comment : '',
    durationMs: Math.max(0, Math.round(num(r.durationMs, 0))),
    hintUsed: r.hintUsed === true,
    revealed: r.revealed === true,
  };
}

export async function loadSrsMap(): Promise<Map<string, SrsState>> {
  const all = (await (await openDb()).getAll('mem_srs')) as unknown[];
  const map = new Map<string, SrsState>();
  for (const item of all) {
    const s = sanitizeSrs(item);
    if (s) map.set(s.qid, s);
  }
  return map;
}

export async function putSrs(state: SrsState): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'sync_outbox'], 'readwrite');
  await tx.objectStore('mem_srs').put(state, state.qid);
  enqueueChange(tx, {
    collection: COLLECTIONS.memorySrs, recordId: state.qid, updatedAt: state.lastAt, deleted: false,
  });
  await commitWithNotify(tx);
}

export async function appendAttempt(a: Omit<MemoryAttempt, 'id'>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['mem_attempts', 'sync_outbox'], 'readwrite');
  await tx.objectStore('mem_attempts').add(a);
  enqueueChange(tx, {
    collection: COLLECTIONS.memoryAttempts, recordId: attemptKey(a), updatedAt: a.ts, deleted: false,
  });
  await commitWithNotify(tx);
}

export async function listAttempts(opts: { limit?: number; bankPath?: string } = {}): Promise<MemoryAttempt[]> {
  let all = ((await (await openDb()).getAll('mem_attempts')) as unknown[])
    .map(sanitizeAttempt)
    .filter((a): a is MemoryAttempt => a !== null);
  if (opts.bankPath) all = all.filter((a) => a.bankPath === opts.bankPath);
  all.sort((a, b) => b.ts - a.ts || (b.id ?? 0) - (a.id ?? 0));
  return opts.limit ? all.slice(0, opts.limit) : all;
}

export async function getSession(): Promise<MemorySession | undefined> {
  const raw = await kvGet<MemorySession>(SESSION_KEY);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return undefined;
  return raw;
}

export function saveSession(s: MemorySession): Promise<void> {
  return serialize(() => kvSet(SESSION_KEY, s));
}

export async function clearSession(): Promise<void> {
  await (await openDb()).delete('kv', SESSION_KEY);
}

/** 清除训练进度与记录、会话；保留题库缓存、模型配置与范围选择。 */
export async function clearTrainingData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'mem_attempts', 'kv', 'sync_outbox'], 'readwrite');
  const srsStore = tx.objectStore('mem_srs');
  const attStore = tx.objectStore('mem_attempts');
  const kv = tx.objectStore('kv');
  const [srsRows, attRows] = await Promise.all([srsStore.getAll(), attStore.getAll()]);
  let maxTs = 0;
  for (const row of srsRows as SrsState[]) maxTs = Math.max(maxTs, row.lastAt);
  for (const row of attRows as MemoryAttempt[]) maxTs = Math.max(maxTs, row.ts);
  await srsStore.clear();
  await attStore.clear();
  await kv.delete(SESSION_KEY);

  const before = nextUpdatedAt(Date.now(), maxTs);
  // 同一个事务里清掉旧的训练 outbox，避免残留条目在 reset 之后继续推送。
  const outboxStore = tx.objectStore('sync_outbox');
  const oldEntries = await outboxStore.getAll() as { id: string; collection: string; recordId: string; updatedAt: number }[];
  for (const entry of oldEntries) {
    const isMemory = entry.collection === COLLECTIONS.memorySrs || entry.collection === COLLECTIONS.memoryAttempts;
    if (isMemory && entry.recordId !== RESET_RECORD_ID && entry.updatedAt <= before) {
      await outboxStore.delete(entry.id);
    }
  }

  const reset = await kv.get('syncReset');
  const map = reset && typeof reset === 'object' ? { ...(reset as Record<string, number>) } : {};
  for (const collection of [COLLECTIONS.memorySrs, COLLECTIONS.memoryAttempts]) {
    map[collection] = Math.max(map[collection] ?? 0, before);
    enqueueChange(tx, {
      collection, recordId: RESET_RECORD_ID, updatedAt: before, deleted: true, payload: { before },
    });
  }
  await kv.put(map, 'syncReset');
  await commitWithNotify(tx);
}

export async function exportMemory(): Promise<string> {
  const db = await openDb();
  const [srs, attempts] = await Promise.all([db.getAll('mem_srs'), db.getAll('mem_attempts')]);
  return JSON.stringify({ app: 'md-reader', kind: 'memory', version: 1, exportedAt: Date.now(), srs, attempts }, null, 2);
}

export async function importMemory(json: string): Promise<{ srs: number; attempts: number }> {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('文件不是合法 JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data as { kind?: unknown }).kind !== 'memory') {
    throw new Error('不是记忆训练数据文件');
  }
  const rawSrs = Array.isArray((data as { srs?: unknown }).srs) ? (data as { srs: unknown[] }).srs : [];
  const rawAttempts = Array.isArray((data as { attempts?: unknown }).attempts) ? (data as { attempts: unknown[] }).attempts : [];

  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'mem_attempts', 'kv', 'sync_outbox'], 'readwrite');
  const srsStore = tx.objectStore('mem_srs');
  const attStore = tx.objectStore('mem_attempts');
  let srsImported = 0;
  let attemptsImported = 0;

  const existingSrs = new Map(((await srsStore.getAll()) as SrsState[]).map((s) => [s.qid, s]));
  for (const item of rawSrs) {
    const s = sanitizeSrs(item);
    if (!s) continue;
    const cur = existingSrs.get(s.qid);
    if (cur && cur.lastAt >= s.lastAt) continue;
    await srsStore.put(s, s.qid);
    await clearTombstoneTx(tx, COLLECTIONS.memorySrs, s.qid);
    enqueueChange(tx, { collection: COLLECTIONS.memorySrs, recordId: s.qid, updatedAt: s.lastAt, deleted: false });
    srsImported += 1;
  }

  const existingKeys = new Set(((await attStore.getAll()) as MemoryAttempt[]).map(attemptKey));
  for (const item of rawAttempts) {
    const a = sanitizeAttempt(item);
    if (!a) continue;
    const key = attemptKey(a);
    if (existingKeys.has(key)) continue;
    const { id: _ignored, ...rest } = a;
    await attStore.add(rest);
    await clearTombstoneTx(tx, COLLECTIONS.memoryAttempts, key);
    enqueueChange(tx, { collection: COLLECTIONS.memoryAttempts, recordId: key, updatedAt: a.ts, deleted: false });
    existingKeys.add(key);
    attemptsImported += 1;
  }
  await commitWithNotify(tx);
  return { srs: srsImported, attempts: attemptsImported };
}

/** AI 评分记录的分值（非 AI 或无分数返回 null），供均分/趋势统一口径。 */
function aiScore(a: MemoryAttempt): number | null {
  return a.mode === 'ai' && typeof a.score === 'number' ? a.score : null;
}

function mean1(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null;
}

export function summarize(attempts: MemoryAttempt[], srs: SrsState[], now: number = Date.now()): MemoryStats {
  const verdictCounts: Record<Verdict, number> = { excellent: 0, good: 0, hard: 0, again: 0 };
  for (const a of attempts) verdictCounts[a.verdict] += 1;

  const aiScores = attempts.map(aiScore).filter((v): v is number => v !== null);
  const avgAiScore = mean1(aiScores);
  const sevenDaysAgo = addDays(dayStart(now), -6);
  const avgAiScore7d = mean1(attempts.filter((a) => a.ts >= sevenDaysAgo).map(aiScore).filter((v): v is number => v !== null));

  const today = dayStart(now);
  const practicedToday = attempts.filter((a) => a.ts >= today).length;

  const days = new Set(attempts.map((a) => dayStart(a.ts)));
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  let dueToday = 0;
  let due3 = 0;
  let due7 = 0;
  const in3 = addDays(today, 3);
  const in7 = addDays(today, 7);
  for (const s of srs) {
    if (s.dueAt <= now) dueToday += 1;
    if (s.dueAt <= in3) due3 += 1;
    if (s.dueAt <= in7) due7 += 1;
  }

  const trend: MemoryStats['trend'] = [];
  for (let i = 13; i >= 0; i--) {
    const from = addDays(today, -i);
    const to = addDays(from, 1);
    const inDay = attempts.filter((a) => a.ts >= from && a.ts < to);
    const ai = inDay.map(aiScore).filter((v): v is number => v !== null);
    trend.push({
      day: from,
      count: inDay.length,
      avgScore: ai.length ? Math.round(ai.reduce((s, v) => s + v, 0) / ai.length) : null,
    });
  }

  return {
    practiced: new Set(attempts.map((a) => a.qid)).size,
    mastered: srs.filter(isMastered).length,
    avgAiScore,
    avgAiScore7d,
    verdictCounts,
    streak,
    practicedToday,
    dueToday,
    due3,
    due7,
    trend,
  };
}
