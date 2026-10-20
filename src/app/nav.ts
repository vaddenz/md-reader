import type { NavigateFunction } from 'react-router-dom';

export const HOME = '#/';
export const SETUP = '#/setup';
export const SETTINGS = '#/settings';
/** 设置二级页（设置首页只做分组导航，细节收进各页）。 */
export const SETTINGS_ACCOUNT = '#/settings/account';
export const SETTINGS_READING = '#/settings/reading';
export const SETTINGS_DATA = '#/settings/data';
export const SETTINGS_MEMORY = '#/settings/memory';
export const SETTINGS_ABOUT = '#/settings/about';
export const MEMORY = '#/memory';
export const MEMORY_TRAIN = '#/memory/train';
export const MEMORY_RECORDS = '#/memory/records';

/** 应用内 href（'#/…'）→ react-router 路径（'/…'）；所有 navigate() 调用必须经此转换。 */
export function toRouterPath(href: string): string {
  return href.startsWith('#') ? href.slice(1) : href;
}

/** 统一「返回」语义：有应用内历史时弹出当前条目，否则跳到指定兜底页。 */
function goBackOr(navigate: NavigateFunction, fallback: string): void {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(toRouterPath(fallback));
}

/** 回到进入前的页面；无应用内历史（直接打开/冷启动）时回首页。 */
export function goBackOrHome(navigate: NavigateFunction): void {
  goBackOr(navigate, HOME);
}

/** 设置二级页返回上一页（通常为设置首页）；直接打开二级页（无应用内历史）时兜底到设置首页。 */
export function goBackOrSettings(navigate: NavigateFunction): void {
  goBackOr(navigate, SETTINGS);
}

export function docHref(path: string, opts?: { to?: string; q?: string; i?: number }): string {
  const base = `#/doc/${encodeURIComponent(path)}`;
  const params = new URLSearchParams();
  if (opts?.to) params.set('to', opts.to);
  if (opts?.q) params.set('q', opts.q);
  if (opts?.i !== undefined) params.set('i', String(opts.i));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function searchHref(q: string): string {
  return `#/search?q=${encodeURIComponent(q)}`;
}
