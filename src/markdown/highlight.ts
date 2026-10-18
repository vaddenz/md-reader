/**
 * 正文搜索命中高亮（T18）：在渲染后的正文容器内把查询词逐处包成
 * `<mark class="search-mark">`，供搜索直达后滚动定位。
 */

/** 命中区间（相对文本的偏移）。 */
export interface TermRange { start: number; end: number }

const DEFAULT_MAX = 200;

/**
 * 查询词（按空白切分、ASCII 大小写归一）在文本中的全部命中区间：
 * 各词内非重叠计数（与 searchDocs 口径一致），跨词重叠区间合并、按位置排序。
 */
export function termRanges(text: string, query: string): TermRange[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const lower = text.toLowerCase();
  const found: TermRange[] = [];
  for (const term of terms) {
    let at = lower.indexOf(term);
    while (at !== -1) {
      found.push({ start: at, end: at + term.length });
      at = lower.indexOf(term, at + term.length);
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: TermRange[] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else merged.push(r);
  }
  return merged;
}

/**
 * 在容器内高亮查询词，返回全部 `<mark>`（按文档顺序）。
 * - 大小写不敏感；查询按空白切分为多词，每个词的每一处都高亮；
 * - 跳过 `script` / `style` / `mark`（含既有搜索命中与 ==高亮==，不重复包裹）；
 * - 总数上限 `max`（默认 200），按文档顺序取前 max 处。
 */
export function highlightInContainer(
  container: HTMLElement,
  query: string,
  opts?: { max?: number },
): HTMLElement[] {
  const max = Math.max(0, opts?.max ?? DEFAULT_MAX);
  if (!query.trim() || max === 0) return [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, mark')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const marks: HTMLElement[] = [];
  let node = walker.nextNode() as Text | null;
  while (node && marks.length < max) {
    const ranges = termRanges(node.data, query).slice(0, max - marks.length);
    const local: HTMLElement[] = [];
    // 从后往前包裹：后面的 splitText 不影响前面命中区间的偏移。
    for (let k = ranges.length - 1; k >= 0; k--) {
      const { start, end } = ranges[k];
      const parent = node.parentNode;
      if (!parent) break;
      node.splitText(end); // [end, …) 拆出为新文本节点
      const target = node.splitText(start); // [start, end)
      const mark = document.createElement('mark');
      mark.className = 'search-mark';
      parent.insertBefore(mark, target);
      mark.appendChild(target);
      local.push(mark);
    }
    local.reverse();
    marks.push(...local);
    node = walker.nextNode() as Text | null;
  }
  return marks;
}
