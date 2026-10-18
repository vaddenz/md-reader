import { useNavigate } from 'react-router-dom';
import { HOME, toRouterPath } from '../app/nav';

interface DocHeaderProps {
  /** 当前文档标题（来自 files.title）；未加载完成时为空串。 */
  title: string;
}

/** 阅读页吸顶栏：返回首页 + 文档标题；右侧操作区留待后续任务填充。 */
export default function DocHeader({ title }: DocHeaderProps) {
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
      {/* T14/T16/T19：文件树 / 返回来源 / 收藏 / TOC 按钮将放入此操作区 */}
      <div className="doc-header-actions" />
    </header>
  );
}
