import { useEffect, useState } from 'react';
import { searchHref } from '../app/nav';
import FileTree from '../components/FileTree';
import SyncBadge from '../components/SyncBadge';
import { listFilesMeta, type FileMeta } from '../data/db';
import { useSync } from '../state/SyncContext';
import '../styles/home.css';

export default function HomePage() {
  const { lastSyncAt } = useSync();
  const [metas, setMetas] = useState<FileMeta[] | null>(null);

  // 进入首页读取一次；同步完成（lastSyncAt 变化）后重读，让「更新目录」新增/过期的文档即时反映到树上。
  useEffect(() => {
    let cancelled = false;
    void listFilesMeta().then(
      (list) => { if (!cancelled) setMetas(list); },
      () => { if (!cancelled) setMetas([]); },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

  return (
    <main className="home">
      <SyncBadge />

      <a className="home-search" href={searchHref('')}>
        <svg className="home-search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M15.4 15.4 21 21" />
        </svg>
        <span>搜索文档</span>
      </a>

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
