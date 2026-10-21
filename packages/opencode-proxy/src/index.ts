/**
 * OpenCode Go 代理（Cloudflare Worker）。
 *
 * md-reader 是纯前端 PWA，浏览器里有两件事做不到：
 * 1. 请求 opencode.ai 会被 CORS 拦截（预检直接 404，没有 Access-Control-* 头）；
 * 2. `User-Agent` 是 forbidden header，fetch 设置无效。
 * 这个 Worker 补上这两点，并把客户端的 `x-opencode-session` 原样透传给上游。
 *
 * 不保存任何凭据：`Authorization` 头由浏览器逐请求带来，原样转发。
 */

export interface Env {
  /** 上游基址，默认 Go 的 OpenAI 兼容入口。 */
  UPSTREAM?: string;
  /** 允许的来源，逗号分隔；默认 `*`。生产建议收紧到 Pages + 本地开发地址。 */
  ALLOWED_ORIGINS?: string;
  /** 透传给上游的 User-Agent，默认与 OpenCode CLI 一致。 */
  USER_AGENT?: string;
  /** `x-opencode-client` 的值。 */
  CLIENT?: string;
}

const DEFAULT_UPSTREAM = 'https://opencode.ai/inference/go/openai';
const DEFAULT_USER_AGENT = 'opencode/latest/2.1.1/cli';
const DEFAULT_CLIENT = 'cli';
/** 前端 Base URL 里必须带的路径前缀：`https://<worker>/opencode/v1`。 */
const ROUTE_PREFIX = '/opencode';

const ALLOW_METHODS = 'POST, GET, OPTIONS';
const ALLOW_HEADERS = 'authorization, content-type, x-opencode-session';

/** `/opencode/v1/...` → `<upstream>/v1/...`；前缀之外返回 null。 */
export function upstreamUrl(upstream: string, pathname: string, search: string): string | null {
  if (pathname !== ROUTE_PREFIX && !pathname.startsWith(`${ROUTE_PREFIX}/`)) return null;
  const rest = pathname.slice(ROUTE_PREFIX.length);
  return `${upstream.replace(/\/+$/, '')}${rest}${search}`;
}

/** 命中允许列表时返回 CORS 头；来源不被允许返回 null。 */
export function corsHeaders(origin: string | null, allow: string): Record<string, string> | null {
  const list = allow.split(',').map((s) => s.trim()).filter(Boolean);
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
  if (list.includes('*')) return { ...base, 'Access-Control-Allow-Origin': '*' };
  if (origin && list.includes(origin)) return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return null;
}

/** 客户端没带会话头时的兜底：`ses_` + 26 位字母数字，与 OpenCode 的 ID 形状一致。 */
export function randomSessionId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return `ses_${id}`;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS ?? '*');
    if (!cors) return json({ error: 'origin_not_allowed' }, 403, {});

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' && request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    const target = upstreamUrl(env.UPSTREAM ?? DEFAULT_UPSTREAM, url.pathname, url.search);
    if (!target) return json({ error: 'not_found' }, 404, cors);

    const headers = new Headers();
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    const authorization = request.headers.get('Authorization');
    if (authorization) headers.set('Authorization', authorization);
    headers.set('User-Agent', env.USER_AGENT?.trim() || DEFAULT_USER_AGENT);
    headers.set('x-opencode-client', env.CLIENT?.trim() || DEFAULT_CLIENT);
    headers.set('x-opencode-session', request.headers.get('x-opencode-session')?.trim() || randomSessionId());

    const body = request.method === 'GET' ? undefined : await request.arrayBuffer();

    let upstream: Response;
    try {
      upstream = await fetch(target, { method: request.method, headers, body });
    } catch {
      return json({ error: 'upstream_unreachable' }, 502, cors);
    }

    const out = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(cors)) out.set(key, value);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
