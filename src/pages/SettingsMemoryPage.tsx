import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrSettings } from '../app/nav';
import SettingsHeader from '../components/SettingsHeader';
import LlmConfigForm from '../components/memory/LlmConfigForm';
import MemoryChips from '../components/memory/MemoryChips';
import {
  SESSION_SIZE_CHOICES, getLlmConfig, getSelection, saveLlmConfig, saveSelection,
  type LlmConfig, type MemorySelection,
} from '../data/memory';
import { showToast } from '../lib/toast';
import '../styles/settings.css';
import '../styles/memory.css';

/** 设置 · 记忆助手：训练题量 / 每日新题 / AI 评分模型（数据均只在本机）。 */
export default function SettingsMemoryPage() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<MemorySelection | null>(null);
  const [llm, setLlm] = useState<LlmConfig | undefined>();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getSelection(), getLlmConfig()]).then(
      ([sel, cfg]) => {
        if (cancelled) return;
        setSelection(sel);
        setLlm(cfg);
      },
      () => { if (!cancelled) showToast('读取记忆设置失败', { kind: 'error' }); },
    );
    return () => { cancelled = true; };
  }, []);

  const updateSelection = (next: MemorySelection) => {
    setSelection(next);
    void saveSelection(next).catch(() => showToast('训练设置保存失败', { kind: 'error' }));
  };

  return (
    <main className="settings">
      <SettingsHeader
        title="记忆助手"
        subtitle="训练题量、每日新题与 AI 评分模型；仅影响记忆助手。"
        backLabel="返回"
        backAriaLabel="返回"
        onBack={() => goBackOrSettings(navigate)}
      />

      <section className="settings-section" aria-labelledby="settings-memory-training-title">
        <h2 id="settings-memory-training-title">训练设置</h2>
        {selection ? (
          <div className="memory-filters">
            <MemoryChips
              label="每次题量"
              options={SESSION_SIZE_CHOICES.map((n) => ({ value: String(n), label: n === 0 ? '不限' : String(n) }))}
              selected={[String(selection.sessionSize)]}
              onToggle={(v) => updateSelection({ ...selection, sessionSize: Number(v) })}
              single
            />
            <div className="memory-row">
              <span className="memory-row-label">每日新题</span>
              <input
                type="number" min={0} max={50}
                value={selection.newPerDay}
                aria-label="每日新题上限"
                onChange={(e) => {
                  const n = Math.min(50, Math.max(0, Math.round(Number(e.target.value) || 0)));
                  updateSelection({ ...selection, newPerDay: n });
                }}
              />
              <span className="memory-unit">题</span>
            </div>
            <p className="settings-note">改动立即保存，并在下次开始训练时生效。</p>
          </div>
        ) : (
          <p className="settings-note">读取中…</p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="settings-memory-llm-title">
        <h2 id="settings-memory-llm-title">模型设置（AI 评分）</h2>
        <LlmConfigForm
          cfg={llm}
          onChange={(next) => {
            setLlm(next);
            void saveLlmConfig(next).catch(() => showToast('模型设置保存失败', { kind: 'error' }));
          }}
        />
      </section>
    </main>
  );
}
