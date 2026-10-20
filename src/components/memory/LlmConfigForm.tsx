import { useEffect, useRef, useState } from 'react';
import { LlmError, isLlmConfigured, testConnection } from '../../data/llm';
import type { LlmConfig } from '../../data/memory';
import { showToast } from '../../lib/toast';

const EMPTY: LlmConfig = { baseUrl: '', apiKey: '', model: '' };

function errorText(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  return err instanceof Error ? err.message : '连接失败';
}

/** 模型设置字段（spec §9）：由设置 › 记忆助手页包进分组卡。
 *  保存只在通过校验后进行；测试连接复用同一配置。
 *  cfg 异步到达时不覆盖用户正在输入的草稿（dirty 后仅「保存」会重置）。 */
export default function LlmConfigForm(props: { cfg: LlmConfig | undefined; onChange: (cfg: LlmConfig) => void }) {
  const [draft, setDraft] = useState<LlmConfig>(props.cfg ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => { if (props.cfg && !dirtyRef.current) setDraft(props.cfg); }, [props.cfg]);

  const edit = (patch: Partial<LlmConfig>) => {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  const onSave = () => {
    if (!isLlmConfigured(draft)) { showToast('请先完整填写 URL / Key / 模型名', { kind: 'error' }); return; }
    dirtyRef.current = false;
    props.onChange(draft);
    showToast('已保存');
  };

  const onTest = async () => {
    if (!isLlmConfigured(draft)) { showToast('请先完整填写 URL / Key / 模型名', { kind: 'error' }); return; }
    setBusy(true);
    try {
      await testConnection(draft);
      showToast('连接成功');
    } catch (err) {
      showToast(`连接失败：${errorText(err)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="memory-llm-form">
      <label className="memory-field">
        <span>Base URL</span>
        <input value={draft.baseUrl} placeholder="https://api.example.com/v1" autoComplete="off"
          onChange={(e) => edit({ baseUrl: e.target.value })} />
      </label>
      <label className="memory-field">
        <span>API Key</span>
        <input type="password" value={draft.apiKey} placeholder="仅存本机" autoComplete="off"
          onChange={(e) => edit({ apiKey: e.target.value })} />
      </label>
      <label className="memory-field">
        <span>模型名</span>
        <input value={draft.model} placeholder="如 deepseek-chat" autoComplete="off"
          onChange={(e) => edit({ model: e.target.value })} />
      </label>
      <div className="memory-actions" style={{ marginTop: 10 }}>
        <div className="memory-actions-row">
          <button type="button" className="memory-primary" disabled={busy} onClick={onSave}>保存</button>
          <button type="button" className="memory-secondary" disabled={busy} onClick={() => void onTest()}>
            {busy ? '测试中…' : '测试连接'}
          </button>
        </div>
      </div>
      <p className="memory-note">
        问答评分时会把题干、参考答案与你的作答发送到你填写的地址；Key 仅保存在本机。
        直连需服务端允许浏览器跨域（CORS），Ollama 需配置 <code>OLLAMA_ORIGINS</code>。
      </p>
    </div>
  );
}
