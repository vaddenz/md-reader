import { useEffect, useRef } from 'react';
import { saveAppearance, type ReaderAppearance } from '../data/appearance';
import { showToast } from '../lib/toast';
import AppearanceControls from './AppearanceControls';
import '../styles/appearance-sheet.css';

interface Props {
  value: ReaderAppearance;
  onChange: (next: ReaderAppearance) => void;
  onClose: () => void;
}

/** 阅读内外观面板（spec §2.5）：半屏底部 sheet；调整实时生效、防抖落盘、卸载冲刷。
    模态能力（滚动锁 / 打开聚焦 / 关闭归还焦点）对齐 Drawer 外壳惯例。 */
export default function AppearanceSheet({ value, onChange, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const pending = useRef<ReaderAppearance | null>(null);

  const flush = () => {
    const v = pending.current;
    if (!v) return;
    pending.current = null;
    void saveAppearance(v).catch(() => showToast('外观设置保存失败', { kind: 'error' }));
  };
  useEffect(() => () => { window.clearTimeout(timer.current); flush(); }, []);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (next: ReaderAppearance) => {
    onChange(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  };

  return (
    <div className="appearance-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="appearance-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="阅读外观"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <AppearanceControls value={value} onChange={update} />
      </div>
    </div>
  );
}
