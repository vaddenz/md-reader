export const HOME = '#/';
export const SETUP = '#/setup';
export const SETTINGS = '#/settings';

/** 应用内 href（'#/…'）→ react-router 路径（'/…'）；所有 navigate() 调用必须经此转换。 */
export function toRouterPath(href: string): string {
  return href.startsWith('#') ? href.slice(1) : href;
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
