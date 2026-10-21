import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrSettings } from '../app/nav';
import SettingsHeader from '../components/SettingsHeader';
import SyncSetupSection from '../components/SyncSetupSection';
import { useOnline } from '../hooks/useOnline';
import { showToast } from '../lib/toast';
import { maskToken } from '../lib/token';
import { useDataSync } from '../sync/DataSyncContext';
import { listSyncBackends, isSyncConfigured } from '../sync/registry';
import { loadSyncState } from '../sync/state';
import type { SyncConfig } from '../sync/types';
import '../styles/settings.css';

interface Msg { kind: 'ok' | 'err'; text: string }

export default function SettingsSyncPage() {
  const navigate = useNavigate();
  const online = useOnline();
  const {
    config,
    status,
    summary,
    error,
    pendingCount,
    warning,
    syncNow,
    testConnection,
    saveConfig,
    setAutoSync,
    disable,
    clearConfig,
    refreshPendingCount,
  } = useDataSync();
  const backends = listSyncBackends();
  const backend = backends.find((b) => b.type === config.backend) ?? backends[0];
  const savedToken = config.values.token ?? '';
  const [endpoint, setEndpoint] = useState(config.values.endpoint ?? '');
  const [token, setToken] = useState('');
  const [tokenEditing, setTokenEditing] = useState(!savedToken);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null);
  const lastSyncAt = summary?.finishedAt ?? loadSyncState().lastSyncAt;

  useEffect(() => { setEndpoint(config.values.endpoint ?? ''); }, [config.values.endpoint]);
  useEffect(() => { void refreshPendingCount(); }, [refreshPendingCount]);

  const effectiveToken = tokenEditing ? token.trim() : savedToken;
  const canConfigure = Boolean(endpoint.trim() && effectiveToken);
  const canSync = config.enabled && isSyncConfigured(config);

  const runTest = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const result = await testConnection({ endpoint: endpoint.trim(), token: effectiveToken });
      setMsg({ kind: 'ok', text: result.warning ? `连接成功；${result.warning}` : '连接成功：表与 RPC 可用' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '连接失败' });
    } finally {
      setBusy(null);
    }
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!canConfigure) {
      setMsg({ kind: 'err', text: '请填写接口地址与 JWT' });
      return;
    }
    const next: SyncConfig = {
      ...config,
      enabled: true,
      values: { ...config.values, endpoint: endpoint.trim(), token: effectiveToken },
    };
    try {
      await saveConfig(next);
      setToken('');
      setTokenEditing(false);
      setMsg({ kind: 'ok', text: '已保存；自动同步默认关闭，点击「立即同步」开始首次同步' });
      if (next.autoSync) showToast('自动同步已开启');
    } catch {
      setMsg({ kind: 'err', text: '切换同步后端失败，请稍后重试' });
    }
  };

  const statusText = status === 'syncing'
    ? '同步中…'
    : status === 'offline'
      ? '离线'
      : status === 'error'
        ? '同步失败'
        : status === 'unconfigured'
          ? '未配置'
          : status === 'disabled'
            ? '已停用'
            : config.autoSync
              ? '已启用（自动）'
              : '仅手动同步';

  return (
    <main className="settings">
      <SettingsHeader
        title="跨设备同步"
        subtitle="阅读进度、高亮、收藏与记忆数据在多台设备间同步；正文与 GitHub Token 不上传。"
        backLabel="返回"
        backAriaLabel="返回"
        onBack={() => goBackOrSettings(navigate)}
      />

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
          <input
            type="checkbox"
            role="switch"
            checked={config.autoSync}
            onChange={(e) => setAutoSync(e.target.checked)}
            disabled={!canSync}
            aria-label="自动同步"
          />
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
          <label>
            接口地址
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={backend?.fields.find((f) => f.key === 'endpoint')?.placeholder}
              autoComplete="off"
            />
          </label>
          <label>
            JWT
            {tokenEditing ? (
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="粘贴长期 JWT"
                autoComplete="off"
              />
            ) : (
              <span className="settings-token-row">
                <code className="settings-token">{maskToken(savedToken)}</code>
                <button type="button" onClick={() => { setToken(''); setTokenEditing(true); }}>更换</button>
              </span>
            )}
          </label>
          <p className="settings-note">JWT 只保存在本机浏览器；启用后阅读数据会发送到你自己的 Neon 端点。</p>
          <p className="settings-sync-row">
            <button type="submit" disabled={busy !== null || !canConfigure}>保存并启用</button>
            <button type="button" onClick={() => void runTest()} disabled={busy !== null || !canConfigure}>
              {busy === 'test' ? '测试中…' : '测试连接'}
            </button>
            <button
              type="button"
              onClick={() => { setBusy('sync'); void syncNow().finally(() => setBusy(null)); }}
              disabled={busy !== null || !canSync || !online}
            >
              {busy === 'sync' ? '同步中…' : '立即同步'}
            </button>
          </p>
          {msg && <p role={msg.kind === 'err' ? 'alert' : 'status'} className={msg.kind === 'err' ? 'settings-error' : 'settings-ok'}>{msg.text}</p>}
        </form>
      </section>

      <section className="settings-section" aria-labelledby="settings-sync-scope-title">
        <h2 id="settings-sync-scope-title">同步范围</h2>
        <ul className="settings-about-list">
          <li>阅读进度、文本高亮、笔记、收藏</li>
          <li>记忆 SRS 调度、训练记录、题库偏好、坏题标记</li>
        </ul>
        <p className="settings-note">不同步：正文、GitHub Token、AI Key / 模型配置、当前训练会话、打开的标签页、阅读外观。</p>
      </section>

      <section className="settings-section" aria-labelledby="settings-sync-repos-title">
        <h2 id="settings-sync-repos-title">仓库结果</h2>
        {summary?.repos.length ? (
          <ul className="settings-about-list">
            {summary.repos.map((r) => (
              <li key={r.repoId}>
                {r.scope}：拉取 {r.pulled} · 应用 {r.applied} · 推送 {r.pushed}
                {r.error ? ` · ${r.error}` : ''}{r.skipped === 'blocked' ? ' · 数据库被占用' : ''}
              </li>
            ))}
          </ul>
        ) : <p className="settings-note">尚未同步。</p>}
      </section>

      <SyncSetupSection />

      <section className="settings-section settings-danger" aria-labelledby="settings-sync-danger-title">
        <h2 id="settings-sync-danger-title">危险区</h2>
        <p className="settings-note">停用只停止同步；清除配置会删除本机 URL / JWT 与同步状态，但不会删除 Neon 上已同步的数据。</p>
        <p className="settings-sync-row">
          <button type="button" onClick={disable} disabled={!config.enabled}>停用</button>
          <button
            type="button"
            className="settings-danger-btn"
            onClick={() => {
              if (window.confirm('确定清除同步配置吗？不会删除 Neon 上已同步的数据。')) {
                clearConfig();
                setToken('');
                setTokenEditing(true);
                setMsg({ kind: 'ok', text: '同步配置已清除' });
              }
            }}
          >
            清除配置
          </button>
        </p>
      </section>
    </main>
  );
}
