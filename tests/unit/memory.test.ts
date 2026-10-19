import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, kvGet, kvSet, openDb } from '../../src/data/db';
import {
  DEFAULT_SELECTION, SESSION_SIZE_CHOICES, appendAttempt, clearSession, clearTrainingData,
  exportMemory, getLlmConfig, getSelection, getSession, importMemory, listAttempts, loadSrsMap,
  putSrs, sanitizeAttempt, sanitizeLlmConfig, sanitizeSelection, sanitizeSrs, saveLlmConfig,
  saveSelection, saveSession, summarize,
  type MemoryAttempt,
} from '../../src/data/memory';
import type { SrsState } from '../../src/lib/srs';

const NOW = new Date(2026, 9, 19, 15, 30).getTime();
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => { await clearAllData(); });

function attempt(extra: Partial<MemoryAttempt> = {}): MemoryAttempt {
  return {
    qid: 'q1', bankPath: 'b.jsonl', idLabel: 'Q1', ts: NOW, mode: 'ai', score: 80, verdict: 'good',
    answer: 'a', hit: [], missed: [], comment: '', durationMs: 1000, hintUsed: false, revealed: false, ...extra,
  };
}

function srs(qid: string, extra: Partial<SrsState> = {}): SrsState {
  return {
    qid, bankPath: 'b.jsonl', id: qid, stage: 0, dueAt: NOW, lastAt: NOW, firstAt: NOW,
    lastScore: null, verdict: 'again', reps: 1, lapses: 0, ...extra,
  };
}

describe('sanitizeSelection', () => {
  it('非对象回退默认；非法字段回退、白名单与钳制', () => {
    expect(sanitizeSelection(null)).toEqual(DEFAULT_SELECTION);
    expect(sanitizeSelection([1])).toEqual(DEFAULT_SELECTION);
    const s = sanitizeSelection({
      banks: ['a.jsonl', 3, ''],
      filters: { kinds: ['qa', 'x'], chapters: 'nope', types: [1], tags: ['t'], difficulty: [] },
      sessionSize: 999, newPerDay: 999,
    });
    expect(s.banks).toEqual(['a.jsonl']);
    expect(s.filters).toEqual({ kinds: ['qa'], chapters: [], types: [], tags: ['t'], difficulty: [] });
    expect(s.sessionSize).toBe(20);
    expect(s.newPerDay).toBe(50);
    expect(SESSION_SIZE_CHOICES).toContain(sanitizeSelection({ sessionSize: 0 }).sessionSize);
  });
  it('读写往返', async () => {
    expect(await getSelection()).toEqual(DEFAULT_SELECTION);
    await saveSelection({ banks: ['b.jsonl'], filters: { kinds: ['single'], chapters: [], types: [], tags: [], difficulty: [] }, sessionSize: 10, newPerDay: 5 });
    const back = await getSelection();
    expect(back).toMatchObject({ banks: ['b.jsonl'], sessionSize: 10, newPerDay: 5 });
  });
});

describe('sanitizeLlmConfig / 读写', () => {
  it('三字段齐全才有效，否则 undefined；读写往返', async () => {
    expect(sanitizeLlmConfig(null)).toBeUndefined();
    expect(sanitizeLlmConfig({ baseUrl: 'https://x', apiKey: '', model: 'm' })).toBeUndefined();
    const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
    expect(sanitizeLlmConfig(cfg)).toEqual(cfg);
    expect(await getLlmConfig()).toBeUndefined();
    await saveLlmConfig(cfg);
    expect(await getLlmConfig()).toEqual(cfg);
  });
});

describe('进度与记录', () => {
  it('putSrs / loadSrsMap 往返', async () => {
    await putSrs(srs('q1', { stage: 2 }));
    await putSrs(srs('q2'));
    const map = await loadSrsMap();
    expect(map.size).toBe(2);
    expect(map.get('q1')?.stage).toBe(2);
  });

  it('appendAttempt / listAttempts：按时间倒序、bank 过滤、limit', async () => {
    await appendAttempt(attempt({ qid: 'a', ts: NOW - 10 }));
    await appendAttempt(attempt({ qid: 'b', ts: NOW, bankPath: 'c.jsonl' }));
    await appendAttempt(attempt({ qid: 'c', ts: NOW - 5 }));
    const all = await listAttempts();
    expect(all.map((a) => a.qid)).toEqual(['b', 'c', 'a']);
    expect((await listAttempts({ bankPath: 'c.jsonl' })).map((a) => a.qid)).toEqual(['b']);
    expect((await listAttempts({ limit: 2 })).map((a) => a.qid)).toEqual(['b', 'c']);
  });

  it('会话读写与清理', async () => {
    const session = { createdAt: NOW, items: [{ qid: 'q1', bankPath: 'b.jsonl', id: 'Q1' }], index: 0, answered: 0, scores: [], startedAt: NOW };
    await saveSession(session);
    expect((await getSession())?.items).toHaveLength(1);
    await clearSession();
    expect(await getSession()).toBeUndefined();
  });

  it('clearTrainingData 只清训练数据，保留模型配置 / 选择 / 题库缓存', async () => {
    await putSrs(srs('q1'));
    await appendAttempt(attempt());
    await saveSession({ createdAt: NOW, items: [], index: 0, answered: 0, scores: [], startedAt: NOW });
    await saveLlmConfig({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
    await saveSelection({ ...DEFAULT_SELECTION, banks: ['b.jsonl'] });
    await kvSet('llmConfig-keep', 1);
    await (await openDb()).put('mem_banks', { path: 'b.jsonl' }, 'b.jsonl');

    await clearTrainingData();
    expect(await loadSrsMap()).toEqual(new Map());
    expect(await listAttempts()).toEqual([]);
    expect(await getSession()).toBeUndefined();
    expect(await getLlmConfig()).toBeDefined();
    expect((await getSelection()).banks).toEqual(['b.jsonl']);
    expect((await openDb()).get('mem_banks', 'b.jsonl')).toBeDefined();
  });
});

describe('sanitizeSrs / sanitizeAttempt', () => {
  it('非法输入返回 null；字段钳制', () => {
    expect(sanitizeSrs(null)).toBeNull();
    expect(sanitizeSrs({ qid: 'x' })).toBeNull();
    const s = sanitizeSrs({ qid: 'q', bankPath: 'b', id: 'Q1', stage: 99, verdict: 'nope', reps: -3 });
    expect(s).toMatchObject({ stage: 6, verdict: 'again', reps: 0 });
    expect(sanitizeAttempt(null)).toBeNull();
    const a = sanitizeAttempt({ qid: 'q', bankPath: 'b', idLabel: 'Q1', ts: 1, mode: 'nope', verdict: 'nope', score: 'x', hit: [1, 'ok'] });
    expect(a).toMatchObject({ mode: 'ai', verdict: 'again', score: null, hit: ['ok'] });
  });
});

describe('导出 / 导入', () => {
  it('导出格式与不含模型配置；导入合并：srs 取新、attempts 去重', async () => {
    await putSrs(srs('q1', { lastAt: 100, stage: 1 }));
    await appendAttempt(attempt({ ts: 100 }));
    await saveLlmConfig({ baseUrl: 'https://x', apiKey: 'secret', model: 'm' });
    const json = await exportMemory();
    expect(json).not.toContain('secret');
    expect(JSON.parse(json)).toMatchObject({ app: 'md-reader', kind: 'memory', version: 1 });

    await clearAllData();
    const res = await importMemory(json);
    expect(res).toEqual({ srs: 1, attempts: 1 });
    const again = await importMemory(json); // 幂等：重复导入不重复追加
    expect(again).toEqual({ srs: 0, attempts: 0 });

    // 本地较新时不被覆盖
    await putSrs(srs('q1', { lastAt: 999, stage: 5 }));
    await importMemory(json);
    expect((await loadSrsMap()).get('q1')?.stage).toBe(5);
  });

  it('非法文件抛出可读错误', async () => {
    await expect(importMemory('not json')).rejects.toThrow('文件不是合法 JSON');
    await expect(importMemory('{"kind":"x"}')).rejects.toThrow('不是记忆训练数据文件');
  });
});

describe('summarize', () => {
  it('平均分只算 AI；档位分布、连续天数、今日已练、到期分布、14 天趋势', () => {
    const attempts = [
      attempt({ qid: 'a', ts: NOW, mode: 'ai', score: 80, verdict: 'good' }),
      attempt({ qid: 'b', ts: NOW, mode: 'choice', score: null, verdict: 'again' }),
      attempt({ qid: 'c', ts: NOW - DAY, mode: 'self', score: null, verdict: 'hard' }),
      attempt({ qid: 'd', ts: NOW - 3 * DAY, mode: 'ai', score: 90, verdict: 'excellent' }),
    ];
    const states = [
      srs('a', { dueAt: NOW - 1, stage: 6, verdict: 'good' }),
      srs('b', { dueAt: NOW + 2 * DAY }),
      srs('c', { dueAt: NOW + 5 * DAY }),
      srs('d', { dueAt: NOW + 20 * DAY, stage: 4 }),
    ];
    const st = summarize(attempts, states, NOW);
    expect(st.practiced).toBe(4);
    expect(st.mastered).toBe(1);
    expect(st.avgAiScore).toBe(85);
    expect(st.verdictCounts).toEqual({ excellent: 1, good: 1, hard: 1, again: 1 });
    expect(st.streak).toBe(2);
    expect(st.practicedToday).toBe(2);
    expect(st.dueToday).toBe(1);
    expect(st.due3).toBe(2);
    expect(st.due7).toBe(3);
    expect(st.trend).toHaveLength(14);
    expect(st.trend[13]).toMatchObject({ count: 2, avgScore: 80 });
  });
});
