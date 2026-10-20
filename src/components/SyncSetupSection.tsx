import { useState } from 'react';
import { NEON_SETUP_SQL, NEON_SETUP_STEPS } from '../sync/backends/neonSetup';

export default function SyncSetupSection() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(NEON_SETUP_SQL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 用户可手动选择复制。
    }
  };

  return (
    <section className="settings-section" aria-labelledby="settings-sync-setup-title">
      <h2 id="settings-sync-setup-title">Neon 初始化</h2>
      <details className="sync-setup">
        <summary>如何配置 Neon Data API</summary>
        <ol className="sync-setup-steps">
          {NEON_SETUP_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <div className="sync-sql-head">
          <span>初始化 SQL</span>
          <button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button>
        </div>
        <pre className="sync-sql"><code>{NEON_SETUP_SQL}</code></pre>
        <p className="settings-note">
          详细步骤见仓库 <code>docs/sync-neon-setup.md</code>。JWT 是 bearer token，请只保存在本机。
        </p>
      </details>
    </section>
  );
}
