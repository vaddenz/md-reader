/**
 * 题库索引：目录树中的 .jsonl（排除 archive/）→ 按需拉取 / 解析 / 按 sha 缓存。
 * 原文缓存在 blobs（同 sha 同内容），解析结果缓存在 mem_banks。
 */
import type { GitHubClient } from './github';
import { getBlob, kvGet, openDb, putBlob } from './db';
import { parseBankText, type BankQuestion, type ParseWarning } from '../lib/qbank';

export interface BankMeta {
  path: string;
  name: string;
  sha: string;
  size: number;
  fetched: boolean;
  questionCount: number | null;
  issueCount: number | null;
}

export interface ParsedBank {
  path: string;
  sha: string;
  name: string;
  parsedAt: number;
  questions: BankQuestion[];
  warnings: ParseWarning[];
}

interface TreeEntryLite { path: string; sha: string; size: number; type: string }
interface TreeCache { entries: TreeEntryLite[] }
interface RepoRef { owner: string; repo: string; branch: string }

export function bankName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.jsonl$/i, '');
}

function isBankEntry(e: TreeEntryLite): boolean {
  return /\.jsonl$/i.test(e.path) && !e.path.startsWith('archive/');
}

export async function getParsedBank(path: string): Promise<ParsedBank | undefined> {
  return (await openDb()).get('mem_banks', path) as Promise<ParsedBank | undefined>;
}

export async function listBanks(): Promise<BankMeta[]> {
  const tree = await kvGet<TreeCache>('tree');
  const entries = (tree?.entries ?? []).filter(isBankEntry).sort((a, b) => a.path.localeCompare(b.path));
  const metas: BankMeta[] = [];
  for (const e of entries) {
    const cached = await getParsedBank(e.path);
    const fresh = cached && cached.sha === e.sha;
    metas.push({
      path: e.path,
      name: bankName(e.path),
      sha: e.sha,
      size: e.size,
      fetched: Boolean(fresh),
      questionCount: fresh ? cached!.questions.length : null,
      issueCount: fresh ? cached!.warnings.length : null,
    });
  }
  return metas;
}

export async function ensureBankLoaded(
  path: string,
  client: Pick<GitHubClient, 'getBlobText'>,
): Promise<ParsedBank> {
  const tree = await kvGet<TreeCache>('tree');
  const entry = tree?.entries.find((e) => e.path === path);
  if (!entry) throw new Error('题库不在本地目录树中，请先更新目录');

  const cached = await getParsedBank(path);
  if (cached && cached.sha === entry.sha) return cached;

  let text: string | null = null;
  const blob = await getBlob(entry.sha);
  if (blob) text = await blob.blob.text();

  if (text === null) {
    const cfg = await kvGet<RepoRef>('config');
    if (!cfg) throw new Error('未配置仓库，请先在设置中填写');
    try {
      text = await client.getBlobText(cfg.owner, cfg.repo, entry.sha);
    } catch {
      throw new Error('题库首次获取需要联网，请连网后重试');
    }
    await putBlob(entry.sha, new Blob([text], { type: 'application/json' }));
  }

  const { questions, warnings } = parseBankText(text);
  const parsed: ParsedBank = { path, sha: entry.sha, name: bankName(path), parsedAt: Date.now(), questions, warnings };
  await (await openDb()).put('mem_banks', parsed, path);
  return parsed;
}
