import { describe, expect, it } from 'vitest';
import {
  closeTab, EMPTY_TABS, openTab, pruneMissing, renameTab, sanitizeTabs, type TabsState,
} from '../../src/lib/tabs';

const s = (list: TabsState['list'], activeId: string | null): TabsState => ({ list, activeId });
const t = (id: string, docPath: string, title = '') => ({ id, docPath, title, openedAt: 1 });

describe('openTab', () => {
  it('新文档：追加并聚焦；同文档：仅聚焦（不重复开）', () => {
    const a = openTab(EMPTY_TABS, 'a.md', 'A');
    expect(a.list).toHaveLength(1);
    expect(a.activeId).toBe(a.list[0].id);
    const b = openTab(a, 'b.md', 'B');
    expect(b.list).toHaveLength(2);
    const again = openTab(b, 'a.md', 'A');
    expect(again.list).toHaveLength(2);           // 去重
    expect(again.activeId).toBe(b.list[0].id);    // 聚焦已有
  });
});

describe('closeTab', () => {
  it('关非当前：仅移除，不导航', () => {
    const st = s([t('1', 'a.md'), t('2', 'b.md')], '2');
    const r = closeTab(st, '1');
    expect(r.state.list).toHaveLength(1);
    expect(r.state.activeId).toBe('2');
    expect(r.navigateTo).toBeNull();
  });
  it('关当前：优先右邻、次左邻', () => {
    const st = s([t('1', 'a.md'), t('2', 'b.md'), t('3', 'c.md')], '2');
    expect(closeTab(st, '2').navigateTo).toBe('c.md');
    const st2 = s([t('1', 'a.md'), t('2', 'b.md')], '2');
    expect(closeTab(st2, '2').navigateTo).toBe('a.md');
  });
  it('关最后一个：activeId 置空、navigateTo=home', () => {
    const st = s([t('1', 'a.md')], '1');
    const r = closeTab(st, '1');
    expect(r.state.list).toHaveLength(0);
    expect(r.state.activeId).toBeNull();
    expect(r.navigateTo).toBe('home');
  });
  it('未知 id：原样返回', () => {
    const st = s([t('1', 'a.md')], '1');
    expect(closeTab(st, 'x').state).toBe(st);
  });
});

describe('renameTab / sanitizeTabs / pruneMissing', () => {
  it('renameTab：空标题/未知 id 不改；同值返回原引用', () => {
    const st = s([t('1', 'a.md', 'A')], '1');
    expect(renameTab(st, '1', '')).toBe(st);
    expect(renameTab(st, 'x', 'X')).toBe(st);
    expect(renameTab(st, '1', 'A')).toBe(st);
    expect(renameTab(st, '1', 'A2').list[0].title).toBe('A2');
  });
  it('sanitizeTabs：损坏 → 空；非法项丢弃；按 docPath 去重；activeId 非法回退首个', () => {
    expect(sanitizeTabs(null)).toEqual(EMPTY_TABS);
    expect(sanitizeTabs('garbage')).toEqual(EMPTY_TABS);
    const ok = sanitizeTabs({
      list: [t('1', 'a.md', 'A'), { id: 1 }, t('3', 'a.md'), t('4', 'b.md', 'B')],
      activeId: 'nope',
    });
    expect(ok.list.map((x) => x.docPath)).toEqual(['a.md', 'b.md']);
    expect(ok.activeId).toBe(ok.list[0].id);
  });
  it('pruneMissing：剔除不在树的；active 被剔 → null；无变化返回原引用', () => {
    const st = s([t('1', 'a.md'), t('2', 'gone.md')], '2');
    const pruned = pruneMissing(st, new Set(['a.md']));
    expect(pruned.list.map((x) => x.docPath)).toEqual(['a.md']);
    expect(pruned.activeId).toBeNull();
    expect(pruneMissing(st, new Set(['a.md', 'gone.md']))).toBe(st);
  });
});
