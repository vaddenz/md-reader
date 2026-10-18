import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOME } from '../app/nav';
import { DEFAULT_REPO } from '../constants';
import { kvGet, kvSet } from '../data/db';
import { GitHubClient, GitHubError } from '../data/github';
import { useToken } from '../state/TokenContext';

// HashRouter 的 navigate() 接收的是「路由路径」（不含 '#'）；HOME 常量是给 <a href> 用的完整 hash。
// 直接传 HOME 会被 react-router 解析成 URL 片段（URL 变成 #/setup#/），故去掉前导 '#'。
const HOME_PATH = HOME.slice(1);

function errorText(err: GitHubError): string {
  switch (err.kind) {
    case 'auth': return 'Token 无效或已过期';
    case 'network': return '网络不可用';
    default: return `验证失败（${err.kind}）：${err.message}`;
  }
}

export default function SetupPage() {
  const navigate = useNavigate();
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
      navigate(HOME_PATH);
    } catch (err) {
      setError(err instanceof GitHubError ? errorText(err) : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1>配置访问 Token</h1>
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
