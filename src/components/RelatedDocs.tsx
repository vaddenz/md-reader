import { useEffect, useId, useMemo, useState } from 'react';
import { docHref } from '../app/nav';
import { kvGet, listFilesMeta, type FileMeta } from '../data/db';
import { filterKnown, getRelated } from '../data/links';

/** 每组最多展示的 chips 数。 */
const MAX_CHIPS = 8;

interface RelatedDocsProps {
  /** 当前文档路径。 */
  path: string;
}

/**
 * 正文底部「相关文档」：引用本文的（in）+ 本文引用的（out），各最多 8 条 chip，点击互跳。
 * 索引可能残留已删除文档的目标，按本地已知文档过滤；两组都空时整块不渲染。
 */
export default function RelatedDocs({ path }: RelatedDocsProps) {
  const uid = useId();
  // 元数据与互链索引与具体文档无关，只读一次；path 变化时用 useMemo 重算分组。
  const [data, setData] = useState<{ metas: FileMeta[]; index: Record<string, string[]> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listFilesMeta(), kvGet<Record<string, string[]>>('links')]).then(
      ([metas, index]) => { if (!cancelled) setData({ metas, index: index ?? {} }); },
      () => {}, // 读取失败：整块不渲染
    );
    return () => { cancelled = true; };
  }, []);

  const { inbound, outbound } = useMemo(() => {
    if (!data) return { inbound: [], outbound: [] };
    const known = new Set(data.metas.map((m) => m.path));
    const titleOf = new Map(data.metas.map((m) => [m.path, m.title || m.path]));
    const at = (p: string) => ({ path: p, title: titleOf.get(p) ?? p });
    const related = getRelated(path, data.index);
    return {
      inbound: filterKnown(related.in, known, MAX_CHIPS).map(at),
      outbound: filterKnown(related.out, known, MAX_CHIPS).map(at),
    };
  }, [data, path]);

  if (!inbound.length && !outbound.length) return null;

  const group = (id: string, title: string, docs: { path: string; title: string }[]) => (
    <section className="related-group" aria-labelledby={`${uid}-${id}`}>
      <h2 className="related-group-title" id={`${uid}-${id}`}>{title}</h2>
      <ul className="related-list">
        {docs.map((d) => (
          <li key={d.path}>
            <a className="related-chip" href={docHref(d.path)}>{d.title}</a>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <nav className="related-docs" aria-label="相关文档">
      {inbound.length > 0 && group('in', '引用本文的', inbound)}
      {outbound.length > 0 && group('out', '本文引用的', outbound)}
    </nav>
  );
}
