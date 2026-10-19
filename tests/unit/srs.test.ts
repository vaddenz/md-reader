import { describe, expect, it } from 'vitest';
import {
  MAX_STAGE, addDays, buildQueue, dayStart, isMastered, nextState,
  verdictFromChoice, verdictFromScore,
  type QueueCandidate, type SrsState,
} from '../../src/lib/srs';

const NOW = new Date(2026, 9, 19, 15, 30).getTime(); // 2026-10-19 15:30（本地）

const EMPTY_FILTERS = { kinds: [], chapters: [], types: [], tags: [], difficulty: [] };

function cand(qid: string, extra: Partial<QueueCandidate> = {}): QueueCandidate {
  return { qid, bankPath: 'b.jsonl', id: qid, kind: 'qa', type: '概念', bankIndex: 0, line: 1, ...extra };
}

function srs(qid: string, dueAt: number, lastAt = 0, extra: Partial<SrsState> = {}): SrsState {
  return {
    qid, bankPath: 'b.jsonl', id: qid, stage: 0, dueAt, lastAt, firstAt: lastAt,
    lastScore: null, verdict: 'again', reps: 1, lapses: 0, ...extra,
  };
}

const queue = (candidates: QueueCandidate[], srsMap: Map<string, SrsState>, extra: Partial<Parameters<typeof buildQueue>[0]> = {}) =>
  buildQueue({ candidates, srsByQid: srsMap, filters: EMPTY_FILTERS, sessionSize: 0, newPerDay: 10, newIntroducedToday: 0, now: NOW, ...extra });

describe('verdictFromScore', () => {
  it('边界值', () => {
    expect(verdictFromScore(85)).toBe('excellent');
    expect(verdictFromScore(84)).toBe('good');
    expect(verdictFromScore(70)).toBe('good');
    expect(verdictFromScore(69)).toBe('hard');
    expect(verdictFromScore(50)).toBe('hard');
    expect(verdictFromScore(49)).toBe('again');
    expect(verdictFromScore(0)).toBe('again');
  });
});

describe('verdictFromChoice', () => {
  it('单选：对 → 优秀；错 → 不会', () => {
    expect(verdictFromChoice('single', ['A'], ['A'])).toBe('excellent');
    expect(verdictFromChoice('single', ['B'], ['A'])).toBe('again');
    expect(verdictFromChoice('single', [], ['A'])).toBe('again');
  });
  it('多选：全对 → 优秀；漏选 → 勉强；错选 → 不会', () => {
    expect(verdictFromChoice('multiple', ['A', 'C'], ['A', 'C'])).toBe('excellent');
    expect(verdictFromChoice('multiple', ['A'], ['A', 'C'])).toBe('hard');
    expect(verdictFromChoice('multiple', [], ['A', 'C'])).toBe('hard');
    expect(verdictFromChoice('multiple', ['A', 'B'], ['A', 'C'])).toBe('again');
  });
});

describe('dayStart / addDays', () => {
  it('本地日界：截断到 0 点、跨月推进', () => {
    const d = new Date(2026, 9, 19, 23, 59, 59).getTime();
    expect(dayStart(d)).toBe(new Date(2026, 9, 19).getTime());
    expect(addDays(dayStart(d), 1)).toBe(new Date(2026, 9, 20).getTime());
    expect(addDays(new Date(2026, 9, 31).getTime(), 1)).toBe(new Date(2026, 10, 1).getTime());
  });
});

describe('nextState', () => {
  const meta = { qid: 'q_a', bankPath: 'b.jsonl', id: 'Q1', score: 75 };

  it('首次作答：优秀/良好升一档并按新档间隔到期', () => {
    const a = nextState(undefined, 'good', NOW, meta);
    expect(a).toMatchObject({ stage: 1, dueAt: addDays(NOW, 2), lastAt: NOW, firstAt: NOW, lastScore: 75, verdict: 'good', reps: 1, lapses: 0 });
    const b = nextState(undefined, 'excellent', NOW, { ...meta, score: 90 });
    expect(b).toMatchObject({ stage: 1, dueAt: addDays(NOW, 2), lapses: 0 });
  });

  it('升档封顶：stage 5 良好 → stage 6、60 天；再良好仍 stage 6', () => {
    const prev = srs('q_a', NOW, 0, { stage: 5, firstAt: 1 });
    const s6 = nextState(prev, 'good', NOW, meta);
    expect(s6).toMatchObject({ stage: MAX_STAGE, dueAt: addDays(NOW, 60), firstAt: 1 });
    const again6 = nextState(s6, 'good', NOW + 1000, meta);
    expect(again6).toMatchObject({ stage: MAX_STAGE, dueAt: addDays(NOW + 1000, 60) });
  });

  it('勉强：保持档位、明天重试；不会：重置 stage 0、明天重试、lapses 累加', () => {
    const prev = srs('q_a', NOW, 0, { stage: 3, firstAt: 1, lapses: 2, reps: 4 });
    const hard = nextState(prev, 'hard', NOW, { ...meta, score: 60 });
    expect(hard).toMatchObject({ stage: 3, dueAt: addDays(NOW, 1), lapses: 2, reps: 5 });
    const again = nextState(prev, 'again', NOW, { ...meta, score: 30 });
    expect(again).toMatchObject({ stage: 0, dueAt: addDays(NOW, 1), lapses: 3, reps: 5 });
  });

  it('选择题（score null）：lastScore 为 null，其余照常', () => {
    const s = nextState(undefined, 'excellent', NOW, { ...meta, score: null });
    expect(s.lastScore).toBeNull();
    expect(s.stage).toBe(1);
  });
});

describe('isMastered', () => {
  it('档位到顶且最近一次为优秀/良好才掌握', () => {
    expect(isMastered(srs('q', 0, 0, { stage: MAX_STAGE, verdict: 'good' }))).toBe(true);
    expect(isMastered(srs('q', 0, 0, { stage: MAX_STAGE, verdict: 'excellent' }))).toBe(true);
    expect(isMastered(srs('q', 0, 0, { stage: MAX_STAGE, verdict: 'hard' }))).toBe(false);
    expect(isMastered(srs('q', 0, 0, { stage: 5, verdict: 'good' }))).toBe(false);
  });
});

describe('buildQueue', () => {
  it('到期优先（dueAt 升序、同刻按 lastAt），新题按题库顺序 + 行序', () => {
    const candidates = [
      cand('q1', { line: 1 }),
      cand('q2', { line: 2, bankIndex: 1 }),
      cand('q3', { line: 3 }),
      cand('q4', { line: 4 }),
    ];
    const map = new Map([
      ['q3', srs('q3', NOW - 5 * 86400000, 100)],
      ['q4', srs('q4', NOW - 6 * 86400000, 200)],
      ['q2', srs('q2', NOW + 86400000, 300)], // 未到期，不出
    ]);
    expect(queue(candidates, map).map((e) => e.qid)).toEqual(['q4', 'q3', 'q1']);
  });

  it('每日新题额度：newIntroducedToday 占用额度，到期复习不占', () => {
    const candidates = [cand('q1'), cand('q2'), cand('q3')];
    const map = new Map([['q3', srs('q3', NOW - 1)]]);
    expect(queue(candidates, map, { newPerDay: 2, newIntroducedToday: 1 }).map((e) => e.qid)).toEqual(['q3', 'q1']);
    expect(queue(candidates, map, { newPerDay: 2, newIntroducedToday: 5 }).map((e) => e.qid)).toEqual(['q3']);
  });

  it('sessionSize 截断（0 = 不限）；qid 去重', () => {
    const candidates = [cand('q1'), cand('q2'), cand('q1', { line: 9 })];
    expect(queue(candidates, new Map(), { sessionSize: 1 }).map((e) => e.qid)).toEqual(['q1']);
    expect(queue(candidates, new Map()).map((e) => e.qid)).toEqual(['q1', 'q2']);
  });

  it('筛选：形态 / 题型 / 章节 / 标签 / 难度，空数组 = 不限制', () => {
    const candidates = [
      cand('qa', { type: '概念', chapter: '1. 基础', tags: ['a'], difficulty: '基础' }),
      cand('sc', { kind: 'single', type: '辨析', chapter: '2. 进阶', tags: ['b'], difficulty: '进阶' }),
      cand('mc', { kind: 'multiple', type: '概念', chapter: '2. 进阶' }),
    ];
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, kinds: ['single'] } }).map((e) => e.qid)).toEqual(['sc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, types: ['概念'] } }).map((e) => e.qid)).toEqual(['qa', 'mc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, chapters: ['2. 进阶'] } }).map((e) => e.qid)).toEqual(['sc', 'mc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, tags: ['b'] } }).map((e) => e.qid)).toEqual(['sc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, difficulty: ['基础'] } }).map((e) => e.qid)).toEqual(['qa']);
  });

  it('追问链排序：母题在前、追问紧随；多子题按行序；母题缺席保持原位', () => {
    const candidates = [
      cand('A', { line: 1 }),
      cand('C', { line: 3 }),
      cand('B', { line: 5, followUpOf: 'A' }),
      cand('D', { line: 2, followUpOf: 'Z' }), // Z 不在候选
      cand('B2', { line: 6, followUpOf: 'B' }), // 二级链
    ];
    expect(queue(candidates, new Map()).map((e) => e.qid)).toEqual(['A', 'B', 'B2', 'D', 'C']);
  });

  it('成环不悬挂：两题都在队列时都能出，且不无限循环', () => {
    const candidates = [
      cand('E', { line: 1, followUpOf: 'F' }),
      cand('F', { line: 2, followUpOf: 'E' }),
    ];
    const out = queue(candidates, new Map()).map((e) => e.qid);
    expect(out.sort()).toEqual(['E', 'F']);
  });
});
