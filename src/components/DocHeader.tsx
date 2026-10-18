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
  /** 当前显示方向；未提供 onToggleOrientation 时不渲染方向按钮。 */
  orientation?: 'portrait' | 'landscape' | 'landscape-flipped';
  /** 横屏/竖屏切换；未提供时不渲染横屏按钮。 */
  onToggleOrientation?: () => void;
  /** 翻转 180°（横屏 ↔ 横屏翻转）；未提供时（非横屏）不渲染旋转按钮。 */
  onFlipOrientation?: () => void;
}

/** 阅读页吸顶栏：返回首页 + 文档标题 + 操作区（文件树 / 目录 / 收藏 / 方向）。 */
export default function DocHeader({
  title,
  onOpenToc,
  onOpenTree,
  favorite = false,
  onToggleFavorite,
  orientation,
  onToggleOrientation,
  onFlipOrientation,
}: DocHeaderProps) {
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
        {onToggleOrientation && (
          <button
            type="button"
            className="doc-header-btn"
            aria-label="横屏"
            title="横屏/竖屏"
            aria-pressed={orientation !== 'portrait'}
            onClick={onToggleOrientation}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"
              />
            </svg>
          </button>
        )}
        {orientation && orientation !== 'portrait' && onFlipOrientation && (
          <button
            type="button"
            className="doc-header-btn"
            aria-label="旋转"
            title="翻转 180°"
            onClick={onFlipOrientation}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 12a8 8 0 1 1 2.3 5.6M4 12V7m0 5h5"
              />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
