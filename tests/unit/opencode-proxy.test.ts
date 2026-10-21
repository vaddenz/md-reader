import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { corsHeaders, upstreamUrl, type Env } from '../../packages/opencode-proxy/src/index';

const ORIGIN = 'https://vaddenz.github.io';
const PATH = '/opencode/v1/chat/completions';

function call(path: string, init: RequestInit & { origin?: string } = {}, env: Env = {}) {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set('Origin', init.origin);
  const request = new Request(`https://worker.example${path}`, { ...init, headers });
  return worker.fetch(request, env);
}

function mockUpstream() {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"ok":true}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('upstreamUrl / corsHeaders', () => {
  it('只映射 /opencode 前缀，其余返回 null', () => {
    expect(upstreamUrl('https://opencode.ai/inference/go/openai', '/opencode/v1/chat/completions', '?a=1'))
      .toBe('https://opencode.ai/inference/go/openai/v1/chat/completions?a=1');
    expect(upstreamUrl('https://up.example/', '/opencode', '')).toBe('https://up.example');
    expect(upstreamUrl('https://up.example', '/v1/chat/completions', '')).toBeNull();
    expect(upstreamUrl('https://up.example', '/opencodeish/v1', '')).toBeNull();
  });

  it('通配与白名单两种 CORS 策略', () => {
    expect(corsHeaders(ORIGIN, '*')).toMatchObject({ 'Access-Control-Allow-Origin': '*' });
    expect(corsHeaders(ORIGIN, `https://a.example, ${ORIGIN}`)).toMatchObject({
      'Access-Control-Allow-Origin': ORIGIN,
      Vary: 'Origin',
    });
    expect(corsHeaders('https://evil.example', ORIGIN)).toBeNull();
    expect(corsHeaders(null, ORIGIN)).toBeNull();
  });
});

describe('Worker 转发', () => {
  it('预检返回 204 且允许会话头', async () => {
    const res = await call(PATH, { method: 'OPTIONS', origin: ORIGIN });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('x-opencode-session');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('转发路径、鉴权、UA 与会话头，不转发 Origin', async () => {
    const fetchMock = mockUpstream();
    const body = JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [] });
    const res = await call(`${PATH}?trace=1`, {
      method: 'POST',
      origin: ORIGIN,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer oc_sk_test',
        'x-opencode-session': 'ses_keepme',
      },
      body,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions?trace=1');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer oc_sk_test');
    expect(headers.get('user-agent')).toBe('opencode/latest/2.1.1/cli');
    expect(headers.get('x-opencode-client')).toBe('cli');
    expect(headers.get('x-opencode-session')).toBe('ses_keepme');
    expect(headers.get('origin')).toBeNull();
    expect(await new Response(init.body).text()).toBe(body);

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.text()).toBe('{"ok":true}');
  });

  it('客户端没带会话头时兜底生成一个', async () => {
    const fetchMock = mockUpstream();
    await call(PATH, { method: 'POST', origin: ORIGIN, body: '{}' });
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('x-opencode-session')).toMatch(/^ses_[0-9A-Za-z]{26}$/);
  });

  it('来源不被允许时 403 且不发起上游请求', async () => {
    const fetchMock = mockUpstream();
    const res = await call(PATH, { method: 'POST', origin: 'https://evil.example', body: '{}' }, {
      ALLOWED_ORIGINS: ORIGIN,
    });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('白名单命中时回显来源并带 Vary', async () => {
    mockUpstream();
    const res = await call(PATH, { method: 'POST', origin: ORIGIN, body: '{}' }, { ALLOWED_ORIGINS: ORIGIN });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('前缀外 404、方法不支持 405', async () => {
    expect((await call('/v1/chat/completions', { method: 'POST', origin: ORIGIN, body: '{}' })).status).toBe(404);
    expect((await call(PATH, { method: 'PUT', origin: ORIGIN, body: '{}' })).status).toBe(405);
  });

  it('透传 SSE：响应体原样流给浏览器，内容类型不变', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"score\\":80}"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));
    const res = await call(PATH, { method: 'POST', origin: ORIGIN, body: '{}' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('"reasoning_content":"想"');
    expect(text).toContain('data: [DONE]');
  });

  it('上游不可达返回 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('boom'); }));
    const res = await call(PATH, { method: 'POST', origin: ORIGIN, body: '{}' });
    expect(res.status).toBe(502);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
