import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { toRouterPath } from './nav';
import { keyFromLocation, rememberScroll } from './scroll';
import OfflineBanner from '../components/OfflineBanner';
import { ToastHost } from '../lib/toast';
import { OrientationProvider } from '../state/OrientationContext';
import { SyncProvider } from '../state/SyncContext';
import { TokenProvider } from '../state/TokenContext';

/**
 * 全局拦截应用内链接（href 以 '#/' 开头）走 react-router：
 * 原生 hash 导航产生的历史条目没有 router key（恒为 "default"），
 * 会让「按历史条目记滚动位置」互相串味；这里统一改为 navigate()。
 * 已由页面内处理器（正文互链 / 文件树抽屉）拦截的点击带 defaultPrevented，直接跳过。
 */
function useInternalLinkInterception(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const locationKey = keyFromLocation(location);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // 保留新窗口/新标签打开
      const target = e.target as Element | null;
      const link = target?.closest?.('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('#/')) return; // 只管应用内路由链接（外链/锚点/死链不碰）
      e.preventDefault();
      rememberScroll(locationKey, window.scrollY);
      navigate(toRouterPath(href));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate, locationKey]);
}

export default function Shell() {
  useInternalLinkInterception();

  return (
    <TokenProvider>
      <SyncProvider>
        <OrientationProvider>
          <div className="shell">
            {/* ToastHost 先挂载：页面/同步的早期 effect 触发的提示也能被接收 */}
            <ToastHost />
            <OfflineBanner />
            <Outlet />
          </div>
        </OrientationProvider>
      </SyncProvider>
    </TokenProvider>
  );
}
