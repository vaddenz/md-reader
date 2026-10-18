import type { TreeEntry } from './db';

export type GitHubErrorKind = 'auth' | 'notfound' | 'ratelimit' | 'network' | 'unknown';

export class GitHubError extends Error {
  constructor(public kind: GitHubErrorKind, message: string, public status?: number, public resetAt?: number) {
    super(message);
    this.name = 'GitHubError';
  }
}

const API = 'https://api.github.com';

export class GitHubClient {
  constructor(private token: string) {}

  private async request(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(API + path, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      });
    } catch {
      throw new GitHubError('network', '网络不可用');
    }
    if (res.status === 401) throw new GitHubError('auth', 'Token 无效或已过期', 401);
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      throw new GitHubError('ratelimit', 'API 限流', 403, reset);
    }
    if (res.status === 404) throw new GitHubError('notfound', '仓库或文件不存在', 404);
    if (!res.ok) throw new GitHubError('unknown', `GitHub API 错误 ${res.status}`, res.status);
    return res;
  }

  async getUser(): Promise<{ login: string }> {
    return (await this.request('/user')).json();
  }
  async getRepo(owner: string, repo: string): Promise<{ default_branch: string }> {
    return (await this.request(`/repos/${owner}/${repo}`)).json();
  }
  async getTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
    const res = await this.request(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const data = await res.json();
    if (data.truncated) throw new GitHubError('unknown', '仓库目录树过大（truncated）');
    return (data.tree as TreeEntry[]).filter((e) => e.type === 'blob');
  }
  async getBlobText(owner: string, repo: string, sha: string): Promise<string> {
    return (await this.request(`/repos/${owner}/${repo}/git/blobs/${sha}`, 'application/vnd.github.raw')).text();
  }
  async getBlobBytes(owner: string, repo: string, sha: string): Promise<Blob> {
    return (await this.request(`/repos/${owner}/${repo}/git/blobs/${sha}`, 'application/vnd.github.raw')).blob();
  }
}
