import { useEffect, useRef, useState } from 'react';
import {
  appearanceStyle, DEFAULT_APPEARANCE, getAppearance, saveAppearance, type ReaderAppearance,
} from '../data/appearance';
import { showToast } from '../lib/toast';
import AppearanceControls from './AppearanceControls';

/** 设置页「阅读外观」区：共享外观控件 + 实时预览（spec §3.3；控件组见 AppearanceControls）。 */
export default function AppearanceSection() {
  const [a, setA] = useState<ReaderAppearance>(DEFAULT_APPEARANCE);
  const timer = useRef(0);
  const pending = useRef<ReaderAppearance | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAppearance().then((v) => { if (!cancelled) setA(v); });
    return () => { cancelled = true; };
  }, []);

  const flush = () => {
    const v = pending.current;
    if (!v) return;
    pending.current = null;
    void saveAppearance(v).catch(() => showToast('外观设置保存失败', { kind: 'error' }));
  };
  // 卸载时冲刷未落盘的防抖写（否则 300ms 内离开页面会丢最后一次修改）。
  useEffect(() => () => { window.clearTimeout(timer.current); flush(); }, []);

  const update = (next: ReaderAppearance) => {
    setA(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  };

  return (
    <section className="settings-section" aria-labelledby="settings-appearance-title">
      <h2 id="settings-appearance-title">阅读外观</h2>
      <AppearanceControls value={a} onChange={update} />
      <div className="doc-content appearance-preview" style={appearanceStyle(a)} aria-label="外观预览">
        <p>预览：正文段落与 <code>行内代码</code>、<a href="#" tabIndex={-1} onClick={(e) => e.preventDefault()}>链接</a> 的显示效果。</p>
        <blockquote><p>引用块预览文本。</p></blockquote>
        <table>
          <thead><tr><th>列 A</th><th>列 B</th></tr></thead>
          <tbody><tr><td>表格文本</td><td>示例</td></tr></tbody>
        </table>
      </div>
      <p className="settings-note"><a href="#/font-preview">字体并排样张对比 →</a></p>
    </section>
  );
}
