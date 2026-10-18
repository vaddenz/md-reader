export const isDoc = (p: string) => p.endsWith('.md');
export const isImage = (p: string) => /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(p);

export function normalizeRepoPath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function decode(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function resolveMdLink(fromPath: string, href: string): { path: string; anchor?: string } | null {
  if (/^(https?:|mailto:|tel:|data:)/i.test(href)) return null;
  if (href.startsWith('#')) return { path: fromPath, anchor: decode(href.slice(1)) ?? undefined };
  const [rawPath, rawAnchor] = href.split('#');
  const decoded = decode(rawPath) ?? rawPath;
  if (!decoded.endsWith('.md')) return null;
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const joined = decoded.startsWith('/') ? decoded.slice(1) : (dir ? `${dir}/${decoded}` : decoded);
  return { path: normalizeRepoPath(joined), anchor: rawAnchor ? decode(rawAnchor) ?? rawAnchor : undefined };
}

export function resolveAssetPath(fromPath: string, src: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(src)) return null;
  const decoded = decode(src) ?? src;
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const joined = decoded.startsWith('/') ? decoded.slice(1) : (dir ? `${dir}/${decoded}` : decoded);
  return normalizeRepoPath(joined);
}
