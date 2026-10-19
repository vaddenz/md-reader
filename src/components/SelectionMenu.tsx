import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rangesEqual, type MenuAction } from '../lib/selection-menu';

interface Props {
  x: number; y: number;
  /** 打开菜单时的选区矩形：优先在选区下方（放不下翻到上方）定位；null（无选区）回退触点定位。 */
  rect?: DOMRect | null;
  /** 打开菜单时的选区快照：选区缺失/塌缩/变化（含拖动选择手柄）时自动关闭。 */
  selectionSnapshot: Range | null;
  actions: MenuAction[];
  onAction: (id: string) => void;
  onClose: () => void;
}

/** 菜单与选区之间的垂直间距（验收微调：8 → 16px）。 */
const SELECTION_GAP = 16;

/** 阅读正文自定义右键/长按菜单（spec §6.3）：避开选区定位、越界收边、外部/滚动/Esc/选区变化关闭。 */
export default function SelectionMenu({ x, y, rect = null, selectionSnapshot, actions, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let left: number;
    let top: number;
    if (rect) {
      left = rect.left;
      top = rect.bottom + SELECTION_GAP; // 优先选区下方
      if (top + r.height > window.innerHeight - margin) top = rect.top - r.height - SELECTION_GAP; // 下方放不下：翻到上方
    } else {
      left = x; // 无选区：触点定位
      top = y;
    }
    // 越界收边（也覆盖选区在视口外/过高导致翻转仍放不下的兜底；竖直方向仍保持不与选区重叠）
    setPos({
      left: Math.max(margin, Math.min(left, window.innerWidth - r.width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - r.height - margin)),
    });
  }, [x, y, rect]);

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

  // 选区变化（拖动选择手柄属于浏览器 UI，不会派发 pointerdown）→ 自动关闭；
  // 与打开时的快照不一致（或选区缺失/塌缩）即关，无选区的菜单（快照 null）在任一 selectionchange 时关闭。
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = document.getSelection();
      const cur = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!cur || cur.collapsed || !rangesEqual(cur, selectionSnapshot)) onClose();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [onClose, selectionSnapshot]);

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
