import { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/toast.css';

/**
 * 无依赖 toast（T22）：模块级事件总线 + 在外壳挂载一次的 <ToastHost />。
 * 任何模块（含非组件代码）都可调用 showToast()；容器未挂载时调用仅静默丢弃。
 */

export type ToastKind = 'info' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  kind?: ToastKind;
  durationMs?: number;
  /** 可选操作按钮（如「撤销」）；点击后先关闭本条，再执行回调。 */
  action?: ToastAction;
}

export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  durationMs: number;
  action?: ToastAction;
}

/** 自动消失时长（ms）。 */
const DEFAULT_DURATION_MS = 4000;
/** 同时最多展示的条数（超出先关最早的一条，叠放不淹没页面）。 */
const MAX_VISIBLE = 3;

/** 缓存自愈信号（db.ts 自愈路径派发）：ToastHost 监听后提示「本地缓存已重建」。 */
export const CACHE_REBUILT_EVENT = 'mdreader:cache-rebuilt';

type Listener = (item: ToastItem) => void;
const listeners = new Set<Listener>();
let nextId = 1;

/** 显示一条 toast；返回条目 id（供测试/程序化关闭）。 */
export function showToast(text: string, opts: ToastOptions = {}): number {
  const item: ToastItem = {
    id: nextId++,
    text,
    kind: opts.kind ?? 'info',
    durationMs: opts.durationMs ?? DEFAULT_DURATION_MS,
    ...(opts.action ? { action: opts.action } : {}),
  };
  for (const listener of [...listeners]) listener(item);
  return item.id;
}

/**
 * toast 容器：Shell 挂载一次。role="status" + aria-live="polite" 让读屏器播报；
 * 条目整块是按钮（点按立即关闭），触摸场景无需悬停即可操作。
 */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const listener: Listener = (item) => {
      setItems((list) => [...list, item]);
      timers.current.set(item.id, window.setTimeout(() => dismiss(item.id), item.durationMs));
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, [dismiss]);

  // 超出上限先关最早一条：在 effect 中做，避免在 setState 更新函数里产生副作用。
  useEffect(() => {
    if (items.length > MAX_VISIBLE) dismiss(items[0].id);
  }, [items, dismiss]);

  // 本地缓存自愈（一次性信号）：仅在浏览器环境监听，事件由 db.ts 在重建成功后派发。
  useEffect(() => {
    const onRebuilt = () => { showToast('本地缓存已重建'); };
    window.addEventListener(CACHE_REBUILT_EVENT, onRebuilt);
    return () => window.removeEventListener(CACHE_REBUILT_EVENT, onRebuilt);
  }, []);

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast-wrap toast-${item.kind}${item.action ? ' toast-wrap-action' : ''}`}>
          <button
            type="button"
            className={`toast toast-${item.kind}`}
            title="点击关闭"
            onClick={() => dismiss(item.id)}
          >
            {item.text}
          </button>
          {item.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismiss(item.id);
                item.action!.onAction();
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
