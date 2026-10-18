import { useEffect, useState } from 'react';

/** 顶栏高度兜底值（px），与 base.css 的 --header-h 保持一致。 */
const FALLBACK_HEADER_H = 48;
/** 判定线相对顶栏底部的下移量（px），与标题 scroll-margin-top 对齐。 */
const OFFSET_GAP = 24;

/** 默认判定线：顶栏底部 + 24px；优先读 CSS 变量 --header-h，读不到用兜底值。 */
function defaultOffset(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return n + OFFSET_GAP;
  } catch {
    // 无 document 的环境（理论上不会走到，钩子只在浏览器使用）→ 兜底
  }
  return FALLBACK_HEADER_H + OFFSET_GAP;
}

/**
 * 滚动位置侦测：返回「判定线（offset）上方最后一个标题」的 id；没有则为 null。
 *
 * 纯几何计算（getBoundingClientRect），不依赖 IntersectionObserver；
 * scroll/resize 监听用 requestAnimationFrame 节流，每帧最多计算一次。
 * ids 中不存在的元素直接跳过；ids 变化或组件卸载时清理监听并取消未执行的帧。
 */
export function useScrollSpy(ids: string[], offset?: number): string | null {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      setCurrent(null);
      return;
    }
    const limit = offset ?? defaultOffset();
    let frame = 0;
    let scheduled = false;

    const compute = () => {
      let found: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= limit) found = id;
      }
      setCurrent(found);
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      frame = window.requestAnimationFrame(() => {
        scheduled = false;
        compute();
      });
    };

    schedule(); // 挂载后立即算一次（首屏滚动位置可能不在顶部）
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (scheduled) window.cancelAnimationFrame(frame);
    };
  }, [ids, offset]);

  return current;
}
