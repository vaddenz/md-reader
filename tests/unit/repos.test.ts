// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, getRepoDbName, kvGet, kvSet, setRepoDbName } from '../../src/data/db';
import {
  activeRepo, addRepo, defaultRepoState, initRepoState, loadRepoState, removeRepo, repoDbName,
  resetRepoStateForTests, sanitizeRepoState, saveRepoState, setActiveRepo, updateOwner, updateRepo,
} from '../../src/data/repos';

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
  await resetRepoStateForTests();
  await clearAllData();
  await setRepoDbName('mdreader');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeRepoState', () => {
  it('非法输入回退默认仓库', () => {
    expect(sanitizeRepoState(null)).toEqual(defaultRepoState());
    expect(sanitizeRepoState([])).toEqual(defaultRepoState());
    expect(sanitizeRepoState({ owner: '', repos: [] })).toMatchObject({
      owner: 'vaddenz', activeRepoId: 'default',
    });
  });

  it('丢弃重复/空仓库，active 失效时回退首个', () => {
    const state = sanitizeRepoState({
      owner: 'alice',
      activeRepoId: 'missing',
      repos: [
        { id: 'a', repo: 'notes', branch: 'main' },
        { id: 'b', repo: 'notes', branch: 'main' },
        { id: 'c', repo: '', branch: 'dev' },
        { id: 'd', repo: 'blog', branch: 'dev' },
      ],
    });
    expect(state.owner).toBe('alice');
    expect(state.repos).toEqual([
      { id: 'a', repo: 'notes', branch: 'main' },
      { id: 'd', repo: 'blog', branch: 'dev' },
    ]);
    expect(state.activeRepoId).toBe('a');
  });

  it('缺失 id 时生成确定性位置 id（重复清洗结果一致）', () => {
    const raw = {
      owner: 'alice',
      activeRepoId: 'repo-1',
      repos: [
        { repo: 'notes', branch: 'main' },
        { repo: 'blog', branch: 'dev' },
      ],
    };
    expect(sanitizeRepoState(raw)).toEqual(sanitizeRepoState(raw));
    expect(sanitizeRepoState(raw).repos.map((r) => r.id)).toEqual(['repo-1', 'repo-2']);
  });

  it('兼容误存的单仓库配置', () => {
    expect(sanitizeRepoState({ owner: 'alice', repo: 'notes', branch: 'dev' })).toEqual({
      version: 1,
      owner: 'alice',
      repos: [{ id: 'default', repo: 'notes', branch: 'dev' }],
      activeRepoId: 'default',
    });
  });
});

describe('仓库配置读写', () => {
  it('保存/读取；默认仓库映射旧库名，自定义仓库使用独立库名', () => {
    const saved = saveRepoState({
      version: 1,
      owner: 'alice',
      activeRepoId: 'r1',
      repos: [
        { id: 'default', repo: 'notes', branch: 'main' },
        { id: 'r1', repo: 'blog', branch: 'dev' },
      ],
    });
    expect(loadRepoState()).toEqual(saved);
    expect(activeRepo()).toEqual({ id: 'r1', owner: 'alice', repo: 'blog', branch: 'dev' });
    expect(repoDbName('default')).toBe('mdreader');
    expect(repoDbName('r1')).toBe('mdreader-r1');
  });

  it('新增/改名/切换/删除；重复仓库与删除最后一个被拒绝', () => {
    saveRepoState(defaultRepoState());
    const added = addRepo('  notes  ', ' dev ');
    expect(added.repos).toHaveLength(2);
    const notes = added.repos.find((r) => r.repo === 'notes')!;
    expect(notes.branch).toBe('dev');
    expect(() => addRepo('notes', 'dev')).toThrow('该仓库已在列表中');

    const renamed = updateRepo(notes.id, { repo: 'handbook', branch: 'release' });
    expect(renamed.repos.find((r) => r.id === notes.id)).toMatchObject({ repo: 'handbook', branch: 'release' });

    expect(setActiveRepo(notes.id).activeRepoId).toBe(notes.id);
    expect(activeRepo().repo).toBe('handbook');
    expect(removeRepo(notes.id).repos).toEqual([{ id: 'default', repo: 'interview', branch: 'main' }]);
    expect(() => removeRepo('default')).toThrow('至少保留一个仓库');
  });

  it('修改 Owner 对全部仓库生效且 trim', () => {
    const added = addRepo('notes', 'main');
    expect(updateOwner('  alice  ').owner).toBe('alice');
    expect(activeRepo().owner).toBe('alice');
    expect(added.repos).toHaveLength(2);
  });
});

describe('initRepoState', () => {
  it('首次启动从旧版 kv.config 迁移到默认仓库（沿用旧库）', async () => {
    await kvSet('config', { owner: 'legacy', repo: 'notes', branch: 'dev' });
    const state = await initRepoState();
    expect(state).toEqual({
      version: 1,
      owner: 'legacy',
      repos: [{ id: 'default', repo: 'notes', branch: 'dev' }],
      activeRepoId: 'default',
    });
    expect(getRepoDbName()).toBe('mdreader');
    expect(await kvGet('config')).toEqual({ owner: 'legacy', repo: 'notes', branch: 'dev' });
  });

  it('已有 localStorage 配置时直接切换库作用域并写 config 镜像', async () => {
    saveRepoState({
      version: 1,
      owner: 'alice',
      activeRepoId: 'r1',
      repos: [
        { id: 'default', repo: 'notes', branch: 'main' },
        { id: 'r1', repo: 'blog', branch: 'dev' },
      ],
    });
    const state = await initRepoState();
    expect(state.activeRepoId).toBe('r1');
    expect(getRepoDbName()).toBe('mdreader-r1');
    expect(await kvGet('config')).toEqual({ owner: 'alice', repo: 'blog', branch: 'dev' });

    // 清理自定义库并回默认作用域
    await clearAllData();
    await setRepoDbName('mdreader');
  });
});
