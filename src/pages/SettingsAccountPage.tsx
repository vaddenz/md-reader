import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrSettings } from '../app/nav';
import SettingsHeader from '../components/SettingsHeader';
import { DEFAULT_REPO } from '../constants';
import { kvGet, kvSet } from '../data/db';
import { GitHubClient, GitHubError } from '../data/github';
import { githubErrorText } from '../lib/errors';
import { maskToken } from '../lib/token';
import { useSync, type RepoConfig } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';
import '../styles/settings.css';

interface Msg { kind: 'ok' | 'err'; text: string }

/** 设置 · 账户与仓库：Token / 仓库配置 / 同步（原设置页前三区块）。 */
export default function SettingsAccountPage() {
  const navigate = useNavigate();
  const { token, setToken, clear } = useToken();
  const { status, progress, lastSyncAt, error, syncNow, timeAgo } = useSync();

  const [changing, setChanging] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<Msg | null>(null);

  const [cfg, setCfg] = useState<RepoConfig>({ ...DEFAULT_REPO });
  const [repoMsg, setRepoMsg] = useState<Msg | null>(null);

  // 仓库配置：读取已保存值（缺失回退默认仓库）。
  useEffect(() => {
    let cancelled = false;
    void kvGet<RepoConfig>('config').then(
      (saved) => { if (!cancelled && saved) setCfg(saved); },
      () => {},
    );
    return () => { cancelled = true; };
  }, []);

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

  async function onSaveRepo(e: FormEvent) {
    e.preventDefault();
    const next = { owner: cfg.owner.trim(), repo: cfg.repo.trim(), branch: cfg.branch.trim() };
    if (!next.owner || !next.repo || !next.branch) {
      setRepoMsg({ kind: 'err', text: '请填写完整的仓库信息（Owner / 仓库名 / 分支）' });
      return;
    }
    try {
      await kvSet('config', next);
      setCfg(next);
      setRepoMsg({ kind: 'ok', text: '已保存' });
    } catch {
      setRepoMsg({ kind: 'err', text: '保存失败，请重试' });
    }
  }

  const syncing = status === 'syncing';

  return (
    <main className="settings">
      <SettingsHeader
        title="账户与仓库"
        subtitle="GitHub 访问凭据与内容来源；Token 只保存在本机。"
        backLabel="设置"
        backAriaLabel="返回设置"
        onBack={() => goBackOrSettings(navigate)}
      />

      <section className="settings-section" aria-labelledby="settings-token-title">
        <h2 id="settings-token-title">访问 Token</h2>
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
      </section>

      <section className="settings-section" aria-labelledby="settings-repo-title">
        <h2 id="settings-repo-title">仓库配置</h2>
        <form className="settings-repo-form" onSubmit={onSaveRepo}>
          <label>
            Owner
            <input
              value={cfg.owner}
              onChange={(e) => { setCfg({ ...cfg, owner: e.target.value }); setRepoMsg(null); }}
              autoComplete="off"
            />
          </label>
          <label>
            仓库名
            <input
              value={cfg.repo}
              onChange={(e) => { setCfg({ ...cfg, repo: e.target.value }); setRepoMsg(null); }}
              autoComplete="off"
            />
          </label>
          <label>
            分支
            <input
              value={cfg.branch}
              onChange={(e) => { setCfg({ ...cfg, branch: e.target.value }); setRepoMsg(null); }}
              autoComplete="off"
            />
          </label>
          <p className="settings-note">修改后需点击「保存」才会生效；「立即同步」将使用上次保存的配置。</p>
          <button type="submit">保存</button>
          {repoMsg && (
            <p role={repoMsg.kind === 'err' ? 'alert' : 'status'} className={repoMsg.kind === 'err' ? 'settings-error' : 'settings-ok'}>
              {repoMsg.text}
            </p>
          )}
        </form>
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
