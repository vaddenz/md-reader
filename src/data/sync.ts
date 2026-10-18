import type { GitHubClient } from './github';
import { deleteFiles, getFile, kvGet, kvSet, listFilesMeta, markExpired, putFiles, type TreeEntry } from './db';
import { buildLinksIndex } from './links';
import { isDoc } from './paths';
import { extractTitle } from '../lib/text';
import { runPool } from '../lib/pool';

export interface SyncProgress { phase: 'tree' | 'download' | 'cleanup' | 'done'; done: number; total: number }
export interface SyncResult { added: number; updated: number; deleted: number; totalDocs: number; bytes: number }

export function diffTree(localShaByPath: Record<string, string>, remote: TreeEntry[]) {
  const added: TreeEntry[] = [], updated: TreeEntry[] = [];
  for (const e of remote) {
    const l = localShaByPath[e.path];
    if (l === undefined) added.push(e);
    else if (l !== e.sha) updated.push(e);
  }
  const remotePaths = new Set(remote.map((e) => e.path));
  const deleted = Object.keys(localShaByPath).filter((p) => !remotePaths.has(p));
  return { added, updated, deleted };
}

export const EXPIRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 清理超过 ttl 未使用的文档正文（text → null），返回清理数量。 */
export async function sweepExpired(ttlMs = EXPIRY_TTL_MS, now = Date.now()): Promise<number> {
  const metas = await listFilesMeta();
  const expired = metas.filter((m) => m.cached && now - m.lastUsedAt > ttlMs).map((m) => m.path);
  if (expired.length) await markExpired(expired);
  await kvSet('lastSweepAt', now);
  return expired.length;
}

/** 按需下载未缓存文档（从本地目录树取 sha），写入并刷新 lastUsedAt。 */
export async function downloadDocText(
  client: Pick<GitHubClient, 'getBlobText'>,
  cfg: { owner: string; repo: string; branch: string },
  path: string,
): Promise<string> {
  const tree = await kvGet<{ entries: TreeEntry[] }>('tree');
  const entry = tree?.entries.find((e) => e.path === path);
  if (!entry) throw new Error('文件不在本地目录树中，请先更新目录');
  const text = await client.getBlobText(cfg.owner, cfg.repo, entry.sha);
  const now = Date.now();
  await putFiles([{ path, sha: entry.sha, size: entry.size, text, title: extractTitle(text, path), lastUsedAt: now, updatedAt: now }]);
  return text;
}

export async function syncRepo(
  client: Pick<GitHubClient, 'getTree' | 'getBlobText'>,
  cfg: { owner: string; repo: string; branch: string },
  onProgress: (p: SyncProgress) => void,
  opts?: { signal?: AbortSignal },
): Promise<SyncResult> {
  onProgress({ phase: 'tree', done: 0, total: 1 });
  const tree = await client.getTree(cfg.owner, cfg.repo, cfg.branch);
  const docs = tree.filter((e) => isDoc(e.path));

  const metas = await listFilesMeta();
  const metaByPath = Object.fromEntries(metas.map((m) => [m.path, m]));
  const local = Object.fromEntries(metas.map((m) => [m.path, m.sha]));
  const { added, updated, deleted } = diffTree(local, docs);

  // 已过期（未缓存）的文档：只更新记录的 sha，不下载（用户点击时按需下载）
  const updatedExpired = updated.filter((e) => metaByPath[e.path]?.cached === false);
  const queue = [...added, ...updated.filter((e) => metaByPath[e.path]?.cached !== false)];
  let done = 0, bytes = 0;

  if (updatedExpired.length) {
    const now = Date.now();
    await putFiles(updatedExpired.map((e) => {
      const m = metaByPath[e.path]!;
      return { path: e.path, sha: e.sha, size: e.size, text: null, title: m.title, lastUsedAt: m.lastUsedAt, updatedAt: now };
    }));
  }

  await runPool(queue, 4, async (e) => {
    const text = await client.getBlobText(cfg.owner, cfg.repo, e.sha);
    const now = Date.now();
    await putFiles([{ path: e.path, sha: e.sha, size: e.size, text, title: extractTitle(text, e.path), lastUsedAt: now, updatedAt: now }]);
    done++; bytes += text.length;
    onProgress({ phase: 'download', done, total: queue.length });
  }, opts);

  if (deleted.length) { onProgress({ phase: 'cleanup', done: 0, total: 1 }); await deleteFiles(deleted); }

  await kvSet('tree', { syncedAt: Date.now(), entries: tree });   // 含图片，供路径→sha
  await kvSet('lastSyncAt', Date.now());
  const allDocs = await Promise.all(docs.map(async (e) => ({ path: e.path, text: (await getFile(e.path))?.text ?? '' })));
  await kvSet('links', buildLinksIndex(allDocs.filter((d) => d.text)));

  onProgress({ phase: 'done', done, total: queue.length });
  return { added: added.length, updated: updated.length, deleted: deleted.length, totalDocs: docs.length, bytes };
}
