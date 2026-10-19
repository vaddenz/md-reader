import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SETTINGS, goBackOrHome, searchHref, toRouterPath } from '../app/nav';
import { useTabs } from '../state/TabsContext';

interface DocHeaderProps {
  /** 当前文档标题（来自 files.title）；未加载完成时为空串。 */
  title: string;
  /** 打开文件树抽屉；未提供时（本地没有文档）不渲染文件按钮。 */
  onOpenTree?: () => void;
  /** 收藏状态：true 表示已收藏（菜单项文案为「取消收藏」）；未提供 onToggleFavorite 时不渲染收藏项。 */
  favorite?: boolean;
  /** 切换收藏；未提供时（收藏状态尚未读取）不渲染收藏项。 */
  onToggleFavorite?: () => void;
  /** 打开阅读内外观面板；未提供时不渲染外观按钮。 */
  onOpenAppearance?: () => void;
  /** 当前显示方向；未提供 onToggleOrientation 时不渲染方向按钮。 */
  orientation?: 'portrait' | 'landscape' | 'landscape-flipped';
  /** 横屏/竖屏切换；未提供时不渲染横屏按钮。 */
  onToggleOrientation?: () => void;
  /** 翻转 180°（横屏 ↔ 横屏翻转）；未提供时（非横屏）不渲染旋转按钮。 */
  onFlipOrientation?: () => void;
  /** 导航离开阅读页前记住滚动位置（搜索/设置直达用，与互链/抽屉跳转同口径）。 */
  remember?: () => void;
}

/**
 * 阅读页吸顶栏（spec §3.2）：返回 · 标题 · ⋯。
 * 底栏已移除，原底栏入口（搜索/收藏/外观/设置）与文件/横屏/旋转一并收进 ⋯ 弹层（spec §2.2）。
 */
export default function DocHeader({
  title,
  onOpenTree,
  favorite,
  onToggleFavorite,
  onOpenAppearance,
  orientation,
  onToggleOrientation,
  onFlipOrientation,
  remember,
}: DocHeaderProps) {
  const navigate = useNavigate();
  const { tabs, activateTab, close } = useTabs();
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLElement>(null);
  const [tabsOpen, setTabsOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  // 沉浸（spec §2.1）：正文下滑隐藏顶栏、上滑/回到顶部显示；⋯ 弹层打开期间不隐藏。
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;
        lastY = y;
        if (y <= 80 || delta < -4) setHidden(false);
        // 程序式落位（进度恢复/锚点/搜索跳转）是大跨度单帧跳变：只重设基准，不改变隐藏态。
        else if (delta > 4 && delta <= window.innerHeight && y > 120) setHidden(true);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

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

  // 切换器弹层：外部 pointerdown / Escape 关闭；标题按钮自身点击由 closest 排除。
  useEffect(() => {
    if (!tabsOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (tabsRef.current?.contains(target as Node)) return;
      if (target?.closest?.('.doc-title-btn')) return;
      setTabsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabsOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [tabsOpen]);

  const act = (fn?: () => void) => {
    setMore(false);
    fn?.();
  };

  /** 就地切换类菜单项（横屏/旋转/收藏）：不关闭弹层，便于连续操作（spec §1.3 / §2.4）。 */
  const actStay = (fn?: () => void) => {
    fn?.();
  };

  return (
    <header
      className={hidden && !more && !tabsOpen ? 'doc-header doc-header--hidden' : 'doc-header'}
      ref={moreRef}
    >
      <button
        type="button"
        className="doc-back"
        aria-label="返回"
        onClick={() => goBackOrHome(navigate)}
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
      <button
        type="button"
        className="doc-title doc-title-btn"
        aria-label="切换标签"
        aria-expanded={tabsOpen}
        onClick={() => {
          setMore(false); // 与 ⋯ 互斥
          setTabsOpen((v) => !v);
        }}
      >
        <span className="doc-title-text" title={title || undefined}>{title}</span>
        {tabs.list.length >= 2 && (
          <svg className="doc-title-caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>
      {tabsOpen && (
        <div className="doc-tabs" role="group" aria-label="打开的标签" ref={tabsRef}>
          {tabs.list.map((t) => (
            <div key={t.id} className={t.id === tabs.activeId ? 'doc-tab-row doc-tab-current' : 'doc-tab-row'}>
              <button
                type="button"
                className="doc-tab-open"
                aria-current={t.id === tabs.activeId ? 'true' : undefined}
                onClick={() => {
                  setTabsOpen(false);
                  activateTab(t.id);
                }}
              >
                <span className="doc-tab-title">{t.title || t.docPath}</span>
              </button>
              <button
                type="button"
                className="doc-tab-close"
                aria-label={`关闭标签：${t.title || t.docPath}`}
                onClick={() => close(t.id)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="doc-header-actions">
        <button
          type="button"
          className="doc-header-btn"
          aria-label="更多"
          aria-expanded={more}
          onClick={() => {
            setTabsOpen(false); // 与切换器互斥
            setMore((v) => !v);
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="5" cy="12" r="1.9" fill="currentColor" />
            <circle cx="12" cy="12" r="1.9" fill="currentColor" />
            <circle cx="19" cy="12" r="1.9" fill="currentColor" />
          </svg>
        </button>
        {more && (
          <div className="doc-more" role="group" aria-label="更多操作">
            <button type="button" className="doc-more-item" onClick={() => act(() => { remember?.(); navigate(toRouterPath(searchHref(''))); })}>
              <svg className="doc-more-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M16.5 16.5 21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              搜索
            </button>
            {onToggleFavorite && (
              <button
                type="button"
                className="doc-more-item"
                aria-pressed={favorite === true}
                onClick={() => actStay(onToggleFavorite)}
              >
                <svg className="doc-more-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill={favorite ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    d="M12 3.6l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9z"
                  />
                </svg>
                {favorite ? '取消收藏' : '收藏'}
              </button>
            )}
            {onOpenAppearance && (
              <button type="button" className="doc-more-item" onClick={() => act(onOpenAppearance)}>
                <span className="doc-more-aa" aria-hidden="true">Aa</span>
                外观
              </button>
            )}
            {onOpenTree && (
              <button type="button" className="doc-more-item" onClick={() => act(onOpenTree)}>
                <svg className="doc-more-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M7 3h7l4 4v14H7z" />
                  <path fill="none" stroke="currentColor" strokeWidth="2" d="M14 3v4h4" />
                </svg>
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
                <svg className="doc-more-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <rect x="3.5" y="7.5" width="17" height="9" rx="2.2" fill="none" stroke="currentColor" strokeWidth="2" />
                  <circle cx="17.2" cy="12" r="1.1" fill="currentColor" />
                </svg>
                横屏
              </button>
            )}
            {orientation && orientation !== 'portrait' && onFlipOrientation && (
              <button type="button" className="doc-more-item" onClick={() => actStay(onFlipOrientation)}>
                <svg className="doc-more-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M20 12 A8 8 0 1 1 12 4" />
                  <path fill="currentColor" d="M12 1.8 15.6 4 12 6.2Z" />
                </svg>
                旋转
              </button>
            )}
            <button type="button" className="doc-more-item" onClick={() => act(() => { remember?.(); navigate(toRouterPath(SETTINGS)); })}>
              <svg className="doc-more-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
              </svg>
              设置
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
