import { useEffect, type RefObject } from 'react';
import { saveProgress } from '../data/prefs';

/** 写入节流窗口：滚动期间每 ≥1s 落一次盘，停滚后尾部补写一次（≥1s 口径见规格 §8）。 */
const THROTTLE_MS = 1000;
/** 标题判定线：顶栏 48px + 24px，与 useScrollSpy 默认口径一致。 */
const HEADING_LINE = 72;

/** 滚动比例：scrollY / max(1, scrollHeight - innerHeight)，钳制到 [0,1]。 */
function scrollRatio(): number {
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(1, Math.max(0, window.scrollY / max));
}

/** 判定线以上最后一个标题的 id（辅助字段）；容器内没有可用标题时 undefined。 */
function nearestHeadingId(container: HTMLElement | null): string | undefined {
  if (!container) return undefined;
  let found: string | undefined;
  for (const el of container.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]')) {
    if (el.getBoundingClientRect().top <= HEADING_LINE) found = el.id;
  }
  return found;
}

export interface UseReadingProgressOptions {
  /** 正文是否已就绪：未就绪不记录（加载间隙页面变矮，scrollY 被钳制会覆盖真实进度）。 */
  enabled?: boolean;
  /** 正文容器：用于附带「最近可见标题 id」辅助字段。 */
  container?: RefObject<HTMLElement>;
}

/**
 * 阅读进度记录（T19）：把滚动比例节流写入 kv.progress；visibilitychange 隐藏时补写，
 * 卸载/换文档时用滚动事件里捕获的比例补写（不读此刻的 scrollY，避免被钳制值污染）。
 *
 * 恢复不在这里做：由 DocPage 的历史滚动恢复槽位统一裁决
 * （scroll 记忆 > ?to= 锚点 > ?q= 命中 > 进度比例 > 页首）。
 */
export function useReadingProgress(path: string, opts: UseReadingProgressOptions = {}): void {
  const { enabled = true, container } = opts;

  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    let lastWrite = 0;
    let latest: number | null = null; // 最近一次滚动事件时的比例（卸载补写用）

    const write = (ratio: number) => {
      lastWrite = Date.now();
      void saveProgress(path, ratio, nearestHeadingId(container?.current ?? null)).catch(() => {});
    };

    const flush = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      write(latest ?? scrollRatio());
    };

    const onScroll = () => {
      latest = scrollRatio();
      const wait = THROTTLE_MS - (Date.now() - lastWrite);
      if (wait <= 0) {
        flush(); // 前缘：首次滚动立即落盘
        return;
      }
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        write(latest ?? scrollRatio()); // 尾缘：停滚后补一次最终位置
      }, wait);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) window.clearTimeout(timer);
      if (latest !== null) {
        void saveProgress(path, latest, nearestHeadingId(container?.current ?? null)).catch(() => {});
      }
    };
  }, [path, enabled, container]);
}
