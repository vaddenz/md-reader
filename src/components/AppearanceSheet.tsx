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

/** 阅读内外观面板（spec §2.5）：半屏底部 sheet；调整实时生效、防抖落盘、卸载冲刷。 */
export default function AppearanceSheet({ value, onChange, onClose }: Props) {
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
        className="appearance-sheet"
        role="dialog"
        aria-label="阅读外观"
        onClick={(e) => e.stopPropagation()}
      >
        <AppearanceControls value={value} onChange={update} />
      </div>
    </div>
  );
}
