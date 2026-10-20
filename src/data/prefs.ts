import { openDb } from './db';
import { serialize } from './serialize';
import { nextUpdatedAt } from '../sync/device';
import { commitWithNotify, enqueueChange } from '../sync/outbox';
import { clearTombstoneTx, putTombstone } from '../sync/tombstones';
import { COLLECTIONS } from '../sync/collections/names';

/**
 * 用户偏好（T19）：收藏与阅读进度。
 * kv 键约定（spec §5/§7）：`progress` = {[path]:{ratio,headingId?,updatedAt}}；
 * `favoritesV2` = {[path]:{addedAt}}（旧 `favorites` string[] 首次读取时迁移）。
 */

/** 单篇文档的阅读进度记录。 */
export interface ProgressRecord {
  /** 阅读位置比例 [0,1]（scrollY / max(1, scrollHeight - innerHeight)）。 */
  ratio: number;
  /** 最近可见标题 id（辅助字段，恢复以 ratio 为准）。 */
  headingId?: string;
  /** 写入时间（ms）：recentDocs 排序与 LWW 合并依据。 */
  updatedAt: number;
}

/** 「继续阅读」条目。 */
export interface RecentDoc { path: string; updatedAt: number }

/** 收藏记录：addedAt 同时作为同步时间戳。 */
export interface FavoriteRecord { addedAt: number }

const FAVORITES_KEY = 'favorites';
const FAVORITES_V2_KEY = 'favoritesV2';
const PROGRESS_KEY = 'progress';

/** 旧收藏数组可能被旧版本/外部写入损坏：非字符串项直接丢弃。 */
export function sanitizeFavorites(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
}

/** V2 收藏表：非对象项丢弃，缺失 addedAt 按 0（迁移前的老数据）。 */
export function sanitizeFavoritesV2(raw: unknown): Record<string, FavoriteRecord> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, FavoriteRecord> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!path) continue;
    const addedAt = value && typeof value === 'object' && typeof (value as FavoriteRecord).addedAt === 'number'
      ? (value as FavoriteRecord).addedAt : 0;
    out[path] = { addedAt: Number.isFinite(addedAt) ? addedAt : 0 };
  }
  return out;
}

/** V2 存在时以 V2 为准；否则按旧数组顺序迁移（addedAt = index）。 */
export function favoritesMapFrom(v2: unknown, legacy: unknown): Record<string, FavoriteRecord> {
  if (v2 !== undefined) return sanitizeFavoritesV2(v2);
  return Object.fromEntries(sanitizeFavorites(legacy).map((path, index) => [path, { addedAt: index }]));
}

/** 对外列表顺序：先收藏在前（addedAt 升序），同时间按 path 字典序稳定排序。 */
export function sortFavorites(map: Record<string, FavoriteRecord>): string[] {
  return Object.entries(map)
    .sort(([pa, a], [pb, b]) => a.addedAt - b.addedAt || pa.localeCompare(pb))
    .map(([path]) => path);
}

/** 仅保留 ratio 为有限数的条目，比例钳制到 [0,1]，updatedAt 缺失按 0。 */
export function sanitizeProgress(raw: unknown): Record<string, ProgressRecord> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ProgressRecord> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const rec = value as Partial<ProgressRecord>;
    if (typeof rec.ratio !== 'number' || !Number.isFinite(rec.ratio)) continue;
    out[path] = {
      ratio: Math.min(1, Math.max(0, rec.ratio)),
      ...(typeof rec.headingId === 'string' && rec.headingId ? { headingId: rec.headingId } : {}),
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : 0,
    };
  }
  return out;
}

/** 读改写 kv 所需的最小 store 接口（idb 的事务 store）。 */
interface KvWriteStore {
  get(key: string): Promise<unknown>;
  put(value: unknown, key: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/** 读取 / 迁移 V2；调用方必须传入包含 kv 的读写事务 store。 */
async function readFavoritesMap(store: KvWriteStore): Promise<Record<string, FavoriteRecord>> {
  const v2 = await store.get(FAVORITES_V2_KEY);
  const map = favoritesMapFrom(v2, v2 === undefined ? await store.get(FAVORITES_KEY) : undefined);
  if (v2 === undefined) {
    await store.put(map, FAVORITES_V2_KEY);
    await store.delete(FAVORITES_KEY);
  }
  return map;
}

/** 收藏列表（按加入顺序）。首次调用会把旧 `favorites` 迁移到 `favoritesV2`。 */
export async function getFavorites(): Promise<string[]> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    const map = await readFavoritesMap(tx.objectStore('kv'));
    await tx.done;
    return sortFavorites(map);
  });
}

/** 切换收藏：已收藏则移除（写 tombstone）、未收藏则追加；返回切换后的完整列表。 */
export function toggleFavorite(path: string): Promise<string[]> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const map = await readFavoritesMap(kv);
    const current = map[path];
    const at = nextUpdatedAt(Date.now(), current?.addedAt ?? 0);
    if (current) {
      delete map[path];
      await putTombstone(tx, COLLECTIONS.favorites, path, at);
      enqueueChange(tx, { collection: COLLECTIONS.favorites, recordId: path, updatedAt: at, deleted: true });
    } else {
      map[path] = { addedAt: at };
      await clearTombstoneTx(tx, COLLECTIONS.favorites, path);
      enqueueChange(tx, { collection: COLLECTIONS.favorites, recordId: path, updatedAt: at, deleted: false });
    }
    await kv.put(map, FAVORITES_V2_KEY);
    await commitWithNotify(tx);
    return sortFavorites(map);
  });
}

/** 写入某文档的阅读进度与 outbox（同一事务；比例钳制到 [0,1]；不传 headingId 时不保留旧值）。 */
export function saveProgress(path: string, ratio: number, headingId?: string): Promise<void> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeProgress(await kv.get(PROGRESS_KEY));
    const at = nextUpdatedAt(Date.now(), all[path]?.updatedAt ?? 0);
    const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
    all[path] = { ratio: clamped, ...(headingId ? { headingId } : {}), updatedAt: at };
    await kv.put(all, PROGRESS_KEY);
    await clearTombstoneTx(tx, COLLECTIONS.progress, path);
    enqueueChange(tx, { collection: COLLECTIONS.progress, recordId: path, updatedAt: at, deleted: false });
    await commitWithNotify(tx);
  });
}

/** 某文档的阅读进度；无记录返回 undefined。 */
export async function getProgress(path: string): Promise<ProgressRecord | undefined> {
  const all = sanitizeProgress(await (await openDb()).get('kv', PROGRESS_KEY));
  return all[path];
}

/** 最近阅读（按 updatedAt 降序，最多 limit 条）。 */
export async function recentDocs(limit = 3): Promise<RecentDoc[]> {
  const all = sanitizeProgress(await (await openDb()).get('kv', PROGRESS_KEY));
  return Object.entries(all)
    .map(([path, rec]) => ({ path, updatedAt: rec.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit));
}
