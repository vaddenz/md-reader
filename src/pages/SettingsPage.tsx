import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SETTINGS_ABOUT, SETTINGS_ACCOUNT, SETTINGS_DATA, SETTINGS_READING, goBackOrHome,
} from '../app/nav';
import SettingsHeader from '../components/SettingsHeader';
import pkg from '../../package.json';
import { DEFAULT_REPO } from '../constants';
import { DEFAULT_APPEARANCE, getAppearance, type ReaderAppearance } from '../data/appearance';
import { kvGet, listFilesMeta, storageEstimate, type FileMeta } from '../data/db';
import { bytesToText } from '../lib/format';
import { maskToken } from '../lib/token';
import { useSync, type RepoConfig } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';
import '../styles/settings.css';

const FONT_LABELS: Record<ReaderAppearance['fontFamily'], string> = {
  system: '系统字体',
  xihei: '等线',
  serif: '宋体',
};

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
        d="M10.4 13.6a4.2 4.2 0 0 0 6 0l2.1-2.1a4.2 4.2 0 0 0-6-6l-1.2 1.2"
      />
      <path
        fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
        d="M13.6 10.4a4.2 4.2 0 0 0-6 0l-2.1 2.1a4.2 4.2 0 0 0 6 6l1.2-1.2"
      />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
        d="M12 6.6C9.9 5.1 7.2 4.5 4.8 5.2v13.1c2.4-.7 5.1-.1 7.2 1.4 2.1-1.5 4.8-2.1 7.2-1.4V5.2c-2.4-.7-5.1-.1-7.2 1.4Z"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 6.6v13.1" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="6.6" ry="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        d="M5.4 6v6c0 1.3 3 2.4 6.6 2.4s6.6-1.1 6.6-2.4V6M5.4 12v6c0 1.3 3 2.4 6.6 2.4s6.6-1.1 6.6-2.4v-6"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 11v5" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="settings-group-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
        d="m9.5 5.5 6.5 6.5-6.5 6.5"
      />
    </svg>
  );
}

/** 设置首页：连接状态 + 分组导航；细节收进各二级页（账户 / 阅读 / 数据 / 关于）。 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { token } = useToken();
  const { status, lastSyncAt, syncNow, timeAgo } = useSync();

  const [cfg, setCfg] = useState<RepoConfig>({ ...DEFAULT_REPO });
  const [appearance, setAppearance] = useState<ReaderAppearance>(DEFAULT_APPEARANCE);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [metas, setMetas] = useState<FileMeta[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void kvGet<RepoConfig>('config').then(
      (saved) => { if (!cancelled && saved) setCfg(saved); },
      () => {},
    );
    void getAppearance().then(
      (value) => { if (!cancelled) setAppearance(value); },
      () => {},
    );
    return () => { cancelled = true; };
  }, []);

  // 存储统计与文档数量：进入页面与每次同步完成后刷新。
  useEffect(() => {
    let cancelled = false;
    void storageEstimate().then(
      (value) => { if (!cancelled) setStorage(value); },
      () => {},
    );
    void listFilesMeta().then(
      (list) => { if (!cancelled) setMetas(list); },
      () => { if (!cancelled) setMetas([]); },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

  const syncing = status === 'syncing';
  const cachedCount = metas?.filter((m) => m.cached).length ?? 0;
  const syncText = syncing
    ? '同步中…'
    : status === 'offline'
      ? lastSyncAt ? `离线 · 上次同步 ${timeAgo(lastSyncAt)}` : '离线'
      : status === 'error'
        ? '同步失败'
        : lastSyncAt ? `上次同步 ${timeAgo(lastSyncAt)}` : '尚未同步';

  const readingSummary = `${FONT_LABELS[appearance.fontFamily]} · ${appearance.fontSize}px`;
  const dataSummary = metas === null
    ? '读取中…'
    : storage
      ? `${cachedCount} 篇已缓存 · ${bytesToText(storage.usage)}`
      : `${cachedCount} 篇已缓存`;

  return (
    <main className="settings">
      <SettingsHeader
        title="设置"
        backLabel="返回"
        backAriaLabel="返回"
        onBack={() => goBackOrHome(navigate)}
      />

      <section className="settings-connect" aria-label="GitHub 连接">
        <a className="settings-connect-link" href={SETTINGS_ACCOUNT}>
          <span className="settings-connect-icon"><LinkIcon /></span>
          <span className="settings-connect-text">
            <span className="settings-connect-eyebrow">GitHub 连接</span>
            <span className="settings-connect-repo">{cfg.owner} / {cfg.repo}</span>
            <span className="settings-connect-meta">
              <span>{cfg.branch}</span>
              <span aria-hidden="true">·</span>
              <code className="settings-connect-token">{token ? maskToken(token) : '未配置 Token'}</code>
            </span>
          </span>
          <ChevronIcon />
        </a>

        <div className="settings-connect-sync">
          <span className={`settings-dot settings-dot-${status}`} aria-hidden="true" />
          <span className="settings-connect-status">{syncText}</span>
          <button
            type="button"
            className="settings-sync-btn"
            onClick={() => void syncNow()}
            disabled={syncing}
          >
            {syncing ? '同步中…' : '立即同步'}
          </button>
        </div>
      </section>

      <nav className="settings-nav" aria-label="设置分类">
        <p className="settings-groups-label">更多设置</p>
        <ul className="settings-groups">
          <li>
            <a className="settings-group-link" href={SETTINGS_READING}>
              <span className="settings-group-icon"><BookIcon /></span>
              <span className="settings-group-text">
                <span className="settings-group-title">阅读体验</span>
                <span className="settings-group-sub">{readingSummary} · 显示方向</span>
              </span>
              <ChevronIcon />
            </a>
          </li>
          <li>
            <a className="settings-group-link" href={SETTINGS_DATA}>
              <span className="settings-group-icon"><DatabaseIcon /></span>
              <span className="settings-group-text">
                <span className="settings-group-title">数据管理</span>
                <span className="settings-group-sub">{dataSummary} · 高亮备份</span>
              </span>
              <ChevronIcon />
            </a>
          </li>
          <li>
            <a className="settings-group-link" href={SETTINGS_ABOUT}>
              <span className="settings-group-icon"><InfoIcon /></span>
              <span className="settings-group-text">
                <span className="settings-group-title">关于</span>
                <span className="settings-group-sub">v{pkg.version} · 个人自用与隐私说明</span>
              </span>
              <ChevronIcon />
            </a>
          </li>
        </ul>
      </nav>

      <p className="settings-privacy">Token 与阅读数据仅保存在本机</p>
    </main>
  );
}
