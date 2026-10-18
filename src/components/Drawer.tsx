import { useEffect, useRef, type ReactNode } from 'react';
import '../styles/drawer.css';

interface DrawerProps {
  /** 抽屉标题（同时作为对话框的无障碍名称，如「目录」「全部文档」）。 */
  title: string;
  /** 关闭抽屉（遮罩点击 / 关闭按钮 / Esc / 内部跳转后调用）。 */
  onClose: () => void;
  children: ReactNode;
}

/**
 * 底部弹出的通用抽屉外壳（T16 起 TOC 与文件树共用）：
 * 遮罩/关闭按钮/Esc 关闭；打开期间锁定背景滚动、聚焦面板，关闭时把焦点还给触发元素。
 */
export default function Drawer({ title, onClose, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus({ preventScroll: true });
    };
  }, []);

  // 桌面端 Esc 关闭。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <span className="drawer-head-title">{title}</span>
          <button type="button" className="drawer-close" aria-label={`关闭${title}`} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
