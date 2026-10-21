/**
 * OpenAI 兼容模型客户端：只负责「问答评分」与「测试连接」。
 * 不设置 max_tokens / response_format（最大化兼容），解析脏 JSON 并重试一次。
 */
import type { LlmConfig } from './memory';
import { verdictFromScore, type Verdict } from '../lib/srs';

export type LlmErrorKind = 'auth' | 'notfound' | 'ratelimit' | 'timeout' | 'network' | 'server' | 'parse';

export class LlmError extends Error {
  constructor(public kind: LlmErrorKind, message: string, public status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface ScoreInput {
  type: string;
  chapter?: string;
  question: string;
  prompt?: string;
  answer: string;
  userAnswer: string;
}

export interface ScoreResult {
  score: number;
  verdict: Verdict;
  hit: string[];
  missed: string[];
  comment: string;
}

export const DEFAULT_TIMEOUT_MS = 45_000;
const LIMITS = { userAnswer: 4000, answer: 6000, question: 2000, prompt: 2000 };
/** OpenCode 代理路由前缀：baseUrl 形如 `https://<worker>/opencode/v1`。 */
const OPENCODE_PROXY_PREFIX = '/opencode';

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
/** 流式增量：思考内容与正式回答分开上报。 */
export interface ChatStreamDelta { content?: string; reasoning?: string }
export interface LlmRequestOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onDelta?: (delta: ChatStreamDelta) => void;
}

export function isLlmConfigured(cfg: LlmConfig | undefined | null): cfg is LlmConfig {
  return Boolean(cfg && cfg.baseUrl.trim() && cfg.apiKey.trim() && cfg.model.trim());
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

/** 判断地址是否指向 OpenCode（直连 opencode.ai，或本仓库 Worker 代理的 `/opencode/*` 路由）。 */
export function isOpenCodeTarget(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === 'opencode.ai' || host.endsWith('.opencode.ai')) return true;
  if (path.includes('/inference/go') || path.includes('/zen/go')) return true;
  return path === OPENCODE_PROXY_PREFIX || path.startsWith(`${OPENCODE_PROXY_PREFIX}/`);
}

function randomSessionId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return `ses_${id}`;
}

let opencodeSessionId: string | null = null;

/** 当前训练会话的 OpenCode 会话 ID；未显式开始时按需生成。 */
export function currentOpencodeSession(): string {
  opencodeSessionId ??= randomSessionId();
  return opencodeSessionId;
}

/** 进入一次训练时调用：整轮训练复用同一个会话 ID（提升 OpenCode 提示词缓存命中率）。 */
export function beginOpencodeSession(): string {
  opencodeSessionId = randomSessionId();
  return opencodeSessionId;
}

/** 浏览器禁止设置 User-Agent：OpenCode 需要的那部分由 Worker 代理注入。 */
function requestHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (isOpenCodeTarget(baseUrl)) headers['x-opencode-session'] = currentOpencodeSession();
  return headers;
}

/** 思考强度参数：OpenCode 走标准的 reasoning_effort；直连 DeepSeek 用 chat_template_kwargs。 */
function reasoningParams(baseUrl: string, effort: LlmConfig['reasoningEffort']): Record<string, unknown> {
  if (!effort) return {};
  if (/deepseek\.com/i.test(baseUrl) && !isOpenCodeTarget(baseUrl)) {
    return { chat_template_kwargs: { thinking: true, reasoning_effort: effort } };
  }
  return { reasoning_effort: effort };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface ChatCompletion { content: string; reasoning: string }

/** 兼容两种响应：SSE（stream:true 正常情况）与一次性 JSON（服务端忽略 stream 时）。 */
async function readChatCompletion(res: Response, onDelta?: (delta: ChatStreamDelta) => void): Promise<ChatCompletion> {
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!/text\/event-stream/i.test(contentType)) {
    const data = (await res.json()) as { choices?: { message?: Record<string, unknown> }[] } | null;
    const message = data?.choices?.[0]?.message;
    const content = textOf(message?.content);
    const reasoning = textOf(message?.reasoning_content) || textOf(message?.reasoning);
    if (reasoning) onDelta?.({ reasoning });
    if (!content.trim()) throw new LlmError('parse', '响应缺少内容');
    onDelta?.({ content });
    return { content, reasoning };
  }

  const reader = res.body?.getReader();
  if (!reader) throw new LlmError('parse', '响应缺少内容');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';

  const handleEvent = (raw: string): void => {
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json: {
        error?: { message?: unknown };
        choices?: { delta?: Record<string, unknown>; message?: Record<string, unknown> }[];
      };
      try { json = JSON.parse(payload); } catch { continue; }
      if (json.error) {
        throw new LlmError('server', textOf(json.error.message) || '模型返回错误');
      }
      const delta = json.choices?.[0]?.delta ?? json.choices?.[0]?.message;
      const think = textOf(delta?.reasoning_content) || textOf(delta?.reasoning);
      const text = textOf(delta?.content);
      if (think) { reasoning += think; onDelta?.({ reasoning: think }); }
      if (text) { content += text; onDelta?.({ content: text }); }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n?/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      handleEvent(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
    }
  }
  handleEvent(buffer);

  if (!content.trim()) throw new LlmError('parse', '响应缺少内容');
  return { content, reasoning };
}

export function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…（已截断）`;
}

const SYSTEM_PROMPT = [
  '你是记忆训练助教，负责给用户的作答打分。',
  '评分依据：参考答案要点覆盖度、表述准确性、完整性；只要要点意思到位即可得分，不苛求原文字句。',
  '要求：',
  '1) 只输出一个 JSON 对象，不要输出任何其它文字或 Markdown 代码围栏；',
  '2) JSON 结构：{"score": 0-100 的整数, "hit": ["已覆盖的要点"], "missed": ["遗漏或错误的要点"], "comment": "一句话点评（≤120 字）"}；',
  '3) 不要复述参考答案，不要虚构答案中不存在的内容。',
].join('\n');

function buildMessages(input: ScoreInput): ChatMessage[] {
  const parts = [
    `题型：${input.type}`,
    input.chapter ? `章节：${input.chapter}` : '',
    `题干：${truncateText(input.question, LIMITS.question)}`,
    input.prompt ? `题面材料：\n${truncateText(input.prompt, LIMITS.prompt)}` : '',
    `参考答案：\n${truncateText(input.answer, LIMITS.answer)}`,
    `用户作答：\n${truncateText(input.userAnswer, LIMITS.userAnswer)}`,
  ].filter(Boolean);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

export function extractScoreJson(text: string): unknown | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

export function toScoreResult(raw: unknown): ScoreResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.score !== 'number' || !Number.isFinite(r.score)) return null;
  const score = Math.min(100, Math.max(0, Math.round(r.score)));
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 120)).slice(0, 8)
      : [];
  const comment = typeof r.comment === 'string' ? r.comment.trim().slice(0, 500) : '';
  return { score, verdict: verdictFromScore(score), hit: list(r.hit), missed: list(r.missed), comment };
}

/** 请求失败的统一分类：外部取消原样抛出；内部超时 → timeout；其余按调用点归类（网络 / 解析）。 */
function classifyRequestFailure(
  err: unknown,
  opts: LlmRequestOpts,
  controller: AbortController,
  fallback: LlmError,
): never {
  if (opts.signal?.aborted) throw err;
  if (controller.signal.aborted) throw new LlmError('timeout', '请求超时');
  throw fallback;
}

async function requestChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: LlmRequestOpts,
  expectContent = true,
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = cfg.baseUrl.trim();
  const apiKey = cfg.apiKey.trim();
  const model = cfg.model.trim();
  const controller = new AbortController();
  if (opts.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    let res: Response;
    try {
      res = await fetchImpl(chatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: requestHeaders(apiKey, baseUrl),
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          stream: true,
          ...reasoningParams(baseUrl, cfg.reasoningEffort),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      classifyRequestFailure(err, opts, controller, new LlmError('network', '网络不可用（也可能是服务端未允许跨域）'));
    }
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', 'Key 无效或无权限', res.status);
    if (res.status === 404) throw new LlmError('notfound', 'URL 或模型名不存在', 404);
    if (res.status === 429) throw new LlmError('ratelimit', '限流，请稍后重试', 429);
    if (res.status >= 500) throw new LlmError('server', `服务端错误 ${res.status}`, res.status);
    if (!res.ok) throw new LlmError('server', `请求失败 ${res.status}`, res.status);

    // 测试连接只要求 2xx：不读取响应体，避免空/非 JSON body 误判为 parse 错误。
    if (!expectContent) {
      void res.body?.cancel().catch(() => {});
      return '';
    }

    const completion = await readChatCompletion(res, opts.onDelta).catch((err: unknown) => {
      if (err instanceof LlmError) throw err;
      return classifyRequestFailure(err, opts, controller, new LlmError('parse', '响应不是合法 JSON'));
    });
    return completion.content;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export async function scoreAnswer(cfg: LlmConfig, input: ScoreInput, opts: LlmRequestOpts = {}): Promise<ScoreResult> {
  const messages = buildMessages(input);
  const first = await requestChat(cfg, messages, opts);
  let result = toScoreResult(extractScoreJson(first));
  if (result) return result;
  const retry = await requestChat(cfg, [
    ...messages,
    { role: 'assistant', content: first.slice(0, 2000) },
    { role: 'user', content: '上面的输出不是要求的 JSON。请只输出一个 JSON 对象：{"score": number, "hit": string[], "missed": string[], "comment": string}' },
  ], opts);
  result = toScoreResult(extractScoreJson(retry));
  if (!result) throw new LlmError('parse', '评分结果无法解析');
  return result;
}

export async function testConnection(cfg: LlmConfig, opts: LlmRequestOpts = {}): Promise<void> {
  await requestChat(cfg, [{ role: 'user', content: 'ping（仅测试连通性，请直接回复 pong）' }], opts, false);
}
