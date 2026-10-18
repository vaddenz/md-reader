import { useEffect, useRef, useState } from 'react';
import {
  appearanceStyle, DEFAULT_APPEARANCE, FONT_SIZE_RANGE, SCALE_RANGE,
  getAppearance, saveAppearance, type FontChoice, type ReaderAppearance,
} from '../data/appearance';
import { showToast } from '../lib/toast';

const FONT_OPTIONS: { id: FontChoice; label: string }[] = [
  { id: 'system', label: '系统默认' },
  { id: 'xihei', label: '等线（霞鹜新晰黑）' },
  { id: 'serif', label: '宋体（思源宋体）' },
];

/** 设置页「阅读外观」区：字体 / 正文字号 / 表格与引用比例 + 实时预览（spec §3.3）。 */
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

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <section className="settings-section" aria-labelledby="settings-appearance-title">
      <h2 id="settings-appearance-title">阅读外观</h2>
      <div className="appearance-row" role="radiogroup" aria-label="正文字体">
        {FONT_OPTIONS.map((o) => (
          <label key={o.id} className="appearance-radio">
            <input
              type="radio" name="appearance-font" checked={a.fontFamily === o.id}
              onChange={() => update({ ...a, fontFamily: o.id })}
            />
            {o.label}
          </label>
        ))}
      </div>
      <label className="appearance-slider">
        正文字号 <output>{a.fontSize}px</output>
        <input type="range" min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} step={1} value={a.fontSize}
          onChange={(e) => update({ ...a, fontSize: Number(e.target.value) })} />
      </label>
      <label className="appearance-slider">
        表格字号比例 <output>{pct(a.tableScale)}</output>
        <input type="range" min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} value={a.tableScale}
          onChange={(e) => update({ ...a, tableScale: Number(e.target.value) })} />
      </label>
      <label className="appearance-slider">
        引用字号比例 <output>{pct(a.quoteScale)}</output>
        <input type="range" min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} value={a.quoteScale}
          onChange={(e) => update({ ...a, quoteScale: Number(e.target.value) })} />
      </label>
      <div className="doc-content appearance-preview" style={appearanceStyle(a)} aria-label="外观预览">
        <p>预览：正文段落与 <code>行内代码</code>、<a href="#" tabIndex={-1} onClick={(e) => e.preventDefault()}>链接</a> 的显示效果。</p>
        <blockquote><p>引用块预览文本。</p></blockquote>
        <table>
          <thead><tr><th>列 A</th><th>列 B</th></tr></thead>
          <tbody><tr><td>表格文本</td><td>示例</td></tr></tbody>
        </table>
      </div>
    </section>
  );
}
