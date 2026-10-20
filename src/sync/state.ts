const STATE_KEY = 'mdreader.syncState';

export interface RepoScopeState {
  cursor: number;
  lastSyncAt: number | null;
  lastError?: string;
}

export interface SyncState {
  version: 1;
  lastSyncAt: number | null;
  lastError: { message: string; at: number } | null;
  repos: Record<string, RepoScopeState>;
}

/** localStorage 不可用时的内存回退（隐私模式等），避免同步进度在运行期丢失。 */
let memoryState: SyncState | null = null;

const emptyState = (): SyncState => ({ version: 1, lastSyncAt: null, lastError: null, repos: {} });

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function sanitizeSyncState(raw: unknown): SyncState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyState();
  const r = raw as Partial<SyncState>;
  const repos: Record<string, RepoScopeState> = {};
  if (r.repos && typeof r.repos === 'object' && !Array.isArray(r.repos)) {
    for (const [scope, value] of Object.entries(r.repos)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Partial<RepoScopeState>;
      repos[scope] = {
        cursor: typeof v.cursor === 'number' && Number.isFinite(v.cursor) ? v.cursor : 0,
        lastSyncAt: typeof v.lastSyncAt === 'number' ? v.lastSyncAt : null,
        ...(typeof v.lastError === 'string' ? { lastError: v.lastError } : {}),
      };
    }
  }
  return {
    version: 1,
    lastSyncAt: typeof r.lastSyncAt === 'number' ? r.lastSyncAt : null,
    lastError: r.lastError && typeof r.lastError.message === 'string'
      ? { message: r.lastError.message, at: typeof r.lastError.at === 'number' ? r.lastError.at : 0 }
      : null,
    repos,
  };
}

export function loadSyncState(): SyncState {
  // 内存态优先：setItem 失败（配额/隐私模式）时写入只存在于内存，
  // 若先读 storage 会把旧值读回来，导致 cursor 静默回滚。
  if (memoryState) return memoryState;
  const storage = safeStorage();
  if (storage) {
    try {
      const raw = storage.getItem(STATE_KEY);
      if (raw) memoryState = sanitizeSyncState(JSON.parse(raw));
    } catch {
      // 损坏数据回退内存/空状态
    }
  }
  return memoryState ?? emptyState();
}

export function saveSyncState(next: SyncState): void {
  memoryState = sanitizeSyncState(next);
  try {
    safeStorage()?.setItem(STATE_KEY, JSON.stringify(memoryState));
  } catch {
    // localStorage 不可用（隐私模式/配额）：本次运行以内存为准
  }
}

export function cursorOf(scope: string): number {
  return loadSyncState().repos[scope]?.cursor ?? 0;
}

export function updateRepoState(scope: string, patch: Partial<RepoScopeState>): void {
  const state = loadSyncState();
  const next: RepoScopeState = { cursor: 0, lastSyncAt: null };
  Object.assign(next, state.repos[scope], patch);
  saveSyncState({ ...state, repos: { ...state.repos, [scope]: next } });
}

/** 换库/重新配置后清空每 scope 的 cursor 与 lastSyncAt，保留全局 lastSyncAt/lastError。 */
export function resetSyncCursors(): void {
  const state = loadSyncState();
  const repos = Object.fromEntries(
    Object.entries(state.repos).map(([scope]) => [scope, { cursor: 0, lastSyncAt: null }]),
  );
  saveSyncState({ ...state, repos });
}

export function clearSyncState(): void {
  memoryState = null;
  try {
    safeStorage()?.removeItem(STATE_KEY);
  } catch {
    // 忽略
  }
}
