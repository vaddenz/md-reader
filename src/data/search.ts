import { extractTitle } from '../lib/text';

export interface SearchHit {
  /** 仓库内完整路径。 */
  path: string;
  /** 文档标题：复用 extractTitle（首个一级标题，缺省为文件名去 .md）。 */
  title: string;
  /** 正文命中总数（各查询词出现次数之和，非重叠计数）。 */
  count: number;
  /** count + 5 × 标题命中数 + 2 × 路径命中数。 */
  score: number;
  /** 前 3 条命中片段：start 为片段在原文中的起始偏移。 */
  snippets: { text: string; start: number }[];
}

/** 片段上下文长度：命中处前后各 40 字。 */
const CONTEXT = 40;
const MAX_SNIPPETS = 3;
const DEFAULT_LIMIT = 50;
const collator = new Intl.Collator('zh');

/** 非重叠子串定位：返回 needle 在 haystack（均已小写）中每次出现的位置。 */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    out.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return out;
}

/** 命中处上下文片段：start±40，clamp 到文本边界；start 为原文偏移。 */
function snippetAt(text: string, pos: number, len: number): { text: string; start: number } {
  const start = Math.max(0, pos - CONTEXT);
  const end = Math.min(text.length, pos + len + CONTEXT);
  return { text: text.slice(start, end), start };
}

/**
 * 全文子串搜索：查询按空白切词、AND 语义（每个词都须出现在正文中），ASCII 大小写不敏感。
 * 排序 score = 正文命中数 + 5 × 标题命中数 + 2 × 路径命中数（降序；同分按路径 zh 排序保证稳定）。
 * 每篇文档返回前 3 条命中片段；limit 默认 50。
 */
export function searchDocs(
  docs: { path: string; text: string }[],
  query: string,
  limit = DEFAULT_LIMIT,
): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const lowerText = doc.text.toLowerCase();
    // AND：每个词都必须出现在正文中（标题/路径仅参与加权，不决定是否命中）。
    if (!terms.every((term) => lowerText.includes(term))) continue;

    const title = extractTitle(doc.text, doc.path);
    const lowerTitle = title.toLowerCase();
    const lowerPath = doc.path.toLowerCase();

    let count = 0;
    let titleHits = 0;
    let pathHits = 0;
    const found: { pos: number; len: number }[] = [];
    for (const term of terms) {
      const positions = occurrences(lowerText, term);
      count += positions.length;
      for (const pos of positions) found.push({ pos, len: term.length });
      titleHits += occurrences(lowerTitle, term).length;
      pathHits += occurrences(lowerPath, term).length;
    }

    found.sort((a, b) => a.pos - b.pos);
    const snippets: { text: string; start: number }[] = [];
    const seen = new Set<string>();
    for (const { pos, len } of found) {
      const snippet = snippetAt(doc.text, pos, len);
      // 只对同一窗口去重（同词的大小写变体命中同一处）；同 start 不同 end 是不同命中，保留。
      const key = `${snippet.start}:${snippet.start + snippet.text.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      snippets.push(snippet);
      if (snippets.length === MAX_SNIPPETS) break;
    }

    hits.push({ path: doc.path, title, count, score: count + 5 * titleHits + 2 * pathHits, snippets });
  }

  hits.sort((a, b) => b.score - a.score || collator.compare(a.path, b.path));
  return hits.slice(0, Math.max(0, limit));
}
