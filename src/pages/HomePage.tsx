import { useEffect, useMemo, useState } from 'react';
import { SETTINGS, docHref, searchHref } from '../app/nav';
import FileTree from '../components/FileTree';
import SyncBadge from '../components/SyncBadge';
import { listFilesMeta, type FileMeta } from '../data/db';
import { getFavorites, recentDocs, type RecentDoc } from '../data/prefs';
import { useSync } from '../state/SyncContext';
import '../styles/home.css';

/** 收藏星标（小号）：与阅读页顶栏星标同款。 */
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

export default function HomePage() {
  const { lastSyncAt } = useSync();
  const [metas, setMetas] = useState<FileMeta[] | null>(null);
  const [recents, setRecents] = useState<RecentDoc[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  // 进入首页读取一次；同步完成（lastSyncAt 变化）后重读，让「更新目录」新增/过期的文档即时反映到树上。
  useEffect(() => {
    let cancelled = false;
    void listFilesMeta().then(
      (list) => { if (!cancelled) setMetas(list); },
      () => { if (!cancelled) setMetas([]); },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

  // 继续阅读 / 收藏：同样在进入首页与同步完成后重读（同步可能移除文档，区块随之收敛）。
  useEffect(() => {
    let cancelled = false;
    void Promise.all([recentDocs(3), getFavorites()]).then(
      ([recent, favs]) => { if (!cancelled) { setRecents(recent); setFavorites(favs); } },
      () => {},
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

  // 只展示目录树里仍存在的文档（收藏/进度可能指向已从仓库移除的路径）。
  const known = useMemo(() => new Map((metas ?? []).map((m) => [m.path, m])), [metas]);
  const recentShown = recents.filter((r) => known.has(r.path));
  const favoritesShown = favorites.filter((p) => known.has(p));

  const docLink = (path: string) => (
    <a className="home-doc-link" href={docHref(path)}>
      <span className="home-doc-name">{known.get(path)?.title || path}</span>
    </a>
  );

  return (
    <main className="home">
      <SyncBadge />

      <div className="home-top">
        <a className="home-search" href={searchHref('')}>
          <svg className="home-search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M15.4 15.4 21 21" />
          </svg>
          <span>搜索文档</span>
        </a>
        <a className="home-settings" href={SETTINGS} aria-label="设置" title="设置">
          <SettingsIcon />
        </a>
      </div>

      {/* 首页区块（T19）：继续阅读 → 收藏 → 全部文档树；空态不渲染区块。 */}
      {recentShown.length > 0 && (
        <section className="home-section home-recents" aria-labelledby="home-recents-title">
          <h2 className="home-section-title" id="home-recents-title">继续阅读</h2>
          <ul className="home-section-list">
            {recentShown.map((r) => <li key={r.path}>{docLink(r.path)}</li>)}
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

      {metas === null ? (
        <p className="home-empty" role="status">加载中…</p>
      ) : metas.length === 0 ? (
        <p className="home-empty">暂无文档，点上方「更新目录」同步仓库</p>
      ) : (
        <FileTree metas={metas} />
      )}
    </main>
  );
}
