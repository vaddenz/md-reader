import type { MouseEvent } from 'react';
import { docHref } from '../app/nav';
import type { FileMeta } from '../data/db';
import { useSync } from '../state/SyncContext';
import '../styles/sync-badge.css';
import Drawer from './Drawer';
import FileTree from './FileTree';

interface TreeDrawerProps {
  /** 全部文档元数据（listFilesMeta()）。 */
  metas: FileMeta[];
  /** 当前打开的文档路径 → 高亮该项。 */
  currentPath: string;
  /** 选中其他文档：href 为应用内链接（'#/doc/…'），由调用方记录滚动位置并导航。 */
  onSelect(href: string): void;
  onClose(): void;
}

/**
 * 阅读页文件树抽屉：复用 FileTree（高亮当前文档），并提供「更新目录」手动刷新（spec §3）。
 * 条目是普通 <a>（原生 hash 导航），抽屉内拦截后交给调用方，
 * 以便先记录滚动位置再经 react-router 导航（与正文互链拦截同口径）。
 */
export default function TreeDrawer({ metas, currentPath, onSelect, onClose }: TreeDrawerProps) {
  const { status, syncNow } = useSync();
  const syncing = status === 'syncing';

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>('a.tree-item');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('#/')) return;
    e.preventDefault();
    if (href === docHref(currentPath)) {
      onClose(); // 当前文档：只收起抽屉
      return;
    }
    onSelect(href);
  };

  return (
    <Drawer title="全部文档" onClose={onClose}>
      {/* 手动刷新入口（与 SyncBadge 同口径：同步中禁用并旋转图标）。 */}
      <div className="tree-drawer-tools">
        <button type="button" className="sync-refresh" onClick={() => void syncNow()} disabled={syncing}>
          <svg
            className={syncing ? 'sync-icon sync-spin' : 'sync-icon'}
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" d="M20 12 A8 8 0 1 1 12 4" />
            <path fill="currentColor" d="M12 1.8 15.6 4 12 6.2Z" />
          </svg>
          更新目录
        </button>
      </div>
      <div onClick={onClick}>
        <FileTree metas={metas} currentPath={currentPath} />
      </div>
    </Drawer>
  );
}
