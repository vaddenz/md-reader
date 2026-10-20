const DEVICE_KEY = 'mdreader.syncDeviceId';

let cachedDeviceId: string | null = null;
let lastUpdatedAt = 0;

function safeStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fallthrough */ }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  const storage = safeStorage();
  const saved = storage?.getItem(DEVICE_KEY);
  if (saved) { cachedDeviceId = saved; return saved; }
  const id = randomId();
  cachedDeviceId = id;
  try { storage?.setItem(DEVICE_KEY, id); } catch { /* 内存回退 */ }
  return id;
}

/** 单调递增：同一设备同一毫秒的两次写不会得到相同时间戳。 */
export function nextUpdatedAt(now = Date.now(), atLeast = 0): number {
  lastUpdatedAt = Math.max(now, lastUpdatedAt + 1, atLeast + 1);
  return lastUpdatedAt;
}

/** GitHub owner/repo 不区分大小写；branch 区分大小写。 */
export function repoScope(owner: string, repo: string, branch: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}@${branch.trim()}`;
}

/** 清除全部数据时调用：删除设备 ID 并重置内存缓存。 */
export function clearDeviceId(): void {
  cachedDeviceId = null;
  lastUpdatedAt = 0;
  try { safeStorage()?.removeItem(DEVICE_KEY); } catch { /* ignore */ }
}

/** 仅测试用：重置模块内缓存。 */
export function resetDeviceCacheForTests(): void {
  cachedDeviceId = null;
  lastUpdatedAt = 0;
}
