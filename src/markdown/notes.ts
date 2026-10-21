import type { NoteRecord } from '../data/notes';
import { buildHaystack, locateAnchor, type Haystack } from './highlights';

const NOTE_MARK_SELECTOR = 'button.note-mark';

/** 笔记符号：锚定文字末尾的可点击小徽标（不参与正文 haystack/复制文本）。 */
function createNoteMark(note: NoteRecord): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'note-mark';
  btn.dataset.noteId = note.id;
  btn.setAttribute('aria-label', '查看笔记');
  btn.title = '查看笔记';
  btn.innerHTML = [
    '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">',
    '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="M5 4.5h14v15l-4.2-3H5z"/>',
    '<path fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" d="M9 9h6M9 12.5h4"/>',
    '</svg>',
  ].join('');
  return btn;
}

/** 移除所有已渲染的笔记符号并合并被 insertNode 拆开的文本节点。 */
export function removeNoteMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll(NOTE_MARK_SELECTOR);
  if (!marks.length) return;
  for (const mark of marks) mark.remove();
  container.normalize();
}

/**
 * 将笔记符号插入到各自锚点文字的末尾。
 * 返回记录 id → haystack 区间（未命中的孤儿不返回，记录仍保留）。
 *
 * 先算完全部区间再插入；同一文本节点内按区间倒序插入，避免 insertNode 拆节点后
 * 靠前区间的偏移失效；同一终点合并为一个 fragment 一次插入（多条笔记共享锚点）。
 */
export function applyNotes(
  container: HTMLElement,
  notes: readonly NoteRecord[],
): Map<string, { start: number; end: number }> {
  removeNoteMarks(container);
  const haystack: Haystack = buildHaystack(container);
  const located: { note: NoteRecord; start: number; end: number }[] = [];
  const sorted = [...notes].sort((a, b) => a.createdAt - b.createdAt);
  for (const note of sorted) {
    const found = locateAnchor(haystack, note);
    if (found) located.push({ note, ...found });
  }

  const byEnd = new Map<number, { note: NoteRecord; start: number; end: number }[]>();
  for (const item of located) {
    byEnd.set(item.end, [...(byEnd.get(item.end) ?? []), item]);
  }

  const applied = new Map<string, { start: number; end: number }>();
  const ends = [...byEnd.keys()].sort((a, b) => b - a);
  for (const end of ends) {
    // 定位锚点最后一个正文字符；插入到它之后（分隔符不计）。
    let i = end - 1;
    while (i >= 0 && !haystack.map[i]?.node) i--;
    const pos = i >= 0 ? haystack.map[i] : null;
    if (!pos?.node) continue;

    const fragment = document.createDocumentFragment();
    for (const item of byEnd.get(end)!) {
      fragment.append(createNoteMark(item.note));
      applied.set(item.note.id, { start: item.start, end: item.end });
    }
    const range = document.createRange();
    range.setStart(pos.node, pos.offset + 1);
    range.collapse(true);
    range.insertNode(fragment);
  }
  return applied;
}
