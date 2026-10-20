import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SETUP, goBackOrSettings, toRouterPath } from '../app/nav';
import HighlightsSection from '../components/HighlightsSection';
import SettingsHeader from '../components/SettingsHeader';
import { clearGlobalAppearance } from '../data/appearance';
import { listFilesMeta, storageEstimate, type FileMeta } from '../data/db';
import { clearGlobalMemorySettings } from '../data/memory';
import { clearAllLibraries } from '../data/repos';
import { bytesToText } from '../lib/format';
import { DATA_CLEARED_EVENT } from '../state/TabsContext';
import { useSync } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';
import { useDataSync } from '../sync/DataSyncContext';
import { clearDeviceId } from '../sync/device';
import '../styles/settings.css';

/** 设置 · 数据管理：高亮备份 / 存储统计 / 危险区。 */
export default function SettingsDataPage() {
  const navigate = useNavigate();
  const { clear } = useToken();
  const { lastSyncAt } = useSync();
  const { clearConfig: clearSyncConfigState } = useDataSync();

  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [metas, setMetas] = useState<FileMeta[] | null>(null);

  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // 存储统计：进入页面与每次同步完成后刷新。
  useEffect(() => {
    let cancelled = false;
    void storageEstimate().then(
      (s) => { if (!cancelled) setStorage(s); },
      () => {},
    );
    void listFilesMeta().then(
      (list) => { if (!cancelled) setMetas(list); },
      () => { if (!cancelled) setMetas([]); },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

  async function onClearAll() {
    if (clearing) return;
    if (!window.confirm('确定清除全部数据吗？将删除本机所有仓库的缓存、收藏、阅读进度、记忆训练数据、Token 与跨设备同步配置，且不可恢复。Neon 上已同步的数据不会被删除。')) return;
    setClearing(true);
    setClearError(null);
    try {
      await clearAllLibraries();
      clearGlobalAppearance();
      clearGlobalMemorySettings();
      clearSyncConfigState(); // 同时清 config/state 并同步 Provider 内存状态
      clearDeviceId();
      clear();
      window.dispatchEvent(new Event(DATA_CLEARED_EVENT));
      navigate(toRouterPath(SETUP));
    } catch {
      setClearError('清除失败，请重试');
      setClearing(false);
    }
  }

  const cachedCount = metas?.filter((m) => m.cached).length ?? 0;
  const uncachedCount = metas ? metas.length - cachedCount : 0;

  return (
    <main className="settings">
      <SettingsHeader
        title="数据管理"
        subtitle="当前仓库的缓存、阅读数据与备份；清除操作会清空全部仓库且不可恢复。"
        backLabel="返回"
        backAriaLabel="返回"
        onBack={() => goBackOrSettings(navigate)}
      />

      <HighlightsSection />

      <section className="settings-section" aria-labelledby="settings-storage-title">
        <h2 id="settings-storage-title">存储</h2>
        <p className="settings-note">
          {storage
            ? `已用 ${bytesToText(storage.usage)} / 配额 ${storage.quota > 0 ? bytesToText(storage.quota) : '未知'}`
            : '读取中…'}
        </p>
        <p className="settings-note">
          {metas ? `已缓存 ${cachedCount} 篇 / 未缓存 ${uncachedCount} 篇` : '统计中…'}
        </p>
      </section>

      <section className="settings-section settings-danger" aria-labelledby="settings-danger-title">
        <h2 id="settings-danger-title">危险区</h2>
        <p className="settings-note">清除本机所有仓库的缓存数据与 Token，并返回引导页；此操作不可恢复。</p>
        <button type="button" className="settings-danger-btn" onClick={() => void onClearAll()} disabled={clearing}>
          {clearing ? '清除中…' : '清除全部数据'}
        </button>
        {clearError && <p role="alert" className="settings-error">{clearError}</p>}
      </section>
    </main>
  );
}
