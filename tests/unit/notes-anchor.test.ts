// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { HighlightRecord } from '../../src/data/highlights';
import type { NoteRecord } from '../../src/data/notes';
import { applyHighlights, buildHaystack, rangeIntersectsExcluded, removeMarks, selectionToAnchor, visibleText } from '../../src/markdown/highlights';
import { applyNotes, removeNoteMarks } from '../../src/markdown/notes';

function note(id: string, exact: string, createdAt = 1, body = '内容'): NoteRecord {
  return { id, exact, prefix: '', suffix: '', body, createdAt, updatedAt: createdAt };
}

function highlight(id: string, exact: string): HighlightRecord {
  return { id, exact, prefix: '', suffix: '', decorations: [{ kind: 'bg', color: 'yellow' }], createdAt: 1 };
}

function mount(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'doc-content';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('applyNotes', () => {
  it('在锚点文字末尾插入可点击符号，正文文本不变', () => {
    const el = mount('<p>实验证明，MVCC 可以避免读写冲突。</p>');
    const applied = applyNotes(el, [note('n1', 'MVCC')]);
    const mark = el.querySelector<HTMLButtonElement>('button.note-mark')!;
    expect(mark).not.toBeNull();
    expect(mark.dataset.noteId).toBe('n1');
    expect(mark.getAttribute('aria-label')).toBe('查看笔记');
    expect(mark.type).toBe('button');
    expect(el.textContent).toBe('实验证明，MVCC 可以避免读写冲突。');
    expect(visibleText(el)).toBe('实验证明，MVCC 可以避免读写冲突。');
    expect(applied.get('n1')).toEqual({ start: 5, end: 9 });
    // 符号紧跟在锚点最后一个字之后
    expect(mark.previousSibling?.textContent?.endsWith('MVCC')).toBe(true);
  });

  it('同一文本节点内多处锚点按位置倒序插入，文本与符号都正确', () => {
    const el = mount('<p>甲乙丙丁</p>');
    const applied = applyNotes(el, [note('n1', '甲'), note('n2', '丙')]);
    expect(applied.size).toBe(2);
    expect(el.querySelectorAll('button.note-mark')).toHaveLength(2);
    expect(el.textContent).toBe('甲乙丙丁');
    const ids = [...el.querySelectorAll<HTMLButtonElement>('button.note-mark')].map((m) => m.dataset.noteId);
    // DOM 顺序应与正文顺序一致
    expect(ids).toEqual(['n1', 'n2']);
  });

  it('多条笔记共享同一锚点：合并插入、不重复文本', () => {
    const el = mount('<p>同一段被锚定的文字。</p>');
    applyNotes(el, [note('n1', '锚定', 1), note('n2', '锚定', 2)]);
    expect(el.querySelectorAll('button.note-mark')).toHaveLength(2);
    expect(el.textContent).toBe('同一段被锚定的文字。');
  });

  it('找不到原文的孤儿不渲染，记录仍由调用方保留', () => {
    const el = mount('<p>完全不同。</p>');
    expect(applyNotes(el, [note('n1', '找不到的句子')]).size).toBe(0);
    expect(el.querySelector('button.note-mark')).toBeNull();
  });

  it('重复应用幂等：先移除旧符号再重锚', () => {
    const el = mount('<p>正文。</p>');
    applyNotes(el, [note('n1', '正文')]);
    applyNotes(el, [note('n1', '正文')]);
    expect(el.querySelectorAll('button.note-mark')).toHaveLength(1);
    expect(el.textContent).toBe('正文。');
  });

  it('跨行内元素锚定：符号落在最后一个字之后', () => {
    const el = mount('<p>前<strong>中</strong>后</p>');
    applyNotes(el, [note('n1', '前中后')]);
    const mark = el.querySelector('button.note-mark')!;
    expect(el.textContent).toBe('前中后');
    expect(mark.previousSibling?.textContent?.endsWith('后')).toBe(true);
  });

  it('笔记符号不进入 haystack（后续锚定/复制不受影响）', () => {
    const el = mount('<p>一段正文。</p>');
    applyNotes(el, [note('n1', '一段')]);
    expect(buildHaystack(el).text).toBe('一段正文。');
  });

  it('选区跨过笔记符号不算命中排除区，仍可继续高亮/记笔记', () => {
    const el = mount('<p>甲乙丙丁</p>');
    applyNotes(el, [note('n1', '乙')]);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text;
    let last = first;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) last = node;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.data.length);

    expect(el.querySelector('button.note-mark')).not.toBeNull();
    expect(rangeIntersectsExcluded(el, range)).toBe(false);
    const info = selectionToAnchor(el, range);
    expect(info?.anchor.exact).toBe('甲乙丙丁');
  });
});

describe('removeNoteMarks', () => {
  it('移除全部符号并合并被拆开的文本节点', () => {
    const el = mount('<p>甲乙丙丁</p>');
    applyNotes(el, [note('n1', '甲'), note('n2', '丙')]);
    removeNoteMarks(el);
    expect(el.querySelector('button.note-mark')).toBeNull();
    expect(el.textContent).toBe('甲乙丙丁');
    expect(el.querySelector('p')!.childNodes).toHaveLength(1);
  });
});

describe('与高亮共存', () => {
  it('先笔记后高亮：高亮只包裹原文，笔记符号保留', () => {
    const el = mount('<p>实验证明，MVCC 可以避免读写冲突。</p>');
    applyNotes(el, [note('n1', 'MVCC')]);
    applyHighlights(el, [highlight('h1', 'MVCC')]);
    expect(el.querySelector('mark.hl-yellow')?.textContent).toBe('MVCC');
    expect(el.querySelector('button.note-mark')).not.toBeNull();
    expect(el.textContent).toBe('实验证明，MVCC 可以避免读写冲突。');
  });

  it('先高亮后笔记：符号插在高亮内部，清除高亮后笔记仍在', () => {
    const el = mount('<p>实验证明，MVCC 可以避免读写冲突。</p>');
    applyHighlights(el, [highlight('h1', 'MVCC')]);
    applyNotes(el, [note('n1', 'MVCC')]);
    expect(el.querySelectorAll('button.note-mark')).toHaveLength(1);
    removeMarks(el, ['h1']);
    expect(el.querySelector('mark.hl-yellow')).toBeNull();
    expect(el.querySelectorAll('button.note-mark')).toHaveLength(1);
    expect(el.textContent).toBe('实验证明，MVCC 可以避免读写冲突。');
  });
});
