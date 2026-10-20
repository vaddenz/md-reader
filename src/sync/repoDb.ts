import type { IDBPDatabase } from 'idb';
import { getRepoDbName, openDb, openNamedDb } from '../data/db';
import { serialize } from '../data/serialize';

export interface RepoDb {
  readonly name: string;
  readonly active: boolean;
  readonly db: IDBPDatabase;
  kvGet<T>(key: string): Promise<T | undefined>;
  kvSet(key: string, value: unknown): Promise<void>;
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  put(store: string, value: unknown, key?: IDBValidKey): Promise<void>;
  add(store: string, value: unknown): Promise<IDBValidKey>;
  del(store: string, key: IDBValidKey): Promise<void>;
  close(): void;
}

export async function openRepoDb(name: string): Promise<RepoDb> {
  const active = name === getRepoDbName();
  const db = active ? await openDb() : await openNamedDb(name);
  return {
    name,
    active,
    db,
    kvGet: <T>(key: string) => db.get('kv', key) as Promise<T | undefined>,
    kvSet: async (key, value) => { await db.put('kv', value, key); },
    get: <T>(store: string, key: IDBValidKey) => db.get(store, key) as Promise<T | undefined>,
    getAll: <T>(store: string) => db.getAll(store) as Promise<T[]>,
    put: async (store, value, key) => {
      if (key === undefined) await db.put(store, value);
      else await db.put(store, value, key);
    },
    add: (store, value) => db.add(store, value),
    del: async (store, key) => { await db.delete(store, key); },
    close: () => { if (!active) db.close(); },
  };
}

/** 当前仓库的写入与 UI 写入共用 serialize；非当前仓库没有 UI 竞争，直接执行。 */
export function withWriteLock<T>(db: RepoDb, task: () => Promise<T>): Promise<T> {
  return db.active ? serialize(task) : task();
}
