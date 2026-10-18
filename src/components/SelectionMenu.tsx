import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuAction } from '../lib/selection-menu';

interface Props {
  x: number; y: number;
  actions: MenuAction[];
  onAction: (id: string) => void;
  onClose: () => void;
}

/** 阅读正文自定义右键/长按菜单（spec §6.3）：触点定位、越界收边、外部/滚动/Esc 关闭。 */
export default function SelectionMenu({ x, y, actions, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="selection-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      {actions.map((a) => (
        <button key={a.id} type="button" role="menuitem" className="selection-menu-item" onClick={() => onAction(a.id)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
