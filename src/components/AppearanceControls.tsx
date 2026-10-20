import {
  FONT_SIZE_RANGE, FONT_WEIGHTS, SCALE_RANGE, type FontChoice, type ReaderAppearance,
} from '../data/appearance';
import '../styles/appearance.css';

const FONT_OPTIONS: { id: FontChoice; label: string }[] = [
  { id: 'system', label: '系统默认' },
  { id: 'xihei', label: '等线（霞鹜新晰黑）' },
  { id: 'serif', label: '宋体（思源宋体）' },
];

const WEIGHT_LABELS: Record<(typeof FONT_WEIGHTS)[number], string> = {
  300: '细', 400: '常规', 500: '中粗', 600: '粗体',
};

const WEIGHT_OPTIONS = FONT_WEIGHTS.map((w) => ({ w, label: WEIGHT_LABELS[w] }));

interface Props {
  value: ReaderAppearance;
  onChange: (next: ReaderAppearance) => void;
}

/** 阅读外观控件组（字体/字号/字重/表格与引用比例）：设置页外观区与阅读内面板共用（单源）。 */
export default function AppearanceControls({ value, onChange }: Props) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <div className="appearance-row" role="radiogroup" aria-label="正文字体">
        {FONT_OPTIONS.map((o) => (
          <label key={o.id} className="appearance-radio">
            <input
              type="radio" name="appearance-font" checked={value.fontFamily === o.id}
              onChange={() => onChange({ ...value, fontFamily: o.id })}
            />
            {o.label}
          </label>
        ))}
      </div>
      <label className="appearance-slider">
        正文字号 <output>{value.fontSize}px</output>
        <input type="range" min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} step={1} value={value.fontSize}
          onChange={(e) => onChange({ ...value, fontSize: Number(e.target.value) })} />
      </label>
      <div className="appearance-row" role="radiogroup" aria-label="字体粗细">
        {WEIGHT_OPTIONS.map((o) => (
          <label key={o.w} className="appearance-radio">
            <input
              type="radio" name="appearance-weight" checked={value.fontWeight === o.w}
              onChange={() => onChange({ ...value, fontWeight: o.w })}
            />
            {o.label}
          </label>
        ))}
      </div>
      <label className="appearance-slider">
        表格字号比例 <output>{pct(value.tableScale)}</output>
        <input type="range" min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} value={value.tableScale}
          onChange={(e) => onChange({ ...value, tableScale: Number(e.target.value) })} />
      </label>
      <label className="appearance-slider">
        引用字号比例 <output>{pct(value.quoteScale)}</output>
        <input type="range" min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={0.05} value={value.quoteScale}
          onChange={(e) => onChange({ ...value, quoteScale: Number(e.target.value) })} />
      </label>
    </>
  );
}
