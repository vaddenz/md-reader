import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useScrollSpy } from '../hooks/useScrollSpy';
import type { Heading } from '../markdown/render';
import Drawer from './Drawer';
import '../styles/toc.css';

interface TocDrawerProps {
  /** 文档标题列表（调用方已过滤为 h1–h4，来自 renderDoc）。 */
  headings: Heading[];
  /** 关闭抽屉（点击背景 / 关闭按钮 / Esc / 跳转后调用）。 */
  onClose: () => void;
}

/** 底部弹出的文档目录抽屉：按层级缩进、当前阅读位置高亮、点击平滑跳转。 */
export default function TocDrawer({ headings, onClose }: TocDrawerProps) {
  const ids = useMemo(() => headings.map((h) => h.id), [headings]);
  const current = useScrollSpy(ids);
  const scrolledRef = useRef(false);

  // 打开时把激活项滚到抽屉可视区（居中；仅首次，不播放平滑动画）——spec §1.2
  useEffect(() => {
    if (scrolledRef.current || !current) return;
    scrolledRef.current = true;
    document.querySelector<HTMLElement>('.toc-item.toc-current')?.scrollIntoView({ block: 'center' });
  }, [current]);

  const jump = useCallback(
    (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      onClose();
    },
    [onClose],
  );

  return (
    <Drawer title="目录" onClose={onClose}>
      {headings.length === 0 ? (
        <p className="toc-empty">本文暂无标题目录</p>
      ) : (
        headings.map((h) => (
          <button
            key={h.id}
            type="button"
            className={`toc-item toc-h${h.level}${h.id === current ? ' toc-current' : ''}`}
            onClick={() => jump(h.id)}
          >
            {h.text}
          </button>
        ))
      )}
    </Drawer>
  );
}
