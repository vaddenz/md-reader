import { useRef } from 'react';
import { exportHighlights, importHighlights } from '../data/highlights';
import { showToast } from '../lib/toast';

/** 设置页「高亮数据」区（spec §5.5）：导出 JSON / 导入合并。 */
export default function HighlightsSection() {
  const fileRef = useRef<HTMLInputElement>(null);

  const onExport = async () => {
    try {
      const json = await exportHighlights();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `md-reader-highlights-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('导出失败', { kind: 'error' });
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const { imported, skipped } = await importHighlights(await file.text());
      showToast(`导入 ${imported} 条（跳过重复 ${skipped} 条）`);
    } catch (err) {
      showToast(err instanceof Error ? `导入失败：${err.message}` : '导入失败', { kind: 'error' });
    }
  };

  return (
    <section className="settings-section" aria-labelledby="settings-highlights-title">
      <h2 id="settings-highlights-title">高亮数据</h2>
      <p className="settings-note">高亮仅存本机；导出 JSON 备份可应对清缓存与换机。</p>
      <p className="settings-sync-row">
        <button type="button" onClick={() => void onExport()}>导出高亮</button>
        <button type="button" onClick={() => fileRef.current?.click()}>导入高亮</button>
      </p>
      <input
        ref={fileRef} type="file" accept="application/json,.json" hidden
        aria-label="导入高亮文件"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImportFile(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}
