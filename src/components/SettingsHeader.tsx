/** 设置页共用页头：返回入口 + 页面标题（+ 可选说明）。 */
interface Props {
  title: string;
  /** 返回按钮可见文字。设置首页回来源页，二级页回设置首页。 */
  backLabel: string;
  backAriaLabel: string;
  onBack(): void;
  subtitle?: string;
}

export default function SettingsHeader({ title, backLabel, backAriaLabel, onBack, subtitle }: Props) {
  return (
    <header className="settings-head">
      <button type="button" className="settings-back" aria-label={backAriaLabel} onClick={onBack}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            d="M14.5 5 7.5 12l7 7"
          />
        </svg>
        {backLabel}
      </button>
      <h1 className="settings-title">{title}</h1>
      {subtitle && <p className="settings-lede">{subtitle}</p>}
    </header>
  );
}
