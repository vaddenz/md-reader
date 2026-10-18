import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { docHref, toRouterPath } from '../app/nav';
import type { FileMeta } from '../data/db';

const collator = new Intl.Collator('zh');

/**
 * 文档路径排序（上下篇顺序）：根文档在前，然后子目录；每层「文件在前、子目录在后」，
 * 同层用 Intl.Collator('zh') 排序，目录内深度优先 —— 与 T15 flattenTree 语义一致。
 */
export function orderDocPaths(paths: string[]): string[] {
  const files: string[] = [];
  const dirs = new Map<string, string[]>();
  for (const p of paths) {
    const i = p.indexOf('/');
    if (i < 0) {
      files.push(p);
      continue;
    }
    const dir = p.slice(0, i);
    const rest = p.slice(i + 1);
    const bucket = dirs.get(dir);
    if (bucket) bucket.push(rest);
    else dirs.set(dir, [rest]);
  }
  files.sort(collator.compare);
  const out = files;
  for (const dir of [...dirs.keys()].sort(collator.compare)) {
    for (const rest of orderDocPaths(dirs.get(dir)!)) out.push(`${dir}/${rest}`);
  }
  return out;
}

interface PrevNextProps {
  /** 当前文档路径。 */
  path: string;
  /** 全部文档元数据（listFilesMeta()），用于排序与标题展示。 */
  metas: FileMeta[];
}

/** 正文底部「上一篇 / 下一篇」：按文件树深度优先顺序取相邻文档。 */
export default function PrevNext({ path, metas }: PrevNextProps) {
  const { prev, next } = useMemo(() => {
    const ordered = orderDocPaths(metas.map((m) => m.path));
    const i = ordered.indexOf(path);
    if (i < 0) return { prev: null, next: null };
    const titleOf = new Map(metas.map((m) => [m.path, m.title || m.path]));
    const at = (p: string) => ({ path: p, title: titleOf.get(p) ?? p });
    return {
      prev: i > 0 ? at(ordered[i - 1]) : null,
      next: i < ordered.length - 1 ? at(ordered[i + 1]) : null,
    };
  }, [metas, path]);

  if (!prev && !next) return null;

  return (
    <nav className="prev-next" aria-label="上一篇 / 下一篇">
      {prev ? (
        <Link className="prev-next-item" to={toRouterPath(docHref(prev.path))} rel="prev">
          <span className="prev-next-label">← 上一篇</span>
          <span className="prev-next-title">{prev.title}</span>
        </Link>
      ) : (
        <span className="prev-next-spacer" aria-hidden="true" />
      )}
      {next ? (
        <Link className="prev-next-item prev-next-next" to={toRouterPath(docHref(next.path))} rel="next">
          <span className="prev-next-label">下一篇 →</span>
          <span className="prev-next-title">{next.title}</span>
        </Link>
      ) : (
        <span className="prev-next-spacer" aria-hidden="true" />
      )}
    </nav>
  );
}
