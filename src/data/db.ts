import { deleteDB, openDB, type IDBPDatabase } from 'idb';

export interface FileRecord { path: string; sha: string; size: number; text: string | null; title: string; lastUsedAt: number; updatedAt: number }
export interface TreeEntry { path: string; sha: string; size: number; type: 'blob' }

const DB_NAME = 'mdreader';
const SCHEMA_VER = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function open(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, SCHEMA_VER, {
    upgrade(db) {
      for (const name of ['files', 'blobs', 'kv'] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    },
  });
}

/** 缓存自愈完成信号（T22）：ToastHost 监听后提示「本地缓存已重建」。仅浏览器环境派发。 */
function signalCacheRebuilt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('mdreader:cache-rebuilt'));
  } catch {
    // 事件派发失败不影响自愈结果
  }
}

export function openDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch(async () => {
      // 自愈：结构损坏/版本冲突 → 删库重建
      // 不能调用 clearAllData()：它会 await 本函数正在构造的 dbPromise，导致死锁
      dbPromise = null;
      await deleteDB(DB_NAME);
      const retry = open().catch((err) => {
        dbPromise = null;
        throw err;
      });
      dbPromise = retry;
      // 重建成功后才派发一次性信号（失败时提示「已重建」会误导）
      void retry.then(signalCacheRebuilt, () => {});
      return retry;
    });
  }
  return dbPromise;
}

export async function getFile(path: string): Promise<FileRecord | undefined> {
  return (await openDb()).get('files', path);
}
export async function putFiles(files: FileRecord[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  await Promise.all([...files.map((f) => tx.store.put(f, f.path)), tx.done]);
}
export async function deleteFiles(paths: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  await Promise.all([...paths.map((p) => tx.store.delete(p)), tx.done]);
}
export interface FileMeta { path: string; sha: string; size: number; cached: boolean; title: string; lastUsedAt: number }
export async function listFilesMeta(): Promise<FileMeta[]> {
  const all = await (await openDb()).getAll('files');
  return all.map(({ path, sha, size, text, title, lastUsedAt }) => ({ path, sha, size, cached: text !== null, title, lastUsedAt }));
}
export async function markExpired(paths: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  await Promise.all([
    ...paths.map(async (p) => {
      const rec = await tx.store.get(p);
      if (rec) await tx.store.put({ ...rec, text: null, updatedAt: Date.now() }, p);
    }),
    tx.done,
  ]);
}
export async function touchFile(path: string, at = Date.now()): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  const rec = await tx.store.get(path);
  if (rec) await tx.store.put({ ...rec, lastUsedAt: at }, path);
  await tx.done;
}
export async function getBlob(sha: string) {
  return (await (await openDb()).get('blobs', sha)) as { sha: string; blob: Blob; updatedAt: number } | undefined;
}
export async function putBlob(sha: string, blob: Blob): Promise<void> {
  await (await openDb()).put('blobs', { sha, blob, updatedAt: Date.now() }, sha);
}
export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await openDb()).get('kv', key) as Promise<T | undefined>;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await openDb()).put('kv', value, key);
}
export async function storageEstimate() {
  const e = await navigator.storage?.estimate?.();
  return { usage: e?.usage ?? 0, quota: e?.quota ?? 0 };
}
export async function clearAllData(): Promise<void> {
  try {
    const db = dbPromise ? await dbPromise.catch(() => null) : null;
    if (db) db.close();
    dbPromise = null;
    await indexedDB.deleteDatabase(DB_NAME);
  } finally {
    dbPromise = null;
  }
}
