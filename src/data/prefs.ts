import { kvGet, kvSet } from './db';
import { serialize } from './serialize';

/**
 * 用户偏好（T19）：收藏与阅读进度。
 * kv 键约定（spec §5）：`favorites` = string[]；`progress` = {[path]:{ratio,headingId?,updatedAt}}。
 */

/** 单篇文档的阅读进度记录。 */
export interface ProgressRecord {
  /** 阅读位置比例 [0,1]（scrollY / max(1, scrollHeight - innerHeight)）。 */
  ratio: number;
  /** 最近可见标题 id（辅助字段，恢复以 ratio 为准）。 */
  headingId?: string;
  /** 写入时间（ms）：recentDocs 按此降序。 */
  updatedAt: number;
}

/** 「继续阅读」条目。 */
export interface RecentDoc { path: string; updatedAt: number }

const FAVORITES_KEY = 'favorites';
const PROGRESS_KEY = 'progress';

/** kv 数据可能被旧版本/外部写入损坏：非字符串项直接丢弃。 */
function sanitizeFavorites(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
}

/** 同上：仅保留 ratio 为有限数的条目，比例钳制到 [0,1]，updatedAt 缺失按 0。 */
function sanitizeProgress(raw: unknown): Record<string, ProgressRecord> {
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

async function readProgress(): Promise<Record<string, ProgressRecord>> {
  return sanitizeProgress(await kvGet<unknown>(PROGRESS_KEY));
}

/** 收藏列表（按加入顺序）。 */
export async function getFavorites(): Promise<string[]> {
  return sanitizeFavorites(await kvGet<unknown>(FAVORITES_KEY));
}

/** 切换收藏：已收藏则移除、未收藏则追加；返回切换后的完整列表。 */
export function toggleFavorite(path: string): Promise<string[]> {
  return serialize(async () => {
    const cur = await getFavorites();
    const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path];
    await kvSet(FAVORITES_KEY, next);
    return next;
  });
}

/** 写入某文档的阅读进度（比例钳制到 [0,1]；不传 headingId 时不保留旧值）。 */
export function saveProgress(path: string, ratio: number, headingId?: string): Promise<void> {
  return serialize(async () => {
    const all = await readProgress();
    const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
    all[path] = {
      ratio: clamped,
      ...(headingId ? { headingId } : {}),
      updatedAt: Date.now(),
    };
    await kvSet(PROGRESS_KEY, all);
  });
}

/** 某文档的阅读进度；无记录返回 undefined。 */
export async function getProgress(path: string): Promise<ProgressRecord | undefined> {
  return (await readProgress())[path];
}

/** 最近阅读（按 updatedAt 降序，最多 limit 条）。 */
export async function recentDocs(limit = 3): Promise<RecentDoc[]> {
  const all = await readProgress();
  return Object.entries(all)
    .map(([path, rec]) => ({ path, updatedAt: rec.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit));
}
