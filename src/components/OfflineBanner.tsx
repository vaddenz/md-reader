import { useOnline } from '../hooks/useOnline';
import { useSync } from '../state/SyncContext';
import '../styles/offline-banner.css';

/**
 * 离线横幅（T22）：离线时在页面顶部显示「离线模式 · 上次同步 X」。
 * 恢复在线后自动隐藏；恢复在线触发的一次同步由 SyncContext 的在线翻转效应负责，此处不重复触发。
 */
export default function OfflineBanner() {
  const online = useOnline();
  const { lastSyncAt, timeAgo } = useSync();
  if (online) return null;

  return (
    <div className="offline-banner" role="status">
      {lastSyncAt ? `离线模式 · 上次同步 ${timeAgo(lastSyncAt)}` : '离线模式 · 尚未同步'}
    </div>
  );
}
