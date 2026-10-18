import { useNavigate } from 'react-router-dom';
import { HOME, toRouterPath } from '../app/nav';

interface DocHeaderProps {
  /** 当前文档标题（来自 files.title）；未加载完成时为空串。 */
  title: string;
  /** 打开目录抽屉；未提供时（文档没有 h1–h4 标题）不渲染目录按钮。 */
  onOpenToc?: () => void;
}

/** 阅读页吸顶栏：返回首页 + 文档标题 + 操作区（目录；文件树 / 返回来源 / 收藏留待后续任务）。 */
export default function DocHeader({ title, onOpenToc }: DocHeaderProps) {
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
      {/* T16/T19：文件树 / 返回来源 / 收藏按钮将放入此操作区 */}
      <div className="doc-header-actions">
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
      </div>
    </header>
  );
}
