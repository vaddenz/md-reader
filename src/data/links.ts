import { resolveMdLink } from './paths';

export function buildLinksIndex(docs: { path: string; text: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const doc of docs) {
    const targets = new Set<string>();
    for (const m of doc.text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)\s]*)?\)/g)) {
      const hit = resolveMdLink(doc.path, m[1]);
      if (hit && hit.path !== doc.path) targets.add(hit.path);
    }
    if (targets.size) out[doc.path] = [...targets];
  }
  return out;
}

export function getRelated(path: string, index: Record<string, string[]>) {
  // 自引用（正文写 [自己](自己.md)，或外部/损坏索引残留）双向排除，避免面板指向当前文档。
  const out = (index[path] ?? []).filter((p) => p !== path);
  const inbound: string[] = [];
  for (const [from, to] of Object.entries(index)) {
    if (from !== path && to.includes(path)) inbound.push(from);
  }
  return { out, in: inbound };
}

/**
 * 关联文档面板用：按「本地已知文档」过滤引用目标（索引可能残留已删除文档的旧目标），
 * 去重后按原顺序最多保留 limit 条。
 */
export function filterKnown(paths: string[], knownPaths: ReadonlySet<string>, limit: number): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (out.length >= limit) break;
    if (knownPaths.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}
