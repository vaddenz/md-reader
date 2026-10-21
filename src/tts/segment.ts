import type { Chunk, ChunkKind } from './types';

export interface SegmentOptions {
  /** 跳过代码块；默认 true。 */
  skipCode?: boolean;
  /** 朗读表格；默认 false。 */
  readTable?: boolean;
}

interface TextSpan {
  node: Text;
  start: number;
  end: number;
}

interface BlockText {
  el: HTMLElement;
  text: string;
  spans: TextSpan[];
  kind: ChunkKind;
}

const BASE_EXCLUDED = 'svg,script,style,button,.note-mark,.tts-ignore,.mermaid';
const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption';

function blockKind(el: HTMLElement): ChunkKind {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'li') return 'list';
  if (tag === 'td' || tag === 'th') return 'table';
  return 'text';
}

function cjkRatio(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return cjk / text.length;
}

/** 粗略时长：中文 5 字/秒，其他 14 字符/秒。 */
export function estimateSeconds(text: string, rate = 1): number {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const other = Math.max(0, text.length - cjk);
  return Math.max(0.2, (cjk / 5 + other / 14) / Math.max(0.1, rate));
}

/**
 * 把渲染后的正文拆成句级朗读块。
 *
 * 只读文本节点，按最近的块级祖先分组；因此 `<li>` 里嵌套的 `<ul>`、
 * `<td>` 里的行内格式都不会重复朗读。清洗只改 `speak` 文本，不改 Range。
 */
export function buildChunks(root: HTMLElement, opts: SegmentOptions = {}): Chunk[] {
  const skipCode = opts.skipCode ?? true;
  const readTable = opts.readTable ?? false;
  const excluded = [BASE_EXCLUDED, skipCode ? 'pre' : '', readTable ? '' : 'table']
    .filter(Boolean)
    .join(',');
  const blockSelector = skipCode ? BLOCK_SELECTOR : `${BLOCK_SELECTOR},pre`;

  const blocks: BlockText[] = [];
  let current: BlockText | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const text = node.nodeValue ?? '';
    const parent = node.parentElement;
    if (text.length > 0 && parent) {
      const inExcluded = parent.closest(excluded);
      if (!inExcluded) {
        const blockEl = parent.closest(blockSelector) as HTMLElement | null;
        if (blockEl && root.contains(blockEl)) {
          // 按文本节点的连续区间分组：父 li 在嵌套 ul 之后还有文字时，
          // 另起一个 segment，保证朗读顺序与 DOM 一致。
          if (!current || current.el !== blockEl) {
            current = { el: blockEl, text: '', spans: [], kind: blockKind(blockEl) };
            blocks.push(current);
          }
          const start = current.text.length;
          current.text += text;
          current.spans.push({ node: node as Text, start, end: start + text.length });
        }
      }
    }
    node = walker.nextNode();
  }

  const chunks: Chunk[] = [];
  for (const block of blocks) {
    if (!block.text.trim()) continue;
    for (const part of sentenceRanges(block.text)) {
      const trimmed = trimRange(block.text, part.start, part.end);
      if (!trimmed) continue;
      const raw = block.text.slice(trimmed.start, trimmed.end);
      const speak = cleanForSpeech(raw);
      if (!speak) continue;
      chunks.push({
        text: speak,
        raw,
        lang: cjkRatio(raw) > 0.25 ? 'zh-CN' : 'en-US',
        block: block.el,
        ranges: rangesFor(block, trimmed.start, trimmed.end),
        kind: block.kind,
      });
    }
  }
  return chunks;
}

/** 仅供测试：暴露分句结果（offset 以原文计）。 */
export function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  const raw: Array<{ start: number; end: number }> = [];
  const Segmenter = (Intl as unknown as { Segmenter?: new (locales?: string, opts?: object) => { segment(input: string): Iterable<{ segment: string; index: number }> } }).Segmenter;
  if (Segmenter) {
    const seg = new Segmenter('zh', { granularity: 'sentence' });
    for (const s of seg.segment(text)) {
      raw.push({ start: s.index, end: s.index + s.segment.length });
    }
  } else {
    // 极旧浏览器的兜底：按中文/英文句末标点粗分
    const re = /[^。！？!?；;\n]+[。！？!?；;]?/g;
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      raw.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  // 合并过短句（<24 字）到下一句，避免频繁起停；不跨换行合并。
  const merged: Array<{ start: number; end: number }> = [];
  for (const part of raw) {
    const cur = trimRange(text, part.start, part.end);
    if (!cur) continue;
    const last = merged.at(-1);
    if (
      last &&
      last.end - last.start < 24 &&
      last.end - last.start + (cur.end - cur.start) <= 80 &&
      !text.slice(last.end, cur.start).includes('\n')
    ) {
      last.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }

  // 过长句在标点处再切；中文/中英混排上限 70 字，纯英文 200 字符。
  const out: Array<{ start: number; end: number }> = [];
  for (const part of merged) {
    const max = cjkRatio(text.slice(part.start, part.end)) > 0.15 ? 70 : 200;
    if (part.end - part.start <= max) {
      out.push(part);
      continue;
    }
    let start = part.start;
    while (start < part.end) {
      const remain = part.end - start;
      if (remain <= max) {
        const piece = trimRange(text, start, part.end);
        if (piece) out.push(piece);
        break;
      }
      const windowEnd = start + max;
      const slice = text.slice(start, windowEnd);
      let cut = -1;
      for (const ch of ['，', '、', '；', '：', ',', ';', ':', '。', '！', '？', '.', '!', '?']) {
        const idx = slice.lastIndexOf(ch);
        if (idx > max * 0.45) {
          cut = start + idx + 1;
          break;
        }
      }
      if (cut <= start) cut = windowEnd;
      const piece = trimRange(text, start, cut);
      if (piece) out.push(piece);
      start = cut;
    }
  }
  return out;
}

function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = Math.max(0, Math.min(text.length, start));
  let e = Math.max(s, Math.min(text.length, end));
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return s < e ? { start: s, end: e } : null;
}

function rangesFor(block: BlockText, start: number, end: number): Range[] {
  const out: Range[] = [];
  for (const span of block.spans) {
    const s = Math.max(start, span.start);
    const e = Math.min(end, span.end);
    if (s >= e) continue;
    const range = document.createRange();
    range.setStart(span.node, s - span.start);
    range.setEnd(span.node, e - span.start);
    out.push(range);
  }
  return out;
}

/**
 * 语音前的清洗：只改送进 TTS 的字符串，不参与 Range 映射。
 * 目标：URL/路径不逐字读，camelCase/snake_case 拆词，去掉 Markdown 残留。
 */
export function cleanForSpeech(raw: string): string {
  let s = raw.replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '');
  s = s.replace(/https?:\/\/\S+/gi, '链接');
  s = s.replace(/\bwww\.[^\s]+/gi, '链接');
  s = s.replace(/(?:^|\s)(?:~?\/|\.{1,2}\/)[^\s]+/g, ' 链接 ');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/(\*\*|__|~~|==)/g, '');
  s = s.replace(/\(\s*\)/g, '');
  // camelCase / PascalCase：useEffect → use Effect，SpeechSynthesis → Speech Synthesis
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  // snake_case / kebab-case：只处理词内分隔，避免把 2026-10-21 拆开
  s = s.replace(/_/g, ' ');
  s = s.replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
