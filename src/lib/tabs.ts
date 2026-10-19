/** 多标签数据层（spec §3）：纯函数，无 IO、无 React。 */

export interface TabRecord {
  id: string;
  docPath: string;
  title: string;
  openedAt: number;
}

export interface TabsState {
  list: TabRecord[];
  activeId: string | null;
}

export const EMPTY_TABS: TabsState = { list: [], activeId: null };

let seq = 0;
/** 标签 id：时间基 + 进程内序号（无需 crypto）。 */
function newTabId(): string {
  seq += 1;
  return `t-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** 打开文档：已开 → 仅聚焦；未开 → 新建并聚焦（spec §3.2 总是新开 + 去重）。 */
export function openTab(state: TabsState, docPath: string, title: string, now = Date.now()): TabsState {
  const found = state.list.find((t) => t.docPath === docPath);
  if (found) return found.id === state.activeId ? state : { ...state, activeId: found.id };
  const tab: TabRecord = { id: newTabId(), docPath, title, openedAt: now };
  return { list: [...state.list, tab], activeId: tab.id };
}

/** 关闭标签（spec §3.4）：关当前 → 切相邻（优先右、次左）、关最后一个 → 回首页。 */
export function closeTab(state: TabsState, id: string): { state: TabsState; navigateTo: string | null } {
  const idx = state.list.findIndex((t) => t.id === id);
  if (idx < 0) return { state, navigateTo: null };
  const list = state.list.filter((t) => t.id !== id);
  if (state.activeId !== id) return { state: { ...state, list }, navigateTo: null };
  const next = list[idx] ?? list[idx - 1] ?? null;
  return { state: { list, activeId: next?.id ?? null }, navigateTo: next ? next.docPath : 'home' };
}

/** 回填标题（文档就绪后）；无变化返回原引用。 */
export function renameTab(state: TabsState, id: string, title: string): TabsState {
  if (!title) return state;
  const idx = state.list.findIndex((t) => t.id === id);
  if (idx < 0 || state.list[idx].title === title) return state;
  const list = state.list.slice();
  list[idx] = { ...list[idx], title };
  return { ...state, list };
}

/** 存储清洗（spec §3.6）：损坏/非法 → 空；按 docPath 去重；activeId 非法回退首个。 */
export function sanitizeTabs(raw: unknown): TabsState {
  if (!raw || typeof raw !== 'object') return EMPTY_TABS;
  const obj = raw as { list?: unknown; activeId?: unknown };
  if (!Array.isArray(obj.list)) return EMPTY_TABS;
  const list: TabRecord[] = [];
  for (const item of obj.list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.docPath !== 'string') continue;
    if (list.some((x) => x.docPath === r.docPath)) continue;
    list.push({
      id: r.id,
      docPath: r.docPath,
      title: typeof r.title === 'string' ? r.title : '',
      openedAt: typeof r.openedAt === 'number' && Number.isFinite(r.openedAt) ? r.openedAt : 0,
    });
  }
  const activeId = typeof obj.activeId === 'string' && list.some((t) => t.id === obj.activeId)
    ? obj.activeId
    : (list[0]?.id ?? null);
  return { list, activeId };
}

/** 剔除不在本地树缓存中的标签（spec §3.6 恢复时文档已不存在）；无变化返回原引用。 */
export function pruneMissing(state: TabsState, knownPaths: ReadonlySet<string>): TabsState {
  const list = state.list.filter((t) => knownPaths.has(t.docPath));
  if (list.length === state.list.length) return state;
  const activeId = list.some((t) => t.id === state.activeId) ? state.activeId : null;
  return { list, activeId };
}
