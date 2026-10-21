import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, kvGet, kvSet, openDb } from '../../src/data/db';
import {
  DEFAULT_SELECTION, SESSION_SIZE_CHOICES, appendAttempt, clearGlobalMemorySettings, clearSession, clearTrainingData,
  exportMemory, getLlmConfig, getSelection, getSession, importMemory, listAttempts, loadSrsMap,
  putSrs, sanitizeAttempt, sanitizeLlmConfig, sanitizeSelection, sanitizeSrs, saveLlmConfig,
  saveSelection, saveSession, summarize,
  type MemoryAttempt,
} from '../../src/data/memory';
import {
  loadBadQuestionMap, markBadQuestion, unmarkBadQuestion,
} from '../../src/data/badQuestions';
import type { SrsState } from '../../src/lib/srs';
import type { OutboxEntry } from '../../src/sync/outbox';

async function outbox(): Promise<OutboxEntry[]> {
  return (await openDb()).getAll('sync_outbox') as Promise<OutboxEntry[]>;
}

const NOW = new Date(2026, 9, 19, 15, 30).getTime();
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await clearAllData();
  clearGlobalMemorySettings();
});

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

describe('跨仓库共享的记忆设置', () => {
  it('训练偏好与模型配置写入全局 localStorage；清空仓库库后仍保留', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    });
    try {
      await saveSelection({
        banks: ['b.jsonl'],
        filters: { kinds: ['qa'], chapters: [], types: [], tags: [], difficulty: [] },
        sessionSize: 50,
        newPerDay: 3,
      });
      await saveLlmConfig({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
      expect(store.has('mdreader.memoryTraining')).toBe(true);
      expect(store.has('mdreader.llmConfig')).toBe(true);

      // 模拟切换到另一个仓库库：仓库内选择清空，但训练偏好/模型仍全局有效。
      await clearAllData();
      expect(await getSelection()).toMatchObject({ banks: [], sessionSize: 50, newPerDay: 3 });
      expect(await getLlmConfig()).toEqual({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' });
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('思考强度随配置保存；非法值丢弃', async () => {
    expect(sanitizeLlmConfig({ baseUrl: 'https://x', apiKey: 'k', model: 'm', reasoningEffort: 'max' }))
      .toEqual({ baseUrl: 'https://x', apiKey: 'k', model: 'm', reasoningEffort: 'max' });
    expect(sanitizeLlmConfig({ baseUrl: 'https://x', apiKey: 'k', model: 'm', reasoningEffort: 'ultra' }))
      .toEqual({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });

    const cfg = { baseUrl: 'https://x', apiKey: 'k', model: 'm', reasoningEffort: 'high' as const };
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

describe('坏题标记', () => {
  it('标记 / 撤销往返，并写 outbox；清除训练数据保留标记', async () => {
    const marked = await markBadQuestion({ qid: 'q1', bankPath: 'b.jsonl', id: 'Q1' });
    expect(marked.markedAt).toBeGreaterThan(0);
    expect((await loadBadQuestionMap()).get('q1')).toMatchObject({ bankPath: 'b.jsonl', id: 'Q1' });

    let entries = await outbox();
    expect(entries.find((e) => e.collection === 'memory.badQuestions')).toMatchObject({
      recordId: 'q1', deleted: false,
    });

    await putSrs(srs('q1'));
    await appendAttempt(attempt());
    await clearTrainingData();
    expect((await loadBadQuestionMap()).has('q1')).toBe(true);
    expect(await loadSrsMap()).toEqual(new Map());

    expect(await unmarkBadQuestion('q1')).toBe(true);
    expect((await loadBadQuestionMap()).has('q1')).toBe(false);
    entries = await outbox();
    expect(entries.find((e) => e.collection === 'memory.badQuestions')).toMatchObject({
      recordId: 'q1', deleted: true,
    });
    expect(await unmarkBadQuestion('q1')).toBe(false);
  });

  it('导出 / 导入坏题；重复导入幂等', async () => {
    await markBadQuestion({ qid: 'q1', bankPath: 'b.jsonl', id: 'Q1' });
    const json = await exportMemory();
    expect(JSON.parse(json).badQuestions).toHaveLength(1);

    await clearAllData();
    expect(await importMemory(json)).toEqual({ srs: 0, attempts: 0, bad: 1 });
    expect((await loadBadQuestionMap()).get('q1')).toMatchObject({ qid: 'q1', bankPath: 'b.jsonl', id: 'Q1' });
    expect(await importMemory(json)).toEqual({ srs: 0, attempts: 0, bad: 0 });
  });
});

describe('同步 outbox 与 reset', () => {
  it('putSrs / appendAttempt 写 outbox；attempt 用稳定键', async () => {
    await putSrs(srs('q1'));
    await appendAttempt(attempt());
    const entries = await outbox();
    expect(entries.find((e) => e.collection === 'memory.srs')).toMatchObject({ recordId: 'q1', deleted: false });
    expect(entries.find((e) => e.collection === 'memory.attempts')).toMatchObject({
      recordId: `q1|${NOW}|ai`, updatedAt: NOW, deleted: false,
    });
  });

  it('saveSelection 只在 banks/filters 变化时入队', async () => {
    await saveSelection({ ...DEFAULT_SELECTION, banks: ['b.jsonl'] });
    const first = (await outbox()).filter((e) => e.collection === 'memory.selection');
    expect(first).toHaveLength(1);
    const updatedAt = first[0].updatedAt;
    await saveSelection({ ...DEFAULT_SELECTION, banks: ['b.jsonl'], sessionSize: 50 });
    const second = (await outbox()).filter((e) => e.collection === 'memory.selection');
    expect(second[0].updatedAt).toBe(updatedAt); // 训练设置变化不刷新
  });

  it('clearTrainingData 写 reset 标记并更新 syncReset', async () => {
    await putSrs(srs('q1'));
    await appendAttempt(attempt());
    await clearTrainingData();
    const entries = await outbox();
    const resets = entries.filter((e) => e.recordId === '__reset__');
    expect(resets).toHaveLength(2);
    expect(entries.filter((e) => e.recordId !== '__reset__')).toHaveLength(0);
    expect(resets.every((e) => e.deleted && e.payload)).toBe(true);
    expect(await kvGet('syncReset')).toMatchObject({ 'memory.srs': expect.any(Number), 'memory.attempts': expect.any(Number) });
  });

  it('importMemory 只入队导入/更新的记录并清除墓碑', async () => {
    await kvSet('syncTombstones', {
      'memory.srs': { q1: 1 },
      'memory.attempts': { [`q1|${NOW}|ai`]: 1 },
    });
    const json = JSON.stringify({ kind: 'memory', srs: [srs('q1')], attempts: [attempt()] });
    expect(await importMemory(json)).toEqual({ srs: 1, attempts: 1, bad: 0 });
    expect(await kvGet('syncTombstones')).toEqual({});
    const entries = await outbox();
    expect(entries.map((e) => e.collection).sort()).toEqual(['memory.attempts', 'memory.srs']);
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
    expect(res).toEqual({ srs: 1, attempts: 1, bad: 0 });
    const again = await importMemory(json); // 幂等：重复导入不重复追加
    expect(again).toEqual({ srs: 0, attempts: 0, bad: 0 });

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
    expect(st.avgAiScore7d).toBe(85);
    expect(st.verdictCounts).toEqual({ excellent: 1, good: 1, hard: 1, again: 1 });
    expect(st.streak).toBe(2);
    expect(st.practicedToday).toBe(2);
    expect(st.dueToday).toBe(1);
    expect(st.due3).toBe(2);
    expect(st.due7).toBe(3);
    expect(st.trend).toHaveLength(14);
    expect(st.trend[13]).toMatchObject({ count: 2, avgScore: 80 });
  });

  it('近 7 天均分只算窗口内 AI 记录，7 天外与非 AI 排除；无记录为 null', () => {
    const attempts = [
      attempt({ qid: 'a', ts: NOW, mode: 'ai', score: 80 }),
      attempt({ qid: 'b', ts: NOW - 6 * DAY, mode: 'ai', score: 90 }),
      attempt({ qid: 'c', ts: NOW - 8 * DAY, mode: 'ai', score: 100 }),
      attempt({ qid: 'd', ts: NOW - 2 * DAY, mode: 'choice', score: null }),
    ];
    const st = summarize(attempts, [], NOW);
    expect(st.avgAiScore).toBe(90);      // 全部 AI：(80 + 90 + 100) / 3
    expect(st.avgAiScore7d).toBe(85);    // 仅近 7 天：(80 + 90) / 2
    expect(summarize([], [], NOW).avgAiScore7d).toBeNull();
  });
});
