/**
 * 记忆训练数据层：选择配置 / 模型配置（kv）、进度（mem_srs）、记录（mem_attempts）、
 * 会话（kv memSession）、统计、导出/导入。数据只存本机。
 */
import { kvGet, kvSet, openDb } from './db';
import { serialize } from './serialize';
import { addDays, dayStart, isMastered, MAX_STAGE, type SrsState, type Verdict } from '../lib/srs';

export interface LlmConfig { baseUrl: string; apiKey: string; model: string }

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

export function sanitizeSelection(raw: unknown): MemorySelection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SELECTION, filters: { ...DEFAULT_SELECTION.filters } };
  const r = raw as Record<string, unknown>;
  const f = (r.filters && typeof r.filters === 'object' && !Array.isArray(r.filters)) ? r.filters as Record<string, unknown> : {};
  const sessionSize = SESSION_SIZE_CHOICES.includes(num(r.sessionSize, 20)) ? num(r.sessionSize, 20) : 20;
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
  };
}

export async function getSelection(): Promise<MemorySelection> {
  return sanitizeSelection(await kvGet(SELECTION_KEY));
}

export function saveSelection(sel: MemorySelection): Promise<void> {
  return serialize(() => kvSet(SELECTION_KEY, sanitizeSelection(sel)));
}

export function sanitizeLlmConfig(raw: unknown): LlmConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : '';
  const model = typeof r.model === 'string' ? r.model.trim() : '';
  return baseUrl && apiKey && model ? { baseUrl, apiKey, model } : undefined;
}

export async function getLlmConfig(): Promise<LlmConfig | undefined> {
  return sanitizeLlmConfig(await kvGet(LLM_KEY));
}

export function saveLlmConfig(cfg: LlmConfig): Promise<void> {
  return serialize(() => kvSet(LLM_KEY, { baseUrl: cfg.baseUrl.trim(), apiKey: cfg.apiKey.trim(), model: cfg.model.trim() }));
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
  await (await openDb()).put('mem_srs', state, state.qid);
}

export async function appendAttempt(a: Omit<MemoryAttempt, 'id'>): Promise<void> {
  await (await openDb()).add('mem_attempts', a);
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
  const tx = db.transaction(['mem_srs', 'mem_attempts', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('mem_srs').clear(),
    tx.objectStore('mem_attempts').clear(),
    tx.objectStore('kv').delete(SESSION_KEY),
    tx.done,
  ]);
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
  const tx = db.transaction(['mem_srs', 'mem_attempts'], 'readwrite');
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
    srsImported += 1;
  }

  const existingKeys = new Set(((await attStore.getAll()) as MemoryAttempt[]).map((a) => `${a.qid}|${a.ts}|${a.mode}`));
  for (const item of rawAttempts) {
    const a = sanitizeAttempt(item);
    if (!a) continue;
    const key = `${a.qid}|${a.ts}|${a.mode}`;
    if (existingKeys.has(key)) continue;
    const { id: _ignored, ...rest } = a;
    await attStore.add(rest);
    existingKeys.add(key);
    attemptsImported += 1;
  }
  await tx.done;
  return { srs: srsImported, attempts: attemptsImported };
}

export function summarize(attempts: MemoryAttempt[], srs: SrsState[], now: number = Date.now()): MemoryStats {
  const verdictCounts: Record<Verdict, number> = { excellent: 0, good: 0, hard: 0, again: 0 };
  for (const a of attempts) verdictCounts[a.verdict] += 1;

  const aiScores = attempts.filter((a) => a.mode === 'ai' && typeof a.score === 'number') as (MemoryAttempt & { score: number })[];
  const avgAiScore = aiScores.length
    ? Math.round((aiScores.reduce((s, a) => s + a.score, 0) / aiScores.length) * 10) / 10
    : null;

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
    const ai = inDay.filter((a) => a.mode === 'ai' && typeof a.score === 'number') as (MemoryAttempt & { score: number })[];
    trend.push({
      day: from,
      count: inDay.length,
      avgScore: ai.length ? Math.round(ai.reduce((s, a) => s + a.score, 0) / ai.length) : null,
    });
  }

  return {
    practiced: new Set(attempts.map((a) => a.qid)).size,
    mastered: srs.filter(isMastered).length,
    avgAiScore,
    verdictCounts,
    streak,
    practicedToday,
    dueToday,
    due3,
    due7,
    trend,
  };
}
