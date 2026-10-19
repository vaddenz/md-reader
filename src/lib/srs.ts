/**
 * 艾宾浩斯调度（纯函数、无 IO）。规则见 spec §7：
 * 优秀/良好升一档，勉强保持档位，不会重置；间隔 1/2/4/7/15/30/60 天；到期按本地日界。
 */
import type { BankKind } from './qbank';

export type Verdict = 'excellent' | 'good' | 'hard' | 'again';

export interface SrsState {
  qid: string;
  bankPath: string;
  id: string;
  stage: number;
  dueAt: number;
  lastAt: number;
  firstAt: number;
  lastScore: number | null;
  verdict: Verdict;
  reps: number;
  lapses: number;
}

export const INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60];
export const MAX_STAGE = INTERVALS_DAYS.length - 1;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const VERDICT_LABELS: Record<Verdict, string> = {
  excellent: '优秀', good: '良好', hard: '勉强', again: '不会',
};

/** 本地时区当日 0 点。 */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 按本地日历推进 N 天（返回当日 0 点），避免夏令时/月末误差。 */
export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

export function verdictFromScore(score: number): Verdict {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'hard';
  return 'again';
}

export function verdictFromChoice(kind: 'single' | 'multiple', picked: string[], correct: string[]): Verdict {
  const correctSet = new Set(correct);
  if (kind === 'single') {
    return picked.length === 1 && correctSet.has(picked[0]) ? 'excellent' : 'again';
  }
  const pickedSet = new Set(picked);
  let wrong = false;
  let missed = false;
  for (const k of pickedSet) if (!correctSet.has(k)) wrong = true;
  for (const k of correctSet) if (!pickedSet.has(k)) missed = true;
  if (wrong) return 'again';
  return missed ? 'hard' : 'excellent';
}

export function nextState(
  prev: SrsState | undefined,
  verdict: Verdict,
  now: number,
  meta: { qid: string; bankPath: string; id: string; score: number | null },
): SrsState {
  const prevStage = prev ? Math.min(MAX_STAGE, Math.max(0, prev.stage)) : 0;
  let stage: number;
  let dueAt: number;
  if (verdict === 'excellent' || verdict === 'good') {
    stage = Math.min(prevStage + 1, MAX_STAGE);
    dueAt = addDays(now, INTERVALS_DAYS[stage]);
  } else if (verdict === 'hard') {
    stage = prevStage;
    dueAt = addDays(now, 1);
  } else {
    stage = 0;
    dueAt = addDays(now, 1);
  }
  return {
    qid: meta.qid,
    bankPath: meta.bankPath,
    id: meta.id,
    stage,
    dueAt,
    lastAt: now,
    firstAt: prev ? prev.firstAt : now,
    lastScore: meta.score,
    verdict,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (verdict === 'again' ? 1 : 0),
  };
}

/** 已掌握：档位到顶且最近一次为优秀/良好（选择题与自评无分数，按 verdict 判定）。 */
export function isMastered(s: SrsState): boolean {
  return s.stage >= MAX_STAGE && (s.verdict === 'excellent' || s.verdict === 'good');
}

export interface QueueCandidate {
  qid: string;
  bankPath: string;
  id: string;
  kind: BankKind;
  type: string;
  chapter?: string;
  tags?: string[];
  difficulty?: string;
  followUpOf?: string;
  /** 题库在选择列表中的顺序（0 起）。 */
  bankIndex: number;
  /** 题库内行号。 */
  line: number;
}

export interface QueueFilters {
  kinds: string[];
  chapters: string[];
  types: string[];
  tags: string[];
  difficulty: string[];
}

export interface QueueEntry { qid: string; bankPath: string; id: string }

export interface BuildQueueInput {
  candidates: QueueCandidate[];
  srsByQid: Map<string, SrsState>;
  filters: QueueFilters;
  /** 0 = 不限。 */
  sessionSize: number;
  newPerDay: number;
  newIntroducedToday: number;
  now: number;
}

function matches(c: QueueCandidate, f: QueueFilters): boolean {
  if (f.kinds.length && !f.kinds.includes(c.kind)) return false;
  if (f.chapters.length && !(c.chapter && f.chapters.includes(c.chapter))) return false;
  if (f.types.length && !f.types.includes(c.type)) return false;
  if (f.tags.length && !(c.tags ?? []).some((t) => f.tags.includes(t))) return false;
  if (f.difficulty.length && !(c.difficulty && f.difficulty.includes(c.difficulty))) return false;
  return true;
}

/** 追问链稳定重排：追问移到母题之后（母题不在队列时保持原位）；成环安全。 */
function chainSort(queue: QueueCandidate[]): QueueCandidate[] {
  if (!queue.some((c) => c.followUpOf)) return queue;
  const pos = new Map(queue.map((c, i) => [c.qid, i]));
  const byBankId = new Map(queue.map((c) => [`${c.bankPath}\u0000${c.id}`, c]));
  const keyOf = (c: QueueCandidate): { root: number; depth: number } => {
    let depth = 0;
    let cursor = c;
    const seen = new Set<string>([c.qid]);
    while (cursor.followUpOf) {
      const parent = byBankId.get(`${cursor.bankPath}\u0000${cursor.followUpOf}`);
      if (!parent || seen.has(parent.qid)) break;
      seen.add(parent.qid);
      cursor = parent;
      depth += 1;
    }
    return { root: pos.get(cursor.qid) ?? pos.get(c.qid) ?? 0, depth };
  };
  const decorated = queue.map((c, i) => ({ c, i, key: keyOf(c) }));
  decorated.sort((a, b) => a.key.root - b.key.root || a.key.depth - b.key.depth || a.i - b.i);
  return decorated.map((d) => d.c);
}

export function buildQueue(input: BuildQueueInput): QueueEntry[] {
  const pool = input.candidates.filter((c) => matches(c, input.filters));
  const due: QueueCandidate[] = [];
  const fresh: QueueCandidate[] = [];
  for (const c of pool) {
    const s = input.srsByQid.get(c.qid);
    if (!s) fresh.push(c);
    else if (s.dueAt <= input.now) due.push(c);
  }
  due.sort((a, b) => {
    const sa = input.srsByQid.get(a.qid)!;
    const sb = input.srsByQid.get(b.qid)!;
    return sa.dueAt - sb.dueAt || sa.lastAt - sb.lastAt;
  });
  fresh.sort((a, b) => a.bankIndex - b.bankIndex || a.line - b.line);

  const quota = Math.max(0, input.newPerDay - Math.max(0, input.newIntroducedToday));
  const seen = new Set<string>();
  const merged = [...due, ...fresh.slice(0, quota)].filter((c) => {
    if (seen.has(c.qid)) return false;
    seen.add(c.qid);
    return true;
  });
  const capped = input.sessionSize > 0 ? merged.slice(0, input.sessionSize) : merged;
  return chainSort(capped).map((c) => ({ qid: c.qid, bankPath: c.bankPath, id: c.id }));
}
