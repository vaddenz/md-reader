import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOME, SETUP, toRouterPath } from '../app/nav';
import AboutSection from '../components/AboutSection';
import AppearanceSection from '../components/AppearanceSection';
import { DEFAULT_REPO } from '../constants';
import { clearAllData, kvGet, kvSet, listFilesMeta, storageEstimate, type FileMeta } from '../data/db';
import { GitHubClient, GitHubError } from '../data/github';
import { bytesToText } from '../lib/format';
import { useSync, type RepoConfig } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';
import '../styles/settings.css';

/** Token 掩码：长 Token 显示前缀 + 末 4 位；短 Token 全部以圆点遮蔽（绝不明文展示完整值）。 */
function maskToken(t: string): string {
  if (t.length <= 8) return '••••';
  const tail = t.slice(-4);
  if (t.length <= 16) return `••••${tail}`;
  return `${t.slice(0, 12)}…${tail}`;
}

/** Token 校验失败文案（按 GitHubError.kind 映射，与引导页一致）。 */
function errorText(err: GitHubError): string {
  switch (err.kind) {
    case 'auth': return 'Token 无效或已过期';
    case 'network': return '网络不可用';
    default: return `验证失败（${err.kind}）：${err.message}`;
  }
}

interface Msg { kind: 'ok' | 'err'; text: string }

/** 设置页：Token / 仓库配置 / 同步 / 存储 / 危险区 / 关于（Spec §3/§5.3/§9）。 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { token, setToken, clear } = useToken();
  const { status, progress, lastSyncAt, error, syncNow, timeAgo } = useSync();

  const [changing, setChanging] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<Msg | null>(null);

  const [cfg, setCfg] = useState<RepoConfig>({ ...DEFAULT_REPO });
  const [repoMsg, setRepoMsg] = useState<Msg | null>(null);

  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [metas, setMetas] = useState<FileMeta[] | null>(null);

  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // 仓库配置：读取已保存值（缺失回退默认仓库）。
  useEffect(() => {
    let cancelled = false;
    void kvGet<RepoConfig>('config').then(
      (saved) => { if (!cancelled && saved) setCfg(saved); },
      () => {},
    );
    return () => { cancelled = true; };
  }, []);

  // 存储统计：进入页面与每次同步完成后刷新。
  useEffect(() => {
    let cancelled = false;
    void storageEstimate().then(
      (s) => { if (!cancelled) setStorage(s); },
      () => {},
    );
    void listFilesMeta().then(
      (list) => { if (!cancelled) setMetas(list); },
      () => { if (!cancelled) setMetas([]); },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

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
      setTokenMsg({ kind: 'err', text: err instanceof GitHubError ? errorText(err) : '验证失败，请重试' });
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

  async function onClearAll() {
    if (clearing) return;
    if (!window.confirm('确定清除全部数据吗？将删除本机全部缓存、收藏、阅读进度与 Token，且不可恢复。')) return;
    setClearing(true);
    setClearError(null);
    try {
      await clearAllData();
      clear();
      navigate(toRouterPath(SETUP));
    } catch {
      setClearError('清除失败，请重试');
      setClearing(false);
    }
  }

  const syncing = status === 'syncing';
  const cachedCount = metas?.filter((m) => m.cached).length ?? 0;
  const uncachedCount = metas ? metas.length - cachedCount : 0;

  return (
    <main className="settings">
      <a className="settings-back" href={HOME}>← 返回首页</a>
      <h1 className="settings-title">设置</h1>

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
          <p className="settings-note">修改后需点击「保存」才会生效；「立即同步」将使用已保存的配置。</p>
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

      <AppearanceSection />

      <section className="settings-section" aria-labelledby="settings-storage-title">
        <h2 id="settings-storage-title">存储</h2>
        <p className="settings-note">
          {storage
            ? `已用 ${bytesToText(storage.usage)} / 配额 ${storage.quota > 0 ? bytesToText(storage.quota) : '未知'}`
            : '读取中…'}
        </p>
        <p className="settings-note">
          {metas ? `已缓存 ${cachedCount} 篇 / 未缓存 ${uncachedCount} 篇` : '统计中…'}
        </p>
      </section>

      <section className="settings-section settings-danger" aria-labelledby="settings-danger-title">
        <h2 id="settings-danger-title">危险区</h2>
        <p className="settings-note">清除本机全部缓存数据与 Token，并返回引导页；此操作不可恢复。</p>
        <button type="button" className="settings-danger-btn" onClick={() => void onClearAll()} disabled={clearing}>
          {clearing ? '清除中…' : '清除全部数据'}
        </button>
        {clearError && <p role="alert" className="settings-error">{clearError}</p>}
      </section>

      <AboutSection />
    </main>
  );
}
