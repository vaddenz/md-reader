import { deleteDB } from 'idb';
import { DEFAULT_REPO } from '../constants';
import { kvGet, kvSet, closeDb, setRepoDbName } from './db';

/**
 * 多仓库配置（同一 GitHub 用户名下）。
 *
 * 存储策略：
 * - 仓库列表与当前仓库存在 localStorage（同步可读，启动时先确定库作用域）；
 * - 每个仓库使用独立 IndexedDB（默认仓库沿用旧库 `mdreader`），
 *   因此缓存、收藏、进度、标签、高亮天然按仓库隔离；
 * - 旧版单仓库的 `kv.config` 在首次启动时迁移为默认仓库。
 */

export interface RepoEntry {
  /** 稳定 ID：切换/改名都不变，决定独立库名。 */
  id: string;
  repo: string;
  branch: string;
}

export interface RepoState {
  version: 1;
  /** 同一用户名下的仓库共用 owner 与 Token。 */
  owner: string;
  repos: RepoEntry[];
  activeRepoId: string;
}

/** 运行时使用的完整仓库配置（owner 来自 RepoState）。 */
export interface RepoConfig extends RepoEntry {
  owner: string;
}

/** 旧版/镜像 config 的结构（不含 id；id 由 RepoState 管理）。 */
export interface LegacyRepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

const STATE_KEY = 'mdreader.repos';
const LEGACY_CONFIG_KEY = 'config';
const RELOAD_ROUTE_KEY = 'mdreader.reloadTo';
const DEFAULT_DB_NAME = 'mdreader';
const DEFAULT_REPO_ID = 'default';

let idSeq = 0;
/** localStorage 不可用时的内存回退（隐私模式等），避免迁移后的配置在运行期丢失。 */
let memoryState: RepoState | null = null;

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function safeSession(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function defaultRepoState(): RepoState {
  return {
    version: 1,
    owner: DEFAULT_REPO.owner,
    repos: [{ id: DEFAULT_REPO_ID, repo: DEFAULT_REPO.repo, branch: DEFAULT_REPO.branch }],
    activeRepoId: DEFAULT_REPO_ID,
  };
}

function stateFromLegacy(cfg: LegacyRepoConfig): RepoState {
  return {
    version: 1,
    owner: text(cfg.owner) || DEFAULT_REPO.owner,
    repos: [{
      id: DEFAULT_REPO_ID,
      repo: text(cfg.repo) || DEFAULT_REPO.repo,
      branch: text(cfg.branch) || DEFAULT_REPO.branch,
    }],
    activeRepoId: DEFAULT_REPO_ID,
  };
}

/** 清洗 localStorage 中的仓库配置；损坏时回退默认仓库（不丢旧库数据）。 */
export function sanitizeRepoState(raw: unknown): RepoState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultRepoState();
  const rec = raw as Partial<RepoState> & Partial<LegacyRepoConfig>;
  // 兼容误存成单仓库配置的情况
  if (typeof rec.repo === 'string' && !Array.isArray(rec.repos)) return stateFromLegacy(rec as LegacyRepoConfig);

  const owner = text(rec.owner) || DEFAULT_REPO.owner;
  const seenIds = new Set<string>();
  const seenRepoKeys = new Set<string>();
  const repos: RepoEntry[] = [];

  if (Array.isArray(rec.repos)) {
    rec.repos.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const row = item as Partial<RepoEntry>;
      const repo = text(row.repo);
      if (!repo) return;
      const branch = text(row.branch) || DEFAULT_REPO.branch;
      const repoKey = `${repo}@${branch}`;
      if (seenRepoKeys.has(repoKey)) return;

      // 缺失/重复 id 用确定性的位置 id 回退：重复清洗同一份数据必须得到同一结果，
      // 否则每次读取都会指向不同的独立库。
      let id = text(row.id) || `repo-${index + 1}`;
      if (seenIds.has(id)) id = `${id}-${index + 1}`;
      while (seenIds.has(id)) id = `${id}-x`;
      seenIds.add(id);
      seenRepoKeys.add(repoKey);
      repos.push({ id, repo, branch });
    });
  }

  if (!repos.length) {
    return {
      version: 1,
      owner,
      repos: [{ id: DEFAULT_REPO_ID, repo: DEFAULT_REPO.repo, branch: DEFAULT_REPO.branch }],
      activeRepoId: DEFAULT_REPO_ID,
    };
  }

  const activeRepoId = repos.some((r) => r.id === rec.activeRepoId) ? rec.activeRepoId! : repos[0].id;
  return { version: 1, owner, repos, activeRepoId };
}

/** 同步读取仓库配置（启动完成后再调用；未初始化时返回默认值）。 */
export function loadRepoState(): RepoState {
  const storage = safeStorage();
  if (storage) {
    try {
      const raw = storage.getItem(STATE_KEY);
      if (raw) return sanitizeRepoState(JSON.parse(raw));
    } catch {
      // 损坏数据回退内存/默认状态
    }
  }
  return memoryState ?? defaultRepoState();
}

export function saveRepoState(state: RepoState): RepoState {
  const clean = sanitizeRepoState(state);
  memoryState = clean;
  const storage = safeStorage();
  try {
    storage?.setItem(STATE_KEY, JSON.stringify(clean));
  } catch {
    // localStorage 不可用（隐私模式/配额）：本次运行仍以内存中的 clean 为准
  }
  return clean;
}

export function activeRepo(state: RepoState = loadRepoState()): RepoConfig {
  const entry = state.repos.find((r) => r.id === state.activeRepoId) ?? state.repos[0];
  return { ...entry, owner: state.owner };
}

/** 仓库库名：默认仓库沿用旧库，保证单仓库时代的数据原地保留。 */
export function repoDbName(id: string): string {
  return id === DEFAULT_REPO_ID ? DEFAULT_DB_NAME : `mdreader-${id}`;
}

function newRepoId(existing: readonly RepoEntry[] = []): string {
  const used = new Set(existing.map((r) => r.id));
  let id = '';
  do {
    idSeq += 1;
    id = `r-${Date.now().toString(36)}-${idSeq.toString(36)}`;
  } while (used.has(id));
  return id;
}

/**
 * 启动引导：读取 localStorage 仓库配置；首次运行从旧版 kv.config 迁移；
 * 然后切换当前仓库的 IndexedDB 作用域，并写入 config 镜像（便于恢复）。
 */
export async function initRepoState(): Promise<RepoState> {
  const storage = safeStorage();
  let state: RepoState | null = null;
  if (storage) {
    try {
      const raw = storage.getItem(STATE_KEY);
      if (raw) state = sanitizeRepoState(JSON.parse(raw));
    } catch {
      state = null;
    }
  }

  if (!state) {
    let legacy: LegacyRepoConfig | undefined;
    try {
      legacy = await kvGet<LegacyRepoConfig>(LEGACY_CONFIG_KEY);
    } catch {
      legacy = undefined;
    }
    state = legacy ? stateFromLegacy(legacy) : defaultRepoState();
    saveRepoState(state);
  }

  memoryState = state;
  const active = activeRepo(state);
  await setRepoDbName(repoDbName(active.id));
  // 镜像写入不阻塞启动（localStorage 才是事实源；DB 被旧连接阻塞时也能先渲染）
  void kvSet(LEGACY_CONFIG_KEY, { owner: active.owner, repo: active.repo, branch: active.branch }).catch(() => {});
  return state;
}

/** 将当前仓库写回当前库的 config 镜像（用于 localStorage 丢失后的恢复）。 */
export async function mirrorActiveRepo(): Promise<void> {
  const { owner, repo, branch } = activeRepo();
  try {
    await kvSet(LEGACY_CONFIG_KEY, { owner, repo, branch });
  } catch {
    // 镜像失败不影响运行期（localStorage 是事实源）
  }
}

/** 修改共享 owner（同一用户名下的全部仓库一起生效）。 */
export function updateOwner(owner: string): RepoState {
  const state = loadRepoState();
  const next = text(owner);
  return saveRepoState({ ...state, owner: next || state.owner });
}

/** 修改当前仓库的仓库名/分支；id 不变，独立库与历史数据保留。 */
export function updateRepo(id: string, patch: { repo?: string; branch?: string }): RepoState {
  const state = loadRepoState();
  const repos = state.repos.map((r) => {
    if (r.id !== id) return r;
    return {
      ...r,
      repo: text(patch.repo) || r.repo,
      branch: text(patch.branch) || r.branch,
    };
  });
  return saveRepoState({ ...state, repos });
}

/** 新增仓库（不自动切换，避免打断当前阅读）。 */
export function addRepo(repo: string, branch: string): RepoState {
  const state = loadRepoState();
  const name = text(repo);
  const targetBranch = text(branch) || DEFAULT_REPO.branch;
  if (!name) throw new Error('请填写仓库名');
  if (state.repos.some((r) => r.repo === name && r.branch === targetBranch)) {
    throw new Error('该仓库已在列表中');
  }
  const next = saveRepoState({
    ...state,
    repos: [...state.repos, { id: newRepoId(state.repos), repo: name, branch: targetBranch }],
  });
  return next;
}

/** 删除仓库配置（至少保留一个；调用方负责在必要时切换当前仓库）。 */
export function removeRepo(id: string): RepoState {
  const state = loadRepoState();
  if (state.repos.length <= 1) throw new Error('至少保留一个仓库');
  const repos = state.repos.filter((r) => r.id !== id);
  const activeRepoId = state.activeRepoId === id ? repos[0].id : state.activeRepoId;
  return saveRepoState({ ...state, repos, activeRepoId });
}

/** 只改当前仓库指针，不刷新页面；运行期切换请用 switchActiveRepo。 */
export function setActiveRepo(id: string): RepoState {
  const state = loadRepoState();
  if (!state.repos.some((r) => r.id === id)) return state;
  return saveRepoState({ ...state, activeRepoId: id });
}

/**
 * 运行期切换仓库：写入指针 + 记住当前路由，然后整页刷新，
 * 让所有模块在“新库作用域”下重新初始化（IndexedDB 连接不跨库复用）。
 */
export function switchActiveRepo(id: string): void {
  const state = setActiveRepo(id);
  if (state.activeRepoId !== id) return;
  try {
    safeSession()?.setItem(RELOAD_ROUTE_KEY, window.location.hash);
  } catch {
    // 忽略：刷新后回首页也可接受
  }
  window.location.reload();
}

/** 启动时取出并清除“切换仓库前记住的路由”。 */
export function takeReloadRoute(): string | null {
  const session = safeSession();
  if (!session) return null;
  try {
    const route = session.getItem(RELOAD_ROUTE_KEY);
    if (route) session.removeItem(RELOAD_ROUTE_KEY);
    return route && route.startsWith('#/') ? route : null;
  } catch {
    return null;
  }
}

/** 删除非当前仓库的独立库（释放空间；当前库由切换/清空流程处理）。 */
export async function deleteRepoDatabase(id: string): Promise<void> {
  if (id === loadRepoState().activeRepoId) return;
  try {
    await deleteDB(repoDbName(id));
  } catch {
    // 删除失败不影响配置删除，残留库可被后续“清除全部数据”回收
  }
}

/** 清空所有仓库的独立库与仓库配置（危险区；全局外观/记忆设置由调用方清理）。 */
export async function clearAllLibraries(): Promise<void> {
  const state = loadRepoState();
  const names = new Set<string>([DEFAULT_DB_NAME, ...state.repos.map((r) => repoDbName(r.id))]);

  // Chromium/Safari 可枚举；Firefox 不支持时退回已知仓库名集合。
  try {
    const databases = await indexedDB.databases?.();
    for (const db of databases ?? []) {
      if (db.name && (db.name === DEFAULT_DB_NAME || db.name.startsWith(`${DEFAULT_DB_NAME}-`))) {
        names.add(db.name);
      }
    }
  } catch {
    // 枚举失败不影响已知仓库清理
  }

  await closeDb();
  for (const name of names) {
    try {
      await deleteDB(name);
    } catch {
      // 单个库删除失败不阻断其余清理
    }
  }

  memoryState = null;
  try {
    safeStorage()?.removeItem(STATE_KEY);
  } catch {
    // 忽略
  }
  await setRepoDbName(DEFAULT_DB_NAME);
}

/** 仅测试用：重置 localStorage 中的仓库配置并回到默认库作用域。 */
export async function resetRepoStateForTests(): Promise<void> {
  memoryState = null;
  try {
    safeStorage()?.removeItem(STATE_KEY);
  } catch {
    // 忽略
  }
  await setRepoDbName(DEFAULT_DB_NAME);
}
