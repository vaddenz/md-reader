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
  const out = index[path] ?? [];
  const inbound: string[] = [];
  for (const [from, to] of Object.entries(index)) if (to.includes(path)) inbound.push(from);
  return { out, in: inbound };
}
