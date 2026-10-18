import { describe, expect, it } from 'vitest';
import { menuActionsFor, type MenuContext } from '../../src/lib/selection-menu';

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
