// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { neonDefinition } from '../../src/sync/backends/neon';
import type { SyncRecord } from '../../src/sync/types';

const values = { endpoint: 'https://sync.example/rest/v1/', token: 'a.b.c' };

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function jwt(payload: Record<string, unknown>): string {
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('neon backend', () => {
  it('test：解码 sub、读表、写探测、删除探测', async () => {
    const calls: string[] = [];
    const token = jwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 90 * 86400 });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    const result = await backend.test();
    expect(result.warning).toBeUndefined();
    expect(calls[0]).toContain('GET https://sync.example/rest/v1/sync_records');
    expect(calls[1]).toContain('POST https://sync.example/rest/v1/rpc/sync_upsert');
    expect(calls[2]).toContain('DELETE https://sync.example/rest/v1/sync_records');
  });

  it('test：JWT 30 天内到期返回 warning 但继续', async () => {
    const token = jwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 86400 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    const result = await backend.test();
    expect(result.warning).toMatch(/天后到期/);
  });

  it('test：JWT 缺少 sub 抛 config 错误；401 抛 auth', async () => {
    const noSub = neonDefinition.create({ endpoint: values.endpoint, token: jwt({ exp: 9999999999 }) });
    await expect(noSub.test()).rejects.toMatchObject({ kind: 'config' });

    const token = jwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) + 86400 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    await expect(backend.test()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('pull：分页拼接、解析 server_updated_at、scope 编码', async () => {
    // 第一页必须正好 500 条才会触发第二页。
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      collection: 'reading.progress', record_id: `p${i}`, payload: { ratio: i }, updated_at: i,
      deleted: false, device_id: 'd', server_updated_at: '2026-10-20T00:00:00.000Z',
    }));
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(seen.length === 1 ? page1 : []), { status: 200 });
    }));
    const token = jwt({ sub: 'md-reader' });
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    const rows = await backend.pull('VaddenZ/Notes@main', 0);
    expect(rows).toHaveLength(500);
    expect(rows[0].serverUpdatedAt).toBe(Date.parse('2026-10-20T00:00:00.000Z'));
    expect(seen[0]).toContain('scope=eq.VaddenZ%2FNotes%40main');
    expect(seen[1]).toContain('offset=500');
  });

  it('pull：since > 0 时带 server_updated_at 过滤；since = 0 不带', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify([]), { status: 200 });
    }));
    const backend = neonDefinition.create({ endpoint: values.endpoint, token: jwt({ sub: 'md-reader' }) });
    const since = Date.parse('2026-10-19T00:00:00.000Z');
    await backend.pull('s', since);
    expect(seen[0]).toContain(`server_updated_at=gte.${encodeURIComponent(new Date(since).toISOString())}`);
    await backend.pull('s', 0);
    expect(seen[1]).not.toContain('server_updated_at=');
  });

  it('错误映射：过期 JWT => auth，网络失败 => network，非法 JSON => parse', async () => {
    const expired = neonDefinition.create({
      endpoint: values.endpoint,
      token: jwt({ sub: 'md-reader', exp: Math.floor(Date.now() / 1000) - 1 }),
    });
    await expect(expired.test()).rejects.toMatchObject({ kind: 'auth' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const offline = neonDefinition.create({ endpoint: values.endpoint, token: jwt({ sub: 'md-reader' }) });
    await expect(offline.pull('s', 0)).rejects.toMatchObject({ kind: 'network' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(offline.pull('s', 0)).rejects.toMatchObject({ kind: 'parse' });
  });

  it('push：RPC body 使用 p_records，按主键去重', async () => {
    let body: { p_records: SyncRecord[] } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    }));
    const token = jwt({ sub: 'md-reader' });
    const backend = neonDefinition.create({ endpoint: values.endpoint, token });
    const rec = (id: string): SyncRecord => ({
      scope: 'a/b@main', collection: 'reading.progress', recordId: id, payload: null,
      updatedAt: 1, deleted: true, deviceId: 'd',
    });
    await backend.push([rec('x'), rec('x'), rec('y')]);
    expect(body!.p_records).toHaveLength(2);
  });
});
