import type { MouseEvent } from 'react';
import { docHref } from '../app/nav';
import type { FileMeta } from '../data/db';
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
 * 阅读页文件树抽屉：复用 FileTree（高亮当前文档）。
 * 条目是普通 <a>（原生 hash 导航），抽屉内拦截后交给调用方，
 * 以便先记录滚动位置再经 react-router 导航（与正文互链拦截同口径）。
 */
export default function TreeDrawer({ metas, currentPath, onSelect, onClose }: TreeDrawerProps) {
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
      <div onClick={onClick}>
        <FileTree metas={metas} currentPath={currentPath} />
      </div>
    </Drawer>
  );
}
