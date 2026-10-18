import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useScrollSpy } from '../hooks/useScrollSpy';
import type { Heading } from '../markdown/render';
import '../styles/toc.css';

interface TocDrawerProps {
  /** 文档标题列表（调用方已过滤为 h1–h4，来自 renderDoc）。 */
  headings: Heading[];
  /** 关闭抽屉（点击背景 / 关闭按钮 / Esc / 跳转后调用）。 */
  onClose: () => void;
}

/** 底部弹出的文档目录抽屉：按层级缩进、当前阅读位置高亮、点击平滑跳转。 */
export default function TocDrawer({ headings, onClose }: TocDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => headings.map((h) => h.id), [headings]);
  const current = useScrollSpy(ids);

  // 打开期间锁定背景滚动；聚焦抽屉，关闭时把焦点还给触发按钮。
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus({ preventScroll: true });
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

  const jump = useCallback(
    (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      onClose();
    },
    [onClose],
  );

  return (
    <div className="toc-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="toc-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="文档目录"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="toc-head">
          <span className="toc-head-title">目录</span>
          <button type="button" className="toc-close" aria-label="关闭目录" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="toc-list">
          {headings.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`toc-item toc-h${h.level}${h.id === current ? ' toc-current' : ''}`}
              onClick={() => jump(h.id)}
            >
              {h.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
