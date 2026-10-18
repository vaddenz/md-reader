import { useNavigate } from 'react-router-dom';
import { HOME, toRouterPath } from '../app/nav';

interface DocHeaderProps {
  /** 当前文档标题（来自 files.title）；未加载完成时为空串。 */
  title: string;
  /** 打开目录抽屉；未提供时（文档没有 h1–h4 标题）不渲染目录按钮。 */
  onOpenToc?: () => void;
  /** 打开文件树抽屉；未提供时（本地没有文档）不渲染文件按钮。 */
  onOpenTree?: () => void;
  /** 收藏状态：true 实心星；未提供 onToggleFavorite 时不渲染收藏按钮。 */
  favorite?: boolean;
  /** 切换收藏；未提供时（收藏状态尚未读取）不渲染收藏按钮。 */
  onToggleFavorite?: () => void;
}

/** 阅读页吸顶栏：返回首页 + 文档标题 + 操作区（文件树 / 目录 / 收藏）。 */
export default function DocHeader({ title, onOpenToc, onOpenTree, favorite = false, onToggleFavorite }: DocHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="doc-header">
      <button
        type="button"
        className="doc-back"
        aria-label="返回首页"
        onClick={() => navigate(toRouterPath(HOME))}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 5l-7 7 7 7"
          />
        </svg>
      </button>
      <span className="doc-title" title={title || undefined}>{title}</span>
      <div className="doc-header-actions">
        {onOpenTree && (
          <button
            type="button"
            className="doc-header-btn"
            aria-label="文件"
            title="文件"
            onClick={onOpenTree}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.5 6.5a2 2 0 0 1 2-2h3.6l2 2.5h7.4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"
              />
            </svg>
          </button>
        )}
        {onOpenToc && (
          <button
            type="button"
            className="doc-header-btn"
            aria-label="目录"
            title="目录"
            onClick={onOpenToc}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </button>
        )}
        {onToggleFavorite && (
          <button
            type="button"
            className="doc-header-btn doc-fav"
            aria-label={favorite ? '取消收藏' : '收藏'}
            aria-pressed={favorite}
            title={favorite ? '取消收藏' : '收藏'}
            onClick={onToggleFavorite}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill={favorite ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                d="M12 3.6l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9z"
              />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
