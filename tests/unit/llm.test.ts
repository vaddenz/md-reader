import { describe, expect, it, vi } from 'vitest';
import {
  LlmError, beginOpencodeSession, chatCompletionsUrl, currentOpencodeSession, extractScoreJson, isLlmConfigured,
  isOpenCodeTarget, scoreAnswer, testConnection, toScoreResult, truncateText,
} from '../../src/data/llm';

const CFG = { baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' };
const INPUT = { type: '概念', chapter: '1. 基础', question: '什么是事件循环？', prompt: '```js\n1\n```', answer: '- 要点 A\n- 要点 B', userAnswer: '我的作答' };
const OK = JSON.stringify({ score: 82, hit: ['要点 A'], missed: ['要点 B'], comment: '基本正确' });

function chat(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 永不 resolve、只在 abort 时 reject 的 fetch（超时 / 取消用例）。 */
const hangingFetch = (_url: unknown, init?: { signal?: AbortSignal }) =>
  new Promise<Response>((_, reject) => {
    const fail = () => reject(new DOMException('Aborted', 'AbortError'));
    if (init?.signal?.aborted) return fail();
    init?.signal?.addEventListener('abort', fail);
  });

/** 2xx 响应头已到、但 body 读取挂起并在 abort 时 reject 的响应（响应体阶段取消用例）。 */
function hangingBody(signal?: AbortSignal): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () => new Promise((_, reject) => {
      const fail = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal?.aborted) return fail();
      signal?.addEventListener('abort', fail);
    }),
  } as unknown as Response;
}

describe('chatCompletionsUrl / isLlmConfigured', () => {
  it('URL 规范化：补 /chat/completions、去尾部斜杠、已完整则原样', () => {
    expect(chatCompletionsUrl('https://x/v1')).toBe('https://x/v1/chat/completions');
    expect(chatCompletionsUrl('https://x/v1/')).toBe('https://x/v1/chat/completions');
    expect(chatCompletionsUrl(' https://x/v1/chat/completions ')).toBe('https://x/v1/chat/completions');
  });
  it('三字段齐全才算配置完成', () => {
    expect(isLlmConfigured(null)).toBe(false);
    expect(isLlmConfigured({ baseUrl: 'x', apiKey: '', model: 'm' })).toBe(false);
    expect(isLlmConfigured(CFG)).toBe(true);
  });
});

describe('extractScoreJson / toScoreResult', () => {
  it('脏文本提取：代码围栏、前后杂文、无 JSON 返回 null', () => {
    expect(extractScoreJson(`好的，结果如下：\n\`\`\`json\n${OK}\n\`\`\`\n请查收`)).toMatchObject({ score: 82 });
    expect(extractScoreJson(`prefix {"score": 50} suffix`)).toMatchObject({ score: 50 });
    expect(extractScoreJson('没有 JSON')).toBeNull();
    expect(extractScoreJson('{broken')).toBeNull();
  });
  it('校验与钳制：分数取整钳制、hit/missed 清洗限量、comment 截断', () => {
    expect(toScoreResult({ score: 120 })).toMatchObject({ score: 100, verdict: 'excellent' });
    expect(toScoreResult({ score: -5 })).toMatchObject({ score: 0, verdict: 'again' });
    expect(toScoreResult({ score: 84.6 })).toMatchObject({ score: 85, verdict: 'excellent' });
    expect(toScoreResult({ hit: 'x' })).toBeNull();
    const r = toScoreResult({ score: 70, hit: [' a ', 7, ''], missed: Array.from({ length: 12 }, (_, i) => `m${i}`), comment: 'x'.repeat(900) })!;
    expect(r.hit).toEqual(['a']);
    expect(r.missed).toHaveLength(8);
    expect(r.comment.length).toBe(500);
  });
});

describe('truncateText', () => {
  it('2000/4000/6000 边界：恰好等于上限不截断，超出截断并带后缀', () => {
    for (const limit of [2000, 4000, 6000]) {
      const exact = 'x'.repeat(limit);
      expect(truncateText(exact, limit)).toBe(exact);
      expect(truncateText(`${exact}y`, limit)).toBe(`${exact}…（已截断）`);
    }
    expect(truncateText('', 2000)).toBe('');
  });
});

describe('scoreAnswer', () => {
  it('正常评分：请求体与鉴权头正确、返回 verdict 映射', async () => {
    const fetchImpl = vi.fn(async () => chat(OK));
    const result = await scoreAnswer(CFG, INPUT, { fetchImpl });
    expect(result).toMatchObject({ score: 82, verdict: 'good', hit: ['要点 A'], missed: ['要点 B'] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('m');
    expect(body.temperature).toBe(0.2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('参考答案：');
    expect(body.messages[1].content).toContain('我的作答');
  });

  it('配置字段带首尾空白时，请求使用 trim 后的 URL/Key/Model', async () => {
    const fetchImpl = vi.fn(async () => chat(OK));
    await scoreAnswer({ baseUrl: ' https://llm.example/v1/ ', apiKey: ' k ', model: ' m ' }, INPUT, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(String(init.body)).model).toBe('m');
  });

  it('首次输出不是 JSON 时自动重试一次，两轮都失败 → parse 错误', async () => {
    const retryThenOk = vi.fn()
      .mockResolvedValueOnce(chat('抱歉，我无法直接评分'))
      .mockResolvedValueOnce(chat(OK));
    await expect(scoreAnswer(CFG, INPUT, { fetchImpl: retryThenOk })).resolves.toMatchObject({ score: 82 });
    expect(retryThenOk).toHaveBeenCalledTimes(2);

    const alwaysBad = vi.fn(async () => chat('还是不给 JSON'));
    await expect(scoreAnswer(CFG, INPUT, { fetchImpl: alwaysBad })).rejects.toMatchObject({ kind: 'parse' });
    expect(alwaysBad).toHaveBeenCalledTimes(2);
  });

  it('错误映射：401/404/429/500/网络不可用', async () => {
    const cases: [Response | Error, string][] = [
      [chat('x', 401), 'auth'],
      [chat('x', 403), 'auth'],
      [chat('x', 404), 'notfound'],
      [chat('x', 429), 'ratelimit'],
      [chat('x', 500), 'server'],
      [new TypeError('Failed to fetch'), 'network'],
    ];
    for (const [res, kind] of cases) {
      const fetchImpl = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
      await expect(scoreAnswer(CFG, INPUT, { fetchImpl })).rejects.toMatchObject({ kind });
    }
  });

  it('超时 → timeout；外部取消 → 原样抛 AbortError', async () => {
    await expect(scoreAnswer(CFG, INPUT, { fetchImpl: hangingFetch as typeof fetch, timeoutMs: 10 }))
      .rejects.toMatchObject({ kind: 'timeout' });

    const ac = new AbortController();
    ac.abort();
    await expect(scoreAnswer(CFG, INPUT, { fetchImpl: hangingFetch as typeof fetch, signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('响应体读取阶段：外部取消 → 原样抛 AbortError；内部超时 → timeout', async () => {
    const ac = new AbortController();
    const abortMidBody = vi.fn(async (_url: string, init?: RequestInit) => {
      setTimeout(() => ac.abort(), 5);
      return hangingBody(init?.signal ?? undefined);
    });
    await expect(scoreAnswer(CFG, INPUT, { fetchImpl: abortMidBody as unknown as typeof fetch, signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });

    const timeoutMidBody = vi.fn(async (_url: string, init?: RequestInit) => hangingBody(init?.signal ?? undefined));
    await expect(scoreAnswer(CFG, INPUT, { fetchImpl: timeoutMidBody as unknown as typeof fetch, timeoutMs: 10 }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('LlmError 可识别', async () => {
    const fetchImpl = vi.fn(async () => chat('x', 401));
    const err = await scoreAnswer(CFG, INPUT, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
  });
});

describe('testConnection', () => {
  it('2xx 视为可用（不要求响应体可解析）；401 抛 auth', async () => {
    await expect(testConnection(CFG, { fetchImpl: vi.fn(async () => chat('pong')) })).resolves.toBeUndefined();
    await expect(testConnection(CFG, { fetchImpl: vi.fn(async () => new Response('not json', { status: 200 })) })).resolves.toBeUndefined();
    await expect(testConnection(CFG, { fetchImpl: vi.fn(async () => new Response(null, { status: 204 })) })).resolves.toBeUndefined();
    await expect(testConnection(CFG, { fetchImpl: vi.fn(async () => chat('x', 401)) })).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('OpenCode 会话头', () => {  it('识别直连与 Worker 代理地址，其它地址不受影响', () => {
    expect(isOpenCodeTarget('https://opencode.ai/inference/go/openai/v1')).toBe(true);
    expect(isOpenCodeTarget('https://api.opencode.ai/zen/go/v1')).toBe(true);
    expect(isOpenCodeTarget('https://md-reader-opencode.pw.workers.dev/opencode/v1')).toBe(true);
    expect(isOpenCodeTarget('https://md-reader-opencode.pw.workers.dev/opencode')).toBe(true);
    expect(isOpenCodeTarget('https://llm.example/v1')).toBe(false);
    expect(isOpenCodeTarget('https://example.com/opencodeish/v1')).toBe(false);
    expect(isOpenCodeTarget('not a url')).toBe(false);
  });

  it('整轮训练复用同一个 session ID，换一轮才更新', async () => {
    const fetchImpl = vi.fn(async () => chat(OK));
    const cfg = { ...CFG, baseUrl: 'https://md-reader-opencode.pw.workers.dev/opencode/v1' };
    const first = beginOpencodeSession();
    expect(first).toMatch(/^ses_[0-9A-Za-z]{26}$/);
    expect(currentOpencodeSession()).toBe(first);

    await scoreAnswer(cfg, INPUT, { fetchImpl });
    await scoreAnswer(cfg, INPUT, { fetchImpl });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    const headers = calls.map((call) => new Headers(call[1].headers));
    expect(headers.map((h) => h.get('x-opencode-session'))).toEqual([first, first]);

    const next = beginOpencodeSession();
    expect(next).not.toBe(first);
    await scoreAnswer(cfg, INPUT, { fetchImpl });
    expect(new Headers(calls[2][1].headers).get('x-opencode-session')).toBe(next);
  });

  it('非 OpenCode 地址不带会话头', async () => {
    const fetchImpl = vi.fn(async () => chat(OK));
    beginOpencodeSession();
    await scoreAnswer(CFG, INPUT, { fetchImpl });
    const [call] = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(new Headers(call[1].headers).get('x-opencode-session')).toBeNull();
  });
});

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('流式输出与思考内容', () => {
  it('SSE：思考与正文分开回调，正文跨块拼接后可解析', async () => {
    const [head, tail] = [OK.slice(0, 20), OK.slice(20)];
    const fetchImpl = vi.fn(async () => sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先审题' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '再对照要点' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: head } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: tail } }] })}\n\n`,
      'data: [DONE]\n\n',
    ]));

    const deltas: { content?: string; reasoning?: string }[] = [];
    const result = await scoreAnswer(CFG, INPUT, { fetchImpl, onDelta: (d) => deltas.push(d) });

    expect(result).toMatchObject({ score: 82, hit: ['要点 A'], missed: ['要点 B'] });
    expect(deltas.filter((d) => d.reasoning).map((d) => d.reasoning).join('')).toBe('先审题再对照要点');
    expect(deltas.filter((d) => d.content).map((d) => d.content).join('')).toBe(OK);
  });

  it('服务端忽略 stream 时仍按 JSON 解析，并读取 message.reasoning_content', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: OK, reasoning_content: '简短思考' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const deltas: { content?: string; reasoning?: string }[] = [];
    const result = await scoreAnswer(CFG, INPUT, { fetchImpl, onDelta: (d) => deltas.push(d) });

    expect(result.score).toBe(82);
    expect(deltas).toEqual([{ reasoning: '简短思考' }, { content: OK }]);
  });

  it('思考强度：OpenCode 用 reasoning_effort，直连 DeepSeek 用 chat_template_kwargs', async () => {
    const opencode = vi.fn(async () => chat(OK));
    await scoreAnswer({ ...CFG, baseUrl: 'https://w.dev/opencode/v1', reasoningEffort: 'max' }, INPUT, { fetchImpl: opencode });
    const [opencodeCall] = opencode.mock.calls as unknown as [string, RequestInit][];
    const body = JSON.parse(String(opencodeCall[1].body));
    expect(body.reasoning_effort).toBe('max');
    expect(body.stream).toBe(true);
    expect(body.chat_template_kwargs).toBeUndefined();

    const deepseek = vi.fn(async () => chat(OK));
    await scoreAnswer({ ...CFG, baseUrl: 'https://api.deepseek.com/v1', reasoningEffort: 'high' }, INPUT, { fetchImpl: deepseek });
    const [deepseekCall] = deepseek.mock.calls as unknown as [string, RequestInit][];
    const dsBody = JSON.parse(String(deepseekCall[1].body));
    expect(dsBody.reasoning_effort).toBeUndefined();
    expect(dsBody.chat_template_kwargs).toEqual({ thinking: true, reasoning_effort: 'high' });
  });
});
