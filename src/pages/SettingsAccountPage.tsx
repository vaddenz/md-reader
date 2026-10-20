import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrSettings } from '../app/nav';
import SettingsHeader from '../components/SettingsHeader';
import { GitHubClient, GitHubError } from '../data/github';
import {
  activeRepo, addRepo, deleteRepoDatabase, loadRepoState, mirrorActiveRepo, removeRepo,
  switchActiveRepo, updateOwner, updateRepo, type RepoState,
} from '../data/repos';
import { githubErrorText } from '../lib/errors';
import { maskToken } from '../lib/token';
import { useSync } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';
import '../styles/settings.css';

interface Msg { kind: 'ok' | 'err'; text: string }

/**
 * 设置 · 账户与仓库：Token / 共享 Owner / 同用户名下的多仓库（各自独立本机书库）/ 同步。
 * 多仓库仅支持同一 GitHub 用户名；切换仓库通过整页刷新重建库作用域。
 */
export default function SettingsAccountPage() {
  const navigate = useNavigate();
  const { token, setToken, clear } = useToken();
  const { status, progress, lastSyncAt, error, syncNow, timeAgo } = useSync();

  const [changing, setChanging] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<Msg | null>(null);

  const [repoState, setRepoState] = useState<RepoState>(() => loadRepoState());
  const active = activeRepo(repoState);
  const [ownerDraft, setOwnerDraft] = useState(repoState.owner);
  const [ownerMsg, setOwnerMsg] = useState<Msg | null>(null);
  const [repoDraft, setRepoDraft] = useState(active.repo);
  const [branchDraft, setBranchDraft] = useState(active.branch);
  const [repoMsg, setRepoMsg] = useState<Msg | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newRepo, setNewRepo] = useState('');
  const [newBranch, setNewBranch] = useState('main');
  const [addMsg, setAddMsg] = useState<Msg | null>(null);

  async function onChangeToken(e: FormEvent) {
    e.preventDefault();
    const next = tokenInput.trim();
    if (!next) {
      setTokenMsg({ kind: 'err', text: '请先粘贴 Token' });
      return;
    }
    if (tokenBusy) return;
    setTokenBusy(true);
    setTokenMsg(null);
    try {
      await new GitHubClient(next).getUser();
      setToken(next);
      setChanging(false);
      setTokenInput('');
      setTokenMsg({ kind: 'ok', text: 'Token 已更新' });
    } catch (err) {
      setTokenMsg({ kind: 'err', text: err instanceof GitHubError ? githubErrorText(err) : '验证失败，请重试' });
    } finally {
      setTokenBusy(false);
    }
  }

  function onClearToken() {
    clear();
    setChanging(false);
    setTokenInput('');
    setTokenMsg(null);
  }

  async function onSaveOwner(e: FormEvent) {
    e.preventDefault();
    const next = ownerDraft.trim();
    if (!next) {
      setOwnerMsg({ kind: 'err', text: '请填写 GitHub 用户名' });
      return;
    }
    const saved = updateOwner(next);
    setRepoState(saved);
    setOwnerDraft(saved.owner);
    await mirrorActiveRepo();
    setOwnerMsg({ kind: 'ok', text: '用户名已保存' });
  }

  async function onSaveRepo(e: FormEvent) {
    e.preventDefault();
    const repo = repoDraft.trim();
    const branch = branchDraft.trim();
    if (!repo || !branch) {
      setRepoMsg({ kind: 'err', text: '请填写仓库名与分支' });
      return;
    }
    if (repoState.repos.some((r) => r.id !== active.id && r.repo === repo && r.branch === branch)) {
      setRepoMsg({ kind: 'err', text: '该仓库已在列表中' });
      return;
    }
    const saved = updateRepo(active.id, { repo, branch });
    const updated = saved.repos.find((r) => r.id === active.id)!;
    setRepoState(saved);
    setRepoDraft(updated.repo);
    setBranchDraft(updated.branch);
    await mirrorActiveRepo();
    setRepoMsg({ kind: 'ok', text: '仓库已保存，下次同步使用新配置' });
  }

  function onAddRepo(e: FormEvent) {
    e.preventDefault();
    try {
      const saved = addRepo(newRepo, newBranch);
      setRepoState(saved);
      setNewRepo('');
      setNewBranch('main');
      setAddOpen(false);
      setAddMsg({ kind: 'ok', text: '仓库已添加；切换到该仓库后开始同步' });
    } catch (err) {
      setAddMsg({ kind: 'err', text: err instanceof Error ? err.message : '添加失败，请重试' });
    }
  }

  function onRemoveRepo(id: string, repo: string) {
    if (!window.confirm(`确定删除仓库「${repo}」吗？该仓库的本机缓存、收藏、进度与标签页也会删除。`)) return;
    try {
      const saved = removeRepo(id);
      setRepoState(saved);
      void deleteRepoDatabase(id);
      setRepoMsg({ kind: 'ok', text: '仓库已删除' });
    } catch (err) {
      setRepoMsg({ kind: 'err', text: err instanceof Error ? err.message : '删除失败，请重试' });
    }
  }

  const syncing = status === 'syncing';

  return (
    <main className="settings">
      <SettingsHeader
        title="账户与仓库"
        subtitle="同一 GitHub 用户名下的多个仓库共用一个 Token；每个仓库有独立的本机书库。"
        backLabel="返回"
        backAriaLabel="返回"
        onBack={() => goBackOrSettings(navigate)}
      />

      <section className="settings-section" aria-labelledby="settings-account-title">
        <h2 id="settings-account-title">GitHub 账号</h2>

        <p className="settings-subhead">访问 Token</p>
        <p className="settings-token-row">
          <code className="settings-token">{token ? maskToken(token) : '未配置'}</code>
          <button
            type="button"
            onClick={() => { setChanging((v) => !v); setTokenMsg(null); }}
          >
            {changing ? '取消更换' : '更换'}
          </button>
          <button type="button" onClick={onClearToken} disabled={!token}>清除</button>
        </p>
        <p className="settings-note">Token 仅保存在本机浏览器，不会上传到任何第三方，也不会写入 URL 或日志。</p>

        {changing && (
          <form className="settings-token-form" onSubmit={onChangeToken}>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="粘贴新的 Fine-grained PAT"
              aria-label="新的 GitHub Token"
              autoComplete="off"
              disabled={tokenBusy}
            />
            <button type="submit" disabled={tokenBusy}>{tokenBusy ? '验证中…' : '验证并保存'}</button>
          </form>
        )}
        {tokenMsg && (
          <p role={tokenMsg.kind === 'err' ? 'alert' : 'status'} className={tokenMsg.kind === 'err' ? 'settings-error' : 'settings-ok'}>
            {tokenMsg.text}
          </p>
        )}

        <form className="settings-repo-form settings-owner-form" onSubmit={onSaveOwner}>
          <label>
            Owner
            <input
              value={ownerDraft}
              onChange={(e) => { setOwnerDraft(e.target.value); setOwnerMsg(null); }}
              autoComplete="off"
            />
          </label>
          <p className="settings-note">GitHub 用户名（所有仓库共用）。Token 需包含各仓库的 Contents 只读权限。</p>
          <button type="submit">保存 Owner</button>
          {ownerMsg && (
            <p role={ownerMsg.kind === 'err' ? 'alert' : 'status'} className={ownerMsg.kind === 'err' ? 'settings-error' : 'settings-ok'}>
              {ownerMsg.text}
            </p>
          )}
        </form>
      </section>

      <section className="settings-section" aria-labelledby="settings-repo-title">
        <h2 id="settings-repo-title">仓库（{repoState.repos.length}）</h2>

        <ul className="settings-repo-list" aria-label="仓库列表">
          {repoState.repos.map((r) => {
            const isActive = r.id === repoState.activeRepoId;
            return (
              <li key={r.id} className="settings-repo-item">
                <label className="settings-repo-row">
                  <input
                    type="radio"
                    name="active-repo"
                    checked={isActive}
                    onChange={() => { if (!isActive) switchActiveRepo(r.id); }}
                  />
                  <span className="settings-repo-row-text">
                    <span className="settings-repo-row-name">{r.repo}</span>
                    <span className="settings-repo-row-branch">{r.branch}</span>
                  </span>
                  {isActive && <span className="settings-repo-current">当前</span>}
                </label>
                {!isActive && (
                  <button
                    type="button"
                    className="settings-repo-delete"
                    aria-label={`删除仓库 ${r.repo}`}
                    onClick={() => onRemoveRepo(r.id, r.repo)}
                  >
                    删除
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="settings-note">点选仓库即可切换；切换会重新载入，并打开该仓库独立的本机缓存、收藏、进度与标签页。</p>

        <form className="settings-repo-form settings-repo-edit" onSubmit={onSaveRepo}>
          <p className="settings-subhead">当前仓库</p>
          <label>
            仓库名
            <input
              value={repoDraft}
              onChange={(e) => { setRepoDraft(e.target.value); setRepoMsg(null); }}
              autoComplete="off"
            />
          </label>
          <label>
            分支
            <input
              value={branchDraft}
              onChange={(e) => { setBranchDraft(e.target.value); setRepoMsg(null); }}
              autoComplete="off"
            />
          </label>
          <p className="settings-note">修改后需点击「保存仓库」才会生效；「立即同步」将使用上次保存的配置。</p>
          <button type="submit">保存仓库</button>
          {repoMsg && (
            <p role={repoMsg.kind === 'err' ? 'alert' : 'status'} className={repoMsg.kind === 'err' ? 'settings-error' : 'settings-ok'}>
              {repoMsg.text}
            </p>
          )}
        </form>

        <button
          type="button"
          className="settings-add-toggle"
          onClick={() => { setAddOpen((v) => !v); setAddMsg(null); }}
        >
          {addOpen ? '取消添加' : '+ 添加仓库'}
        </button>

        {addOpen && (
          <form className="settings-repo-form settings-add-form" onSubmit={onAddRepo}>
            <label>
              仓库名
              <input
                value={newRepo}
                onChange={(e) => { setNewRepo(e.target.value); setAddMsg(null); }}
                placeholder="my-notes"
                autoComplete="off"
              />
            </label>
            <label>
              分支
              <input
                value={newBranch}
                onChange={(e) => { setNewBranch(e.target.value); setAddMsg(null); }}
                autoComplete="off"
              />
            </label>
            <p className="settings-note">仓库需属于上方 Owner；添加后不会自动切换，也不会立即下载。</p>
            <button type="submit">添加</button>
          </form>
        )}

        {addMsg && (
          <p role={addMsg.kind === 'err' ? 'alert' : 'status'} className={addMsg.kind === 'err' ? 'settings-error' : 'settings-ok'}>
            {addMsg.text}
          </p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="settings-sync-title">
        <h2 id="settings-sync-title">同步</h2>
        <p className="settings-sync-row">
          <button type="button" onClick={() => void syncNow()} disabled={syncing}>
            {syncing ? '同步中…' : '立即同步'}
          </button>
          <span className="settings-note">{lastSyncAt ? `上次同步：${timeAgo(lastSyncAt)}` : '尚未同步'}</span>
        </p>
        {syncing && (
          <p className="settings-note" role="status">
            {progress?.phase === 'download' ? `同步中：${progress.done} / ${progress.total} 篇` : '同步中…'}
          </p>
        )}
        {status === 'offline' && <p className="settings-note">离线中，联网后可同步。</p>}
        {status === 'error' && error && (
          <p role="alert" className="settings-error">同步失败：{error.message}</p>
        )}
      </section>
    </main>
  );
}
