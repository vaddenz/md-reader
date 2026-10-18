import { useSync } from '../state/SyncContext';
import '../styles/sync-badge.css';

/** 同步状态徽标：状态点（灰=空闲 / 蓝转=同步中 / 红=错误 / 橙=离线）+「上次同步 X」+「更新目录」按钮。 */
export default function SyncBadge() {
  const { status, progress, lastSyncAt, error, syncNow, timeAgo } = useSync();
  const syncing = status === 'syncing';

  let text: string;
  if (syncing) {
    text = progress?.phase === 'download' ? `同步中 ${progress.done}·共 ${progress.total}` : '同步中…';
  } else if (status === 'offline') {
    text = lastSyncAt ? `离线 · 上次同步 ${timeAgo(lastSyncAt)}` : '离线';
  } else if (status === 'error') {
    text = '同步失败';
  } else {
    text = lastSyncAt ? `上次同步 ${timeAgo(lastSyncAt)}` : '尚未同步';
  }

  return (
    <div className="sync-badge">
      <button
        type="button"
        className="sync-badge-status"
        title={status === 'error' ? error?.message : undefined}
        onClick={() => void syncNow()}
        aria-label={`同步状态：${text}；点按立即同步`}
      >
        <span className={`sync-dot sync-dot-${status}`} aria-hidden="true" />
        <span className="sync-badge-text">{text}</span>
      </button>

      <button type="button" className="sync-refresh" onClick={() => void syncNow()} disabled={syncing}>
        <svg
          className={syncing ? 'sync-icon sync-spin' : 'sync-icon'}
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" d="M20 12 A8 8 0 1 1 12 4" />
          <path fill="currentColor" d="M12 1.8 15.6 4 12 6.2Z" />
        </svg>
        更新目录
      </button>
    </div>
  );
}
