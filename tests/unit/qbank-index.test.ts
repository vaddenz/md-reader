import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, kvSet, openDb, putBlob } from '../../src/data/db';
import { bankName, ensureBankLoaded, listBanks } from '../../src/data/qbankIndex';

const BANK_PATH = '题库/示例.jsonl';
const QA_LINE = JSON.stringify({ id: 'Q1.1', type: '概念', question: '什么是事件循环？', answer: '- 事件循环…' });
const SC_LINE = JSON.stringify({
  id: 'Q1.2', kind: 'single', type: '概念', question: '选哪个？',
  options: [{ key: 'A', text: '对' }, { key: 'B', text: '错' }], correct: ['A'],
});
const BANK_TEXT = `${QA_LINE}\n${SC_LINE}\n坏行\n`;
const CFG = { owner: 'o', repo: 'r', branch: 'main' };

function treeWith(entries: { path: string; sha: string }[]) {
  return { syncedAt: 1, entries: entries.map((e) => ({ path: e.path, sha: e.sha, size: 100, type: 'blob' })) };
}

beforeEach(async () => { await clearAllData(); });

describe('bankName / listBanks', () => {
  it('bankName 去目录与扩展名', () => {
    expect(bankName('题库/Node 卷.jsonl')).toBe('Node 卷');
    expect(bankName('a.JSONL')).toBe('a');
  });

  it('只列 .jsonl、排除 archive/、按路径排序', async () => {
    await kvSet('tree', treeWith([
      { path: 'b.md', sha: 's1' },
      { path: 'archive/旧.jsonl', sha: 's2' },
      { path: '题库/B卷.jsonl', sha: 's3' },
      { path: '题库/A卷.jsonl', sha: 's4' },
    ]));
    const banks = await listBanks();
    expect(banks.map((b) => b.path)).toEqual(['题库/A卷.jsonl', '题库/B卷.jsonl']);
    expect(banks[0]).toMatchObject({ name: 'A卷', fetched: false, questionCount: null, issueCount: null });
  });

  it('缓存与 sha 一致时标记 fetched 并带题量/问题数', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-1' }]));
    await (await openDb()).put('mem_banks', {
      path: BANK_PATH, sha: 'sha-1', name: '示例', parsedAt: 1,
      questions: [{ qid: 'q_x' }], warnings: [{ line: 3, kind: 'invalid-json', message: 'x' }],
    }, BANK_PATH);
    const [bank] = await listBanks();
    expect(bank).toMatchObject({ fetched: true, questionCount: 1, issueCount: 1 });
  });
});

describe('ensureBankLoaded', () => {
  it('拉取 → 解析 → 缓存；二次调用不再请求', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-1' }]));
    await kvSet('config', CFG);
    const client = { getBlobText: vi.fn(async () => BANK_TEXT) };

    const first = await ensureBankLoaded(BANK_PATH, client);
    expect(client.getBlobText).toHaveBeenCalledTimes(1);
    expect(first.questions).toHaveLength(2);
    expect(first.warnings).toHaveLength(1);
    expect(first.questions[0].qid).toBeTruthy();

    const second = await ensureBankLoaded(BANK_PATH, client);
    expect(client.getBlobText).toHaveBeenCalledTimes(1);
    expect(second.questions).toHaveLength(2);
  });

  it('sha 变化后重新解析；优先用 blobs 缓存文本（不再请求）', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-2' }]));
    await kvSet('config', CFG);
    const updated = `${JSON.stringify({ id: 'Q9', type: '概念', question: '新题？', answer: '- 新答' })}\n`;
    await putBlob('sha-2', new Blob([updated], { type: 'application/json' }));
    const client = { getBlobText: vi.fn(async () => { throw new Error('should not be called'); }) };

    const parsed = await ensureBankLoaded(BANK_PATH, client);
    expect(client.getBlobText).not.toHaveBeenCalled();
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].id).toBe('Q9');
  });

  it('离线且无缓存 → 可读错误；不在目录树 → 先更新目录', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-1' }]));
    await kvSet('config', CFG);
    const failing = { getBlobText: vi.fn(async () => { throw new Error('network down'); }) };
    await expect(ensureBankLoaded(BANK_PATH, failing)).rejects.toThrow('题库首次获取需要联网');
    await expect(ensureBankLoaded('不存在.jsonl', failing)).rejects.toThrow('请先更新目录');
  });
});
