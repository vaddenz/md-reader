/** 记忆助手筛选/题量胶囊组（记忆概览与设置页训练设置共用）。 */
interface Props {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  single?: boolean;
}

export default function MemoryChips({ label, options, selected, onToggle, single }: Props) {
  return (
    <div className="memory-row">
      <span className="memory-row-label">{label}</span>
      <div className="memory-chips" role={single ? 'radiogroup' : 'group'} aria-label={label}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role={single ? 'radio' : 'checkbox'}
              aria-checked={on}
              className={on ? 'memory-chip memory-chip-on' : 'memory-chip'}
              onClick={() => onToggle(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
