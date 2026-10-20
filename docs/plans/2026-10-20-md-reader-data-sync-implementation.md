# md-reader v1.7 跨设备数据同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 md-reader 中加入可扩展的跨设备数据同步：阅读进度、高亮、收藏、记忆 SRS / 训练记录 / 题库偏好，首批后端为 Neon Postgres Data API。

**Architecture:** 远端是一张通用记录表（scope + collection + record_id + payload + LWW 时间戳），客户端用「集合适配器」把业务数据映射成记录；每个仓库 IndexedDB 内维护 outbox，同步引擎遍历全部仓库执行「拉取 → 应用 reset → seed → 应用远端 → 推送」。后端通过 `SyncBackend` 接口 + 注册表扩展。

**Tech Stack:** React 18 + TypeScript + Vite + IndexedDB (`idb`) + Vitest + Playwright；Neon Data API 通过原生 `fetch` 访问，不新增运行时依赖。

**Spec:** `docs/specs/2026-10-20-data-sync-design.md`

## Global Constraints

- 不新增运行时依赖；Node ≥ 20。
- `package.json` 版本从 `1.6.1` 升到 `1.7.0`。
- `SCHEMA_VER` 从 2 升到 3；只新增 `sync_outbox`，不破坏旧 store。
- 自动同步默认 **关闭**（`autoSync: false`）；关闭时只有「立即同步」会发网络请求。
- 同步范围：阅读进度、高亮、收藏、记忆 SRS、训练记录、题库偏好；不同步正文、GitHub Token、AI Key / 模型配置、当前训练会话、打开标签页、阅读外观。
- 冲突：服务端 `(updatedAt, deviceId)` 条件 upsert；客户端拉取时 `remote.updatedAt >= local.updatedAt` 即应用远端（平局远端胜）。
- 所有用户可见文案为简体中文；JWT 只存 localStorage、只出现在 `Authorization` 头，绝不写 URL / 日志 / 错误消息。
- 现有测试必须全绿；每个任务结束提交一次。

---

## 文件结构

### 新建

```
src/sync/types.ts
src/sync/device.ts
src/sync/repoDb.ts
src/sync/config.ts
src/sync/state.ts
src/sync/registry.ts
src/sync/merge.ts
src/sync/outbox.ts
src/sync/engine.ts
src/sync/DataSyncContext.tsx
src/sync/backends/neon.ts
src/sync/backends/neonSetup.ts
src/sync/backends/index.ts
src/sync/collections/names.ts
src/sync/collections/index.ts
src/sync/collections/progress.ts
src/sync/collections/highlights.ts
src/sync/collections/favorites.ts
src/sync/collections/memorySrs.ts
src/sync/collections/memoryAttempts.ts
src/sync/collections/memorySelection.ts
src/components/SyncSetupSection.tsx
src/pages/SettingsSyncPage.tsx
scripts/sync-jwt.mjs
docs/sync-neon-setup.md
docs/acceptance-2026-10-20-data-sync.md
```

### 修改

```
src/data/db.ts
src/data/prefs.ts
src/data/highlights.ts
src/data/memory.ts
src/pages/DocPage.tsx
src/pages/HomePage.tsx
src/pages/SettingsDataPage.tsx
src/pages/SettingsPage.tsx
src/components/AboutSection.tsx
src/app/nav.ts
src/App.tsx
src/styles/settings.css
package.json
README.md
PRODUCT.md
DESIGN.md
.gitignore
tests/unit/prefs.test.ts
tests/unit/highlights.test.ts
tests/unit/memory.test.ts
tests/unit/db-migrate.test.ts
tests/e2e/settings.spec.ts
```

### 新增测试

```
tests/unit/sync-foundation.test.ts
tests/unit/sync-config-state.test.ts
tests/unit/sync-outbox.test.ts
tests/unit/sync-neon.test.ts
tests/unit/sync-collections-reading.test.ts
tests/unit/sync-collections-memory.test.ts
tests/unit/sync-engine.test.ts
tests/unit/sync-jwt.test.ts
tests/e2e/data-sync.spec.ts
```

---

## Task 1: IndexedDB v3、RepoDb、设备 ID 与时间戳

**Files:**
- Modify: `src/data/db.ts:9-79`
- Create: `src/sync/types.ts`
- Create: `src/sync/device.ts`
- Create: `src/sync/repoDb.ts`
- Create: `src/sync/collections/names.ts`
- Test: `tests/unit/sync-foundation.test.ts`
- Test: `tests/unit/db-migrate.test.ts`

**Interfaces:**
- Produces: `SCHEMA_VER = 3`, `upgradeDb(db, oldVersion)`, `openNamedDb(name)`
- Produces: `RepoDb`（`kvGet/kvSet/get/getAll/put/add/del/close`，`active`、`db`）
- Produces: `openRepoDb(name)`, `withWriteLock(db, task)`
- Produces: `getDeviceId()`, `nextUpdatedAt(now?, atLeast?)`, `repoScope(owner, repo, branch)`
- Produces: `COLLECTIONS` 常量

- [ ] **Step 1: 写 schema v3 与工具函数的失败测试**

```ts
// tests/unit/sync-foundation.test.ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, closeDb, openDb, openNamedDb } from '../../src/data/db';
import { getDeviceId, nextUpdatedAt, repoScope } from '../../src/sync/device';
import { openRepoDb } from '../../src/sync/repoDb';

const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

beforeEach(async () => {
  vi.stubGlobal('localStorage', storage);
  store.clear();
  await clearAllData();
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllGlobals();
});

describe('IndexedDB v3', () => {
  it('新增 sync_outbox，旧数据仍可读', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mdreader', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['files', 'blobs', 'kv', 'mem_banks', 'mem_srs', 'mem_attempts']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(42, 'legacy');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    expect(db.objectStoreNames.contains('sync_outbox')).toBe(true);
    expect((await db.get('kv', 'legacy'))).toBe(42);
    const tx = db.transaction('sync_outbox', 'readonly');
    expect(tx.store.indexNames.contains('collection')).toBe(true);
  });

  it('openNamedDb 打开非当前仓库库，调用方可关闭', async () => {
    const db = await openNamedDb('mdreader-test-other');
    expect(db.objectStoreNames.contains('sync_outbox')).toBe(true);
    db.close();
    await openNamedDb('mdreader-test-other').then((d) => d.close());
  });
});

describe('device / scope / 时间戳', () => {
  it('设备 ID 稳定；缺失时生成并写回', () => {
    const a = getDeviceId();
    expect(a).toBe(getDeviceId());
    expect(localStorage.getItem('mdreader.syncDeviceId')).toBe(a);
  });

  it('nextUpdatedAt 严格递增，且至少大于 atLeast', () => {
    const a = nextUpdatedAt(1000);
    const b = nextUpdatedAt(1000);
    const c = nextUpdatedAt(1000, 5000);
    expect(a).toBeGreaterThanOrEqual(1000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(5000);
  });

  it('repoScope 归一化 owner/repo，保留 branch 大小写', () => {
    expect(repoScope(' VaddenZ ', 'My-Notes', 'Feature/X')).toBe('vaddenz/my-notes@Feature/X');
  });
});

describe('openRepoDb', () => {
  it('当前库 active=true 且 close 不关闭全局连接', async () => {
    const db = await openRepoDb('mdreader');
    expect(db.active).toBe(true);
    db.close();
    expect((await openDb()).objectStoreNames.contains('sync_outbox')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/sync-foundation.test.ts`
Expected: FAIL，`openNamedDb` / `nextUpdatedAt` / `openRepoDb` 未定义。

- [ ] **Step 3: 实现 db.ts schema v3**

把 `src/data/db.ts` 的 `SCHEMA_VER` 改为 `export const SCHEMA_VER = 3;`，把 `open()` 内联的 `upgrade` 抽成：

```ts
export function upgradeDb(db: IDBPDatabase, oldVersion: number): void {
  for (const name of ['files', 'blobs', 'kv'] as const) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
  }
  if (oldVersion < 2) {
    if (!db.objectStoreNames.contains('mem_banks')) db.createObjectStore('mem_banks');
    if (!db.objectStoreNames.contains('mem_srs')) db.createObjectStore('mem_srs');
    if (!db.objectStoreNames.contains('mem_attempts')) db.createObjectStore('mem_attempts', { autoIncrement: true });
  }
  if (oldVersion < 3) {
    if (!db.objectStoreNames.contains('sync_outbox')) {
      const store = db.createObjectStore('sync_outbox', { keyPath: 'id' });
      store.createIndex('collection', 'collection');
    }
  }
}
```

`open()` 改为 `openDB(dbName, SCHEMA_VER, { blocked, upgrade: upgradeDb, terminated })`。在 `openDb` 下方增加：

```ts
/** 打开指定仓库库（用于同步非当前仓库）；不做删库自愈，调用方负责 close。 */
export function openNamedDb(name: string): Promise<IDBPDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DbBlockedError());
    }, DB_TIMEOUT_MS);

    void openDB(name, SCHEMA_VER, {
      upgrade: upgradeDb,
      blocked() {
        // 同步引擎把该仓库标记为 blocked；这里不弹 toast，避免后台同步打扰阅读。
      },
      terminated() {
        // 调用方会在 finally 关闭临时连接。
      },
    }).then((db) => {
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
```

- [ ] **Step 4: 创建同步基础类型与常量**

```ts
// src/sync/types.ts
export type SyncErrorKind = 'config' | 'auth' | 'notfound' | 'network' | 'server' | 'parse';

export class SyncError extends Error {
  constructor(public kind: SyncErrorKind, message: string, public status?: number) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface SyncConfig {
  version: 1;
  enabled: boolean;
  autoSync: boolean;
  backend: string;
  values: Record<string, string>;
}

export interface BackendField {
  key: string;
  label: string;
  type: 'url' | 'password' | 'text';
  placeholder?: string;
  help?: string;
  required: boolean;
}

export interface TestResult { warning?: string }

export interface SyncRecord {
  scope: string;
  collection: string;
  recordId: string;
  payload: unknown;
  updatedAt: number;
  deleted: boolean;
  deviceId: string;
}

export interface RemoteRecord extends SyncRecord {
  serverUpdatedAt: number;
}

export interface LocalRecord {
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  payload: unknown | null;
}

export interface SyncBackend {
  test(signal?: AbortSignal): Promise<TestResult>;
  pull(scope: string, since: number, signal?: AbortSignal): Promise<RemoteRecord[]>;
  push(records: readonly SyncRecord[], signal?: AbortSignal): Promise<void>;
}

export interface SyncBackendDefinition {
  type: string;
  label: string;
  description: string;
  fields: BackendField[];
  create(values: Readonly<Record<string, string>>): SyncBackend;
  validate?(values: Readonly<Record<string, string>>): string | null;
}

export interface SyncCollection {
  name: string;
  label: string;
  listLocal(db: RepoDb): Promise<LocalRecord[]>;
  getLocal(db: RepoDb, recordId: string): Promise<LocalRecord | undefined>;
  applyRemote(db: RepoDb, record: RemoteRecord): Promise<boolean>;
  clearBefore?(db: RepoDb, before: number): Promise<void>;
}

// 这里只声明类型，避免 types.ts 反向依赖 repoDb.ts 的实现。
import type { RepoDb } from './repoDb';
```

把 import 放到文件顶部（TypeScript 允许 type-only import 在末尾，但建议放顶部）。

```ts
// src/sync/collections/names.ts
export const COLLECTIONS = {
  progress: 'reading.progress',
  highlights: 'reading.highlights',
  favorites: 'reading.favorites',
  memorySrs: 'memory.srs',
  memoryAttempts: 'memory.attempts',
  memorySelection: 'memory.selection',
} as const;

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];
export const RESET_RECORD_ID = '__reset__';
```

- [ ] **Step 5: 创建 device.ts**

```ts
// src/sync/device.ts
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
```

- [ ] **Step 6: 创建 repoDb.ts**

```ts
// src/sync/repoDb.ts
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
```

- [ ] **Step 7: 更新 db-migrate 测试**

```ts
// tests/unit/db-migrate.test.ts
expect(db.objectStoreNames.contains('sync_outbox')).toBe(true);
```

Run: `npx vitest run tests/unit/sync-foundation.test.ts tests/unit/db-migrate.test.ts`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/data/db.ts src/sync/types.ts src/sync/device.ts src/sync/repoDb.ts src/sync/collections/names.ts tests/unit/sync-foundation.test.ts tests/unit/db-migrate.test.ts
git commit -m "feat(sync): IndexedDB v3、RepoDb 与设备时间戳基础"
```

---

## Task 2: 同步配置、状态与后端注册表

**Files:**
- Create: `src/sync/config.ts`
- Create: `src/sync/state.ts`
- Create: `src/sync/registry.ts`
- Test: `tests/unit/sync-config-state.test.ts`

**Interfaces:**
- Produces: `loadSyncConfig()`, `saveSyncConfig(next)`, `clearSyncConfig()`, `syncConfigFingerprint(config)`
- Produces: `loadSyncState()`, `saveSyncState(state)`, `cursorOf(scope)`, `updateRepoState(scope, patch)`, `resetSyncCursors()`, `clearSyncState()`
- Produces: `registerSyncBackend(def)`, `listSyncBackends()`, `getSyncBackend(type)`, `createSyncBackend(config)`, `isSyncConfigured(config)`, `shouldAutoSync(config, online)`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/sync-config-state.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSyncConfig, loadSyncConfig, saveSyncConfig, syncConfigFingerprint,
} from '../../src/sync/config';
import {
  clearSyncState, cursorOf, loadSyncState, resetSyncCursors, updateRepoState,
} from '../../src/sync/state';
import {
  createSyncBackend, isSyncConfigured, listSyncBackends, registerSyncBackend, shouldAutoSync,
} from '../../src/sync/registry';
import type { SyncBackendDefinition } from '../../src/sync/types';

const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

beforeEach(() => {
  vi.stubGlobal('localStorage', storage);
  store.clear();
});

describe('sync config', () => {
  it('默认 autoSync=false；值 trim、只保留字符串', () => {
    expect(loadSyncConfig()).toMatchObject({ version: 1, enabled: false, autoSync: false, backend: 'neon' });
    saveSyncConfig({
      version: 1, enabled: true, autoSync: true, backend: 'neon',
      values: { endpoint: ' https://x/ ', token: ' t ', bad: 42 as unknown as string },
    });
    expect(loadSyncConfig()).toEqual({
      version: 1, enabled: true, autoSync: true, backend: 'neon',
      values: { endpoint: 'https://x', token: 't' },
    });
    expect(syncConfigFingerprint(loadSyncConfig())).toContain('neon');
    clearSyncConfig();
    expect(loadSyncConfig().enabled).toBe(false);
  });
});

describe('sync state', () => {
  it('cursor 与 lastSync 持久化；reset 只清 cursor', () => {
    updateRepoState('a/b@main', { cursor: 1234 });
    expect(cursorOf('a/b@main')).toBe(1234);
    resetSyncCursors();
    expect(cursorOf('a/b@main')).toBe(0);
    expect(loadSyncState().lastSyncAt).toBeNull();
    clearSyncState();
    expect(loadSyncState()).toMatchObject({ lastSyncAt: null, lastError: null, repos: {} });
  });
});

describe('registry', () => {
  const fake: SyncBackendDefinition = {
    type: 'fake', label: 'Fake', description: 'test', fields: [{ key: 'token', label: 'Token', type: 'password', required: true }],
    validate: (v) => (v.token ? null : '缺少 token'),
    create: () => ({ test: async () => ({}), pull: async () => [], push: async () => {} }),
  };

  it('注册、查找、创建、配置判断', () => {
    registerSyncBackend(fake);
    expect(listSyncBackends().some((d) => d.type === 'fake')).toBe(true);
    const cfg = { version: 1 as const, enabled: true, autoSync: false, backend: 'fake', values: { token: 't' } };
    expect(isSyncConfigured(cfg)).toBe(true);
    expect(createSyncBackend(cfg)).toBeTruthy();
    expect(() => createSyncBackend({ ...cfg, values: {} })).toThrow('缺少 token');
    expect(shouldAutoSync(cfg, true)).toBe(false);
    expect(shouldAutoSync({ ...cfg, autoSync: true }, true)).toBe(true);
    expect(shouldAutoSync({ ...cfg, autoSync: true }, false)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/sync-config-state.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 config.ts**

```ts
// src/sync/config.ts
import type { SyncConfig } from './types';

const CONFIG_KEY = 'mdreader.syncConfig';

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  version: 1,
  enabled: false,
  autoSync: false,
  backend: 'neon',
  values: {},
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function sanitizeSyncConfig(raw: unknown): SyncConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SYNC_CONFIG };
  const r = raw as Partial<SyncConfig>;
  const values: Record<string, string> = {};
  if (r.values && typeof r.values === 'object' && !Array.isArray(r.values)) {
    for (const [key, value] of Object.entries(r.values)) {
      if (typeof value === 'string') values[key] = value.trim();
    }
  }
  if (values.endpoint) values.endpoint = values.endpoint.replace(/\/+$/, '');
  return {
    version: 1,
    enabled: r.enabled === true,
    autoSync: r.autoSync === true,
    backend: text(r.backend) || DEFAULT_SYNC_CONFIG.backend,
    values,
  };
}

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = safeStorage()?.getItem(CONFIG_KEY);
    return raw ? sanitizeSyncConfig(JSON.parse(raw)) : { ...DEFAULT_SYNC_CONFIG };
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

export function saveSyncConfig(next: SyncConfig): SyncConfig {
  const clean = sanitizeSyncConfig(next);
  try { safeStorage()?.setItem(CONFIG_KEY, JSON.stringify(clean)); } catch { /* 内存态由调用方持有 */ }
  return clean;
}

export function clearSyncConfig(): void {
  try { safeStorage()?.removeItem(CONFIG_KEY); } catch { /* ignore */ }
}

/** 配置变化判断：endpoint/token/backend 变化时清 cursor；autoSync 单独切换不影响。 */
export function syncConfigFingerprint(config: SyncConfig): string {
  return [config.backend, config.values.endpoint ?? '', config.values.token ?? ''].join('\n');
}
```

- [ ] **Step 4: 实现 state.ts**

```ts
// src/sync/state.ts
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

let memoryState: SyncState | null = null;

const emptyState = (): SyncState => ({ version: 1, lastSyncAt: null, lastError: null, repos: {} });

function safeStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
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
  if (memoryState) return memoryState;
  try {
    const raw = safeStorage()?.getItem(STATE_KEY);
    memoryState = raw ? sanitizeSyncState(JSON.parse(raw)) : emptyState();
  } catch {
    memoryState = emptyState();
  }
  return memoryState;
}

export function saveSyncState(next: SyncState): void {
  memoryState = sanitizeSyncState(next);
  try { safeStorage()?.setItem(STATE_KEY, JSON.stringify(memoryState)); } catch { /* 内存回退 */ }
}

export function cursorOf(scope: string): number {
  return loadSyncState().repos[scope]?.cursor ?? 0;
}

export function updateRepoState(scope: string, patch: Partial<RepoScopeState>): void {
  const state = loadSyncState();
  saveSyncState({
    ...state,
    repos: { ...state.repos, [scope]: { cursor: 0, lastSyncAt: null, ...state.repos[scope], ...patch } },
  });
}

export function resetSyncCursors(): void {
  const state = loadSyncState();
  const repos = Object.fromEntries(Object.entries(state.repos).map(([scope]) => [scope, { cursor: 0, lastSyncAt: null }]));
  saveSyncState({ ...state, repos });
}

export function clearSyncState(): void {
  memoryState = emptyState();
  try { safeStorage()?.removeItem(STATE_KEY); } catch { /* ignore */ }
}
```

- [ ] **Step 5: 实现 registry.ts**

```ts
// src/sync/registry.ts
import type { SyncBackend, SyncBackendDefinition, SyncConfig } from './types';
import { SyncError } from './types';

const definitions = new Map<string, SyncBackendDefinition>();

export function registerSyncBackend(def: SyncBackendDefinition): void {
  definitions.set(def.type, def);
}

export function listSyncBackends(): SyncBackendDefinition[] {
  return [...definitions.values()];
}

export function getSyncBackend(type: string): SyncBackendDefinition | undefined {
  return definitions.get(type);
}

export function createSyncBackend(config: SyncConfig): SyncBackend {
  const def = getSyncBackend(config.backend);
  if (!def) throw new SyncError('config', '未知同步后端');
  const error = def.validate?.(config.values);
  if (error) throw new SyncError('config', error);
  return def.create(config.values);
}

export function isSyncConfigured(config: SyncConfig): boolean {
  if (!config.enabled) return false;
  const def = getSyncBackend(config.backend);
  if (!def) return false;
  if (def.validate) return def.validate(config.values) === null;
  return def.fields.every((f) => !f.required || Boolean(config.values[f.key]?.trim()));
}

export function shouldAutoSync(config: SyncConfig, online: boolean): boolean {
  return online && config.enabled && config.autoSync && isSyncConfigured(config);
}
```

- [ ] **Step 6: 运行测试并提交**

Run: `npx vitest run tests/unit/sync-config-state.test.ts`
Expected: PASS。

```bash
git add src/sync/config.ts src/sync/state.ts src/sync/registry.ts tests/unit/sync-config-state.test.ts
git commit -m "feat(sync): 配置、状态与后端注册表"
```

---

## Task 3: Outbox 变更队列

**Files:**
- Create: `src/sync/outbox.ts`
- Test: `tests/unit/sync-outbox.test.ts`

**Interfaces:**
- Produces: `OUTBOX_STORE = 'sync_outbox'`
- Produces: `enqueueChange(tx, change)`, `readOutbox(db)`, `deleteOutboxIfRev(db, id, rev)`, `removeOutboxAtOrBefore(db, collection, before)`, `countOutbox(db)`, `seedCollectionOutbox(db, collection, resetAt)`
- Consumes: `RepoDb`, `SyncCollection`, `COLLECTIONS`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/sync-outbox.test.ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { openRepoDb } from '../../src/sync/repoDb';
import {
  countOutbox, deleteOutboxIfRev, enqueueChange, readOutbox, removeOutboxAtOrBefore, seedCollectionOutbox,
} from '../../src/sync/outbox';
import type { SyncCollection } from '../../src/sync/types';

beforeEach(async () => { await clearAllData(); });

describe('outbox', () => {
  it('同一记录 upsert 去重、rev 更新；rev 不匹配不删除', async () => {
    const repo = await openRepoDb('mdreader');
    const tx = repo.db.transaction('sync_outbox', 'readwrite');
    enqueueChange(tx, { collection: 'reading.progress', recordId: 'a.md', updatedAt: 1, deleted: false });
    enqueueChange(tx, { collection: 'reading.progress', recordId: 'a.md', updatedAt: 2, deleted: false });
    await tx.done;

    const [entry] = await readOutbox(repo);
    expect(entry.updatedAt).toBe(2);
    expect(entry.rev).toBeTruthy();
    expect(await deleteOutboxIfRev(repo, entry.id, 'wrong')).toBe(false);
    expect(await countOutbox(repo)).toBe(1);
    expect(await deleteOutboxIfRev(repo, entry.id, entry.rev)).toBe(true);
    expect(await countOutbox(repo)).toBe(0);
    repo.close();
  });

  it('reset 前清理旧条目，保留 reset 自身', async () => {
    const repo = await openRepoDb('mdreader');
    const tx = repo.db.transaction('sync_outbox', 'readwrite');
    enqueueChange(tx, { collection: 'memory.srs', recordId: 'q1', updatedAt: 10, deleted: false });
    enqueueChange(tx, { collection: 'memory.srs', recordId: '__reset__', updatedAt: 20, deleted: true, payload: { before: 20 } });
    await tx.done;
    await removeOutboxAtOrBefore(repo, 'memory.srs', 20);
    const left = await readOutbox(repo);
    expect(left.map((e) => e.recordId)).toEqual(['__reset__']);
    repo.close();
  });

  it('seedCollectionOutbox 只入队 reset 之后的记录', async () => {
    const repo = await openRepoDb('mdreader');
    const collection: SyncCollection = {
      name: 'test.collection', label: 'Test',
      listLocal: async () => [
        { recordId: 'old', updatedAt: 5, deleted: false, payload: { v: 5 } },
        { recordId: 'new', updatedAt: 15, deleted: false, payload: { v: 15 } },
      ],
      getLocal: async () => undefined,
      applyRemote: async () => false,
    };
    await seedCollectionOutbox(repo, collection, 10);
    const entries = await readOutbox(repo);
    expect(entries.map((e) => e.recordId)).toEqual(['new']);
    repo.close();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/sync-outbox.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 outbox.ts**

```ts
// src/sync/outbox.ts
import type { IDBPTransaction } from 'idb';
import type { RepoDb } from './repoDb';
import type { SyncCollection } from './types';

export const OUTBOX_STORE = 'sync_outbox';

export interface OutboxEntry {
  id: string;
  collection: string;
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  rev: string;
  payload?: unknown;
}

export interface OutboxChange {
  collection: string;
  recordId: string;
  updatedAt: number;
  deleted: boolean;
  payload?: unknown;
}

// idb 的 schema 泛型在跨模块时很难精确匹配；这里用宽类型，调用点仍然只操作 sync_outbox。
type OutboxTx = IDBPTransaction<any, any, any>;

function newRev(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fallthrough */ }
  return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function outboxId(collection: string, recordId: string): string {
  return `${collection}\u0000${recordId}`;
}

/** 在已包含 sync_outbox 的读写事务中入队 / 覆盖一条变更。 */
export function enqueueChange(tx: OutboxTx, change: OutboxChange): void {
  const entry: OutboxEntry = {
    id: outboxId(change.collection, change.recordId),
    collection: change.collection,
    recordId: change.recordId,
    updatedAt: change.updatedAt,
    deleted: change.deleted,
    rev: newRev(),
    ...(change.payload !== undefined ? { payload: change.payload } : {}),
  };
  void tx.objectStore(OUTBOX_STORE).put(entry);
}

export async function readOutbox(db: RepoDb): Promise<OutboxEntry[]> {
  return db.getAll<OutboxEntry>(OUTBOX_STORE);
}

export async function countOutbox(db: RepoDb): Promise<number> {
  return (await readOutbox(db)).length;
}

export async function deleteOutboxIfRev(db: RepoDb, id: string, rev: string): Promise<boolean> {
  const tx = db.db.transaction(OUTBOX_STORE, 'readwrite');
  const store = tx.objectStore(OUTBOX_STORE);
  const current = await store.get(id) as OutboxEntry | undefined;
  if (!current || current.rev !== rev) { await tx.done; return false; }
  await store.delete(id);
  await tx.done;
  return true;
}

export async function removeOutboxAtOrBefore(db: RepoDb, collection: string, before: number): Promise<void> {
  const tx = db.db.transaction(OUTBOX_STORE, 'readwrite');
  const store = tx.objectStore(OUTBOX_STORE);
  const all = await store.getAll() as OutboxEntry[];
  for (const entry of all) {
    if (entry.collection !== collection) continue;
    if (entry.recordId === '__reset__') continue;
    if (entry.updatedAt <= before) await store.delete(entry.id);
  }
  await tx.done;
}

export async function seedCollectionOutbox(
  db: RepoDb,
  collection: SyncCollection,
  resetAt: number,
): Promise<void> {
  const records = await collection.listLocal(db);
  const tx = db.db.transaction(OUTBOX_STORE, 'readwrite');
  for (const record of records) {
    // resetAt=0 表示没有 reset；不能把 updatedAt=0 的旧收藏/旧偏好过滤掉。
    if (resetAt > 0 && record.updatedAt <= resetAt) continue;
    enqueueChange(tx, {
      collection: collection.name,
      recordId: record.recordId,
      updatedAt: record.updatedAt,
      deleted: record.deleted,
      // 普通 seed 条目不带 payload：推送时从本地读当前值，避免 seed 后又被编辑时推送旧数据。
    });
  }
  await tx.done;
}
```

- [ ] **Step 4: 运行测试并提交**

Run: `npx vitest run tests/unit/sync-outbox.test.ts`
Expected: PASS。

```bash
git add src/sync/outbox.ts tests/unit/sync-outbox.test.ts
git commit -m "feat(sync): outbox 变更队列与按集合 seed"
```

---

## Task 4: Neon Data API 后端与初始化 SQL

**Files:**
- Create: `src/sync/backends/neon.ts`
- Create: `src/sync/backends/neonSetup.ts`
- Create: `src/sync/backends/index.ts`
- Test: `tests/unit/sync-neon.test.ts`

**Interfaces:**
- Produces: `neonDefinition: SyncBackendDefinition`
- Produces: `NEON_SETUP_SQL: string`, `NEON_SETUP_STEPS: string[]`
- Consumes: `SyncBackend`, `SyncRecord`, `RemoteRecord`, `SyncError`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/sync-neon.test.ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { neonDefinition } from '../../src/sync/backends/neon';
import type { SyncRecord } from '../../src/sync/types';

const values = { endpoint: 'https://sync.example/rest/v1/', token: 'a.b.c' };

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function jwt(payload: Record<string, unknown>): string {
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('neon backend', () => {
  it('test：解码 sub、读表、写探测、删除探测', async () => {
    const calls: string[] = [];
    const token = jwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 86400 });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    const result = await backend.test();
    expect(result.warning).toBeUndefined();
    expect(calls[0]).toContain('GET https://sync.example/rest/v1/sync_records');
    expect(calls[1]).toContain('POST https://sync.example/rest/v1/rpc/sync_upsert');
    expect(calls[2]).toContain('DELETE https://sync.example/rest/v1/sync_records');
  });

  it('test：JWT 缺少 sub 抛 config 错误；401 抛 auth', async () => {
    const noSub = neonDefinition.create({ endpoint: values.endpoint, token: jwt({ exp: 9999999999 }) });
    await expect(noSub.test()).rejects.toMatchObject({ kind: 'config' });

    const token = jwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 86400 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    await expect(backend.test()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('pull：分页拼接、解析 server_updated_at、scope 编码', async () => {
    // 第一页必须正好 500 条才会触发第二页。
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      collection: 'reading.progress', record_id: `p${i}`, payload: { ratio: i }, updated_at: i,
      deleted: false, device_id: 'd', server_updated_at: '2026-10-20T00:00:00.000Z',
    }));
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(seen.length === 1 ? page1 : []), { status: 200 });
    }));
    const token = jwt({ sub: 'md-reader' });
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    const rows = await backend.pull('VaddenZ/Notes@main', 0);
    expect(rows).toHaveLength(500);
    expect(rows[0].serverUpdatedAt).toBe(Date.parse('2026-10-20T00:00:00.000Z'));
    expect(seen[0]).toContain('scope=eq.VaddenZ%2FNotes%40main');
    expect(seen[1]).toContain('offset=500');
  });

  it('push：RPC body 使用 p_records，按主键去重', async () => {
    let body: { p_records: SyncRecord[] } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    }));
    const token = jwt({ sub: 'md-reader' });
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    const rec = (id: string): SyncRecord => ({
      scope: 'a/b@main', collection: 'reading.progress', recordId: id, payload: null,
      updatedAt: 1, deleted: true, deviceId: 'd',
    });
    await backend.push([rec('x'), rec('x'), rec('y')]);
    expect(body!.p_records).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/sync-neon.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 neon.ts**

```ts
// src/sync/backends/neon.ts
import { SyncError, type RemoteRecord, type SyncBackend, type SyncBackendDefinition, type SyncRecord, type TestResult } from '../types';

const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 500;

interface NeonConfig { endpoint: string; token: string }

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export class NeonBackend implements SyncBackend {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(config: NeonConfig) {
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.token = config.token.trim();
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      ...(extra ?? {}),
    };
  }

  private async request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      let res: Response;
      try {
        res = await fetch(`${this.endpoint}${path}`, {
          ...init,
          headers: this.headers(init.headers as Record<string, string> | undefined),
          signal: controller.signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new SyncError('network', '网络不可用，或 Neon CORS 未允许当前站点');
      }
      if (res.status === 401 || res.status === 403) throw new SyncError('auth', 'JWT 无效、已过期或没有权限', res.status);
      if (res.status === 404) throw new SyncError('notfound', '同步表不存在，请先执行初始化 SQL', 404);
      if (res.status >= 500) throw new SyncError('server', `Neon 服务端错误 ${res.status}`, res.status);
      if (!res.ok) throw new SyncError('server', `请求失败 ${res.status}`, res.status);
      return res;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async test(signal?: AbortSignal): Promise<TestResult> {
    const payload = decodeJwtPayload(this.token);
    if (!payload) throw new SyncError('config', 'JWT 格式不正确');
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new SyncError('config', 'JWT 缺少 sub');
    let warning: string | undefined;
    if (typeof payload.exp === 'number') {
      const left = payload.exp * 1000 - Date.now();
      if (left <= 0) throw new SyncError('auth', 'JWT 已过期');
      if (left < 30 * 86400_000) warning = `JWT 将在 ${Math.ceil(left / 86400_000)} 天后到期`;
    }

    await this.request('/sync_records?select=scope&limit=1', {}, signal);
    const probe: SyncRecord = {
      scope: '__probe__', collection: '__probe__', recordId: 'probe', payload: null,
      updatedAt: 0, deleted: true, deviceId: '__probe__',
    };
    await this.request('/rpc/sync_upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_records: [probe] }),
    }, signal);
    try {
      await this.request('/sync_records?scope=eq.__probe__&collection=eq.__probe__&record_id=eq.probe', {
        method: 'DELETE',
      }, signal);
    } catch {
      // 探测行残留不会进入任何集合适配器；清理失败不影响连接判定。
    }
    return warning ? { warning } : {};
  }

  async pull(scope: string, since: number, signal?: AbortSignal): Promise<RemoteRecord[]> {
    const out: RemoteRecord[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const params = new URLSearchParams({
        select: 'collection,record_id,payload,updated_at,deleted,device_id,server_updated_at',
        scope: `eq.${scope}`,
        order: 'server_updated_at.asc,collection.asc,record_id.asc',
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (since > 0) params.set('server_updated_at', `gte.${new Date(since).toISOString()}`);
      const res = await this.request(`/sync_records?${params.toString()}`, {}, signal);
      let rows: unknown;
      try { rows = await res.json(); } catch { throw new SyncError('parse', '响应不是合法 JSON'); }
      if (!Array.isArray(rows)) throw new SyncError('parse', '响应格式异常');
      for (const row of rows as Record<string, unknown>[]) {
        const serverUpdatedAt = Date.parse(String(row.server_updated_at ?? ''));
        if (!Number.isFinite(serverUpdatedAt)) continue;
        out.push({
          scope,
          collection: String(row.collection ?? ''),
          recordId: String(row.record_id ?? ''),
          payload: row.payload ?? null,
          updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
          deleted: row.deleted === true,
          deviceId: String(row.device_id ?? ''),
          serverUpdatedAt,
        });
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  async push(records: readonly SyncRecord[], signal?: AbortSignal): Promise<void> {
    const seen = new Set<string>();
    const unique = records.filter((r) => {
      const key = `${r.scope}\u0000${r.collection}\u0000${r.recordId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await this.request('/rpc/sync_upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_records: unique.map((r) => ({
          scope: r.scope,
          collection: r.collection,
          record_id: r.recordId,
          payload: r.payload,
          updated_at: r.updatedAt,
          deleted: r.deleted,
          device_id: r.deviceId,
        })),
      }),
    }, signal);
  }
}

export const neonDefinition: SyncBackendDefinition = {
  type: 'neon',
  label: 'Neon Postgres Data API',
  description: '使用你自己的 Neon Data API 地址与长期 JWT；数据存储在你自己的 Postgres。',
  fields: [
    {
      key: 'endpoint', label: '接口地址', type: 'url', required: true,
      placeholder: 'https://ep-xxx.apirest.region.aws.neon.tech/neondb/rest/v1',
      help: 'Neon Console → Data API 页面显示的 API URL。',
    },
    {
      key: 'token', label: 'JWT', type: 'password', required: true,
      placeholder: '粘贴长期 JWT',
      help: '只保存在本机浏览器；只写入 Authorization 请求头。',
    },
  ],
  validate(values) {
    const endpoint = values.endpoint?.trim() ?? '';
    const token = values.token?.trim() ?? '';
    if (!endpoint) return '请填写接口地址';
    if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/localhost(:\d+)?\//i.test(endpoint)) return '接口地址必须是 https://（本地开发可用 http://localhost）';
    if (!token) return '请填写 JWT';
    return null;
  },
  create(values) {
    return new NeonBackend({ endpoint: values.endpoint, token: values.token });
  },
};
```

- [ ] **Step 4: 创建初始化 SQL 常量与注册**

```ts
// src/sync/backends/neonSetup.ts
export const NEON_SETUP_STEPS = [
  '在 Neon Console 打开项目 → Postgres database → Data API，启用并复制 API URL。',
  '在 Data API Settings 配置 JWT 提供方（JWKS URL）；也可运行 node scripts/sync-jwt.mjs 生成本地长期 JWT。',
  '在 Neon SQL Editor 执行下面的初始化 SQL（只需一次）。',
  '在 Data API Settings → CORS allowed origins 填入本站来源。',
  '回到 md-reader 的「设置 › 跨设备同步」，粘贴 URL + JWT，测试连接后保存。',
];

export const NEON_SETUP_SQL = `-- 1. 通用同步记录表
create table if not exists public.sync_records (
  user_id text not null default (auth.user_id()),
  scope text not null,
  collection text not null,
  record_id text not null,
  payload jsonb,
  updated_at double precision not null,
  deleted boolean not null default false,
  device_id text not null default '',
  server_updated_at timestamptz not null default now(),
  primary key (user_id, scope, collection, record_id)
);

create index if not exists sync_records_pull_idx
  on public.sync_records (user_id, scope, server_updated_at);

alter table public.sync_records enable row level security;

drop policy if exists sync_records_own on public.sync_records;
create policy sync_records_own on public.sync_records
for all to authenticated
using (auth.user_id() = user_id)
with check (auth.user_id() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.sync_records to authenticated;

create or replace function public.sync_upsert(p_records jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.sync_records (
    user_id, scope, collection, record_id, payload, updated_at, deleted, device_id
  )
  select
    auth.user_id(), r.scope, r.collection, r.record_id, r.payload,
    r.updated_at, r.deleted, r.device_id
  from jsonb_to_recordset(coalesce(p_records, '[]'::jsonb)) as r(
    scope text,
    collection text,
    record_id text,
    payload jsonb,
    updated_at double precision,
    deleted boolean,
    device_id text
  )
  on conflict (user_id, scope, collection, record_id) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      device_id = excluded.device_id,
      server_updated_at = now()
  where (excluded.updated_at, excluded.device_id)
      > (sync_records.updated_at, sync_records.device_id);
end;
$$;

grant execute on function public.sync_upsert(jsonb) to authenticated;`;
```

```ts
// src/sync/backends/index.ts
import { registerSyncBackend } from '../registry';
import { neonDefinition } from './neon';

registerSyncBackend(neonDefinition);
```

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run tests/unit/sync-neon.test.ts`
Expected: PASS。

```bash
git add src/sync/backends tests/unit/sync-neon.test.ts
git commit -m "feat(sync): Neon Data API 后端与初始化 SQL"
```

---

## Task 5: 阅读进度与收藏（数据层 + 适配器）

**Files:**
- Modify: `src/data/prefs.ts`
- Create: `src/sync/collections/progress.ts`
- Create: `src/sync/collections/favorites.ts`
- Create: `src/sync/merge.ts`
- Test: `tests/unit/prefs.test.ts`
- Test: `tests/unit/sync-collections-reading.test.ts`

**Interfaces:**
- Produces: `sanitizeProgress`, `sanitizeFavorites`, `sanitizeFavoritesV2`, `favoritesMapFrom`, `sortFavorites`
- Produces: `progressCollection`, `favoritesCollection`
- Produces: `remoteWins(remoteUpdatedAt, localUpdatedAt)`

- [ ] **Step 1: 写进度 / 收藏 outbox 失败测试**

在 `tests/unit/prefs.test.ts` 增加：

```ts
import { openDb } from '../../src/data/db';
import type { OutboxEntry } from '../../src/sync/outbox';

async function outbox(): Promise<OutboxEntry[]> {
  const db = await openDb();
  return db.getAll('sync_outbox') as Promise<OutboxEntry[]>;
}

it('saveProgress 原子写 outbox，recordId=path', async () => {
  await saveProgress('a.md', 0.5);
  const [entry] = await outbox();
  expect(entry).toMatchObject({ collection: 'reading.progress', recordId: 'a.md', deleted: false });
  expect(entry.updatedAt).toBeGreaterThan(0);
});

it('收藏迁移为 favoritesV2，并写 upsert / tombstone', async () => {
  await kvSet('favorites', ['a.md', 'b.md']);
  expect(await getFavorites()).toEqual(['a.md', 'b.md']);
  expect(await kvGet('favoritesV2')).toEqual({ 'a.md': { addedAt: 0 }, 'b.md': { addedAt: 1 } });
  expect(await kvGet('favorites')).toBeUndefined();

  await toggleFavorite('a.md'); // 删除 → tombstone
  const entries = await outbox();
  const a = entries.find((e) => e.recordId === 'a.md')!;
  expect(a.deleted).toBe(true);
  await toggleFavorite('a.md'); // 重新收藏 → upsert 覆盖同一条
  const again = (await outbox()).find((e) => e.recordId === 'a.md')!;
  expect(again.deleted).toBe(false);
  expect(again.rev).not.toBe(a.rev);
});
```

- [ ] **Step 2: 写适配器失败测试**

```ts
// tests/unit/sync-collections-reading.test.ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { getProgress, saveProgress } from '../../src/data/prefs';
import { openRepoDb } from '../../src/sync/repoDb';
import { progressCollection } from '../../src/sync/collections/progress';
import { favoritesCollection } from '../../src/sync/collections/favorites';

beforeEach(async () => { await clearAllData(); });

describe('progress collection', () => {
  it('list / apply newer / apply tombstone / equal 远端获胜', async () => {
    const repo = await openRepoDb('mdreader');
    await saveProgress('a.md', 0.4, 'h');
    expect((await progressCollection.listLocal(repo))[0]).toMatchObject({ recordId: 'a.md', updatedAt: expect.any(Number) });

    const applied = await progressCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.9, updatedAt: 9999999999999 }, updatedAt: 9999999999999,
      deleted: false, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(applied).toBe(true);
    expect((await getProgress('a.md'))?.ratio).toBe(0.9);

    await progressCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.progress', recordId: 'a.md', payload: null,
      updatedAt: 9999999999999, deleted: true, deviceId: 'd', serverUpdatedAt: 2,
    });
    expect(await getProgress('a.md')).toBeUndefined();
    repo.close();
  });
});

describe('favorites collection', () => {
  it('legacy 迁移 + apply 删除', async () => {
    const repo = await openRepoDb('mdreader');
    await repo.kvSet('favorites', ['a.md']);
    const listed = await favoritesCollection.listLocal(repo);
    expect(listed[0]).toMatchObject({ recordId: 'a.md', updatedAt: 0 });
    await favoritesCollection.applyRemote(repo, {
      scope: 's', collection: 'reading.favorites', recordId: 'a.md', payload: null,
      updatedAt: 10, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
    });
    expect(await repo.kvGet('favoritesV2')).toEqual({});
    repo.close();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/unit/prefs.test.ts tests/unit/sync-collections-reading.test.ts`
Expected: FAIL（outbox 未写入、V2 未迁移、适配器不存在）。

- [ ] **Step 4: 实现 merge.ts**

```ts
// src/sync/merge.ts
/** 客户端拉取合并：远端时间戳 >= 本地即应用（平局由服务端/远端获胜）。 */
export function remoteWins(remoteUpdatedAt: number, localUpdatedAt: number | undefined): boolean {
  return localUpdatedAt === undefined || remoteUpdatedAt >= localUpdatedAt;
}
```

- [ ] **Step 5: 改造 prefs.ts**

完整替换 `src/data/prefs.ts` 的关键部分（保留现有导出名）：

```ts
import { openDb } from './db';
import { serialize } from './serialize';
import { nextUpdatedAt } from '../sync/device';
import { enqueueChange } from '../sync/outbox';
import { COLLECTIONS } from '../sync/collections/names';

export interface ProgressRecord { ratio: number; headingId?: string; updatedAt: number }
export interface RecentDoc { path: string; updatedAt: number }
export interface FavoriteRecord { addedAt: number }

const FAVORITES_KEY = 'favorites';
const FAVORITES_V2_KEY = 'favoritesV2';
const PROGRESS_KEY = 'progress';

export function sanitizeFavorites(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
}

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

export function favoritesMapFrom(v2: unknown, legacy: unknown): Record<string, FavoriteRecord> {
  if (v2 !== undefined) return sanitizeFavoritesV2(v2);
  return Object.fromEntries(sanitizeFavorites(legacy).map((path, index) => [path, { addedAt: index }]));
}

export function sortFavorites(map: Record<string, FavoriteRecord>): string[] {
  return Object.entries(map)
    .sort(([pa, a], [pb, b]) => a.addedAt - b.addedAt || pa.localeCompare(pb))
    .map(([path]) => path);
}

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

/** 读取 / 迁移 V2；调用方必须传入包含 kv 的读写事务 store。 */
async function readFavoritesMap(store: any): Promise<Record<string, FavoriteRecord>> {
  const v2 = await store.get(FAVORITES_V2_KEY);
  const map = favoritesMapFrom(v2, v2 === undefined ? await store.get(FAVORITES_KEY) : undefined);
  if (v2 === undefined) {
    await store.put(map, FAVORITES_V2_KEY);
    await store.delete(FAVORITES_KEY);
  }
  return map;
}

export async function getFavorites(): Promise<string[]> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    const map = await readFavoritesMap(tx.objectStore('kv'));
    await tx.done;
    return sortFavorites(map);
  });
}

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
      enqueueChange(tx, { collection: COLLECTIONS.favorites, recordId: path, updatedAt: at, deleted: true });
    } else {
      map[path] = { addedAt: at };
      enqueueChange(tx, { collection: COLLECTIONS.favorites, recordId: path, updatedAt: at, deleted: false });
    }
    await kv.put(map, FAVORITES_V2_KEY);
    await tx.done;
    return sortFavorites(map);
  });
}

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
    enqueueChange(tx, { collection: COLLECTIONS.progress, recordId: path, updatedAt: at, deleted: false });
    await tx.done;
  });
}

export async function getProgress(path: string): Promise<ProgressRecord | undefined> {
  const all = sanitizeProgress(await (await openDb()).get('kv', PROGRESS_KEY));
  return all[path];
}

export async function recentDocs(limit = 3): Promise<RecentDoc[]> {
  const all = sanitizeProgress(await (await openDb()).get('kv', PROGRESS_KEY));
  return Object.entries(all)
    .map(([path, rec]) => ({ path, updatedAt: rec.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit));
}
```

- [ ] **Step 6: 实现 progress / favorites 适配器**

```ts
// src/sync/collections/progress.ts
import { sanitizeProgress } from '../../data/prefs';
import { remoteWins } from '../merge';
import type { RepoDb } from '../repoDb';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const KEY = 'progress';

export const progressCollection: SyncCollection = {
  name: COLLECTIONS.progress,
  label: '阅读进度',
  async listLocal(db) {
    const map = sanitizeProgress(await db.kvGet(KEY));
    return Object.entries(map).map(([recordId, rec]) => ({
      recordId, updatedAt: rec.updatedAt, deleted: false, payload: rec,
    }));
  },
  async getLocal(db, recordId) {
    const rec = sanitizeProgress(await db.kvGet(KEY))[recordId];
    return rec ? { recordId, updatedAt: rec.updatedAt, deleted: false, payload: rec } : undefined;
  },
  async applyRemote(db, record) {
    const map = sanitizeProgress(await db.kvGet(KEY));
    const current = map[record.recordId];
    if (!remoteWins(record.updatedAt, current?.updatedAt)) return false;
    if (record.deleted) {
      if (!current) return false;
      delete map[record.recordId];
      await db.kvSet(KEY, map);
      return true;
    }
    const incoming = sanitizeProgress({ [record.recordId]: record.payload })[record.recordId];
    if (!incoming) return false;
    map[record.recordId] = incoming;
    await db.kvSet(KEY, map);
    return true;
  },
  async clearBefore(db, before) {
    const map = sanitizeProgress(await db.kvGet(KEY));
    let changed = false;
    for (const [path, rec] of Object.entries(map)) {
      if (rec.updatedAt <= before) { delete map[path]; changed = true; }
    }
    if (changed) await db.kvSet(KEY, map);
  },
};
```

```ts
// src/sync/collections/favorites.ts
import { favoritesMapFrom } from '../../data/prefs';
import { remoteWins } from '../merge';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const V2 = 'favoritesV2';
const LEGACY = 'favorites';

async function readMap(db: Parameters<SyncCollection['listLocal']>[0]) {
  const v2 = await db.kvGet(V2);
  const map = favoritesMapFrom(v2, v2 === undefined ? await db.kvGet(LEGACY) : undefined);
  if (v2 === undefined) {
    await db.kvSet(V2, map);
    await db.db.delete('kv', LEGACY);
  }
  return map;
}

export const favoritesCollection: SyncCollection = {
  name: COLLECTIONS.favorites,
  label: '收藏',
  async listLocal(db) {
    const map = await readMap(db);
    return Object.entries(map).map(([recordId, rec]) => ({
      recordId, updatedAt: rec.addedAt, deleted: false, payload: rec,
    }));
  },
  async getLocal(db, recordId) {
    const rec = (await readMap(db))[recordId];
    return rec ? { recordId, updatedAt: rec.addedAt, deleted: false, payload: rec } : undefined;
  },
  async applyRemote(db, record) {
    const map = await readMap(db);
    const current = map[record.recordId];
    if (!remoteWins(record.updatedAt, current?.addedAt)) return false;
    if (record.deleted) {
      if (!current) return false;
      delete map[record.recordId];
      await db.kvSet(V2, map);
      return true;
    }
    if (!record.payload || typeof record.payload !== 'object') return false;
    const addedAt = Number((record.payload as { addedAt?: unknown }).addedAt);
    map[record.recordId] = { addedAt: Number.isFinite(addedAt) ? addedAt : record.updatedAt };
    await db.kvSet(V2, map);
    return true;
  },
  async clearBefore(db, before) {
    const map = await readMap(db);
    let changed = false;
    for (const [path, rec] of Object.entries(map)) {
      if (rec.addedAt <= before) { delete map[path]; changed = true; }
    }
    if (changed) await db.kvSet(V2, map);
  },
};
```

注意：`favorites.ts` 里 `sortFavorites` / `sanitizeFavoritesV2` 未使用就删掉 import，保持 lint 干净。

- [ ] **Step 7: 运行测试并提交**

Run: `npx vitest run tests/unit/prefs.test.ts tests/unit/sync-collections-reading.test.ts`
Expected: PASS。

```bash
git add src/data/prefs.ts src/sync/merge.ts src/sync/collections/progress.ts src/sync/collections/favorites.ts tests/unit/prefs.test.ts tests/unit/sync-collections-reading.test.ts
git commit -m "feat(sync): 阅读进度与收藏同步适配器"
```

---

## Task 6: 高亮（数据层 + 适配器 + 阅读页刷新）

**Files:**
- Modify: `src/data/highlights.ts`
- Create: `src/sync/collections/highlights.ts`
- Modify: `src/pages/DocPage.tsx:17,239-256`
- Test: `tests/unit/highlights.test.ts`
- Test: `tests/unit/sync-collections-reading.test.ts`

**Interfaces:**
- Produces: `highlightsCollection`
- Consumes: `COLLECTIONS.highlights`, `enqueueChange`, `nextUpdatedAt`

- [ ] **Step 1: 增加高亮 outbox 失败测试**

在 `tests/unit/highlights.test.ts` 增加：

```ts
import { openDb, kvGet } from '../../src/data/db';
import type { OutboxEntry } from '../../src/sync/outbox';

async function outbox(): Promise<OutboxEntry[]> {
  return (await openDb()).getAll('sync_outbox') as Promise<OutboxEntry[]>;
}

it('addHighlight 入队 upsert；removeHighlights 入队 tombstone 且时间更新', async () => {
  await addHighlight('a.md', rec('h1', '甲'));
  const [added] = await outbox();
  expect(added).toMatchObject({
    collection: 'reading.highlights', recordId: 'h1', deleted: false, updatedAt: 1000,
  });

  await removeHighlights('a.md', ['h1']);
  const removed = (await outbox()).find((e) => e.recordId === 'h1')!;
  expect(removed.deleted).toBe(true);
  expect(removed.updatedAt).toBeGreaterThan(1000);
});

it('importHighlights 入队导入记录', async () => {
  const json = JSON.stringify({
    formatVersion: 1,
    highlights: { 'a.md': [rec('h9', '导入')] },
  });
  await importHighlights(json);
  const entries = await outbox();
  expect(entries.some((e) => e.recordId === 'h9' && !e.deleted)).toBe(true);
});
```

- [ ] **Step 2: 写高亮适配器测试**

在 `tests/unit/sync-collections-reading.test.ts` 增加：

```ts
import { addHighlight } from '../../src/data/highlights';
import { highlightsCollection } from '../../src/sync/collections/highlights';

it('highlights：list 带 path，apply 删除 tombstone', async () => {
  const repo = await openRepoDb('mdreader');
  await addHighlight('a.md', {
    id: 'h1', exact: '甲', prefix: '', suffix: '', decorations: [{ kind: 'bg', color: 'yellow' }], createdAt: 1000,
  });
  const [local] = await highlightsCollection.listLocal(repo);
  expect(local.payload).toMatchObject({ path: 'a.md', record: { id: 'h1' } });

  await highlightsCollection.applyRemote(repo, {
    scope: 's', collection: 'reading.highlights', recordId: 'h1', payload: null,
    updatedAt: 2000, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
  });
  expect((await repo.kvGet('highlights'))).toEqual({});
  repo.close();
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/unit/highlights.test.ts tests/unit/sync-collections-reading.test.ts`
Expected: FAIL。

- [ ] **Step 4: 改造 highlights.ts**

把 `addHighlight` / `removeHighlights` / `importHighlights` 改为原子事务：

```ts
import { openDb } from './db';
import { serialize } from './serialize';
import { nextUpdatedAt } from '../sync/device';
import { enqueueChange } from '../sync/outbox';
import { COLLECTIONS } from '../sync/collections/names';

export function addHighlight(path: string, rec: HighlightRecord): Promise<void> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeHighlights(await kv.get(HIGHLIGHTS_KEY));
    all[path] = [...(all[path] ?? []), rec];
    await kv.put(all, HIGHLIGHTS_KEY);
    enqueueChange(tx, {
      collection: COLLECTIONS.highlights, recordId: rec.id, updatedAt: rec.createdAt, deleted: false,
    });
    await tx.done;
  });
}

export function removeHighlights(path: string, ids: string[]): Promise<void> {
  return serialize(async () => {
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeHighlights(await kv.get(HIGHLIGHTS_KEY));
    const list = all[path] ?? [];
    const found = list.filter((r) => ids.includes(r.id));
    const rest = list.filter((r) => !ids.includes(r.id));
    if (rest.length) all[path] = rest; else delete all[path];
    await kv.put(all, HIGHLIGHTS_KEY);
    const now = Date.now();
    for (const rec of found) {
      enqueueChange(tx, {
        collection: COLLECTIONS.highlights, recordId: rec.id,
        updatedAt: nextUpdatedAt(now, rec.createdAt), deleted: true,
      });
    }
    await tx.done;
  });
}
```

`importHighlights` 改为同样的事务；在写入合并结果后，对每个 `imported` 记录入队：

```ts
export function importHighlights(json: string): Promise<{ imported: number; skipped: number }> {
  return serialize(async () => {
    const parsed = JSON.parse(json) as { formatVersion?: unknown; highlights?: unknown };
    if (parsed?.formatVersion !== HIGHLIGHT_FORMAT_VERSION) throw new Error('不支持的格式版本');
    const incoming = sanitizeHighlights(parsed.highlights);
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const all = sanitizeHighlights(await kv.get(HIGHLIGHTS_KEY));
    let imported = 0; let skipped = 0;
    const key = (p: string, r: HighlightRecord) => `${p}\u0000${r.exact}\u0000${JSON.stringify(r.decorations)}`;
    for (const [path, list] of Object.entries(incoming)) {
      const existing = new Set((all[path] ?? []).map((r) => key(path, r)));
      for (const r of list) {
        if (existing.has(key(path, r))) { skipped += 1; continue; }
        existing.add(key(path, r));
        all[path] = [...(all[path] ?? []), r];
        enqueueChange(tx, {
          collection: COLLECTIONS.highlights, recordId: r.id, updatedAt: r.createdAt, deleted: false,
        });
        imported += 1;
      }
    }
    await kv.put(all, HIGHLIGHTS_KEY);
    await tx.done;
    return { imported, skipped };
  });
}
```

- [ ] **Step 5: 实现高亮适配器**

```ts
// src/sync/collections/highlights.ts
import { sanitizeHighlights, type HighlightRecord } from '../../data/highlights';
import { remoteWins } from '../merge';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const KEY = 'highlights';

interface Payload { path: string; record: HighlightRecord }

function findRecord(map: Record<string, HighlightRecord[]>, id: string): { path: string; record: HighlightRecord } | undefined {
  for (const [path, list] of Object.entries(map)) {
    const record = list.find((r) => r.id === id);
    if (record) return { path, record };
  }
  return undefined;
}

export const highlightsCollection: SyncCollection = {
  name: COLLECTIONS.highlights,
  label: '文本高亮',
  async listLocal(db) {
    const map = sanitizeHighlights(await db.kvGet(KEY));
    const out = [];
    for (const [path, list] of Object.entries(map)) {
      for (const record of list) {
        out.push({ recordId: record.id, updatedAt: record.createdAt, deleted: false, payload: { path, record } });
      }
    }
    return out;
  },
  async getLocal(db, recordId) {
    const found = findRecord(sanitizeHighlights(await db.kvGet(KEY)), recordId);
    return found ? { recordId, updatedAt: found.record.createdAt, deleted: false, payload: found } : undefined;
  },
  async applyRemote(db, record) {
    const map = sanitizeHighlights(await db.kvGet(KEY));
    const found = findRecord(map, record.recordId);
    if (!remoteWins(record.updatedAt, found?.record.createdAt)) return false;
    if (record.deleted) {
      if (!found) return false;
      map[found.path] = map[found.path].filter((r) => r.id !== record.recordId);
      if (!map[found.path].length) delete map[found.path];
      await db.kvSet(KEY, map);
      return true;
    }
    const payload = record.payload as Payload | null;
    if (!payload?.path || !payload.record) return false;
    if (found) {
      map[found.path] = map[found.path].filter((r) => r.id !== record.recordId);
      if (!map[found.path].length) delete map[found.path];
    }
    map[payload.path] = [...(map[payload.path] ?? []), payload.record];
    await db.kvSet(KEY, map);
    return true;
  },
  async clearBefore(db, before) {
    const map = sanitizeHighlights(await db.kvGet(KEY));
    let changed = false;
    for (const [path, list] of Object.entries(map)) {
      const rest = list.filter((r) => r.createdAt > before);
      if (rest.length !== list.length) { changed = true; if (rest.length) map[path] = rest; else delete map[path]; }
    }
    if (changed) await db.kvSet(KEY, map);
  },
};
```

- [ ] **Step 6: DocPage 监听同步事件并重锚高亮**

在 `DocPage` 组件内加 `const [syncTick, setSyncTick] = useState(0);`，并增加：

```ts
useEffect(() => {
  const onApplied = () => {
    const el = contentRef.current;
    if (el && appliedRef.current.size) {
      removeMarks(el, [...appliedRef.current.keys()]);
      appliedRef.current = new Map();
    }
    setSyncTick((v) => v + 1);
  };
  window.addEventListener('mdreader:sync-applied', onApplied);
  return () => window.removeEventListener('mdreader:sync-applied', onApplied);
}, []);
```

把高亮 effect 的依赖从 `[html, path]` 改为 `[html, path, syncTick]`。

- [ ] **Step 7: 运行测试并提交**

Run: `npx vitest run tests/unit/highlights.test.ts tests/unit/sync-collections-reading.test.ts`
Expected: PASS。

```bash
git add src/data/highlights.ts src/sync/collections/highlights.ts src/pages/DocPage.tsx tests/unit/highlights.test.ts tests/unit/sync-collections-reading.test.ts
git commit -m "feat(sync): 高亮同步与阅读页刷新"
```

---

## Task 7: 记忆助手数据（SRS / 训练记录 / 题库偏好）

**Files:**
- Modify: `src/data/memory.ts`
- Create: `src/sync/collections/memorySrs.ts`
- Create: `src/sync/collections/memoryAttempts.ts`
- Create: `src/sync/collections/memorySelection.ts`
- Test: `tests/unit/memory.test.ts`
- Test: `tests/unit/sync-collections-memory.test.ts`

**Interfaces:**
- Produces: `memorySrsCollection`, `memoryAttemptsCollection`, `memorySelectionCollection`
- Consumes: `COLLECTIONS`, `enqueueChange`, `nextUpdatedAt`, `RESET_RECORD_ID`

- [ ] **Step 1: 增加 memory outbox / reset 失败测试**

在 `tests/unit/memory.test.ts` 增加：

```ts
import type { OutboxEntry } from '../../src/sync/outbox';
async function outbox(): Promise<OutboxEntry[]> {
  return (await openDb()).getAll('sync_outbox') as Promise<OutboxEntry[]>;
}

it('putSrs / appendAttempt 写 outbox；attempt 用稳定键', async () => {
  await putSrs(srs('q1'));
  await appendAttempt(attempt());
  const entries = await outbox();
  expect(entries.find((e) => e.collection === 'memory.srs')).toMatchObject({ recordId: 'q1', deleted: false });
  expect(entries.find((e) => e.collection === 'memory.attempts')).toMatchObject({
    recordId: `q1|${NOW}|ai`, updatedAt: NOW, deleted: false,
  });
});

it('saveSelection 只在 banks/filters 变化时入队', async () => {
  await saveSelection({ ...DEFAULT_SELECTION, banks: ['b.jsonl'] });
  const first = (await outbox()).filter((e) => e.collection === 'memory.selection');
  expect(first).toHaveLength(1);
  const updatedAt = first[0].updatedAt;
  await saveSelection({ ...DEFAULT_SELECTION, banks: ['b.jsonl'], sessionSize: 50 });
  const second = (await outbox()).filter((e) => e.collection === 'memory.selection');
  expect(second[0].updatedAt).toBe(updatedAt); // 训练设置变化不刷新
});

it('clearTrainingData 写 reset 标记并更新 syncReset', async () => {
  await putSrs(srs('q1'));
  await appendAttempt(attempt());
  await clearTrainingData();
  const entries = await outbox();
  const resets = entries.filter((e) => e.recordId === '__reset__');
  expect(resets).toHaveLength(2);
  expect(entries.filter((e) => e.recordId !== '__reset__')).toHaveLength(0);
  expect(resets.every((e) => e.deleted && e.payload)).toBe(true);
  expect(await kvGet('syncReset')).toMatchObject({ 'memory.srs': expect.any(Number), 'memory.attempts': expect.any(Number) });
});
```

- [ ] **Step 2: 写适配器失败测试**

```ts
// tests/unit/sync-collections-memory.test.ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../../src/data/db';
import { appendAttempt, loadSrsMap, putSrs, saveSelection, getSelection } from '../../src/data/memory';
import { openRepoDb } from '../../src/sync/repoDb';
import { memorySrsCollection } from '../../src/sync/collections/memorySrs';
import { memoryAttemptsCollection } from '../../src/sync/collections/memoryAttempts';
import { memorySelectionCollection } from '../../src/sync/collections/memorySelection';
import type { SrsState } from '../../src/lib/srs';

const NOW = 1_760_000_000_000;
const srs = (qid: string): SrsState => ({
  qid, bankPath: 'b', id: qid, stage: 0, dueAt: NOW, lastAt: NOW, firstAt: NOW,
  lastScore: null, verdict: 'again', reps: 1, lapses: 0,
});

beforeEach(async () => { await clearAllData(); });

it('srs：远端更新覆盖，reset 清理', async () => {
  const repo = await openRepoDb('mdreader');
  await putSrs(srs('q1'));
  await memorySrsCollection.applyRemote(repo, {
    scope: 's', collection: 'memory.srs', recordId: 'q1', payload: { ...srs('q1'), stage: 3, lastAt: NOW + 1 },
    updatedAt: NOW + 1, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
  });
  expect((await loadSrsMap()).get('q1')?.stage).toBe(3);
  await memorySrsCollection.clearBefore!(repo, NOW + 1);
  expect((await loadSrsMap()).size).toBe(0);
  repo.close();
});

it('attempts：远端新增、tombstone 删除', async () => {
  const repo = await openRepoDb('mdreader');
  await appendAttempt({
    qid: 'q1', bankPath: 'b', idLabel: 'Q1', ts: NOW, mode: 'ai', score: 80, verdict: 'good',
    answer: 'a', hit: [], missed: [], comment: '', durationMs: 1, hintUsed: false, revealed: false,
  });
  await memoryAttemptsCollection.applyRemote(repo, {
    scope: 's', collection: 'memory.attempts', recordId: `q1|${NOW}|ai`, payload: null,
    updatedAt: NOW + 1, deleted: true, deviceId: 'd', serverUpdatedAt: 1,
  });
  expect((await repo.getAll('mem_attempts')).length).toBe(0);
  repo.close();
});

it('selection：只替换 banks/filters，保留本地训练设置', async () => {
  const repo = await openRepoDb('mdreader');
  await saveSelection({ ...(await getSelection()), banks: ['local.jsonl'], sessionSize: 50, newPerDay: 3 });
  await memorySelectionCollection.applyRemote(repo, {
    scope: 's', collection: 'memory.selection', recordId: 'selection',
    payload: { banks: ['remote.jsonl'], filters: { kinds: ['single'], chapters: [], types: [], tags: [], difficulty: [] }, updatedAt: NOW + 10 },
    updatedAt: NOW + 10, deleted: false, deviceId: 'd', serverUpdatedAt: 1,
  });
  const sel = await getSelection();
  expect(sel.banks).toEqual(['remote.jsonl']);
  expect(sel.sessionSize).toBe(50);
  expect(sel.newPerDay).toBe(3);
  repo.close();
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/unit/memory.test.ts tests/unit/sync-collections-memory.test.ts`
Expected: FAIL。

- [ ] **Step 4: 改造 memory.ts**

关键改动：

```ts
import { openDb } from './db';
import { nextUpdatedAt } from '../sync/device';
import { enqueueChange } from '../sync/outbox';
import { COLLECTIONS, RESET_RECORD_ID } from '../sync/collections/names';

export interface MemorySelection {
  banks: string[];
  filters: MemoryFilters;
  sessionSize: number;
  newPerDay: number;
  updatedAt?: number;
}
```

`sanitizeSelection` 保留 `updatedAt`：

```ts
...(typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? { updatedAt: r.updatedAt } : {}),
```

`putSrs`：

```ts
export async function putSrs(state: SrsState): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'sync_outbox'], 'readwrite');
  await tx.objectStore('mem_srs').put(state, state.qid);
  enqueueChange(tx, {
    collection: COLLECTIONS.memorySrs, recordId: state.qid, updatedAt: state.lastAt, deleted: false,
  });
  await tx.done;
}
```

`appendAttempt`：

```ts
export async function appendAttempt(a: Omit<MemoryAttempt, 'id'>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['mem_attempts', 'sync_outbox'], 'readwrite');
  await tx.objectStore('mem_attempts').add(a);
  enqueueChange(tx, {
    collection: COLLECTIONS.memoryAttempts, recordId: attemptKey(a), updatedAt: a.ts, deleted: false,
  });
  await tx.done;
}
```

`saveSelection`：

```ts
export function saveSelection(sel: MemorySelection): Promise<void> {
  const clean = sanitizeSelection(sel);
  return serialize(async () => {
    writeGlobalJson(GLOBAL_TRAINING_KEY, { sessionSize: clean.sessionSize, newPerDay: clean.newPerDay });
    const db = await openDb();
    const tx = db.transaction(['kv', 'sync_outbox'], 'readwrite');
    const kv = tx.objectStore('kv');
    const prev = sanitizeSelection(await kv.get(SELECTION_KEY));
    const changed = JSON.stringify(prev.banks) !== JSON.stringify(clean.banks)
      || JSON.stringify(prev.filters) !== JSON.stringify(clean.filters);
    const updatedAt = changed ? nextUpdatedAt(Date.now(), prev.updatedAt ?? 0) : prev.updatedAt;
    const next: MemorySelection = { ...clean, ...(updatedAt !== undefined ? { updatedAt } : {}) };
    await kv.put(next, SELECTION_KEY);
    if (changed) {
      enqueueChange(tx, {
        collection: COLLECTIONS.memorySelection, recordId: 'selection',
        updatedAt: updatedAt ?? nextUpdatedAt(), deleted: false,
      });
    }
    await tx.done;
  });
}
```

`clearTrainingData`：

```ts
export async function clearTrainingData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'mem_attempts', 'kv', 'sync_outbox'], 'readwrite');
  const srsStore = tx.objectStore('mem_srs');
  const attStore = tx.objectStore('mem_attempts');
  const kv = tx.objectStore('kv');
  const [srsRows, attRows] = await Promise.all([srsStore.getAll(), attStore.getAll()]);
  const maxTs = Math.max(
    0,
    ...(srsRows as SrsState[]).map((s) => s.lastAt),
    ...(attRows as MemoryAttempt[]).map((a) => a.ts),
  );
  await srsStore.clear();
  await attStore.clear();
  await kv.delete(SESSION_KEY);

  const before = nextUpdatedAt(Date.now(), maxTs);
  // 同一个事务里清掉旧的训练 outbox，避免残留条目在 reset 之后继续推送。
  const outboxStore = tx.objectStore('sync_outbox');
  const oldEntries = await outboxStore.getAll() as { id: string; collection: string; recordId: string; updatedAt: number }[];
  for (const entry of oldEntries) {
    const isMemory = entry.collection === COLLECTIONS.memorySrs || entry.collection === COLLECTIONS.memoryAttempts;
    if (isMemory && entry.recordId !== RESET_RECORD_ID && entry.updatedAt <= before) {
      await outboxStore.delete(entry.id);
    }
  }

  const reset = await kv.get('syncReset');
  const map = reset && typeof reset === 'object' ? { ...(reset as Record<string, number>) } : {};
  for (const collection of [COLLECTIONS.memorySrs, COLLECTIONS.memoryAttempts]) {
    map[collection] = Math.max(map[collection] ?? 0, before);
    enqueueChange(tx, {
      collection, recordId: RESET_RECORD_ID, updatedAt: before, deleted: true, payload: { before },
    });
  }
  await kv.put(map, 'syncReset');
  await tx.done;
}
```

`importMemory` 事务改为 `['mem_srs','mem_attempts','sync_outbox']`，导入成功后入队：

```ts
export async function importMemory(json: string): Promise<{ srs: number; attempts: number }> {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('文件不是合法 JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data as { kind?: unknown }).kind !== 'memory') {
    throw new Error('不是记忆训练数据文件');
  }
  const rawSrs = Array.isArray((data as { srs?: unknown }).srs) ? (data as { srs: unknown[] }).srs : [];
  const rawAttempts = Array.isArray((data as { attempts?: unknown }).attempts) ? (data as { attempts: unknown[] }).attempts : [];

  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'mem_attempts', 'sync_outbox'], 'readwrite');
  const srsStore = tx.objectStore('mem_srs');
  const attStore = tx.objectStore('mem_attempts');
  let srsImported = 0;
  let attemptsImported = 0;

  const existingSrs = new Map(((await srsStore.getAll()) as SrsState[]).map((s) => [s.qid, s]));
  for (const item of rawSrs) {
    const s = sanitizeSrs(item);
    if (!s) continue;
    const cur = existingSrs.get(s.qid);
    if (cur && cur.lastAt >= s.lastAt) continue;
    await srsStore.put(s, s.qid);
    enqueueChange(tx, { collection: COLLECTIONS.memorySrs, recordId: s.qid, updatedAt: s.lastAt, deleted: false });
    srsImported += 1;
  }

  const existingKeys = new Set(((await attStore.getAll()) as MemoryAttempt[]).map(attemptKey));
  for (const item of rawAttempts) {
    const a = sanitizeAttempt(item);
    if (!a) continue;
    const key = attemptKey(a);
    if (existingKeys.has(key)) continue;
    const { id: _ignored, ...rest } = a;
    await attStore.add(rest);
    enqueueChange(tx, { collection: COLLECTIONS.memoryAttempts, recordId: key, updatedAt: a.ts, deleted: false });
    existingKeys.add(key);
    attemptsImported += 1;
  }
  await tx.done;
  return { srs: srsImported, attempts: attemptsImported };
}
```

- [ ] **Step 5: 实现三个适配器**

`memorySrs.ts`：

```ts
import { sanitizeSrs, type SrsState } from '../../data/memory';
import { remoteWins } from '../merge';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const STORE = 'mem_srs';

export const memorySrsCollection: SyncCollection = {
  name: COLLECTIONS.memorySrs,
  label: '记忆复习进度',
  async listLocal(db) {
    const rows = (await db.getAll(STORE)).map(sanitizeSrs).filter((s): s is SrsState => s !== null);
    return rows.map((s) => ({ recordId: s.qid, updatedAt: s.lastAt, deleted: false, payload: s }));
  },
  async getLocal(db, recordId) {
    const s = sanitizeSrs(await db.get(STORE, recordId));
    return s ? { recordId, updatedAt: s.lastAt, deleted: false, payload: s } : undefined;
  },
  async applyRemote(db, record) {
    const current = sanitizeSrs(await db.get(STORE, record.recordId));
    if (!remoteWins(record.updatedAt, current?.lastAt)) return false;
    if (record.deleted) {
      if (!current) return false;
      await db.del(STORE, record.recordId);
      return true;
    }
    const incoming = sanitizeSrs(record.payload);
    if (!incoming || incoming.qid !== record.recordId) return false;
    await db.put(STORE, incoming, incoming.qid);
    return true;
  },
  async clearBefore(db, before) {
    const rows = (await db.getAll(STORE)).map(sanitizeSrs).filter((s): s is SrsState => s !== null);
    for (const s of rows) if (s.lastAt <= before) await db.del(STORE, s.qid);
  },
};
```

`memoryAttempts.ts`：

```ts
import { attemptKey, sanitizeAttempt, type MemoryAttempt } from '../../data/memory';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const STORE = 'mem_attempts';

async function all(db: Parameters<SyncCollection['listLocal']>[0]): Promise<MemoryAttempt[]> {
  return (await db.getAll(STORE)).map(sanitizeAttempt).filter((a): a is MemoryAttempt => a !== null);
}

export const memoryAttemptsCollection: SyncCollection = {
  name: COLLECTIONS.memoryAttempts,
  label: '记忆训练记录',
  async listLocal(db) {
    return (await all(db)).map((a) => {
      const { id: _id, ...payload } = a;
      return { recordId: attemptKey(a), updatedAt: a.ts, deleted: false, payload };
    });
  },
  async getLocal(db, recordId) {
    const found = (await all(db)).find((a) => attemptKey(a) === recordId);
    if (!found) return undefined;
    const { id: _id, ...payload } = found;
    return { recordId, updatedAt: found.ts, deleted: false, payload };
  },
  async applyRemote(db, record) {
    const rows = await all(db);
    const found = rows.find((a) => attemptKey(a) === record.recordId);
    if (record.deleted) {
      if (!found?.id) return false;
      await db.del(STORE, found.id);
      return true;
    }
    if (found) return false; // 同一稳定键的同一条记录，不覆盖
    const incoming = sanitizeAttempt(record.payload);
    if (!incoming) return false;
    const { id: _id, ...rest } = incoming;
    await db.add(STORE, rest);
    return true;
  },
  async clearBefore(db, before) {
    const rows = await all(db);
    for (const a of rows) if (a.ts <= before && a.id !== undefined) await db.del(STORE, a.id);
  },
};
```

`memorySelection.ts`：

```ts
import { sanitizeSelection } from '../../data/memory';
import { remoteWins } from '../merge';
import type { SyncCollection } from '../types';
import { COLLECTIONS } from './names';

const KEY = 'memSelection';

type Raw = Record<string, unknown> | undefined;

function payloadOf(raw: Raw) {
  const sel = sanitizeSelection(raw ?? {});
  return {
    banks: sel.banks,
    filters: sel.filters,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

export const memorySelectionCollection: SyncCollection = {
  name: COLLECTIONS.memorySelection,
  label: '题库偏好',
  async listLocal(db) {
    const raw = await db.kvGet<Raw>(KEY);
    if (!raw) return [];
    return [{ recordId: 'selection', updatedAt: payloadOf(raw).updatedAt, deleted: false, payload: payloadOf(raw) }];
  },
  async getLocal(db, recordId) {
    if (recordId !== 'selection') return undefined;
    const raw = await db.kvGet<Raw>(KEY);
    return raw ? { recordId, updatedAt: payloadOf(raw).updatedAt, deleted: false, payload: payloadOf(raw) } : undefined;
  },
  async applyRemote(db, record) {
    const raw = await db.kvGet<Raw>(KEY);
    const current = raw ? payloadOf(raw).updatedAt : undefined;
    if (!remoteWins(record.updatedAt, current)) return false;
    if (record.deleted) {
      if (!raw) return false;
      await db.del('kv', KEY);
      return true;
    }
    if (!record.payload || typeof record.payload !== 'object') return false;
    const incoming = sanitizeSelection(record.payload);
    const prev = sanitizeSelection(raw ?? {});
    const next = {
      ...prev,
      banks: incoming.banks,
      filters: incoming.filters,
      updatedAt: record.updatedAt,
    };
    await db.kvSet(KEY, next);
    return true;
  },
  async clearBefore(db, before) {
    const raw = await db.kvGet<Raw>(KEY);
    if (raw && payloadOf(raw).updatedAt <= before) await db.del('kv', KEY);
  },
};
```

- [ ] **Step 6: 运行测试并提交**

Run: `npx vitest run tests/unit/memory.test.ts tests/unit/sync-collections-memory.test.ts`
Expected: PASS。

```bash
git add src/data/memory.ts src/sync/collections/memorySrs.ts src/sync/collections/memoryAttempts.ts src/sync/collections/memorySelection.ts tests/unit/memory.test.ts tests/unit/sync-collections-memory.test.ts
git commit -m "feat(sync): 记忆 SRS、训练记录与题库偏好同步"
```

---

## Task 8: 集合适配器注册与同步引擎

**Files:**
- Create: `src/sync/collections/index.ts`
- Create: `src/sync/engine.ts`
- Test: `tests/unit/sync-engine.test.ts`

**Interfaces:**
- Produces: `SYNC_COLLECTIONS`, `collectionFor(name)`
- Produces: `syncAll(backend, opts?)`, `syncRepo(scope, repo, db, backend, opts?)`
- Produces: `activeSync` 重入保护

- [ ] **Step 1: 写引擎失败测试**

```ts
// tests/unit/sync-engine.test.ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, kvGet, kvSet } from '../../src/data/db';
import { saveProgress } from '../../src/data/prefs';
import { syncAll } from '../../src/sync/engine';
import { readOutbox, enqueueChange } from '../../src/sync/outbox';
import { openRepoDb } from '../../src/sync/repoDb';
import type { RemoteRecord, SyncBackend, SyncRecord } from '../../src/sync/types';

beforeEach(async () => { await clearAllData(); });

function fakeBackend(remote: RemoteRecord[] = []) {
  const pushed: SyncRecord[][] = [];
  const backend: SyncBackend = {
    test: async () => ({}),
    pull: async () => remote,
    push: async (records) => { pushed.push([...records]); },
  };
  return { backend, pushed };
}

describe('sync engine', () => {
  it('首次同步 seed 本地进度并推送', async () => {
    await saveProgress('a.md', 0.6);
    const { backend, pushed } = fakeBackend();
    const summary = await syncAll(backend);
    expect(summary.pushed).toBeGreaterThan(0);
    expect(pushed.flat().some((r) => r.collection === 'reading.progress' && r.recordId === 'a.md')).toBe(true);
    expect(await readOutbox(await openRepoDb('mdreader'))).toEqual([]);
  });

  it('远端较新 / 相等时应用，本地较新时保留', async () => {
    await saveProgress('a.md', 0.2);
    const now = Date.now();
    const remote: RemoteRecord[] = [{
      scope: 'your-name/your-notes@main', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.9, updatedAt: now + 1000 }, updatedAt: now + 1000,
      deleted: false, deviceId: 'remote', serverUpdatedAt: 1,
    }];
    const { backend } = fakeBackend(remote);
    await syncAll(backend);
    expect((await kvGet('progress') as any)['a.md'].ratio).toBe(0.9);
  });

  it('reset 标记清理本地并过滤旧记录', async () => {
    await saveProgress('a.md', 0.5);
    const before = Date.now() + 10000;
    const remote: RemoteRecord[] = [{
      scope: 'your-name/your-notes@main', collection: 'reading.progress', recordId: '__reset__',
      payload: { before }, updatedAt: before, deleted: true, deviceId: 'remote', serverUpdatedAt: 1,
    }, {
      scope: 'your-name/your-notes@main', collection: 'reading.progress', recordId: 'a.md',
      payload: { ratio: 0.1, updatedAt: before - 1 }, updatedAt: before - 1,
      deleted: false, deviceId: 'remote', serverUpdatedAt: 2,
    }];
    const { backend } = fakeBackend(remote);
    await syncAll(backend);
    expect(await kvGet('progress')).toEqual({});
  });

  it('scope 变化时 cursor 从 0 拉取', async () => {
    const pulls: number[] = [];
    const backend: SyncBackend = {
      test: async () => ({}),
      pull: async (_scope, since) => { pulls.push(since); return []; },
      push: async () => {},
    };
    await kvSet('syncScope', 'old/scope@main');
    await syncAll(backend);
    expect(pulls).toContain(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/sync-engine.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 collections/index.ts**

```ts
// src/sync/collections/index.ts
import { progressCollection } from './progress';
import { highlightsCollection } from './highlights';
import { favoritesCollection } from './favorites';
import { memorySrsCollection } from './memorySrs';
import { memoryAttemptsCollection } from './memoryAttempts';
import { memorySelectionCollection } from './memorySelection';
import type { SyncCollection } from '../types';

export const SYNC_COLLECTIONS: readonly SyncCollection[] = [
  progressCollection,
  highlightsCollection,
  favoritesCollection,
  memorySrsCollection,
  memoryAttemptsCollection,
  memorySelectionCollection,
];

const byName = new Map(SYNC_COLLECTIONS.map((c) => [c.name, c]));
export function collectionFor(name: string): SyncCollection | undefined {
  return byName.get(name);
}
```

- [ ] **Step 4: 实现 engine.ts**

```ts
// src/sync/engine.ts
import { activeRepo, loadRepoState, repoDbName, type RepoEntry } from '../data/repos';
import { DbBlockedError } from '../data/db';
import { RESET_RECORD_ID } from './collections/names';
import { SYNC_COLLECTIONS, collectionFor } from './collections';
import { cursorOf, loadSyncState, saveSyncState, updateRepoState } from './state';
import { openRepoDb, withWriteLock, type RepoDb } from './repoDb';
import { readOutbox, deleteOutboxIfRev, removeOutboxAtOrBefore, seedCollectionOutbox } from './outbox';
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
    if (resetAt !== undefined && record.updatedAt <= resetAt) continue;
    const collection = collectionFor(record.collection);
    if (!collection) continue;
    if (await withWriteLock(db, () => collection.applyRemote(db, record))) applied += 1;
  }
  return applied;
}

async function materialize(db: RepoDb, entry: Awaited<ReturnType<typeof readOutbox>>[number]): Promise<SyncRecord> {
  if (entry.payload !== undefined) {
    return {
      scope: '', collection: entry.collection, recordId: entry.recordId, payload: entry.payload,
      updatedAt: entry.updatedAt, deleted: entry.deleted, deviceId: getDeviceId(),
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

async function pushOutbox(db: RepoDb, scope: string, backend: SyncBackend): Promise<number> {
  const entries = await readOutbox(db);
  let pushed = 0;
  for (let i = 0; i < entries.length; i += 200) {
    const batch = entries.slice(i, i + 200);
    const records = await Promise.all(batch.map((e) => materialize(db, e)));
    for (const record of records) record.scope = scope;
    await backend.push(records);
    for (const entry of batch) await deleteOutboxIfRev(db, entry.id, entry.rev);
    pushed += records.length;
  }
  return pushed;
}

export async function syncOne(scope: string, repo: RepoEntry, backend: SyncBackend, opts?: { signal?: AbortSignal }): Promise<RepoResult> {
  const db = await openRepoDb(repoDbName(repo.id));
  try {
    const scopeChanged = (await db.kvGet<string>('syncScope')) !== scope;
    const cursor = scopeChanged ? 0 : cursorOf(scope);
    const remote = await backend.pull(scope, cursor, opts?.signal);
    const resets = await applyResets(db, remote);
    await seedCollections(db, resets, scopeChanged);
    const applied = await applyRemote(db, remote, resets);
    const nextCursor = Math.max(cursor, ...remote.map((r) => r.serverUpdatedAt), 0);
    updateRepoState(scope, { cursor: nextCursor });
    if (scopeChanged) await db.kvSet('syncScope', scope);
    const pushed = await pushOutbox(db, scope, backend);
    updateRepoState(scope, { cursor: nextCursor, lastSyncAt: Date.now() });
    return { repoId: repo.id, scope, pulled: remote.length, applied, pushed };
  } finally {
    db.close();
  }
}

export async function syncAll(backend: SyncBackend, opts?: { signal?: AbortSignal }): Promise<SyncSummary> {
  const startedAt = Date.now();
  const state = loadRepoState();
  const active = activeRepo(state);
  const repos = [active, ...state.repos.filter((r) => r.id !== active.id)];
  const results: RepoResult[] = [];
  for (const repo of repos) {
    const scope = repoScope(state.owner, repo.repo, repo.branch);
    try {
      results.push(await syncOne(scope, repo, backend, opts));
    } catch (err) {
      if (err instanceof DbBlockedError) {
        results.push({ repoId: repo.id, scope, pulled: 0, applied: 0, pushed: 0, skipped: 'blocked' });
      } else {
        results.push({
          repoId: repo.id, scope, pulled: 0, applied: 0, pushed: 0,
          error: err instanceof SyncError ? err.message : '同步失败，请稍后重试',
        });
      }
    }
  }
  const summary: SyncSummary = {
    startedAt,
    finishedAt: Date.now(),
    repos: results,
    pulled: results.reduce((n, r) => n + r.pulled, 0),
    applied: results.reduce((n, r) => n + r.applied, 0),
    pushed: results.reduce((n, r) => n + r.pushed, 0),
  };
  const current = loadSyncState();
  const firstError = results.find((r) => r.error)?.error ?? null;
  saveSyncState({
    ...current,
    lastSyncAt: summary.finishedAt,
    lastError: firstError ? { message: firstError, at: summary.finishedAt } : null,
  });
  const activeScope = repoScope(state.owner, active.repo, active.branch);
  if (typeof window !== 'undefined' && results.some((r) => r.scope === activeScope && r.applied > 0)) {
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
```

上面的 import 块已是最终版本；不要保留 `_repoDbName`、`getRepoDbName`、`COLLECTIONS` 等未使用符号。

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run tests/unit/sync-engine.test.ts`
Expected: PASS。

```bash
git add src/sync/collections/index.ts src/sync/engine.ts tests/unit/sync-engine.test.ts
git commit -m "feat(sync): 全仓库同步引擎与合并流程"
```

---

## Task 9: DataSyncProvider 与自动同步开关

**Files:**
- Create: `src/sync/DataSyncContext.tsx`
- Modify: `src/App.tsx`
- Test: `tests/unit/sync-config-state.test.ts`（补 `shouldAutoSync` 断言）

**Interfaces:**
- Produces: `DataSyncProvider`, `useDataSync()`
- Consumes: `loadSyncConfig`, `saveSyncConfig`, `clearSyncConfig`, `loadSyncState`, `clearSyncState`, `resetSyncCursors`, `syncNow`

- [ ] **Step 1: 写 provider 行为测试**

`shouldAutoSync` 已在 Task 2 实现；补断言：

```ts
expect(shouldAutoSync({ ...cfg, autoSync: false }, true)).toBe(false);
expect(shouldAutoSync({ ...cfg, autoSync: true }, true)).toBe(true);
expect(shouldAutoSync({ ...cfg, autoSync: true, enabled: false }, true)).toBe(false);
```

- [ ] **Step 2: 实现 DataSyncContext.tsx**

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  clearSyncConfig, loadSyncConfig, saveSyncConfig, syncConfigFingerprint,
} from './config';
import { clearSyncState, loadSyncState, resetSyncCursors } from './state';
import { createSyncBackend, isSyncConfigured, shouldAutoSync } from './registry';
import { syncNow, type SyncSummary } from './engine';
import { countOutbox } from './outbox';
import { openRepoDb } from './repoDb';
import { loadRepoState, repoDbName } from '../data/repos';
import type { SyncConfig, TestResult } from './types';
import { SyncError } from './types';

interface DataSyncContextValue {
  config: SyncConfig;
  status: 'disabled' | 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'error';
  summary: SyncSummary | null;
  error: string | null;
  pendingCount: number;
  warning: string | null;
  syncNow(): Promise<void>;
  testConnection(values: Readonly<Record<string, string>>): Promise<TestResult>;
  saveConfig(next: SyncConfig): void;
  setAutoSync(on: boolean): void;
  disable(): void;
  clearConfig(): void;
  refreshPendingCount(): Promise<void>;
}

const Ctx = createContext<DataSyncContextValue>(null!);
export const useDataSync = () => useContext(Ctx);

export function DataSyncProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SyncConfig>(() => loadSyncConfig());
  const [status, setStatus] = useState<DataSyncContextValue['status']>('idle');
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(() => loadSyncState().lastError?.message ?? null);
  const [pendingCount, setPendingCount] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const timerRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const dirtySinceRef = useRef<number | null>(null);

  const refreshPendingCount = useCallback(async () => {
    const state = loadRepoState();
    let total = 0;
    for (const repo of state.repos) {
      try {
        const db = await openRepoDb(repoDbName(repo.id));
        total += await countOutbox(db);
        db.close();
      } catch { /* 单个库被阻塞时忽略 */ }
    }
    setPendingCount(total);
  }, []);

  const schedulePendingRefresh = useCallback(() => {
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      void refreshPendingCount();
    }, 1000);
  }, [refreshPendingCount]);

  const runSync = useCallback(async () => {
    if (!config.enabled || !isSyncConfigured(config) || !online) return;
    setStatus('syncing');
    setError(null);
    try {
      const result = await syncNow();
      dirtySinceRef.current = null;
      setSummary(result);
      setStatus('idle');
      setError(null);
      await refreshPendingCount();
    } catch (err) {
      setStatus('error');
      setError(err instanceof SyncError ? err.message : '同步失败，请稍后重试');
    }
  }, [config, online, refreshPendingCount]);

  const schedule = useCallback((delayMs: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; void runSync(); }, delayMs);
  }, [runSync]);

  // 自动同步：默认关闭；启动 / 联网 / 页面可见 / dirty 都在 autoSync=true 时才调度。
  useEffect(() => {
    if (!shouldAutoSync(config, online)) return;
    schedule(3000);
  }, [config, online, schedule]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); if (shouldAutoSync(config, true)) schedule(0); };
    const onOffline = () => setOnline(false);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (shouldAutoSync(config, online)) void runSync();
      } else if (shouldAutoSync(config, online)) {
        schedule(3000);
      }
    };
    const onDirty = () => {
      if (!shouldAutoSync(config, online)) { schedulePendingRefresh(); return; }
      const now = Date.now();
      if (dirtySinceRef.current === null) dirtySinceRef.current = now;
      if (now - dirtySinceRef.current >= 60_000) {
        dirtySinceRef.current = null;
        void runSync();
        return;
      }
      schedule(10_000);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('mdreader:sync-dirty', onDirty);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mdreader:sync-dirty', onDirty);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    };
  }, [config, online, refreshPendingCount, runSync, schedule, schedulePendingRefresh]);

  const saveConfig = useCallback((next: SyncConfig) => {
    const previous = config;
    const saved = saveSyncConfig({ ...next, enabled: true });
    if (syncConfigFingerprint(previous) !== syncConfigFingerprint(saved)) resetSyncCursors();
    setConfig(saved);
    setError(null);
    setStatus(isSyncConfigured(saved) ? 'idle' : 'unconfigured');
    void refreshPendingCount();
  }, [config, refreshPendingCount]);

  const setAutoSync = useCallback((on: boolean) => {
    const saved = saveSyncConfig({ ...config, autoSync: on });
    setConfig(saved);
    if (on && shouldAutoSync(saved, online)) schedule(3000);
  }, [config, online, schedule]);

  const disable = useCallback(() => {
    const saved = saveSyncConfig({ ...config, enabled: false });
    setConfig(saved);
    setStatus('disabled');
  }, [config]);

  const clearConfig = useCallback(() => {
    clearSyncConfig();
    clearSyncState();
    const next = loadSyncConfig();
    setConfig(next);
    setSummary(null);
    setError(null);
    setStatus('disabled');
    setPendingCount(0);
  }, []);

  const testConnection = useCallback(async (values: Readonly<Record<string, string>>) => {
    const backend = createSyncBackend({ ...config, values: { ...config.values, ...values } });
    const result = await backend.test();
    setWarning(result.warning ?? null);
    return result;
  }, [config]);

  useEffect(() => {
    if (!config.enabled) setStatus('disabled');
    else if (!isSyncConfigured(config)) setStatus('unconfigured');
    else if (!online) setStatus('offline');
    else if (status !== 'syncing') setStatus(error ? 'error' : 'idle');
  }, [config, online, error, status]);

  const value = useMemo<DataSyncContextValue>(() => ({
    config, status, summary, error, pendingCount, warning,
    syncNow: async () => { await runSync(); },
    testConnection, saveConfig, setAutoSync, disable, clearConfig, refreshPendingCount,
  }), [config, status, summary, error, pendingCount, warning, runSync, testConnection, saveConfig, setAutoSync, disable, clearConfig, refreshPendingCount]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

在 `App.tsx` 用 Provider 包住 RouterProvider：

```tsx
import { DataSyncProvider } from './sync/DataSyncContext';
import './sync/backends'; // 注册 Neon 后端

export default function App() {
  return (
    <DataSyncProvider>
      <RouterProvider router={router} />
    </DataSyncProvider>
  );
}
```

- [ ] **Step 3: 运行 typecheck / 测试并提交**

Run: `npm run typecheck && npx vitest run tests/unit/sync-config-state.test.ts`
Expected: PASS。

```bash
git add src/sync/DataSyncContext.tsx src/App.tsx tests/unit/sync-config-state.test.ts
git commit -m "feat(sync): DataSyncProvider 与自动同步开关"
```

---

## Task 10: 设置页「跨设备同步」

**Files:**
- Create: `src/pages/SettingsSyncPage.tsx`
- Create: `src/components/SyncSetupSection.tsx`
- Modify: `src/app/nav.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/SettingsPage.tsx:95-240`
- Modify: `src/styles/settings.css`
- Test: `tests/e2e/data-sync.spec.ts`

**Interfaces:**
- Produces: `SETTINGS_SYNC = '#/settings/sync'`
- Route: `settings/sync`
- Consumes: `useDataSync()`, `listSyncBackends()`, `NEON_SETUP_SQL`

- [ ] **Step 1: 加路由与导航**

`src/app/nav.ts`：

```ts
export const SETTINGS_SYNC = '#/settings/sync';
```

`src/App.tsx` 增加：

```tsx
import SettingsSyncPage from './pages/SettingsSyncPage';
...
{ path: 'settings/sync', element: <SettingsSyncPage /> },
```

- [ ] **Step 2: 实现 SyncSetupSection**

```tsx
// src/components/SyncSetupSection.tsx
import { useState } from 'react';
import { NEON_SETUP_SQL, NEON_SETUP_STEPS } from '../sync/backends/neonSetup';

export default function SyncSetupSection() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(NEON_SETUP_SQL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* 用户可手动选择复制 */ }
  };

  return (
    <section className="settings-section" aria-labelledby="settings-sync-setup-title">
      <h2 id="settings-sync-setup-title">Neon 初始化</h2>
      <details className="sync-setup">
        <summary>如何配置 Neon Data API</summary>
        <ol className="sync-setup-steps">
          {NEON_SETUP_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <div className="sync-sql-head">
          <span>初始化 SQL</span>
          <button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button>
        </div>
        <pre className="sync-sql"><code>{NEON_SETUP_SQL}</code></pre>
        <p className="settings-note">
          详细步骤见仓库 <code>docs/sync-neon-setup.md</code>。JWT 是 bearer token，请只保存在本机。
        </p>
      </details>
    </section>
  );
}
```

- [ ] **Step 3: 实现 SettingsSyncPage**

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrSettings } from '../app/nav';
import SettingsHeader from '../components/SettingsHeader';
import SyncSetupSection from '../components/SyncSetupSection';
import { useDataSync } from '../sync/DataSyncContext';
import { listSyncBackends } from '../sync/registry';
import { loadSyncState } from '../sync/state';
import { useOnline } from '../hooks/useOnline';
import { showToast } from '../lib/toast';
import { maskToken } from '../lib/token';
import type { SyncConfig } from '../sync/types';
import '../styles/settings.css';

interface Msg { kind: 'ok' | 'err'; text: string }

export default function SettingsSyncPage() {
  const navigate = useNavigate();
  const online = useOnline();
  const { config, status, summary, error, pendingCount, warning, syncNow, testConnection, saveConfig, setAutoSync, disable, clearConfig, refreshPendingCount } = useDataSync();
  const backends = listSyncBackends();
  const backend = backends.find((b) => b.type === config.backend) ?? backends[0];
  const [endpoint, setEndpoint] = useState(config.values.endpoint ?? '');
  const [token, setToken] = useState('');
  const [tokenEditing, setTokenEditing] = useState(!config.values.token);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'sync' | null>(null);
  const savedToken = config.values.token ?? '';
  const lastSyncAt = summary?.finishedAt ?? loadSyncState().lastSyncAt;

  useEffect(() => { setEndpoint(config.values.endpoint ?? ''); }, [config.values.endpoint]);
  useEffect(() => { void refreshPendingCount(); }, [refreshPendingCount]);

  const effectiveToken = tokenEditing ? token.trim() : savedToken;
  const canSync = config.enabled && Boolean(endpoint.trim() && effectiveToken);

  const runTest = async () => {
    setBusy('test'); setMsg(null);
    try {
      const result = await testConnection({ endpoint: endpoint.trim(), token: effectiveToken });
      setMsg({ kind: 'ok', text: result.warning ? `连接成功；${result.warning}` : '连接成功：表与 RPC 可用' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '连接失败' });
    } finally { setBusy(null); }
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    if (!endpoint.trim() || !effectiveToken) { setMsg({ kind: 'err', text: '请填写接口地址与 JWT' }); return; }
    const next: SyncConfig = { ...config, enabled: true, values: { ...config.values, endpoint: endpoint.trim(), token: effectiveToken } };
    saveConfig(next);
    setToken('');
    setTokenEditing(false);
    setMsg({ kind: 'ok', text: '已保存；自动同步默认关闭，点击「立即同步」开始首次同步' });
    if (next.autoSync) showToast('自动同步已开启');
  };

  const statusText = status === 'syncing' ? '同步中…' : status === 'offline' ? '离线' : status === 'error' ? '同步失败' : status === 'unconfigured' ? '未配置' : status === 'disabled' ? '已停用' : config.autoSync ? '已启用（自动）' : '仅手动同步';

  return (
    <main className="settings">
      <SettingsHeader title="跨设备同步" subtitle="阅读进度、高亮、收藏与记忆数据在多台设备间同步；正文与 GitHub Token 不上传。" backLabel="返回" backAriaLabel="返回" onBack={() => goBackOrSettings(navigate)} />

      <section className="settings-section" aria-labelledby="settings-sync-status-title">
        <h2 id="settings-sync-status-title">状态</h2>
        <p className="settings-sync-row">
          <span className={`sync-dot sync-dot-${status}`} aria-hidden="true" />
          <span className="settings-note">{statusText}</span>
          {pendingCount > 0 && <span className="settings-note">待同步 {pendingCount} 条</span>}
        </p>
        <p className="settings-note">{lastSyncAt ? `上次同步：${new Date(lastSyncAt).toLocaleString()}` : '尚未同步'}</p>
        <p className="settings-sync-row">
          <span className="settings-note">自动同步</span>
          <input type="checkbox" role="switch" checked={config.autoSync} onChange={(e) => setAutoSync(e.target.checked)} disabled={!config.enabled || !canSync} aria-label="自动同步" />
        </p>
        <p className="settings-note">关闭时，启动、联网、页面隐藏与数据变更都不会自动同步；只有点击「立即同步」才会同步。</p>
        {error && <p role="alert" className="settings-error">{error}</p>}
        {warning && <p role="status" className="settings-warn">{warning}</p>}
      </section>

      <section className="settings-section" aria-labelledby="settings-sync-backend-title">
        <h2 id="settings-sync-backend-title">后端</h2>
        <p className="settings-subhead">{backend?.label ?? config.backend}</p>
        <p className="settings-note">{backend?.description}</p>
        <form className="settings-repo-form" onSubmit={onSave}>
          <label>接口地址<input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={backend?.fields.find((f) => f.key === 'endpoint')?.placeholder} autoComplete="off" /></label>
          <label>JWT
            {tokenEditing ? (
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="粘贴长期 JWT" autoComplete="off" />
            ) : (
              <span className="settings-token-row"><code className="settings-token">{maskToken(savedToken)}</code><button type="button" onClick={() => setTokenEditing(true)}>更换</button></span>
            )}
          </label>
          <p className="settings-note">JWT 只保存在本机浏览器；启用后阅读数据会发送到你自己的 Neon 端点。</p>
          <p className="settings-sync-row">
            <button type="submit" disabled={busy !== null || !canSync}>{busy === 'save' ? '保存中…' : '保存并启用'}</button>
            <button type="button" onClick={() => void runTest()} disabled={busy !== null || !canSync}>{busy === 'test' ? '测试中…' : '测试连接'}</button>
            <button type="button" onClick={() => { setBusy('sync'); void syncNow().finally(() => setBusy(null)); }} disabled={busy !== null || !canSync || !online}>立即同步</button>
          </p>
          {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={msg.kind === 'err' ? 'settings-error' : 'settings-ok'}>{msg.text}</p>}
        </form>
      </section>

      <section className="settings-section" aria-labelledby="settings-sync-scope-title">
        <h2 id="settings-sync-scope-title">同步范围</h2>
        <ul className="settings-about-list">
          <li>阅读进度、文本高亮、收藏</li>
          <li>记忆 SRS 调度、训练记录、题库偏好</li>
          <li>笔记：预留，尚未启用</li>
        </ul>
        <p className="settings-note">不同步：正文、GitHub Token、AI Key / 模型配置、当前训练会话、打开的标签页、阅读外观。</p>
      </section>

      <section className="settings-section" aria-labelledby="settings-sync-repos-title">
        <h2 id="settings-sync-repos-title">仓库结果</h2>
        {summary?.repos.length ? (
          <ul className="settings-about-list">
            {summary.repos.map((r) => <li key={r.repoId}>{r.scope}：拉取 {r.pulled} · 应用 {r.applied} · 推送 {r.pushed}{r.error ? ` · ${r.error}` : ''}{r.skipped === 'blocked' ? ' · 数据库被占用' : ''}</li>)}
          </ul>
        ) : <p className="settings-note">尚未同步。</p>}
      </section>

      <SyncSetupSection />

      <section className="settings-section settings-danger" aria-labelledby="settings-sync-danger-title">
        <h2 id="settings-sync-danger-title">危险区</h2>
        <p className="settings-note">停用只停止同步；清除配置会删除本机 URL / JWT 与同步状态，但不会删除 Neon 上已同步的数据。</p>
        <p className="settings-sync-row">
          <button type="button" onClick={disable} disabled={!config.enabled}>停用</button>
          <button type="button" className="settings-danger-btn" onClick={() => { if (window.confirm('确定清除同步配置吗？不会删除 Neon 上已同步的数据。')) { clearConfig(); setMsg({ kind: 'ok', text: '同步配置已清除' }); } }}>清除配置</button>
        </p>
      </section>
    </main>
  );
}
```

`onTest` 的调用方式不优雅；改为 `async function runTest()`，测试按钮调用它，表单 `onSubmit={onSave}`。实现时不要伪造 Event。

- [ ] **Step 4: 设置首页加导航项与摘要**

在 `SettingsPage.tsx` 引入 `useDataSync`，在导航列表「数据管理」后插入：

```tsx
<li>
  <a className="settings-group-link" href={SETTINGS_SYNC}>
    <span className="settings-group-icon"><SyncIcon /></span>
    <span className="settings-group-text">
      <span className="settings-group-title">跨设备同步</span>
      <span className="settings-group-sub">{syncSummary}</span>
    </span>
    <ChevronIcon />
  </a>
</li>
```

`syncSummary`：

```ts
import { useDataSync } from '../sync/DataSyncContext';
import { isSyncConfigured } from '../sync/registry';
// 组件内：
const { config: syncConfig } = useDataSync();
const syncSummary = !syncConfig.enabled ? '已停用' : !isSyncConfigured(syncConfig) ? '未配置' : syncConfig.autoSync ? '自动同步已开启' : '仅手动同步';
```

`SyncIcon` 用循环箭头线性 SVG（不要 emoji）：

```tsx
function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M17.5 3.5v4h-4M6.5 20.5v-4h4"
      />
    </svg>
  );
}
```

- [ ] **Step 5: 补 CSS**

在 `src/styles/settings.css` 末尾加：

```css
.settings-warn { margin: 6px 0 0; color: #9a6700; font-size: 13px; }
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: #7d868f; display: inline-block; }
.sync-dot-syncing { background: var(--acc); }
.sync-dot-error { background: var(--danger); }
.sync-dot-offline { background: #b87200; }
.sync-setup summary { cursor: pointer; color: var(--acc-text); font-size: 14px; }
.sync-setup-steps { margin: 10px 0; padding-left: 20px; color: var(--ink2); font-size: 13px; line-height: 1.7; }
.sync-sql-head { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 13px; color: var(--ink2); }
.sync-sql { max-height: 320px; overflow: auto; padding: 12px; border-radius: var(--r-ctl); background: var(--shell); font-size: 12px; line-height: 1.55; }
```

- [ ] **Step 6: 写 e2e（配置、默认仅手动、测试连接、手动同步）**

在 `tests/e2e/data-sync.spec.ts` 用 `page.route('https://sync.example/rest/v1/**', ...)` 模拟：

```ts
await page.route('https://sync.example/rest/v1/**', async (route) => {
  const method = route.request().method();
  if (method === 'GET') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  return route.fulfill({ status: 204, body: '' });
});
```

- `GET /sync_records` → `[]`
- `POST /rpc/sync_upsert` → 204
- `DELETE /sync_records` → 204

测试：

```ts
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

test('跨设备同步：默认仅手动，测试连接与手动同步', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token_1234' });
  await page.goto('./#/settings/sync');
  await page.getByLabel('接口地址').fill('https://sync.example/rest/v1');
  await page.getByLabel('JWT').fill(makeJwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 86400 }));
  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByText(/连接成功/)).toBeVisible();
  await page.getByRole('button', { name: '保存并启用' }).click();
  await expect(page.getByText('仅手动同步')).toBeVisible();
  await expect(page.getByLabel('自动同步')).not.toBeChecked();
  await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.getByText(/拉取/)).toBeVisible();
});
```

`installGitHubMock` 需要 `token` 参数；`makeJwt` 在测试文件内用 `base64url` 生成。

- [ ] **Step 7: 运行 e2e 并提交**

Run: `npm run typecheck && npx playwright test tests/e2e/data-sync.spec.ts`
Expected: PASS（必要时先用 `CI=1` 跑）。

```bash
git add src/pages/SettingsSyncPage.tsx src/components/SyncSetupSection.tsx src/app/nav.ts src/App.tsx src/pages/SettingsPage.tsx src/styles/settings.css tests/e2e/data-sync.spec.ts
git commit -m "feat(sync): 跨设备同步设置页"
```

---

## Task 11: 清除全部数据、首页刷新与记忆页集成

**Files:**
- Modify: `src/pages/SettingsDataPage.tsx:42-58`
- Modify: `src/pages/HomePage.tsx:60-130`
- Modify: `src/pages/MemoryRecordsPage.tsx`（只确认 clear/import 走新数据层）
- Test: `tests/e2e/data-sync.spec.ts`

**Interfaces:**
- Consumes: `clearSyncConfig`, `clearSyncState`
- Produces: HomePage 在 `mdreader:sync-applied` 后刷新最近阅读 / 收藏

- [ ] **Step 1: 清除全部数据时清同步配置**

在 `SettingsDataPage.tsx` 引入：

```ts
import { useDataSync } from '../sync/DataSyncContext';
import { clearDeviceId } from '../sync/device';
```

组件内取 `const { clearConfig: clearSyncConfigState } = useDataSync();`。

`onClearAll` 中在 `clearAllLibraries()` 后调用：

```ts
clearSyncConfigState(); // 同时清 config/state 并同步 Provider 内存状态
clearDeviceId();
```

确认文案改为：

```ts
'确定清除全部数据吗？将删除本机所有仓库的缓存、收藏、阅读进度、记忆训练数据、Token 与跨设备同步配置，且不可恢复。Neon 上已同步的数据不会被删除。'
```

- [ ] **Step 2: HomePage 监听同步事件**

在 `HomePage` 加：

```ts
const [syncTick, setSyncTick] = useState(0);
useEffect(() => {
  const onApplied = () => setSyncTick((v) => v + 1);
  window.addEventListener('mdreader:sync-applied', onApplied);
  return () => window.removeEventListener('mdreader:sync-applied', onApplied);
}, []);
```

把以下 effect 的依赖加上 `syncTick`：

- `recentDocs / getFavorites` 的 effect
- 最近阅读比例的 effect

`metas` effect 已经依赖 `lastSyncAt`，可以不加；`dueCount` 可选加 `syncTick`，让记忆入口的待复习数同步更新。

- [ ] **Step 3: e2e 补「清除全部数据清同步配置」**

```ts
test('清除全部数据会清掉同步配置', async ({ page }) => {
  await installGitHubMock(page, { token: 'ghp_e2e_fake_token_1234' });
  await page.evaluate(() => localStorage.setItem('mdreader.syncConfig', JSON.stringify({
    version: 1, enabled: true, autoSync: false, backend: 'neon',
    values: { endpoint: 'https://sync.example/rest/v1', token: 'x' },
  })));
  await page.goto('./#/settings/data');
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '清除全部数据' }).click();
  await expect(page.getByRole('heading', { name: '配置访问 Token' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mdreader.syncConfig'))).toBeNull();
});
```

- [ ] **Step 4: 运行测试并提交**

Run: `npx playwright test tests/e2e/data-sync.spec.ts tests/e2e/settings.spec.ts`
Expected: PASS。

```bash
git add src/pages/SettingsDataPage.tsx src/pages/HomePage.tsx tests/e2e/data-sync.spec.ts
git commit -m "feat(sync): 清除全部数据与首页同步刷新"
```

---

## Task 12: JWT 脚本、配置文档、产品文档、版本与最终验证

**Files:**
- Create: `scripts/sync-jwt.mjs`
- Create: `docs/sync-neon-setup.md`
- Create: `docs/acceptance-2026-10-20-data-sync.md`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `src/components/AboutSection.tsx:30-35`
- Modify: `package.json:4`
- Test: `tests/unit/sync-jwt.test.ts`

**Interfaces:**
- Produces: `node scripts/sync-jwt.mjs [--sub md-reader] [--days 3650] [--aud ...] [--out-dir .sync-jwt] [--jwks public/sync-jwks.json]`
- Produces: `docs/sync-neon-setup.md` with SQL + JWKS + CORS + rotation
- Updates: version `1.7.0`

- [ ] **Step 1: 写脚本测试**

```ts
// tests/unit/sync-jwt.test.ts
// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('sync-jwt script', () => {
  it('生成三段式 JWT 与 RS256 JWKS', () => {
    dir = mkdtempSync(join(tmpdir(), 'sync-jwt-'));
    const out = execFileSync(process.execPath, [
      'scripts/sync-jwt.mjs',
      '--sub', 'test-user',
      '--days', '1',
      '--out-dir', join(dir, 'keys'),
      '--jwks', join(dir, 'jwks.json'),
    ], { encoding: 'utf8' });
    const token = out.trim().split('\n').pop()!;
    expect(token.split('.')).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.sub).toBe('test-user');
    const jwks = JSON.parse(readFileSync(join(dir, 'jwks.json'), 'utf8'));
    expect(jwks.keys[0]).toMatchObject({ alg: 'RS256', use: 'sig' });
    expect(jwks.keys[0].kid).toBeTruthy();
  });
});
```

- [ ] **Step 2: 实现 scripts/sync-jwt.mjs**

```js
#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function usage() {
  console.error(`用法: node scripts/sync-jwt.mjs [options]

  --sub <id>         JWT sub，默认 md-reader
  --days <n>         有效期天数，默认 3650
  --aud <value>      可选 aud
  --out-dir <dir>    私钥目录，默认 .sync-jwt
  --jwks <file>      公钥 JWKS 输出，默认 public/sync-jwks.json
  --help             显示帮助`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') { usage(); process.exit(0); }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) { out[key] = true; continue; }
    out[key] = value;
    i += 1;
  }
  return out;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

const args = parseArgs(process.argv.slice(2));
const sub = String(args.sub ?? 'md-reader');
const days = Number(args.days ?? 3650);
const aud = typeof args.aud === 'string' ? args.aud : '';
const keyDir = resolve(String(args['out-dir'] ?? '.sync-jwt'));
const jwksPath = resolve(String(args.jwks ?? 'public/sync-jwks.json'));
const privatePath = resolve(keyDir, 'private.pem');

mkdirSync(keyDir, { recursive: true });
if (!existsSync(privatePath)) {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
}

const privatePem = readFileSync(privatePath, 'utf8');
const publicKey = createPublicKey(createPrivateKey(privatePem));
const jwk = publicKey.export({ format: 'jwk' });
const kid = createHash('sha256').update(`${jwk.kty}.${jwk.n}.${jwk.e}`).digest('base64url');
const jwks = { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
mkdirSync(dirname(jwksPath), { recursive: true });
writeFileSync(jwksPath, `${JSON.stringify(jwks, null, 2)}\n`);

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT', kid };
const payload = {
  sub,
  iat: now,
  exp: now + Math.max(1, days) * 86400,
  iss: 'md-reader',
  ...(aud ? { aud } : {}),
};
const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = sign('RSA-SHA256', Buffer.from(input), privatePem).toString('base64url');

console.error(`JWKS: ${jwksPath}`);
console.error(`sub: ${sub} · 有效 ${days} 天`);
console.error('把下面的 JWT 粘贴到 md-reader 的「设置 › 跨设备同步」：');
console.log(`${input}.${signature}`);
```

- [ ] **Step 3: 更新 .gitignore / package.json**

`.gitignore` 加：

```text
.sync-jwt/
```

`package.json` 版本改为 `1.7.0`。

- [ ] **Step 4: 写 docs/sync-neon-setup.md**

文档必须包含：

1. 启用 Neon Data API、复制 API URL。
2. JWT/JWKS 两条路径（已有 provider / `node scripts/sync-jwt.mjs`），说明公钥 JWKS 可公开、私钥 `.sync-jwt/private.pem` 不可提交。
3. 完整初始化 SQL（从 `neonSetup.ts` 复制）。
4. CORS 允许 `https://vaddenz.github.io` 与 `http://localhost:5173`。
5. 应用配置步骤。
6. 故障排查：401/403、404、CORS、JWT 过期、表/RPC 不存在。
7. 轮换：删除旧 JWKS → 更新 Neon → 重新签发 JWT；旧 token 失效。
8. 隐私：Neon 可见明文；只同步指定数据；AI Key / 正文 / GitHub Token 不上传。

- [ ] **Step 5: 更新 README / PRODUCT / DESIGN / About**

- README 功能列表加「跨设备同步（可选，Neon；自动同步默认关闭，需手动开启）」；数据管理/隐私说明指向 setup 文档。
- PRODUCT 原则 1 改为「默认不出本机；启用跨设备同步后，进度/高亮/收藏/记忆数据发送到用户自备 Neon；正文、GitHub Token、AI Key 永不上传」。
- PRODUCT 能力清单加同步；约束「无后端」改为「默认无后端；可选用户自备 Neon Data API」。
- DESIGN 设置页加「跨设备同步」二级页与同步页布局说明。
- AboutSection 隐私列表加「启用跨设备同步后，指定数据会发送到你自备的 Neon 端点」。

- [ ] **Step 6: 写验收清单**

`docs/acceptance-2026-10-20-data-sync.md` 至少覆盖：

- 默认自动同步关闭；首次保存后只手动同步。
- 两台设备（或两个浏览器 profile）配置同一 URL/JWT，进度/高亮/收藏/SRS/训练记录/题库偏好恢复。
- 删除高亮 / 取消收藏同步。
- 清除训练数据后另一台设备旧记录消失且不复活。
- 多仓库全部同步。
- 401 / 404 / CORS 错误文案。
- 离线写数据 → 联网手动同步补推。
- 真机（安卓 PWA）验证。

- [ ] **Step 7: 运行完整验证**

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: 全部 PASS。若 e2e 端口复用导致失败，按仓库约定用 `CI=1 npm run test:e2e`。

- [ ] **Step 8: 提交**

```bash
git add scripts/sync-jwt.mjs tests/unit/sync-jwt.test.ts .gitignore package.json docs/sync-neon-setup.md docs/acceptance-2026-10-20-data-sync.md README.md PRODUCT.md DESIGN.md src/components/AboutSection.tsx
git commit -m "docs: 跨设备同步配置、验收与 v1.7.0"
```

---

## 自查记录

- 规格覆盖：同步后端抽象（Task 1-4）、outbox（Task 3）、六类数据（Task 5-7）、全仓库引擎（Task 8）、自动开关（Task 9）、设置页（Task 10）、清除/刷新（Task 11）、JWT/文档/验收（Task 12）。
- 类型一致性：`SyncRecord` 用于推送，`RemoteRecord` 用于拉取；`SyncCollection.applyRemote` 返回 `boolean`；`RepoDb` 的 `del` 避免与 `delete` 关键字冲突；`COLLECTIONS` 常量统一。
- 无占位符：每个任务包含具体测试、关键实现、运行命令和提交命令。
- 自动同步默认关闭：`DEFAULT_SYNC_CONFIG.autoSync = false`，`shouldAutoSync` 与 Provider 双重校验。
