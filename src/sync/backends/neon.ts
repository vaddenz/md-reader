import { SyncError, type RemoteRecord, type SyncBackend, type SyncBackendDefinition, type SyncRecord, type TestResult } from '../types';

const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 500;

interface NeonConfig { endpoint: string; token: string }

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseServerTimestamp(value: unknown): number {
  const text = String(value ?? '').trim();
  // PostgREST 的 timestamptz 可能带微秒（6 位小数），Date.parse 只保证毫秒精度；先截断到 3 位。
  const ms = Date.parse(text.replace(/(\.\d{3})\d+/, '$1'));
  if (!Number.isFinite(ms)) throw new SyncError('parse', '服务器时间戳格式异常');
  return ms;
}

export class NeonBackend implements SyncBackend {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(config: NeonConfig) {
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.token = config.token.trim();
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      ...(extra ?? {}),
    };
  }

  private async request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      let res: Response;
      try {
        res = await fetch(`${this.endpoint}${path}`, {
          ...init,
          headers: this.headers(init.headers as Record<string, string> | undefined),
          signal: controller.signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new SyncError('network', '网络不可用，或 Neon CORS 未允许当前站点');
      }
      if (res.status === 401 || res.status === 403) throw new SyncError('auth', 'JWT 无效、已过期或没有权限', res.status);
      if (res.status === 404) throw new SyncError('notfound', '同步表不存在，请先执行初始化 SQL', 404);
      if (res.status >= 500) throw new SyncError('server', `Neon 服务端错误 ${res.status}`, res.status);
      if (!res.ok) throw new SyncError('server', `请求失败 ${res.status}`, res.status);
      return res;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async test(signal?: AbortSignal): Promise<TestResult> {
    const payload = decodeJwtPayload(this.token);
    if (!payload) throw new SyncError('config', 'JWT 格式不正确');
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new SyncError('config', 'JWT 缺少 sub');
    if (payload.role !== 'authenticated') {
      throw new SyncError('config', 'JWT 缺少 role=authenticated（Data API 需要它选择数据库角色）');
    }
    let warning: string | undefined;
    if (typeof payload.exp === 'number') {
      const left = payload.exp * 1000 - Date.now();
      if (left <= 0) throw new SyncError('auth', 'JWT 已过期');
      if (left < 30 * 86400_000) warning = `JWT 将在 ${Math.ceil(left / 86400_000)} 天后到期`;
    }

    await this.request('/sync_records?select=scope&limit=1', {}, signal);
    const probe: SyncRecord = {
      scope: '__probe__', collection: '__probe__', recordId: 'probe', payload: null,
      updatedAt: 0, deleted: true, deviceId: '__probe__',
    };
    await this.request('/rpc/sync_upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_records: [{
          scope: probe.scope,
          collection: probe.collection,
          record_id: probe.recordId,
          payload: probe.payload,
          updated_at: probe.updatedAt,
          deleted: probe.deleted,
          device_id: probe.deviceId,
        }],
      }),
    }, signal);
    try {
      await this.request('/sync_records?scope=eq.__probe__&collection=eq.__probe__&record_id=eq.probe', {
        method: 'DELETE',
      }, signal);
    } catch {
      // 探测行残留不会进入任何集合适配器；清理失败不影响连接判定。
    }
    return warning ? { warning } : {};
  }

  async pull(scope: string, since: number, signal?: AbortSignal): Promise<RemoteRecord[]> {
    const out: RemoteRecord[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const params = new URLSearchParams({
        select: 'collection,record_id,payload,updated_at,deleted,device_id,server_updated_at',
        scope: `eq.${scope}`,
        order: 'server_updated_at.asc,collection.asc,record_id.asc',
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (since > 0) params.set('server_updated_at', `gte.${new Date(since).toISOString()}`);
      const res = await this.request(`/sync_records?${params.toString()}`, {}, signal);
      let rows: unknown;
      try { rows = await res.json(); } catch { throw new SyncError('parse', '响应不是合法 JSON'); }
      if (!Array.isArray(rows)) throw new SyncError('parse', '响应格式异常');
      for (const row of rows as Record<string, unknown>[]) {
        const serverUpdatedAt = parseServerTimestamp(row.server_updated_at);
        out.push({
          scope,
          collection: String(row.collection ?? ''),
          recordId: String(row.record_id ?? ''),
          payload: row.payload ?? null,
          updatedAt: typeof row.updated_at === 'number' ? row.updated_at : 0,
          deleted: row.deleted === true,
          deviceId: String(row.device_id ?? ''),
          serverUpdatedAt,
        });
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  async push(records: readonly SyncRecord[], signal?: AbortSignal): Promise<void> {
    const seen = new Set<string>();
    const unique = records.filter((r) => {
      const key = `${r.scope}\u0000${r.collection}\u0000${r.recordId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await this.request('/rpc/sync_upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_records: unique.map((r) => ({
          scope: r.scope,
          collection: r.collection,
          record_id: r.recordId,
          payload: r.payload,
          updated_at: r.updatedAt,
          deleted: r.deleted,
          device_id: r.deviceId,
        })),
      }),
    }, signal);
  }
}

export const neonDefinition: SyncBackendDefinition = {
  type: 'neon',
  label: 'Neon Postgres Data API',
  description: '使用你自己的 Neon Data API 地址与长期 JWT；数据存储在你自己的 Postgres。',
  fields: [
    {
      key: 'endpoint', label: '接口地址', type: 'url', required: true,
      placeholder: 'https://ep-xxx.apirest.region.aws.neon.tech/neondb/rest/v1',
      help: 'Neon Console → Data API 页面显示的 API URL。',
    },
    {
      key: 'token', label: 'JWT', type: 'password', required: true,
      placeholder: '粘贴长期 JWT',
      help: '只保存在本机浏览器；只写入 Authorization 请求头。',
    },
  ],
  validate(values) {
    const endpoint = values.endpoint?.trim() ?? '';
    const token = values.token?.trim() ?? '';
    if (!endpoint) return '请填写接口地址';
    if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/localhost(:\d+)?\//i.test(endpoint)) return '接口地址必须是 https://（本地开发可用 http://localhost）';
    if (!token) return '请填写 JWT';
    return null;
  },
  create(values) {
    return new NeonBackend({ endpoint: values.endpoint, token: values.token });
  },
};
