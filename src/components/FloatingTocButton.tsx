import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'mdreader.toc-fab';
const BTN = 44;

interface Stored { side: 'left' | 'right'; y: number }

function readStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { side: 'right', y: 0 };
    const v = JSON.parse(raw) as Partial<Stored>;
    return { side: v.side === 'left' ? 'left' : 'right', y: Number.isFinite(v.y) ? (v.y as number) : 0 };
  } catch {
    return { side: 'right', y: 0 };
  }
}

/** 垂直位置 clamp：顶栏下方 ~ 底部安全区上方。 */
function clampY(y: number): number {
  const min = 64;
  const max = Math.max(min, window.innerHeight - 132);
  return Math.min(max, Math.max(min, y));
}

interface Props { onOpen: () => void }

/** 悬浮目录按钮（spec §2.3）：点击开目录；可拖拽，松手吸附最近边缘，位置按设备持久化。 */
export default function FloatingTocButton({ onOpen }: Props) {
  // 挂载即钳制：旋转/视口变矮后重开也不会渲染到视口外（resize 事件只在页面存活期间生效）。
  const [pos, setPos] = useState<Stored>(() => {
    const s = readStored();
    return { side: s.side, y: s.y === 0 ? 0 : clampY(s.y) };
  });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const onResize = () => setPos((p) => ({ ...p, y: p.y === 0 ? 0 : clampY(p.y) }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
    suppressClick.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    d.moved = true;
    suppressClick.current = true;
    setDragPos({ x: e.clientX - BTN / 2, y: e.clientY - BTN / 2 });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const moved = d.moved;
    setDragPos(null);
    if (!moved) return;
    const next: Stored = {
      side: e.clientX < window.innerWidth / 2 ? 'left' : 'right',
      y: clampY(e.clientY - BTN / 2),
    };
    setPos(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
  };

  const style: React.CSSProperties = dragPos
    ? { left: dragPos.x, top: dragPos.y }
    : pos.y === 0
      ? ({ [pos.side]: 12, top: '55%' } as React.CSSProperties)
      : ({ [pos.side]: 12, top: pos.y } as React.CSSProperties);

  return (
    <button
      type="button"
      className={dragPos ? 'doc-toc-fab doc-toc-fab-dragging' : 'doc-toc-fab'}
      aria-label="目录"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onOpen();
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h10" />
      </svg>
    </button>
  );
}
