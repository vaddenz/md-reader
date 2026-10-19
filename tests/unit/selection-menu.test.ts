// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { menuActionsFor, rangesEqual, type MenuContext } from '../../src/lib/selection-menu';

/** 基础情境：无选区、未点高亮。 */
const base: MenuContext = {
  hasSelection: false,
  selectionInExcluded: false,
  selectionIntersectsHighlight: false,
  targetOnHighlight: false,
};

function ids(ctx: MenuContext): string[] {
  return menuActionsFor(ctx).map((a) => a.id);
}

describe('menuActionsFor（spec §6.2 菜单项判定）', () => {
  it('有选区（普通文本）：复制 ｜ 高亮·黄 ｜ 高亮·红', () => {
    const actions = menuActionsFor({ ...base, hasSelection: true });
    expect(actions.map((a) => a.id)).toEqual(['copy', 'hl:yellow', 'hl:red']);
    expect(actions.map((a) => a.label)).toEqual(['复制', '高亮·黄', '高亮·红']);
  });

  it('有选区且与已渲染高亮相交：追加「清除高亮」', () => {
    expect(ids({ ...base, hasSelection: true, selectionIntersectsHighlight: true }))
      .toEqual(['copy', 'hl:yellow', 'hl:red', 'clear']);
  });

  it('有选区（与排除区相交，如代码块）：只提供复制', () => {
    const actions = menuActionsFor({ ...base, hasSelection: true, selectionInExcluded: true });
    expect(actions).toEqual([{ id: 'copy', label: '复制' }]);
  });

  it('无选区（点在高亮上）：清除高亮 ｜ 全选', () => {
    const actions = menuActionsFor({ ...base, targetOnHighlight: true });
    expect(actions.map((a) => a.id)).toEqual(['clear', 'select-all']);
    expect(actions.map((a) => a.label)).toEqual(['清除高亮', '全选']);
  });

  it('无选区（普通）：仅全选', () => {
    expect(menuActionsFor(base)).toEqual([{ id: 'select-all', label: '全选' }]);
  });
});

describe('rangesEqual（选区快照等价判定）', () => {
  function rangeAt(text: string, start: number, end: number): Range {
    const p = document.createElement('p');
    p.textContent = text;
    document.body.append(p);
    const r = document.createRange();
    r.setStart(p.firstChild!, start);
    r.setEnd(p.firstChild!, end);
    return r;
  }

  it('对象同一 → true；边界一致的副本 → true', () => {
    const r = rangeAt('MVCC 并发控制', 0, 4);
    expect(rangesEqual(r, r)).toBe(true);
    expect(rangesEqual(r, r.cloneRange())).toBe(true);
  });

  it('边界不同 → false', () => {
    const a = rangeAt('MVCC 并发控制', 0, 4);
    const b = rangeAt('MVCC 并发控制', 1, 4);
    expect(rangesEqual(a, b)).toBe(false);
    expect(rangesEqual(a, rangeAt('MVCC 并发控制', 0, 3))).toBe(false);
  });

  it('null 组合：仅 null/null 相等', () => {
    const r = rangeAt('MVCC 并发控制', 0, 4);
    expect(rangesEqual(null, null)).toBe(true);
    expect(rangesEqual(r, null)).toBe(false);
    expect(rangesEqual(null, r)).toBe(false);
  });

  it('跨文档 Range：比较抛错按不等处理', () => {
    const a = rangeAt('MVCC 并发控制', 0, 4);
    const other = document.implementation.createHTMLDocument('x');
    const p = other.createElement('p');
    p.textContent = 'MVCC 并发控制';
    other.body.append(p);
    const b = other.createRange();
    b.setStart(p.firstChild!, 0);
    b.setEnd(p.firstChild!, 4);
    expect(rangesEqual(a, b)).toBe(false);
  });
});
