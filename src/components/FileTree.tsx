import { useMemo, useState } from 'react';
import { docHref } from '../app/nav';
import type { FileMeta } from '../data/db';
import { buildTree, type TreeItem } from '../lib/tree';
import '../styles/home.css';

interface FileTreeProps {
  /** 全部文档元数据（listFilesMeta()）：用于分组、排序与「未缓存」标记。 */
  metas: FileMeta[];
  /** 当前打开的文档路径（阅读页抽屉传入；首页不传）→ 高亮该项。 */
  currentPath?: string;
}

/** 全局文件树：根文档 / 子目录分组，目录可折叠（默认展开），未缓存文档带「未缓存」标记。 */
export default function FileTree({ metas, currentPath }: FileTreeProps) {
  const tree = useMemo(() => buildTree(metas.map((m) => m.path)), [metas]);
  const uncached = useMemo(
    () => new Set(metas.filter((m) => !m.cached).map((m) => m.path)),
    [metas],
  );
  // 记录「被折叠」的目录：新增目录默认展开，已折叠的目录在同步后保持折叠。
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const renderItem = (item: TreeItem) => {
    const current = item.path === currentPath;
    return (
      <li key={item.path}>
        <a
          className={current ? 'tree-item tree-current' : 'tree-item'}
          href={docHref(item.path)}
          aria-current={current ? 'page' : undefined}
        >
          <svg className="tree-file-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M7 3h7l4 4v14H7z" />
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M14 3v4h4" />
          </svg>
          <span className="tree-name">{item.name}</span>
          {uncached.has(item.path) && <span className="tree-badge">未缓存</span>}
        </a>
      </li>
    );
  };

  return (
    <nav className="file-tree" aria-label="全部文档">
      <ul className="tree-list">
        {tree.dirs.length > 0 && <li className="tree-group-label" aria-hidden="true">文件夹</li>}
        {tree.dirs.map((dir) => {
          const open = !collapsed.has(dir.name);
          return (
            <li key={`dir:${dir.name}`} className="tree-dir">
              <button
                type="button"
                className="tree-dir-toggle"
                aria-expanded={open}
                onClick={() => toggle(dir.name)}
              >
                <svg
                  className={open ? 'tree-chevron tree-chevron-open' : 'tree-chevron'}
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                </svg>
                <svg className="tree-folder-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M3 6h6l2 2h10v12H3z" />
                </svg>
                <span className="tree-dir-name">{dir.name}</span>
              </button>
              {open && <ul className="tree-list tree-children">{dir.items.map(renderItem)}</ul>}
            </li>
          );
        })}
        {tree.root.length > 0 && <li className="tree-group-label" aria-hidden="true">文件</li>}
        {tree.root.map(renderItem)}
      </ul>
    </nav>
  );
}
