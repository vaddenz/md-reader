import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HOME, toRouterPath } from '../app/nav';
import { DEFAULT_REPO } from '../constants';
import { kvGet, kvSet } from '../data/db';
import { GitHubClient, GitHubError } from '../data/github';
import { AUTH_EXPIRED_TEXT, githubErrorText } from '../lib/errors';
import { useToken } from '../state/TokenContext';
import '../styles/setup.css';

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="8" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        d="M11.4 12h8.1M16.5 12v3M19.5 12v2.2"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M8.4 10V7.8a3.6 3.6 0 0 1 7.2 0V10" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 7.6v5.2" />
      <circle cx="12" cy="16.2" r="1" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="setup-guide-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
        d="m9.5 5.5 6.5 6.5-6.5 6.5"
      />
    </svg>
  );
}

/** 首次引导 / 重新授权：连接 GitHub，配置 Fine-grained PAT。 */
export default function SetupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reauth = searchParams.get('reauth') === '1';
  const { setToken } = useToken();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) {
      setError('请先粘贴 Token');
      inputRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await new GitHubClient(token).getUser();
      // 先落盘 config 再 setToken：SyncContext 的 [token] 效应在 render 后立即读取 config，
      // 顺序颠倒时首次自动同步可能读到空 config 而不触发（T9 竞态；T23 探针确定性复现）。
      if (!(await kvGet('config'))) await kvSet('config', DEFAULT_REPO);
      setToken(token);
      navigate(toRouterPath(HOME));
    } catch (err) {
      setError(err instanceof GitHubError ? githubErrorText(err) : '保存失败，请重试');
      // 等 busy 复位、输入框解除 disabled 后再聚焦（否则 focus 会被浏览器忽略）。
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup">
      <div className="setup-panel">
        <header className="setup-head">
          <img className="setup-mark" src="./favicon.svg" width="64" height="64" alt="" />
          <h1 className="setup-title">配置访问 Token</h1>
          <p className="setup-lede">
            连接私有 GitHub 仓库，把 Markdown 笔记变成一本随时可读的书。
          </p>
        </header>

        {reauth && (
          <p role="status" className="setup-reauth">
            <span className="setup-reauth-icon"><AlertIcon /></span>
            {AUTH_EXPIRED_TEXT}
          </p>
        )}

        <form className="setup-card setup-form" onSubmit={onSubmit}>
          <div className="setup-field-head">
            <label className="setup-label" htmlFor="setup-token">GitHub Token</label>
            <a
              className="setup-help-link"
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              创建 Token ↗
            </a>
          </div>

          <div className={`setup-input-wrap${error ? ' setup-input-invalid' : ''}`}>
            <span className="setup-input-icon"><KeyIcon /></span>
            <input
              id="setup-token"
              ref={inputRef}
              type={revealed ? 'text' : 'password'}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              placeholder="粘贴 Fine-grained PAT"
              aria-label="GitHub Token"
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
            />
            <button
              type="button"
              className="setup-reveal"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? '隐藏 Token' : '显示 Token'}
              disabled={busy}
            >
              {revealed ? '隐藏' : '显示'}
            </button>
          </div>

          <button type="submit" className="setup-submit" disabled={busy}>
            {busy ? '验证中…' : '验证并保存'}
          </button>

          {error && <p role="alert" className="setup-error">{error}</p>}

          <p className="setup-privacy">
            <LockIcon />
            Token 仅保存在本机浏览器，不会上传到任何第三方，也不会写入 URL 或日志。
          </p>
        </form>

        <details className="setup-card setup-guide" open={!reauth}>
          <summary className="setup-guide-summary">
            <span className="setup-guide-title">如何创建 Token</span>
            <span className="setup-guide-meta">Fine-grained PAT · Contents 只读</span>
            <ChevronIcon />
          </summary>

          <ol className="setup-steps">
            <li>
              <span className="setup-step-num" aria-hidden="true">1</span>
              <div className="setup-step-text">
                <p className="setup-step-title">打开 GitHub 令牌页面</p>
                <p className="setup-step-body">
                  依次进入 Settings → Developer settings → Personal access tokens → Fine-grained tokens，
                  点击 Generate new token。
                </p>
              </div>
            </li>
            <li>
              <span className="setup-step-num" aria-hidden="true">2</span>
              <div className="setup-step-text">
                <p className="setup-step-title">只授权这一个仓库</p>
                <p className="setup-step-body">
                  Repository access 选择 <code>Only select repositories</code>，勾选{' '}
                  <code>{DEFAULT_REPO.owner}/{DEFAULT_REPO.repo}</code>。
                </p>
              </div>
            </li>
            <li>
              <span className="setup-step-num" aria-hidden="true">3</span>
              <div className="setup-step-text">
                <p className="setup-step-title">把权限收到最小</p>
                <p className="setup-step-body">
                  Permissions → Contents 设为 <code>Read-only</code>，其余保持 No access；
                  有效期按需设置，建议 90 天。
                </p>
              </div>
            </li>
            <li>
              <span className="setup-step-num" aria-hidden="true">4</span>
              <div className="setup-step-text">
                <p className="setup-step-title">生成并粘贴</p>
                <p className="setup-step-body">
                  点击 Generate token 并复制，粘贴到上方输入框即可。
                </p>
              </div>
            </li>
          </ol>
        </details>

        <footer className="setup-footer">
          <span>个人自用 · 非通用 Markdown 阅读器</span>
          <span aria-hidden="true">·</span>
          <span>内容与凭据不出本机</span>
        </footer>
      </div>
    </main>
  );
}
