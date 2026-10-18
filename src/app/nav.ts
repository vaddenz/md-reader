export const HOME = '#/';
export const SETUP = '#/setup';
export const SETTINGS = '#/settings';

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
