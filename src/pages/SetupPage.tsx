import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HOME, toRouterPath } from '../app/nav';
import { DEFAULT_REPO } from '../constants';
import { kvGet, kvSet } from '../data/db';
import { GitHubClient, GitHubError } from '../data/github';
import { AUTH_EXPIRED_TEXT } from '../lib/errors';
import { useToken } from '../state/TokenContext';

function errorText(err: GitHubError): string {
  switch (err.kind) {
    case 'auth': return 'Token 无效或已过期';
    case 'network': return '网络不可用';
    default: return `验证失败（${err.kind}）：${err.message}`;
  }
}

export default function SetupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reauth = searchParams.get('reauth') === '1';
  const { setToken } = useToken();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!token) {
      setError('请先粘贴 Token');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await new GitHubClient(token).getUser();
      setToken(token);
      if (!(await kvGet('config'))) await kvSet('config', DEFAULT_REPO);
      navigate(toRouterPath(HOME));
    } catch (err) {
      setError(err instanceof GitHubError ? errorText(err) : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1>配置访问 Token</h1>
      {reauth && (
        <p
          role="status"
          className="setup-reauth"
          style={{
            padding: '10px 12px',
            border: '1px solid #d4a72c',
            borderRadius: 8,
            background: '#fff8c5',
            color: '#7d4e00',
          }}
        >
          {AUTH_EXPIRED_TEXT}
        </p>
      )}
      <p>
        本应用通过你本人的 GitHub <strong>Fine-grained PAT</strong>（细粒度个人访问令牌）读取私有仓库内容，
        Token 仅保存在本机浏览器中，不会上传到任何第三方。
      </p>

      <h2>创建步骤</h2>
      <ol>
        <li>
          打开 GitHub，依次进入 <code>Settings → Developer settings → Personal access tokens → Fine-grained tokens</code>，
          点击 <code>Generate new token</code>。
        </li>
        <li>
          <code>Repository access</code> 选择 <code>Only select repositories</code>，勾选{' '}
          <code>{DEFAULT_REPO.owner}/{DEFAULT_REPO.repo}</code>。
        </li>
        <li>
          <code>Permissions → Repository permissions → Contents</code> 设为 <code>Read-only</code>（其余权限保持 No access）；
          有效期按需设置（建议 90 天）。
        </li>
        <li>点击 <code>Generate token</code> 并复制，粘贴到下方输入框，点击「验证并保存」。</li>
      </ol>

      <form onSubmit={onSubmit}>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="粘贴 Fine-grained PAT"
          aria-label="GitHub Token"
          autoComplete="off"
          disabled={busy}
          style={{ width: '100%', padding: 8 }}
        />
        <button type="submit" disabled={busy} style={{ marginTop: 8, padding: '6px 16px' }}>
          {busy ? '验证中…' : '验证并保存'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ color: '#b42318' }}>
          {error}
        </p>
      )}

      <footer style={{ marginTop: 24, fontSize: 14, color: '#57606a' }}>
        本应用仅供个人自用（非通用 Markdown 阅读器）。
      </footer>
    </main>
  );
}
