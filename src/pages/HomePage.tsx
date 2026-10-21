import { useEffect, useMemo, useState } from 'react';
import { MEMORY, SETTINGS, docHref, searchHref } from '../app/nav';
import FileTree from '../components/FileTree';
import SyncBadge from '../components/SyncBadge';
import { DbBlockedError, listFilesMeta, type FileMeta } from '../data/db';
import { loadSrsMap } from '../data/memory';
import { loadBadQuestionMap } from '../data/badQuestions';
import { getFavorites, getProgress, recentDocs, type RecentDoc } from '../data/prefs';
import { useSync } from '../state/SyncContext';
import '../styles/home.css';

/** 收藏星标（小号）：首页「收藏」区块条目标记。 */
function StarIcon() {
  return (
    <svg className="home-doc-star" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3.6l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9z"
      />
    </svg>
  );
}

/** 设置齿轮（小号）：首页顶部入口。 */
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      />
    </svg>
  );
}

/** 记忆助手入口图标（记忆卡片意象：两张叠放的卡片）。 */
function MemoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="4" y="7" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        d="M8 4h9a3 3 0 0 1 3 3v9M8 12h5M8 16h5"
      />
    </svg>
  );
}

export default function HomePage() {
  const { lastSyncAt } = useSync();
  const [metas, setMetas] = useState<FileMeta[] | null>(null);
  const [recents, setRecents] = useState<RecentDoc[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentRatios, setRecentRatios] = useState<Record<string, number>>({});
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [syncTick, setSyncTick] = useState(0);

  // 跨设备同步应用了远端数据：重读首页上可能被远端更新/删除的区块。
  useEffect(() => {
    const onApplied = () => setSyncTick((v) => v + 1);
    window.addEventListener('mdreader:sync-applied', onApplied);
    return () => window.removeEventListener('mdreader:sync-applied', onApplied);
  }, []);

  // 记忆助手入口的「今日待复习」提示（仅本机统计，坏题不计；失败静默）
  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSrsMap(), loadBadQuestionMap()]).then(
      ([map, bad]) => {
        if (cancelled) return;
        const now = Date.now();
        setDueCount([...map.values()].filter((s) => !bad.has(s.qid) && s.dueAt <= now).length);
      },
      () => {},
    );
    return () => { cancelled = true; };
  }, [lastSyncAt, syncTick]);

  // 数据库被旧页面连接阻塞（v1→v2 升级无法完成）时自动重试：旧标签页释放后无需手动刷新。
  useEffect(() => {
    if (!dbError) return;
    const timer = window.setTimeout(() => {
      setDbError(null);
      setMetas(null);
      setReloadTick((v) => v + 1);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [dbError]);

  // 进入首页读取一次；同步完成（lastSyncAt 变化）或手动重试（reloadTick）后重读。
  useEffect(() => {
    let cancelled = false;
    void listFilesMeta().then(
      (list) => { if (!cancelled) { setMetas(list); setDbError(null); } },
      (err) => {
        if (cancelled) return;
        if (err instanceof DbBlockedError) {
          setDbError(err.message);
          setMetas(null);
        } else {
          setMetas([]);
        }
      },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt, reloadTick]);

  const retryDb = () => {
    setDbError(null);
    setMetas(null);
    setReloadTick((v) => v + 1);
  };

  // 继续阅读 / 收藏：同样在进入首页与同步完成后重读（同步可能移除文档，区块随之收敛）。
  useEffect(() => {
    let cancelled = false;
    void Promise.all([recentDocs(3), getFavorites()]).then(
      ([recent, favs]) => { if (!cancelled) { setRecents(recent); setFavorites(favs); } },
      () => {},
    );
    return () => { cancelled = true; };
  }, [lastSyncAt, syncTick]);

  // 只展示目录树里仍存在的文档（收藏/进度可能指向已从仓库移除的路径）。
  const known = useMemo(() => new Map((metas ?? []).map((m) => [m.path, m])), [metas]);
  const recentShown = useMemo(() => recents.filter((r) => known.has(r.path)), [recents, known]);
  const favoritesShown = favorites.filter((p) => known.has(p));

  // 继续阅读卡片的进度（每张卡一个百分比环）：同步完成后重读，进度可能被更新/移除。
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      recentShown.map(async (r) => [r.path, (await getProgress(r.path))?.ratio ?? 0] as const),
    ).then(
      (pairs) => { if (!cancelled) setRecentRatios(Object.fromEntries(pairs)); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [recentShown, lastSyncAt, syncTick]);

  return (
    <main className="home">
      <header className="home-header">
        <h1 className="home-title">知识库</h1>
        <a className="home-settings" href={SETTINGS} aria-label="设置" title="设置">
          <SettingsIcon />
        </a>
      </header>

      <a className="home-search" href={searchHref('')}>
        <svg className="home-search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M15.4 15.4 21 21" />
        </svg>
        <span>搜索文档</span>
      </a>

      {/* 记忆助手独立入口：带文字与今日待复习数，避免纯图标入口难以发现。 */}
      <a className="home-memory-entry" href={MEMORY} aria-label="记忆助手">
        <span className="home-memory-icon"><MemoryIcon /></span>
        <span className="home-memory-text">
          <span className="home-memory-title">记忆助手</span>
          <span className="home-memory-sub">
            按遗忘曲线复习{dueCount === null ? '' : ` · 今日 ${dueCount} 题待复习`}
          </span>
        </span>
        <span className="home-memory-arrow" aria-hidden="true">›</span>
      </a>

      {/* 首页区块（T19）：继续阅读 → 收藏 → 全部文档树；空态不渲染区块。 */}
      {recentShown.length > 0 && (
        <section className="home-section home-recents" aria-labelledby="home-recents-title">
          <h2 className="home-section-title" id="home-recents-title">继续阅读</h2>
          <ul className="home-cards">
            {recentShown.map((r) => {
              const ratio = recentRatios[r.path] ?? 0;
              return (
                <li key={r.path} className="home-card">
                  <a className="home-card-link" href={docHref(r.path)}>
                    <span className="home-card-name">{known.get(r.path)?.title || r.path}</span>
                    <span className="home-card-meta">
                      <svg className="home-card-ring" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--line)" strokeWidth="3" />
                        {Math.round(ratio * 56.5) > 0 && (
                          <circle cx="12" cy="12" r="9" fill="none" stroke="var(--acc)" strokeWidth="3"
                            strokeDasharray={`${Math.round(ratio * 56.5)} 56.5`} strokeLinecap="round"
                            transform="rotate(-90 12 12)" />
                        )}
                      </svg>
                      <span className="home-card-pct">{Math.round(ratio * 100)}%</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {favoritesShown.length > 0 && (
        <section className="home-section home-favorites" aria-labelledby="home-favorites-title">
          <h2 className="home-section-title" id="home-favorites-title">收藏</h2>
          <ul className="home-section-list">
            {favoritesShown.map((path) => (
              <li key={path}>
                <a className="home-doc-link" href={docHref(path)}>
                  <StarIcon />
                  <span className="home-doc-name">{known.get(path)?.title || path}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dbError ? (
        <div className="home-empty home-db-error" role="alert">
          <p>{dbError}</p>
          <p>请关闭同一站点的其它标签页，或强制退出应用后重开；本页也会自动重试。</p>
          <button type="button" onClick={retryDb}>重试</button>
        </div>
      ) : metas === null ? (
        <p className="home-empty" role="status">加载中…</p>
      ) : metas.length === 0 ? (
        <p className="home-empty">暂无文档，点「更新目录」同步仓库</p>
      ) : (
        <div className="home-tree-card">
          <FileTree metas={metas} />
        </div>
      )}

      <footer className="home-footer">
        <SyncBadge />
      </footer>
    </main>
  );
}
