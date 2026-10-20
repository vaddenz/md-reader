import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOME, docHref, toRouterPath } from '../app/nav';
import { kvGet, kvSet } from '../data/db';
import {
  closeTab, EMPTY_TABS, openTab, pruneMissing, renameTab, sanitizeTabs, type TabsState,
} from '../lib/tabs';

const TABS_KEY = 'tabs';

/** 清除全部数据事件（设置 › 数据管理在清空所有仓库后派发，Provider 据此重置内存标签）。 */
export const DATA_CLEARED_EVENT = 'mdreader:data-cleared';

interface TabsCtx {
  /** kv 载入完成（DocPage 的登记 effect 需等待，避免与恢复竞态）。 */
  loaded: boolean;
  tabs: TabsState;
  /** 打开/聚焦文档（DocPage 挂载时调用）。 */
  ensureTab(docPath: string): void;
  /** 回填标题（文档就绪后）。 */
  setTitle(docPath: string, title: string): void;
  /** 切换器：激活并导航到某标签（当前标签调用为幂等 no-op）。 */
  activateTab(id: string): void;
  /** 关闭标签：关当前 → 自动切相邻/回首页。 */
  close(id: string): void;
}

const Ctx = createContext<TabsCtx>(null!);

export function useTabs(): TabsCtx {
  return useContext(Ctx);
}

/** 多标签状态（spec §3.1）：kv 持久化、跨重启恢复；载入时按本地树缓存剔除已不存在文档。 */
export function TabsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [tabs, setTabs] = useState<TabsState>(EMPTY_TABS);
  const [loaded, setLoaded] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await kvGet<unknown>(TABS_KEY).catch(() => undefined);
      let next = sanitizeTabs(raw);
      const tree = await kvGet<{ entries?: { path?: string }[] }>('tree').catch(() => undefined);
      const paths = new Set(
        (tree?.entries ?? []).map((e) => e.path).filter((p): p is string => typeof p === 'string'),
      );
      if (paths.size > 0) next = pruneMissing(next, paths);
      if (!cancelled) {
        setTabs(next);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 清除全部数据后重置内存标签（设置 › 数据管理在清空所有仓库后派发）。
  useEffect(() => {
    const onCleared = () => setTabs(EMPTY_TABS);
    window.addEventListener(DATA_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(DATA_CLEARED_EVENT, onCleared);
  }, []);

  // 持久化：载入完成后任何状态变化都落盘（含载入时的清洗/剔除结果）。
  useEffect(() => {
    if (!loaded) return;
    void kvSet(TABS_KEY, tabs).catch(() => undefined);
  }, [tabs, loaded]);

  const ensureTab = useCallback((docPath: string) => {
    setTabs((s) => {
      const found = s.list.find((t) => t.docPath === docPath);
      if (found) return found.id === s.activeId ? s : { ...s, activeId: found.id };
      return openTab(s, docPath, '');
    });
  }, []);

  const setTitle = useCallback((docPath: string, title: string) => {
    setTabs((s) => {
      const t = s.list.find((x) => x.docPath === docPath);
      return t ? renameTab(s, t.id, title) : s;
    });
  }, []);

  const activateTab = useCallback((id: string) => {
    const s = tabsRef.current;
    const t = s.list.find((x) => x.id === id);
    if (!t || s.activeId === id) return;
    setTabs((prev) => ({ ...prev, activeId: id }));
    navigate(toRouterPath(docHref(t.docPath)));
  }, [navigate]);

  const close = useCallback((id: string) => {
    const { state: next, navigateTo } = closeTab(tabsRef.current, id);
    setTabs(next);
    if (navigateTo === 'home') navigate(toRouterPath(HOME));
    else if (navigateTo) navigate(toRouterPath(docHref(navigateTo)));
  }, [navigate]);

  const value = useMemo(
    () => ({ loaded, tabs, ensureTab, setTitle, activateTab, close }),
    [loaded, tabs, ensureTab, setTitle, activateTab, close],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
