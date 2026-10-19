/**
 * 题库 JSONL 解析（纯函数、无 IO）。
 * 标准：docs/specs/2026-10-19-memory-assistant-design.md 附录 A（题库 JSONL 标准 v1.1）。
 */

export type BankKind = 'qa' | 'single' | 'multiple';

export interface BankOption { key: string; text: string }

export interface BankQuestion {
  qid: string;
  id: string;
  kind: BankKind;
  type: string;
  chapter?: string;
  section?: string;
  question: string;
  prompt?: string;
  hint?: string;
  options?: BankOption[];
  correct?: string[];
  followUpOf?: string;
  answer?: string;
  tags?: string[];
  difficulty?: string;
  source?: string;
  line: number;
}

export type WarningKind =
  | 'invalid-json' | 'missing-field' | 'empty-field' | 'bad-type'
  | 'duplicate-id' | 'duplicate-qid' | 'inapplicable-field'
  | 'bad-options' | 'bad-correct' | 'bad-followup';

export interface ParseWarning { line: number; kind: WarningKind; message: string }
export interface ParseResult { questions: BankQuestion[]; warnings: ParseWarning[] }

/** 规范化题干：去首尾空白 + 连续空白折叠为单个空格（qid 的输入）。 */
export function normalizeStem(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** cyrb53：53 位非加密哈希（纯函数、无依赖）。 */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 进度主键：题干内容哈希（与 id、文件名解耦）。 */
export function qidOf(stem: string): string {
  return `q_${cyrb53(normalizeStem(stem)).toString(36)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseBankText(text: string): ParseResult {
  const questions: BankQuestion[] = [];
  const warnings: ParseWarning[] = [];
  const warn = (line: number, kind: WarningKind, message: string) => { warnings.push({ line, kind, message }); };
  const idFirstSeen = new Map<string, number>();
  const qidSeen = new Set<string>();
  const byId = new Map<string, BankQuestion>();

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let raw = lines[i].trim();
    if (i === 0) raw = raw.replace(/^\uFEFF/, '');
    if (!raw) continue;

    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { warn(lineNo, 'invalid-json', 'JSON 解析失败'); continue; }
    if (!isRecord(parsed)) { warn(lineNo, 'invalid-json', '行内容不是 JSON 对象'); continue; }
    const o = parsed;

    const required: [string, string | null][] = [
      ['id', typeof o.id === 'string' ? o.id : null],
      ['question', typeof o.question === 'string' ? o.question : null],
      ['type', typeof o.type === 'string' ? o.type : null],
    ];
    const missing = required.filter(([, v]) => v === null).map(([k]) => k);
    if (missing.length) { warn(lineNo, 'missing-field', `缺少或类型错误：${missing.join('、')}`); continue; }
    const empties = required.filter(([, v]) => (v as string).trim() === '').map(([k]) => k);
    if (empties.length) { warn(lineNo, 'empty-field', `为空：${empties.join('、')}`); continue; }
    const id = (o.id as string).trim();
    const question = (o.question as string).trim();
    const type = (o.type as string).trim();

    let kind: BankKind = 'qa';
    if (o.kind !== undefined) {
      if (o.kind === 'qa' || o.kind === 'single' || o.kind === 'multiple') kind = o.kind;
      else { warn(lineNo, 'bad-type', `kind 非法：${String(o.kind)}`); continue; }
    }

    const optStr = (key: string): string | undefined => {
      const v = o[key];
      if (v === undefined || v === null) return undefined;
      if (typeof v !== 'string') { warn(lineNo, 'bad-type', `${key} 应为字符串`); return undefined; }
      return v.trim() ? v : undefined;
    };
    const chapter = optStr('chapter');
    const section = optStr('section');
    const prompt = optStr('prompt');
    const hint = optStr('hint');
    const difficulty = optStr('difficulty');
    const source = optStr('source');
    const followUpOf = optStr('followUpOf');

    let tags: string[] | undefined;
    if (o.tags !== undefined && o.tags !== null) {
      if (!Array.isArray(o.tags)) warn(lineNo, 'bad-type', 'tags 应为字符串数组');
      else {
        const kept: string[] = [];
        for (const item of o.tags) {
          if (typeof item === 'string' && item.trim()) kept.push(item.trim());
          else warn(lineNo, 'bad-type', 'tags 含非法元素，已丢弃');
        }
        if (kept.length) tags = kept;
      }
    }

    let options: BankOption[] | undefined;
    let correct: string[] | undefined;
    let answer: string | undefined;
    if (kind === 'qa') {
      if (o.options !== undefined || o.correct !== undefined) {
        warn(lineNo, 'inapplicable-field', '问答不应携带 options/correct，已忽略');
      }
      const a = o.answer;
      if (typeof a !== 'string' || a.trim() === '') { warn(lineNo, 'empty-field', '问答缺少 answer'); continue; }
      answer = a;
    } else {
      const rawOptions = o.options;
      if (!Array.isArray(rawOptions) || rawOptions.length < 2) { warn(lineNo, 'bad-options', '选择题 options 需为 ≥2 项的数组'); continue; }
      const opts: BankOption[] = [];
      const keys = new Set<string>();
      let optionsOk = true;
      for (const item of rawOptions) {
        if (!isRecord(item)) { optionsOk = false; break; }
        if (typeof item.key !== 'string' || !item.key.trim() || typeof item.text !== 'string' || !item.text.trim()) { optionsOk = false; break; }
        const key = item.key.trim();
        if (keys.has(key)) { optionsOk = false; break; }
        keys.add(key);
        opts.push({ key, text: item.text.trim() });
      }
      if (!optionsOk) { warn(lineNo, 'bad-options', '选项结构非法（key 重复 / text 为空 / 类型错误）'); continue; }
      options = opts;

      const rawCorrect = o.correct;
      if (!Array.isArray(rawCorrect) || rawCorrect.length === 0 || rawCorrect.some((k) => typeof k !== 'string')) {
        warn(lineNo, 'bad-correct', 'correct 需为非空字符串数组'); continue;
      }
      const correctKeys = [...new Set(rawCorrect.map((k) => (k as string).trim()))];
      if (correctKeys.some((k) => !keys.has(k))) { warn(lineNo, 'bad-correct', 'correct 含不存在的选项 key'); continue; }
      if (kind === 'single' && correctKeys.length !== 1) { warn(lineNo, 'bad-correct', '单选必须恰好 1 个正确项'); continue; }
      correct = correctKeys;

      const a = o.answer;
      if (a !== undefined && a !== null) {
        if (typeof a !== 'string') warn(lineNo, 'bad-type', 'answer 应为字符串');
        else if (a.trim()) answer = a;
      }
    }

    if (idFirstSeen.has(id)) warn(lineNo, 'duplicate-id', `id「${id}」与第 ${idFirstSeen.get(id)} 行重复`);
    else idFirstSeen.set(id, lineNo);

    const qid = qidOf(question);
    if (qidSeen.has(qid)) { warn(lineNo, 'duplicate-qid', '题干与前面某题重复，已跳过'); continue; }
    qidSeen.add(qid);

    const q: BankQuestion = {
      qid, id, kind, type, question, line: lineNo,
      ...(chapter ? { chapter } : {}),
      ...(section ? { section } : {}),
      ...(prompt ? { prompt } : {}),
      ...(hint ? { hint } : {}),
      ...(options ? { options } : {}),
      ...(correct ? { correct } : {}),
      ...(followUpOf ? { followUpOf } : {}),
      ...(answer ? { answer } : {}),
      ...(tags ? { tags } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(source ? { source } : {}),
    };
    questions.push(q);
    if (!byId.has(id)) byId.set(id, q);
  }

  // 追问关系校验（只告警，不剔除）
  for (const q of questions) {
    if (!q.followUpOf) continue;
    const target = byId.get(q.followUpOf);
    if (!target) { warn(q.line, 'bad-followup', `followUpOf「${q.followUpOf}」不存在`); continue; }
    if (target.qid === q.qid) { warn(q.line, 'bad-followup', 'followUpOf 指向自身'); continue; }
    let cursor: BankQuestion | undefined = target;
    const chain = new Set<string>([q.qid]);
    let cycle = false;
    while (cursor) {
      if (chain.has(cursor.qid)) { cycle = true; break; }
      chain.add(cursor.qid);
      cursor = cursor.followUpOf ? byId.get(cursor.followUpOf) : undefined;
    }
    if (cycle) warn(q.line, 'bad-followup', 'followUpOf 成环');
  }

  return { questions, warnings };
}
