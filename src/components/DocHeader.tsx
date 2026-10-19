import { useEffect, useRef, useState } from 'react';
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

/**
 * 阅读页吸顶栏（spec §3.2）：返回 · 标题 · ⋯。
 * onOpenToc / onToggleFavorite 已迁往底部工具条（BottomBar），但 props 签名保留（调用方可继续传入）。
 */
export default function DocHeader({
  title,
  onOpenTree,
  orientation,
  onToggleOrientation,
  onFlipOrientation,
}: DocHeaderProps) {
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLElement>(null);

  // ⋯ 弹层：外部 pointerdown（捕获）或 Escape 关闭；关闭类菜单项由 act() 先关再执行，就地切换类用 actStay()。
  useEffect(() => {
    if (!more) return;
    const onDown = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMore(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMore(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [more]);

  const act = (fn?: () => void) => {
    setMore(false);
    fn?.();
  };

  /** 就地切换类菜单项（横屏/旋转/收藏）：不关闭弹层，便于连续操作（spec §1.3 / §2.4）。 */
  const actStay = (fn?: () => void) => {
    fn?.();
  };

  return (
    <header className="doc-header" ref={moreRef}>
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
        <button
          type="button"
          className="doc-header-btn"
          aria-label="更多"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="5" cy="12" r="1.9" fill="currentColor" />
            <circle cx="12" cy="12" r="1.9" fill="currentColor" />
            <circle cx="19" cy="12" r="1.9" fill="currentColor" />
          </svg>
        </button>
        {more && (
          <div className="doc-more" role="group" aria-label="更多操作">
            {onOpenTree && (
              <button type="button" className="doc-more-item" onClick={() => act(onOpenTree)}>
                文件
              </button>
            )}
            {onToggleOrientation && (
              <button
                type="button"
                className="doc-more-item"
                aria-pressed={orientation !== 'portrait'}
                onClick={() => actStay(onToggleOrientation)}
              >
                横屏
              </button>
            )}
            {orientation && orientation !== 'portrait' && onFlipOrientation && (
              <button type="button" className="doc-more-item" onClick={() => actStay(onFlipOrientation)}>
                旋转
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
