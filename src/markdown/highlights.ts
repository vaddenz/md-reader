import type { HighlightRecord } from '../data/highlights';

export interface TextPos { node: Text | null; offset: number }
export interface Haystack { text: string; map: TextPos[] }
/** 归一化结果：空白串折叠为单空格，并记录每个归一化字符 → 原文下标。 */
export interface NormalizedText { norm: string; toRaw: number[] }

const SKIP_SELECTOR = 'script, style, pre, code, button, svg, .code-copy, .md-mermaid, .md-mermaid-error, .md-img-error';
/** 复制口径的跳过清单：与锚定口径相同，但保留 pre/code（代码是正文内容，只剔除界面元素）。 */
const COPY_SKIP_SELECTOR = 'script, style, button, svg, .code-copy, .md-mermaid, .md-mermaid-error, .md-img-error';
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dt, dd, pre';
const CONTEXT = 32;

export function buildHaystack(container: HTMLElement, skipSelector: string = SKIP_SELECTOR): Haystack {
  const text: string[] = [];
  const map: TextPos[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let prevBlock: Element | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest(skipSelector)) {
      const block = parent.closest(BLOCK_SELECTOR) ?? container;
      if (prevBlock !== null && block !== prevBlock) {
        text.push('\n');
        map.push({ node: null, offset: -1 });
      }
      prevBlock = block;
      for (let i = 0; i < node.data.length; i++) {
        text.push(node.data[i]);
        map.push({ node, offset: i });
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return { text: text.join(''), map };
}

/** 全选范围：从首个到末个「非排除区」文本节点；无可用文本时返回 null。 */
export function contentRange(container: HTMLElement): Range | null {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest(SKIP_SELECTOR)) nodes.push(node);
    node = walker.nextNode() as Text | null;
  }
  if (nodes.length === 0) return null;
  const range = document.createRange();
  range.setStart(nodes[0], 0);
  const last = nodes[nodes.length - 1];
  range.setEnd(last, last.data.length);
  return range;
}

/** 可见文本（复制口径：保留代码、剔除界面元素，块间以换行分隔）。 */
export function visibleText(container: HTMLElement): string {
  return buildHaystack(container, COPY_SKIP_SELECTOR).text;
}

/** 归一化：空白串折叠为单空格，并记录每个归一化字符 → 原文下标。 */
function normalize(s: string): NormalizedText {
  const norm: string[] = [];
  const toRaw: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      norm.push(' ');
      toRaw.push(i);
      while (i < s.length && /\s/.test(s[i])) i++;
    } else {
      norm.push(s[i]);
      toRaw.push(i);
      i++;
    }
  }
  return { norm: norm.join(''), toRaw };
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * 在 haystack 中定位锚点。`prep` 可选：由调用方惰性构建、跨记录复用的归一化结构
 * （批量应用时避免逐记录重复归一化）；不传则按需在函数内构建。
 */
export function locateAnchor(
  haystack: Haystack,
  anchor: { exact: string; prefix: string; suffix: string },
  prep?: () => { norm: NormalizedText },
): { start: number; end: number } | null {
  if (!anchor.exact) return null; // 空 exact 无意义，且会让 indexOf 循环不前进
  const getNorm = (): NormalizedText => (prep ? prep().norm : normalize(haystack.text));
  // 一级：原始精确匹配（候选直接带原文区间）
  const candidates: { start: number; end: number }[] = [];
  for (let i = haystack.text.indexOf(anchor.exact); i !== -1; i = haystack.text.indexOf(anchor.exact, i + 1)) {
    candidates.push({ start: i, end: i + anchor.exact.length });
  }
  // 单候选短路：唯一原文命中即答案，无需归一化与消歧（批量应用的主路径）。
  if (candidates.length === 1) return candidates[0];
  // 二级：空白归一化匹配（toRaw 映射回原文；end 取下一归一化字符的原文下标，覆盖整段空白）
  let normInfo: NormalizedText | null = null;
  let nExact = anchor.exact;
  if (candidates.length === 0) {
    normInfo = getNorm();
    nExact = normalize(anchor.exact).norm;
    if (!nExact) return null;
    for (let i = normInfo.norm.indexOf(nExact); i !== -1; i = normInfo.norm.indexOf(nExact, i + 1)) {
      const start = normInfo.toRaw[i];
      const after = i + nExact.length;
      const end = after < normInfo.toRaw.length ? normInfo.toRaw[after] : haystack.text.length;
      candidates.push({ start, end });
    }
  }
  if (candidates.length === 0) return null;
  // 三级：上下文消歧（归一化空间计分；平分取最早）
  const useNorm = normInfo ?? getNorm();
  const useExact = normInfo ? nExact : normalize(anchor.exact).norm;
  const nPrefix = normalize(anchor.prefix).norm;
  const nSuffix = normalize(anchor.suffix).norm;
  // 原文下标 → 归一化下标（消歧用）：只映射候选起点（原先全量映射是长文档的主要开销）。
  const starts = new Set(candidates.map((c) => c.start));
  const rawToNorm = new Map<number, number>();
  useNorm.toRaw.forEach((raw, i) => { if (starts.has(raw)) rawToNorm.set(raw, i); });
  let best = { range: candidates[0], score: -1 };
  for (const range of candidates) {
    const nStart = rawToNorm.get(range.start) ?? 0;
    const nEnd = nStart + useExact.length;
    const before = useNorm.norm.slice(Math.max(0, nStart - CONTEXT), nStart);
    const after = useNorm.norm.slice(nEnd, nEnd + CONTEXT);
    const score = commonSuffixLen(before, nPrefix) + commonPrefixLen(after, nSuffix);
    if (score > best.score) best = { range, score };
  }
  return best.range;
}

export function markClassFor(record: HighlightRecord): string | null {
  const known = record.decorations.filter((d) => d.kind === 'bg' && (d.color === 'yellow' || d.color === 'red'));
  if (known.length === 0) return null;
  return `hl hl-${known[0].color}`;
}

export function wrapRange(container: HTMLElement, haystack: Haystack, start: number, end: number, className: string, id: string): HTMLElement[] {
  const groups: { node: Text; from: number; to: number }[] = [];
  for (let i = start; i < end; i++) {
    const pos = haystack.map[i];
    if (!pos || pos.node === null) continue; // 分隔符
    const last = groups[groups.length - 1];
    if (last && last.node === pos.node && pos.offset === last.to) last.to = pos.offset + 1;
    else groups.push({ node: pos.node, from: pos.offset, to: pos.offset + 1 });
  }
  const marks: HTMLElement[] = [];
  for (const g of groups) {
    const range = document.createRange();
    range.setStart(g.node, g.from);
    range.setEnd(g.node, g.to);
    const mark = document.createElement('mark');
    mark.className = className;
    mark.setAttribute('data-hl-id', id);
    range.surroundContents(mark);
    marks.push(mark);
  }
  return marks;
}

export function removeMarks(container: HTMLElement, ids: string[]): void {
  for (const mark of container.querySelectorAll('mark.hl')) {
    const id = mark.getAttribute('data-hl-id');
    if (id && ids.includes(id)) mark.replaceWith(...mark.childNodes);
  }
  container.normalize();
}

export function applyHighlights(container: HTMLElement, records: HighlightRecord[]): Map<string, { start: number; end: number }> {
  const applied = new Map<string, { start: number; end: number }>();
  const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const haystack = buildHaystack(container);
  // 归一化结构惰性构建、整次调用复用（逐记录重复归一化 + 全量映射是长文档的主要开销）。
  let prep: { norm: NormalizedText } | undefined;
  const getPrep = () => (prep ??= { norm: normalize(haystack.text) });
  const pending: { start: number; end: number; className: string; id: string }[] = [];
  for (const record of sorted) {
    const cls = markClassFor(record);
    if (!cls) continue;
    const found = locateAnchor(haystack, record, getPrep);
    if (!found) continue; // 孤儿：保留记录不渲染
    let conflict = false;
    for (const r of applied.values()) if (found.start < r.end && r.start < found.end) { conflict = true; break; }
    if (conflict) continue; // 先到先得
    applied.set(record.id, found);
    pending.push({ start: found.start, end: found.end, className: cls, id: record.id });
  }
  // 包裹按区间倒序执行：surroundContents 会把文本节点在区间起点处截断（前半留在原节点），
  // 先包裹靠后的区间，靠前区间持有的节点引用与偏移才仍然有效（同一文本节点内多处高亮必需）。
  pending.sort((a, b) => b.start - a.start);
  for (const p of pending) wrapRange(container, haystack, p.start, p.end, p.className, p.id);
  return applied;
}

export function rangeIntersectsExcluded(container: HTMLElement, range: Range): boolean {
  for (const el of container.querySelectorAll(SKIP_SELECTOR)) {
    if (range.intersectsNode(el)) return true;
  }
  return false;
}

export function selectionToAnchor(container: HTMLElement, range: Range): { anchor: { exact: string; prefix: string; suffix: string }; start: number; end: number } | null {
  if (rangeIntersectsExcluded(container, range)) return null;
  const haystack = buildHaystack(container);
  let start = -1; let end = -1;
  for (let i = 0; i < haystack.map.length; i++) {
    const pos = haystack.map[i];
    if (!pos.node) continue;
    const a = range.comparePoint(pos.node, pos.offset);
    const b = range.comparePoint(pos.node, pos.offset + 1);
    if (a >= 0 && b <= 0) {
      if (start === -1) start = i;
      end = i + 1;
    }
  }
  if (start === -1 || start >= end) return null;
  return {
    anchor: {
      exact: haystack.text.slice(start, end),
      prefix: haystack.text.slice(Math.max(0, start - CONTEXT), start),
      suffix: haystack.text.slice(end, end + CONTEXT),
    },
    start, end,
  };
}
