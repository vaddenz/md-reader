import { getFile, kvGet, listFilesMeta } from './db';

export interface CachedDocText { path: string; text: string }

/**
 * 已缓存正文的模块级缓存（搜索页与后续调用方共用）。
 * 以下任一条件不满足即重建：
 *  - `kv.lastSyncAt` 变化（完整同步完成）；
 *  - 缓存条目数 ≠ 元数据中 `cached` 文档数 —— 自愈两类不经 lastSyncAt 的变化：
 *    按需下载（DocPage 打开过期文档 / 「纳入全文搜索」）使命中数变大、过期清理使其变小。
 */
let cache: { stamp: number | null; texts: Map<string, string> } | null = null;

function toDocs(texts: Map<string, string>): CachedDocText[] {
  return [...texts].map(([path, text]) => ({ path, text }));
}

/** 返回全部已缓存文档的正文（顺序为 listFilesMeta 的键序）；缓存按上述条件自愈。 */
export async function loadCachedTexts(): Promise<CachedDocText[]> {
  const metas = await listFilesMeta();
  const stamp = (await kvGet<number>('lastSyncAt').catch(() => undefined)) ?? null;
  const cached = metas.filter((m) => m.cached);
  if (cache && cache.stamp === stamp && cache.texts.size === cached.length) return toDocs(cache.texts);

  const texts = new Map<string, string>();
  await Promise.all(
    cached.map(async (m) => {
      const rec = await getFile(m.path).catch(() => undefined);
      if (rec?.text != null) texts.set(m.path, rec.text);
    }),
  );
  cache = { stamp, texts };
  return toDocs(texts);
}

/** 仅测试用：清空模块缓存（fake-indexeddb 用例间隔离）。 */
export function resetSearchCacheForTests(): void {
  cache = null;
}
