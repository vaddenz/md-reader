import { HIGHLIGHT_COLORS } from '../data/highlights';

export interface MenuContext {
  hasSelection: boolean;
  selectionInExcluded: boolean;
  selectionIntersectsHighlight: boolean;
  targetOnHighlight: boolean;
}
export interface MenuAction { id: string; label: string }

/** 菜单项判定（spec §6.2 表格；纯函数，单测见 tests/unit/selection-menu.test.ts）。 */
export function menuActionsFor(ctx: MenuContext): MenuAction[] {
  if (ctx.hasSelection) {
    if (ctx.selectionInExcluded) return [{ id: 'copy', label: '复制' }];
    const actions: MenuAction[] = [{ id: 'copy', label: '复制' }];
    for (const c of HIGHLIGHT_COLORS) actions.push({ id: `hl:${c.id}`, label: c.label });
    if (ctx.selectionIntersectsHighlight) actions.push({ id: 'clear', label: '清除高亮' });
    return actions;
  }
  const actions: MenuAction[] = [];
  if (ctx.targetOnHighlight) actions.push({ id: 'clear', label: '清除高亮' });
  actions.push({ id: 'select-all', label: '全选' });
  return actions;
}
