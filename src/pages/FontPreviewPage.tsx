import { useEffect, useState } from 'react';
import { FONT_STACKS, DEFAULT_APPEARANCE, appearanceStyle, getAppearance, type ReaderAppearance } from '../data/appearance';
import '../styles/settings.css';

const SAMPLES: { id: keyof typeof FONT_STACKS; label: string }[] = [
  { id: 'system', label: '系统默认' },
  { id: 'xihei', label: '等线（霞鹜新晰黑·屏幕版）' },
  { id: 'serif', label: '宋体（思源宋体）' },
];

/** 字体定稿确认用样张页（spec §3.4）；不在主导航，设置页进入。 */
export default function FontPreviewPage() {
  const [base, setBase] = useState<ReaderAppearance>(DEFAULT_APPEARANCE);
  useEffect(() => {
    let cancelled = false;
    void getAppearance().then((v) => { if (!cancelled) setBase(v); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="settings">
      <a className="settings-back" href="#/settings">← 返回设置</a>
      <h1 className="settings-title">字体样张</h1>
      {SAMPLES.map((s) => (
        <section key={s.id} className="font-sample">
          <h2>{s.label}</h2>
          <div className="doc-content" style={appearanceStyle({ ...base, fontFamily: s.id })}>
            <h2>标题样张 Heading</h2>
            <p>这是一段用于对比的正文字样：MVCC 与版本可见性、中文标点，与 <code>inline code</code> 混排。</p>
            <blockquote><p>引用块样张：紧凑排版下的阅读效果。</p></blockquote>
            <table><thead><tr><th>列 A</th><th>列 B</th></tr></thead><tbody><tr><td>表格文本</td><td>示例</td></tr></tbody></table>
          </div>
        </section>
      ))}
    </main>
  );
}
