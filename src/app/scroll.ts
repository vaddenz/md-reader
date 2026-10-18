import type { Location } from 'react-router-dom';

/**
 * 历史滚动位置记忆（T16）：按 react-router 的 location.key 记录每个历史条目的滚动位置。
 * 内存 Map 为主 + sessionStorage 持久化（刷新/恢复会话后仍可还原）；`takeScroll` 为消费语义。
 */

const STORAGE_KEY = 'mdreader.scroll';

const mem = new Map<string, number>();
let loaded = false;

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    // 隐私模式等场景访问 sessionStorage 会抛错：退化为纯内存记录
    return undefined;
  }
}

/** 首次访问时把持久化记录读入内存（损坏数据静默忽略）。 */
function load(): void {
  if (loaded) return;
  loaded = true;
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, y] of Object.entries(parsed)) {
      if (typeof y === 'number' && Number.isFinite(y) && y >= 0) mem.set(key, y);
    }
  } catch {
    // 持久化数据损坏：丢弃，仅用内存
  }
}

function persist(): void {
  const data: Record<string, number> = {};
  for (const [key, y] of mem) data[key] = y;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 配额/权限问题：持久化失败不影响内存记录
  }
}

/** 历史条目标识：react-router 的 location.key（首次进入为 "default"）。 */
export function keyFromLocation(loc: Pick<Location, 'key'>): string {
  return loc.key;
}

/** 记录某历史条目的滚动位置（覆盖旧值）。 */
export function rememberScroll(key: string, y: number): void {
  load();
  mem.set(key, Math.max(0, Math.round(y)));
  persist();
}

/** 取走某历史条目的滚动位置：取过一次即删除（消费语义）；无记录返回 undefined。 */
export function takeScroll(key: string): number | undefined {
  load();
  const y = mem.get(key);
  if (y === undefined) return undefined;
  mem.delete(key);
  persist();
  return y;
}
