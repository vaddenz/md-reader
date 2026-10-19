import { useNavigate } from 'react-router-dom';
import { SETTINGS, searchHref, toRouterPath } from '../app/nav';

interface Props {
  onOpenToc?: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** 离开阅读页前记住滚动（与互链/抽屉跳转同口径）。 */
  remember: () => void;
}

/** 阅读页底部工具条（spec §3.2）：目录 / 搜索 / 外观 / 收藏 / 设置。 */
export default function BottomBar({ onOpenToc, favorite = false, onToggleFavorite, remember }: Props) {
  const navigate = useNavigate();
  const go = (to: string) => {
    remember();
    navigate(toRouterPath(to));
  };
  return (
    <nav className="doc-bottombar" aria-label="阅读工具">
      {onOpenToc && (
        <button
          type="button"
          className="doc-bottombar-item"
          aria-label="目录"
          onClick={onOpenToc}
        >
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h10" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="doc-bottombar-item"
        aria-label="搜索"
        onClick={() => go(searchHref(''))}
      >
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16.5 16.5 21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="doc-bottombar-item doc-bottombar-aa"
        aria-label="外观"
        onClick={() => go(SETTINGS)}
      >
        <span aria-hidden="true">Aa</span>
      </button>
      {onToggleFavorite && (
        <button
          type="button"
          className="doc-bottombar-item"
          aria-label={favorite ? '取消收藏' : '收藏'}
          aria-pressed={favorite}
          onClick={onToggleFavorite}
        >
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
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
      <button
        type="button"
        className="doc-bottombar-item"
        aria-label="设置"
        onClick={() => go(SETTINGS)}
      >
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"
          />
        </svg>
      </button>
    </nav>
  );
}
