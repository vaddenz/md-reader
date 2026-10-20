import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import { showToast } from '../lib/toast';

export interface FileRecord { path: string; sha: string; size: number; text: string | null; title: string; lastUsedAt: number; updatedAt: number }
export interface TreeEntry { path: string; sha: string; size: number; type: 'blob' }

/** 默认库沿用旧名 `mdreader`（单仓库时代的数据原地保留）；多仓库各自使用独立库。 */
const DEFAULT_DB_NAME = 'mdreader';
const SCHEMA_VER = 2;
/** 打开 / 删除数据库的等待上限：被旧页面连接阻塞时不能无限等待。 */
const DB_TIMEOUT_MS = 6000;

/** 数据库被其它页面/旧实例的 IndexedDB 连接阻塞（升级无法完成）。 */
export class DbBlockedError extends Error {
  constructor() {
    super('本地数据库被其它页面占用，暂时无法加载');
    this.name = 'DbBlockedError';
  }
}

let dbName = DEFAULT_DB_NAME;
let dbPromise: Promise<IDBPDatabase> | null = null;

function open(): Promise<IDBPDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DbBlockedError());
    }, DB_TIMEOUT_MS);

    void openDB(dbName, SCHEMA_VER, {
      blocked() {
        // 首次升级被其它标签页 / 后台 PWA 实例的旧连接挡住：提示用户释放。
        showToast('本地数据库被其它页面占用，正在等待其它页面释放…', { kind: 'error' });
      },
      upgrade(db, oldVersion) {
        for (const name of ['files', 'blobs', 'kv'] as const) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('mem_banks')) db.createObjectStore('mem_banks');
          if (!db.objectStoreNames.contains('mem_srs')) db.createObjectStore('mem_srs');
          if (!db.objectStoreNames.contains('mem_attempts')) db.createObjectStore('mem_attempts', { autoIncrement: true });
        }
      },
      terminated() {
        dbPromise = null;
        showToast('本地数据库连接已断开，请刷新页面', { kind: 'error' });
      },
    }).then((db) => {
      if (settled) {
        // 已超时：丢弃迟到的连接，避免它反过来阻塞其它页面升级。
        db.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      const release = () => {
        try { db.close(); } catch { /* 已关闭 */ }
        dbPromise = null;
      };
      // 手机 PWA 切后台 / 关闭页面时主动释放连接，降低后续升级被旧连接阻塞的概率。
      if (typeof window !== 'undefined') window.addEventListener('pagehide', release, { once: true });
      // 其它标签页请求升级时主动让路，否则本连接会把对方永久 blocked。
      db.onversionchange = () => {
        release();
        showToast('数据库已在其它标签页升级，请刷新本页', { kind: 'error' });
      };
      resolve(db);
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** 删库（自愈/清空用）：同样限时，避免被旧连接阻塞后永久挂起。 */
function deleteDb(name: string = dbName): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DbBlockedError());
    }, DB_TIMEOUT_MS);
    void deleteDB(name, {
      blocked() {
        showToast('旧页面仍占用数据库，请关闭其它标签页后重试', { kind: 'error' });
      },
    }).then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
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
    dbPromise = open().catch(async (err) => {
      // 自愈：结构损坏/版本冲突 → 删库重建
      // 不能调用 clearAllData()：它会 await 本函数正在构造的 dbPromise，导致死锁
      dbPromise = null;
      // 被旧连接阻塞：不删库（删库同样会被阻塞且会丢数据），交给 UI 提示 / 重试。
      if (err instanceof DbBlockedError) throw err;
      await deleteDb();
      const retry = open().catch((e) => {
        dbPromise = null;
        throw e;
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
/** 关闭当前仓库库连接（切换仓库/清库前调用；可重复调用）。 */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  const db = await pending.catch(() => null);
  db?.close();
}

/** 当前仓库的 IndexedDB 名（默认仓库为 mdreader，其余为 mdreader-<repoId>）。 */
export function getRepoDbName(): string {
  return dbName;
}

/**
 * 切换当前仓库的库作用域。必须先关闭旧连接再打开新库；
 * 启动阶段（main.tsx）在渲染前调用，运行期切换仓库通过整页刷新完成。
 */
export async function setRepoDbName(name: string): Promise<void> {
  if (name === dbName) return;
  await closeDb();
  dbName = name;
}

/** 仅清空当前仓库库（单元测试与单仓库清理用）；清空所有仓库请用 repos.clearAllLibraries。 */
export async function clearAllData(): Promise<void> {
  const name = dbName;
  await closeDb();
  await deleteDb(name);
}
