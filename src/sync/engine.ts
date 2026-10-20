import { activeRepo, loadRepoState, repoDbName, type RepoEntry } from '../data/repos';
import { DbBlockedError } from '../data/db';
import { RESET_RECORD_ID } from './collections/names';
import { SYNC_COLLECTIONS, collectionFor } from './collections';
import { cursorOf, loadSyncState, saveSyncState, updateRepoState } from './state';
import { openRepoDb, withWriteLock, type RepoDb } from './repoDb';
import { readOutbox, deleteOutboxIfRev, removeOutboxAtOrBefore, seedCollectionOutbox, type OutboxEntry } from './outbox';
import { getDeviceId, repoScope } from './device';
import { createSyncBackend } from './registry';
import { loadSyncConfig } from './config';
import type { RemoteRecord, SyncBackend, SyncRecord } from './types';
import { SyncError } from './types';

export interface RepoResult {
  repoId: string;
  scope: string;
  pulled: number;
  applied: number;
  pushed: number;
  skipped?: 'blocked' | 'offline';
  error?: string;
}

export interface SyncSummary {
  startedAt: number;
  finishedAt: number;
  repos: RepoResult[];
  pulled: number;
  applied: number;
  pushed: number;
}

function isReset(record: RemoteRecord): boolean {
  return record.deleted && record.recordId === RESET_RECORD_ID;
}

function resetBefore(record: RemoteRecord): number {
  const value = record.payload && typeof record.payload === 'object'
    ? (record.payload as { before?: unknown }).before : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : record.updatedAt;
}

async function applyResets(db: RepoDb, remote: RemoteRecord[]): Promise<Record<string, number>> {
  return withWriteLock(db, async () => {
    const stored = await db.kvGet<Record<string, number>>('syncReset');
    const resets: Record<string, number> = stored && typeof stored === 'object' ? { ...stored } : {};
    for (const record of remote.filter(isReset)) {
      const before = resetBefore(record);
      const current = resets[record.collection] ?? 0;
      if (before <= current) continue;
      resets[record.collection] = before;
      await collectionFor(record.collection)?.clearBefore?.(db, before);
      await removeOutboxAtOrBefore(db, record.collection, before);
    }
    await db.kvSet('syncReset', resets);
    return resets;
  });
}

async function seedCollections(db: RepoDb, resets: Record<string, number>, force: boolean): Promise<void> {
  const stored = await db.kvGet<string[]>('syncSeededCollections');
  const seeded = new Set(force ? [] : Array.isArray(stored) ? stored : []);
  for (const collection of SYNC_COLLECTIONS) {
    if (seeded.has(collection.name)) continue;
    await withWriteLock(db, () => seedCollectionOutbox(db, collection, resets[collection.name] ?? 0));
    seeded.add(collection.name);
  }
  await db.kvSet('syncSeededCollections', [...seeded]);
}

async function applyRemote(db: RepoDb, remote: RemoteRecord[], resets: Record<string, number>): Promise<number> {
  let applied = 0;
  for (const record of remote) {
    if (isReset(record)) continue;
    const resetAt = resets[record.collection];
    if (resetAt !== undefined && resetAt > 0 && record.updatedAt <= resetAt) continue;
    const collection = collectionFor(record.collection);
    if (!collection) continue;
    if (await withWriteLock(db, () => collection.applyRemote(db, record))) applied += 1;
  }
  return applied;
}

async function materialize(db: RepoDb, entry: OutboxEntry): Promise<SyncRecord> {
  if (entry.recordId === RESET_RECORD_ID) {
    return {
      scope: '', collection: entry.collection, recordId: entry.recordId, payload: entry.payload ?? null,
      updatedAt: entry.updatedAt, deleted: true, deviceId: getDeviceId(),
    };
  }
  const collection = collectionFor(entry.collection);
  const local = collection ? await collection.getLocal(db, entry.recordId) : undefined;
  if (!local) {
    return {
      scope: '', collection: entry.collection, recordId: entry.recordId, payload: null,
      updatedAt: entry.updatedAt, deleted: true, deviceId: getDeviceId(),
    };
  }
  return {
    scope: '', collection: entry.collection, recordId: entry.recordId, payload: local.payload,
    updatedAt: local.updatedAt, deleted: local.deleted, deviceId: getDeviceId(),
  };
}

async function pushOutbox(
  db: RepoDb,
  scope: string,
  backend: SyncBackend,
  signal?: AbortSignal,
): Promise<number> {
  const entries = await readOutbox(db);
  let pushed = 0;
  for (let i = 0; i < entries.length; i += 200) {
    const batch = entries.slice(i, i + 200);
    const records = await Promise.all(batch.map((entry) => materialize(db, entry)));
    for (const record of records) record.scope = scope;
    await backend.push(records, signal);
    for (const entry of batch) await deleteOutboxIfRev(db, entry.id, entry.rev);
    pushed += records.length;
  }
  return pushed;
}

/** 同步一个已打开的仓库库；打开/关闭生命周期由调用方负责。 */
export async function syncRepo(
  scope: string,
  repo: RepoEntry,
  db: RepoDb,
  backend: SyncBackend,
  opts?: { signal?: AbortSignal },
): Promise<RepoResult> {
  const scopeChanged = (await db.kvGet<string>('syncScope')) !== scope;
  const cursor = scopeChanged ? 0 : cursorOf(scope);
  const remote = await backend.pull(scope, cursor, opts?.signal);
  const resets = await applyResets(db, remote);
  await seedCollections(db, resets, scopeChanged);
  const applied = await applyRemote(db, remote, resets);
  const nextCursor = Math.max(cursor, ...remote.map((record) => record.serverUpdatedAt), 0);

  // Commit the successfully applied pull before pushing, so a push failure won't replay it.
  updateRepoState(scope, { cursor: nextCursor });
  if (scopeChanged) await db.kvSet('syncScope', scope);

  const pushed = await pushOutbox(db, scope, backend, opts?.signal);
  updateRepoState(scope, { cursor: nextCursor, lastSyncAt: Date.now() });
  return { repoId: repo.id, scope, pulled: remote.length, applied, pushed };
}

async function syncOne(
  scope: string,
  repo: RepoEntry,
  backend: SyncBackend,
  opts?: { signal?: AbortSignal },
): Promise<RepoResult> {
  let db: RepoDb | undefined;
  try {
    db = await openRepoDb(repoDbName(repo.id));
    return await syncRepo(scope, repo, db, backend, opts);
  } finally {
    db?.close();
  }
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof SyncError)) return '同步失败，请稍后重试';
  switch (error.kind) {
    case 'config': return '同步配置无效，请检查配置';
    case 'auth': return '同步认证失败，请检查配置';
    case 'notfound': return '同步目标不存在，请检查配置';
    case 'network': return '网络连接失败，请稍后重试';
    case 'server': return '同步服务异常，请稍后重试';
    case 'parse': return '同步数据格式异常，请检查后端数据';
  }
}

export async function syncAll(backend: SyncBackend, opts?: { signal?: AbortSignal }): Promise<SyncSummary> {
  const startedAt = Date.now();
  const state = loadRepoState();
  const active = activeRepo(state);
  const repos = [active, ...state.repos.filter((repo) => repo.id !== active.id)];
  const results: RepoResult[] = [];
  for (const repo of repos) {
    const scope = repoScope(state.owner, repo.repo, repo.branch);
    try {
      results.push(await syncOne(scope, repo, backend, opts));
    } catch (error) {
      if (error instanceof DbBlockedError) {
        results.push({ repoId: repo.id, scope, pulled: 0, applied: 0, pushed: 0, skipped: 'blocked' });
      } else {
        results.push({ repoId: repo.id, scope, pulled: 0, applied: 0, pushed: 0, error: safeErrorMessage(error) });
      }
    }
  }

  const summary: SyncSummary = {
    startedAt,
    finishedAt: Date.now(),
    repos: results,
    pulled: results.reduce((total, result) => total + result.pulled, 0),
    applied: results.reduce((total, result) => total + result.applied, 0),
    pushed: results.reduce((total, result) => total + result.pushed, 0),
  };
  const current = loadSyncState();
  const firstError = results.find((result) => result.error)?.error ?? null;
  saveSyncState({
    ...current,
    lastSyncAt: summary.finishedAt,
    lastError: firstError ? { message: firstError, at: summary.finishedAt } : null,
  });

  const activeScope = repoScope(state.owner, active.repo, active.branch);
  if (typeof window !== 'undefined' && results.some((result) => result.scope === activeScope && result.applied > 0)) {
    window.dispatchEvent(new CustomEvent('mdreader:sync-applied', { detail: { scope: activeScope } }));
  }
  return summary;
}

let activeSync: Promise<SyncSummary> | null = null;

/** 手动 / 自动同步统一入口；并发调用复用同一 Promise。 */
export function syncNow(opts?: { signal?: AbortSignal }): Promise<SyncSummary> {
  if (activeSync) return activeSync;
  const config = loadSyncConfig();
  if (!config.enabled) return Promise.reject(new SyncError('config', '同步已停用'));
  const backend = createSyncBackend(config);
  activeSync = syncAll(backend, opts).finally(() => { activeSync = null; });
  return activeSync;
}
