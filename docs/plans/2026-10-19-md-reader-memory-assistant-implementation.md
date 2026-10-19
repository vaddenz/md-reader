# md-reader v1.3 记忆助手实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 md-reader v1.2.0 之上交付「记忆助手」：从内容仓库的 JSONL 题库（问答 / 单选 / 多选 / 追问）出发，按艾宾浩斯间隔做记忆训练，支持 AI 评分（OpenAI 兼容）与本地判分、自评降级、提示、本地训练记录与统计。

**Architecture:** 沿用既有分层：`src/lib/*` 纯函数（题库解析、调度）；`src/data/*` 持久化与外部 IO（IndexedDB v2、GitHub、模型 API）；`src/pages` + `src/components/memory/*` 页面编排。题库一律从仓库目录树按需拉取并按 sha 缓存解析结果；训练进度用题干内容哈希（qid）做主键，与文件名 / 题号解耦。

**Tech Stack:** React 18 + TS + Vite 6 + IndexedDB(idb) + Vitest + Playwright；无新增运行时依赖。

**Spec:** `docs/specs/2026-10-19-memory-assistant-design.md`（冲突以 spec 为准；附录 A 为题库 JSONL 标准 v1.1）

## Global Constraints

- 不新增运行时依赖；不改动既有同步 / 渲染 / 搜索 / 高亮行为（除首页入口、CSP、设置页文案、版本号）。
- 既有 200 单测 + 25 e2e 必须全绿；每完成一个任务跑相关测试。
- 术语：代码注释与新增 UI 文案统一用「记忆助手 / 记忆训练 / 题库 / 题目 / 作答 / 评分 / 判分」，**不出现「面试」二字**（数据原文除外，题库名直接取文件名）。
- CSP（Task 6 修改）：`connect-src 'self' https:`；e2e 一律 mock GitHub 与模型端点，绝不触达真实 API。
- e2e mock 约束：不得新增可被文件树 / 搜索看到的 `.md` 文档；`.jsonl` 题库只进目录树与 blob，不进 `files` store。
- 版本号最终为 `1.3.0`（Task 10）；提交信息沿用 `feat:/fix:/test:/docs:/chore:` 前缀。
- 到期计算一律本地时区日界（`dayStart`/`addDays`），不使用 UTC。

## 文件结构（新增 / 修改）

| 文件 | 任务 | 职责 |
| --- | --- | --- |
| `src/lib/qbank.ts` | T1 | JSONL 题库解析（纯函数）：qid、校验、警告 |
| `src/lib/srs.ts` | T2 | 调度（纯函数）：判分映射、档位、到期、队列组装、链排序 |
| `src/data/db.ts` | T3 | IndexedDB v2：新增 `mem_banks` / `mem_srs` / `mem_attempts` |
| `src/data/memory.ts` | T3 | 训练数据：选择配置、模型配置、进度、记录、统计、导出/导入 |
| `src/data/qbankIndex.ts` | T4 | 题库发现 / 按需拉取 / sha 缓存 |
| `src/data/llm.ts` | T5 | OpenAI 兼容客户端：评分契约、错误映射、测试连接 |
| `src/app/nav.ts`、`src/App.tsx`、`src/pages/HomePage.tsx`、`index.html` | T6 | 路由、首页入口、CSP |
| `src/pages/MemoryPage.tsx`、`src/components/memory/LlmConfigForm.tsx`、`src/styles/memory.css` | T6 | 概览页 + 模型设置 + 样式 |
| `src/pages/MemoryTrainPage.tsx`、`src/components/memory/MarkdownBlock.tsx` | T7 | 训练页（问答链路、会话） |
| `src/pages/MemoryRecordsPage.tsx` | T9 | 记录与统计、导出导入 |
| `tests/unit/{qbank,srs,memory,qbank-index,llm,db-migrate}.test.ts` | T1–T5 | 单测 |
| `tests/e2e/fixtures.ts`、`tests/e2e/memory.spec.ts` | T6–T9 | e2e |

---

### Task 1: 题库解析器（`src/lib/qbank.ts`）

**Files:**
- Create: `src/lib/qbank.ts`
- Test: `tests/unit/qbank.test.ts`

**Interfaces:**
- Produces（后续任务按此签名使用）：
  - `type BankKind = 'qa' | 'single' | 'multiple'`
  - `interface BankOption { key: string; text: string }`
  - `interface BankQuestion { qid; id; kind; type; chapter?; section?; question; prompt?; hint?; options?; correct?; followUpOf?; answer?; tags?; difficulty?; source?; line }`
  - `type WarningKind = 'invalid-json' | 'missing-field' | 'empty-field' | 'bad-type' | 'duplicate-id' | 'duplicate-qid' | 'inapplicable-field' | 'bad-options' | 'bad-correct' | 'bad-followup'`
  - `interface ParseWarning { line: number; kind: WarningKind; message: string }`
  - `interface ParseResult { questions: BankQuestion[]; warnings: ParseWarning[] }`
  - `normalizeStem(s: string): string`、`cyrb53(str: string, seed?: number): number`、`qidOf(stem: string): string`（`'q_' + base36`）
  - `parseBankText(text: string): ParseResult`

- [ ] **Step 1: 写失败测试** `tests/unit/qbank.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { normalizeStem, parseBankText, qidOf } from '../../src/lib/qbank';

/** 便捷构造：对象 → JSONL 一行。 */
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const QA = { id: 'Q1.1', type: '概念', question: '什么是事件循环？', answer: '- 事件循环是…' };

describe('normalizeStem / qidOf', () => {
  it('空白折叠：空格/换行变化不影响 qid，题干改写则变化', () => {
    expect(normalizeStem('  a   b\n c ')).toBe('a b c');
    expect(qidOf('a  b')).toBe(qidOf('a b'));
    expect(qidOf('a b')).not.toBe(qidOf('a c'));
    expect(qidOf('x')).toMatch(/^q_[0-9a-z]+$/);
  });
});

describe('parseBankText 基本解析', () => {
  it('问答：全字段解析、行号正确、顺序保持', () => {
    const text = [
      line({ ...QA, chapter: '2. 事件循环', section: '2.2 补充', hint: '想 libuv', tags: ['事件循环'], difficulty: '基础', source: '知识.md#2' }),
      '',
      line({ ...QA, id: 'Q1.2', question: '第二题？' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      kind: 'qa', id: 'Q1.1', type: '概念', chapter: '2. 事件循环', section: '2.2 补充',
      hint: '想 libuv', tags: ['事件循环'], difficulty: '基础', source: '知识.md#2', line: 1,
    });
    expect(questions[0].qid).toBe(qidOf('什么是事件循环？'));
    expect(questions[1].line).toBe(3);
    expect(questions[1].answer).toBe('- 事件循环是…');
  });

  it('BOM 与空行容忍', () => {
    const { questions, warnings } = parseBankText(`\uFEFF${line(QA)}\n\n`);
    expect(warnings).toEqual([]);
    expect(questions).toHaveLength(1);
  });

  it('无效 JSON / 非对象 → invalid-json，坏行跳过、其余可用', () => {
    const text = ['not json', '[1,2]', line(QA)].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => [w.line, w.kind])).toEqual([[1, 'invalid-json'], [2, 'invalid-json']]);
    expect(questions).toHaveLength(1);
  });

  it('缺字段 / 空字符串 / 非法 kind', () => {
    const text = [
      line({ id: 'Q1', question: 'x' }),
      line({ ...QA, id: '' }),
      line({ ...QA, kind: 'choice' }),
      line({ ...QA, answer: '   ' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['missing-field', 'empty-field', 'bad-type', 'empty-field']);
    expect(questions).toEqual([]);
  });

  it('可选字段类型错误只告警并忽略该字段', () => {
    const { questions, warnings } = parseBankText(line({ ...QA, chapter: 3, tags: 'x' }));
    expect(warnings.map((w) => w.kind)).toEqual(['bad-type', 'bad-type']);
    expect(questions[0].chapter).toBeUndefined();
    expect(questions[0].tags).toBeUndefined();
  });

  it('tags 非法元素丢弃并告警，合法元素保留', () => {
    const { questions, warnings } = parseBankText(line({ ...QA, tags: ['ok', 7, ''] }));
    expect(warnings.filter((w) => w.kind === 'bad-type')).toHaveLength(2);
    expect(questions[0].tags).toEqual(['ok']);
  });

  it('id 重复告警但保留；题干重复跳过后者', () => {
    const text = [line(QA), line({ ...QA, id: 'Q9', question: '另一题？' }), line({ ...QA, id: 'Q1.1', question: QA.question })].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['duplicate-id', 'duplicate-qid']);
    expect(questions).toHaveLength(2);
  });
});

describe('parseBankText 选择题', () => {
  const single = { id: 'S1', kind: 'single', type: '概念', question: '选哪个？', options: [{ key: 'A', text: '对' }, { key: 'B', text: '错' }], correct: ['A'] };

  it('单选 / 多选合法解析，answer 可选（解析）', () => {
    const text = [
      line({ ...single, answer: '因为 A。' }),
      line({ id: 'M1', kind: 'multiple', type: '辨析', question: '多选？', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }, { key: 'C', text: '3' }], correct: ['A', 'C'], answer: undefined }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings).toEqual([]);
    expect(questions[0]).toMatchObject({ kind: 'single', correct: ['A'], answer: '因为 A。' });
    expect(questions[1]).toMatchObject({ kind: 'multiple', correct: ['A', 'C'] });
    expect(questions[1].answer).toBeUndefined();
  });

  it('问答携带 options/correct → inapplicable-field（忽略该字段）', () => {
    const { questions, warnings } = parseBankText(line({ ...QA, correct: ['A'] }));
    expect(warnings.map((w) => w.kind)).toEqual(['inapplicable-field']);
    expect(questions[0].correct).toBeUndefined();
  });

  it('bad-options：选项少于 2 / key 重复 / text 为空', () => {
    const text = [
      line({ ...single, options: [{ key: 'A', text: '对' }] }),
      line({ ...single, options: [{ key: 'A', text: '1' }, { key: 'A', text: '2' }] }),
      line({ ...single, options: [{ key: 'A', text: '1' }, { key: 'B', text: ' ' }] }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['bad-options', 'bad-options', 'bad-options']);
    expect(questions).toEqual([]);
  });

  it('bad-correct：key 越界 / 单选多答 / 多选空答', () => {
    const text = [
      line({ ...single, correct: ['C'] }),
      line({ ...single, correct: ['A', 'B'] }),
      line({ id: 'M1', kind: 'multiple', type: '辨析', question: '多选？', options: single.options, correct: [] }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings.map((w) => w.kind)).toEqual(['bad-correct', 'bad-correct', 'bad-correct']);
    expect(questions).toEqual([]);
  });
});

describe('parseBankText 追问关系', () => {
  it('合法链无告警', () => {
    const text = [
      line(QA),
      line({ id: 'Q1.2', type: '追问', question: '继续？', answer: '- 继续答…', followUpOf: 'Q1.1' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(warnings).toEqual([]);
    expect(questions[1].followUpOf).toBe('Q1.1');
  });

  it('悬空 / 自引用 / 成环 → bad-followup，但题目保留', () => {
    const text = [
      line({ id: 'A', type: '追问', question: '悬空？', answer: '- 答', followUpOf: '不存在' }),
      line({ id: 'B', type: '追问', question: '自指？', answer: '- 答', followUpOf: 'B' }),
      line({ id: 'C', type: '追问', question: '环 1？', answer: '- 答', followUpOf: 'D' }),
      line({ id: 'D', type: '追问', question: '环 2？', answer: '- 答', followUpOf: 'C' }),
    ].join('\n');
    const { questions, warnings } = parseBankText(text);
    expect(questions).toHaveLength(4);
    expect(warnings.map((w) => [w.line, w.kind])).toEqual([
      [1, 'bad-followup'], [2, 'bad-followup'], [3, 'bad-followup'], [4, 'bad-followup'],
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/qbank.test.ts`
Expected: FAIL（`src/lib/qbank.ts` 不存在）

- [ ] **Step 3: 实现 `src/lib/qbank.ts`**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/qbank.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/qbank.ts tests/unit/qbank.test.ts
git commit -m "feat: 题库 JSONL 解析器（qid 内容哈希、选择题与追问校验）"
```

---

### Task 2: 艾宾浩斯调度（`src/lib/srs.ts`）

**Files:**
- Create: `src/lib/srs.ts`
- Test: `tests/unit/srs.test.ts`

**Interfaces:**
- Consumes: `BankKind`（`src/lib/qbank.ts`，仅类型）
- Produces（后续任务按此签名使用）：
  - `type Verdict = 'excellent' | 'good' | 'hard' | 'again'`
  - `interface SrsState { qid; bankPath; id; stage; dueAt; lastAt; firstAt; lastScore: number | null; verdict: Verdict; reps; lapses }`
  - `const INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60]`、`const MAX_STAGE = 6`、`const DAY_MS`
  - `dayStart(ts: number): number`、`addDays(ts: number, days: number): number`（本地日界）
  - `verdictFromScore(score: number): Verdict`（≥85 excellent / ≥70 good / ≥50 hard / 其余 again）
  - `verdictFromChoice(kind: 'single' | 'multiple', picked: string[], correct: string[]): Verdict`
  - `nextState(prev: SrsState | undefined, verdict: Verdict, now: number, meta: { qid: string; bankPath: string; id: string; score: number | null }): SrsState`
  - `isMastered(s: SrsState): boolean`
  - `const VERDICT_LABELS: Record<Verdict, string>`（优秀 / 良好 / 勉强 / 不会）
  - `interface QueueCandidate { qid; bankPath; id; kind: BankKind; type; chapter?; tags?; difficulty?; followUpOf?; bankIndex; line }`
  - `interface QueueFilters { kinds: string[]; chapters: string[]; types: string[]; tags: string[]; difficulty: string[] }`
  - `interface QueueEntry { qid: string; bankPath: string; id: string }`
  - `buildQueue(input: { candidates: QueueCandidate[]; srsByQid: Map<string, SrsState>; filters: QueueFilters; sessionSize: number; newPerDay: number; newIntroducedToday: number; now: number }): QueueEntry[]`

- [ ] **Step 1: 写失败测试** `tests/unit/srs.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_STAGE, addDays, buildQueue, dayStart, isMastered, nextState,
  verdictFromChoice, verdictFromScore,
  type QueueCandidate, type SrsState,
} from '../../src/lib/srs';

const NOW = new Date(2026, 9, 19, 15, 30).getTime(); // 2026-10-19 15:30（本地）

const EMPTY_FILTERS = { kinds: [], chapters: [], types: [], tags: [], difficulty: [] };

function cand(qid: string, extra: Partial<QueueCandidate> = {}): QueueCandidate {
  return { qid, bankPath: 'b.jsonl', id: qid, kind: 'qa', type: '概念', bankIndex: 0, line: 1, ...extra };
}

function srs(qid: string, dueAt: number, lastAt = 0, extra: Partial<SrsState> = {}): SrsState {
  return {
    qid, bankPath: 'b.jsonl', id: qid, stage: 0, dueAt, lastAt, firstAt: lastAt,
    lastScore: null, verdict: 'again', reps: 1, lapses: 0, ...extra,
  };
}

const queue = (candidates: QueueCandidate[], srsMap: Map<string, SrsState>, extra: Partial<Parameters<typeof buildQueue>[0]> = {}) =>
  buildQueue({ candidates, srsByQid: srsMap, filters: EMPTY_FILTERS, sessionSize: 0, newPerDay: 10, newIntroducedToday: 0, now: NOW, ...extra });

describe('verdictFromScore', () => {
  it('边界值', () => {
    expect(verdictFromScore(85)).toBe('excellent');
    expect(verdictFromScore(84)).toBe('good');
    expect(verdictFromScore(70)).toBe('good');
    expect(verdictFromScore(69)).toBe('hard');
    expect(verdictFromScore(50)).toBe('hard');
    expect(verdictFromScore(49)).toBe('again');
    expect(verdictFromScore(0)).toBe('again');
  });
});

describe('verdictFromChoice', () => {
  it('单选：对 → 优秀；错 → 不会', () => {
    expect(verdictFromChoice('single', ['A'], ['A'])).toBe('excellent');
    expect(verdictFromChoice('single', ['B'], ['A'])).toBe('again');
    expect(verdictFromChoice('single', [], ['A'])).toBe('again');
  });
  it('多选：全对 → 优秀；漏选 → 勉强；错选 → 不会', () => {
    expect(verdictFromChoice('multiple', ['A', 'C'], ['A', 'C'])).toBe('excellent');
    expect(verdictFromChoice('multiple', ['A'], ['A', 'C'])).toBe('hard');
    expect(verdictFromChoice('multiple', [], ['A', 'C'])).toBe('hard');
    expect(verdictFromChoice('multiple', ['A', 'B'], ['A', 'C'])).toBe('again');
  });
});

describe('dayStart / addDays', () => {
  it('本地日界：截断到 0 点、跨月推进', () => {
    const d = new Date(2026, 9, 19, 23, 59, 59).getTime();
    expect(dayStart(d)).toBe(new Date(2026, 9, 19).getTime());
    expect(addDays(dayStart(d), 1)).toBe(new Date(2026, 9, 20).getTime());
    expect(addDays(new Date(2026, 9, 31).getTime(), 1)).toBe(new Date(2026, 10, 1).getTime());
  });
});

describe('nextState', () => {
  const meta = { qid: 'q_a', bankPath: 'b.jsonl', id: 'Q1', score: 75 };

  it('首次作答：优秀/良好升一档并按新档间隔到期', () => {
    const a = nextState(undefined, 'good', NOW, meta);
    expect(a).toMatchObject({ stage: 1, dueAt: addDays(NOW, 2), lastAt: NOW, firstAt: NOW, lastScore: 75, verdict: 'good', reps: 1, lapses: 0 });
    const b = nextState(undefined, 'excellent', NOW, { ...meta, score: 90 });
    expect(b).toMatchObject({ stage: 1, dueAt: addDays(NOW, 2), lapses: 0 });
  });

  it('升档封顶：stage 5 良好 → stage 6、60 天；再良好仍 stage 6', () => {
    const prev = srs('q_a', NOW, 0, { stage: 5, firstAt: 1 });
    const s6 = nextState(prev, 'good', NOW, meta);
    expect(s6).toMatchObject({ stage: MAX_STAGE, dueAt: addDays(NOW, 60), firstAt: 1 });
    const again6 = nextState(s6, 'good', NOW + 1000, meta);
    expect(again6).toMatchObject({ stage: MAX_STAGE, dueAt: addDays(NOW + 1000, 60) });
  });

  it('勉强：保持档位、明天重试；不会：重置 stage 0、明天重试、lapses 累加', () => {
    const prev = srs('q_a', NOW, 0, { stage: 3, firstAt: 1, lapses: 2, reps: 4 });
    const hard = nextState(prev, 'hard', NOW, { ...meta, score: 60 });
    expect(hard).toMatchObject({ stage: 3, dueAt: addDays(NOW, 1), lapses: 2, reps: 5 });
    const again = nextState(prev, 'again', NOW, { ...meta, score: 30 });
    expect(again).toMatchObject({ stage: 0, dueAt: addDays(NOW, 1), lapses: 3, reps: 5 });
  });

  it('选择题（score null）：lastScore 为 null，其余照常', () => {
    const s = nextState(undefined, 'excellent', NOW, { ...meta, score: null });
    expect(s.lastScore).toBeNull();
    expect(s.stage).toBe(1);
  });
});

describe('isMastered', () => {
  it('档位到顶且最近一次为优秀/良好才掌握', () => {
    expect(isMastered(srs('q', 0, 0, { stage: MAX_STAGE, verdict: 'good' }))).toBe(true);
    expect(isMastered(srs('q', 0, 0, { stage: MAX_STAGE, verdict: 'excellent' }))).toBe(true);
    expect(isMastered(srs('q', 0, 0, { stage: MAX_STAGE, verdict: 'hard' }))).toBe(false);
    expect(isMastered(srs('q', 0, 0, { stage: 5, verdict: 'good' }))).toBe(false);
  });
});

describe('buildQueue', () => {
  it('到期优先（dueAt 升序、同刻按 lastAt），新题按题库顺序 + 行序', () => {
    const candidates = [
      cand('q1', { line: 1 }),
      cand('q2', { line: 2, bankIndex: 1 }),
      cand('q3', { line: 3 }),
      cand('q4', { line: 4 }),
    ];
    const map = new Map([
      ['q3', srs('q3', NOW - 5 * 86400000, 100)],
      ['q4', srs('q4', NOW - 6 * 86400000, 200)],
      ['q2', srs('q2', NOW + 86400000, 300)], // 未到期，不出
    ]);
    expect(queue(candidates, map).map((e) => e.qid)).toEqual(['q4', 'q3', 'q1']);
  });

  it('每日新题额度：newIntroducedToday 占用额度，到期复习不占', () => {
    const candidates = [cand('q1'), cand('q2'), cand('q3')];
    const map = new Map([['q3', srs('q3', NOW - 1)]]);
    expect(queue(candidates, map, { newPerDay: 2, newIntroducedToday: 1 }).map((e) => e.qid)).toEqual(['q3', 'q1']);
    expect(queue(candidates, map, { newPerDay: 2, newIntroducedToday: 5 }).map((e) => e.qid)).toEqual(['q3']);
  });

  it('sessionSize 截断（0 = 不限）；qid 去重', () => {
    const candidates = [cand('q1'), cand('q2'), cand('q1', { line: 9 })];
    expect(queue(candidates, new Map(), { sessionSize: 1 }).map((e) => e.qid)).toEqual(['q1']);
    expect(queue(candidates, new Map()).map((e) => e.qid)).toEqual(['q1', 'q2']);
  });

  it('筛选：形态 / 题型 / 章节 / 标签 / 难度，空数组 = 不限制', () => {
    const candidates = [
      cand('qa', { type: '概念', chapter: '1. 基础', tags: ['a'], difficulty: '基础' }),
      cand('sc', { kind: 'single', type: '辨析', chapter: '2. 进阶', tags: ['b'], difficulty: '进阶' }),
      cand('mc', { kind: 'multiple', type: '概念', chapter: '2. 进阶' }),
    ];
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, kinds: ['single'] } }).map((e) => e.qid)).toEqual(['sc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, types: ['概念'] } }).map((e) => e.qid)).toEqual(['qa', 'mc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, chapters: ['2. 进阶'] } }).map((e) => e.qid)).toEqual(['sc', 'mc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, tags: ['b'] } }).map((e) => e.qid)).toEqual(['sc']);
    expect(queue(candidates, new Map(), { filters: { ...EMPTY_FILTERS, difficulty: ['基础'] } }).map((e) => e.qid)).toEqual(['qa']);
  });

  it('追问链排序：母题在前、追问紧随；多子题按行序；母题缺席保持原位', () => {
    const candidates = [
      cand('A', { line: 1 }),
      cand('C', { line: 3 }),
      cand('B', { line: 5, followUpOf: 'A' }),
      cand('D', { line: 2, followUpOf: 'Z' }), // Z 不在候选
      cand('B2', { line: 6, followUpOf: 'B' }), // 二级链
    ];
    expect(queue(candidates, new Map()).map((e) => e.qid)).toEqual(['A', 'B', 'B2', 'D', 'C']);
  });

  it('成环不悬挂：两题都在队列时都能出，且不无限循环', () => {
    const candidates = [
      cand('E', { line: 1, followUpOf: 'F' }),
      cand('F', { line: 2, followUpOf: 'E' }),
    ];
    const out = queue(candidates, new Map()).map((e) => e.qid);
    expect(out.sort()).toEqual(['E', 'F']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/srs.test.ts`
Expected: FAIL（`src/lib/srs.ts` 不存在）

- [ ] **Step 3: 实现 `src/lib/srs.ts`**

```ts
/**
 * 艾宾浩斯调度（纯函数、无 IO）。规则见 spec §7：
 * 优秀/良好升一档，勉强保持档位，不会重置；间隔 1/2/4/7/15/30/60 天；到期按本地日界。
 */
import type { BankKind } from './qbank';

export type Verdict = 'excellent' | 'good' | 'hard' | 'again';

export interface SrsState {
  qid: string;
  bankPath: string;
  id: string;
  stage: number;
  dueAt: number;
  lastAt: number;
  firstAt: number;
  lastScore: number | null;
  verdict: Verdict;
  reps: number;
  lapses: number;
}

export const INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60];
export const MAX_STAGE = INTERVALS_DAYS.length - 1;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const VERDICT_LABELS: Record<Verdict, string> = {
  excellent: '优秀', good: '良好', hard: '勉强', again: '不会',
};

/** 本地时区当日 0 点。 */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 按本地日历推进 N 天（返回当日 0 点），避免夏令时/月末误差。 */
export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

export function verdictFromScore(score: number): Verdict {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'hard';
  return 'again';
}

export function verdictFromChoice(kind: 'single' | 'multiple', picked: string[], correct: string[]): Verdict {
  const correctSet = new Set(correct);
  if (kind === 'single') {
    return picked.length === 1 && correctSet.has(picked[0]) ? 'excellent' : 'again';
  }
  const pickedSet = new Set(picked);
  let wrong = false;
  let missed = false;
  for (const k of pickedSet) if (!correctSet.has(k)) wrong = true;
  for (const k of correctSet) if (!pickedSet.has(k)) missed = true;
  if (wrong) return 'again';
  return missed ? 'hard' : 'excellent';
}

export function nextState(
  prev: SrsState | undefined,
  verdict: Verdict,
  now: number,
  meta: { qid: string; bankPath: string; id: string; score: number | null },
): SrsState {
  const prevStage = prev ? Math.min(MAX_STAGE, Math.max(0, prev.stage)) : 0;
  let stage: number;
  let dueAt: number;
  if (verdict === 'excellent' || verdict === 'good') {
    stage = Math.min(prevStage + 1, MAX_STAGE);
    dueAt = addDays(now, INTERVALS_DAYS[stage]);
  } else if (verdict === 'hard') {
    stage = prevStage;
    dueAt = addDays(now, 1);
  } else {
    stage = 0;
    dueAt = addDays(now, 1);
  }
  return {
    qid: meta.qid,
    bankPath: meta.bankPath,
    id: meta.id,
    stage,
    dueAt,
    lastAt: now,
    firstAt: prev ? prev.firstAt : now,
    lastScore: meta.score,
    verdict,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (verdict === 'again' ? 1 : 0),
  };
}

/** 已掌握：档位到顶且最近一次为优秀/良好（选择题与自评无分数，按 verdict 判定）。 */
export function isMastered(s: SrsState): boolean {
  return s.stage >= MAX_STAGE && (s.verdict === 'excellent' || s.verdict === 'good');
}

export interface QueueCandidate {
  qid: string;
  bankPath: string;
  id: string;
  kind: BankKind;
  type: string;
  chapter?: string;
  tags?: string[];
  difficulty?: string;
  followUpOf?: string;
  /** 题库在选择列表中的顺序（0 起）。 */
  bankIndex: number;
  /** 题库内行号。 */
  line: number;
}

export interface QueueFilters {
  kinds: string[];
  chapters: string[];
  types: string[];
  tags: string[];
  difficulty: string[];
}

export interface QueueEntry { qid: string; bankPath: string; id: string }

export interface BuildQueueInput {
  candidates: QueueCandidate[];
  srsByQid: Map<string, SrsState>;
  filters: QueueFilters;
  /** 0 = 不限。 */
  sessionSize: number;
  newPerDay: number;
  newIntroducedToday: number;
  now: number;
}

function matches(c: QueueCandidate, f: QueueFilters): boolean {
  if (f.kinds.length && !f.kinds.includes(c.kind)) return false;
  if (f.chapters.length && !(c.chapter && f.chapters.includes(c.chapter))) return false;
  if (f.types.length && !f.types.includes(c.type)) return false;
  if (f.tags.length && !(c.tags ?? []).some((t) => f.tags.includes(t))) return false;
  if (f.difficulty.length && !(c.difficulty && f.difficulty.includes(c.difficulty))) return false;
  return true;
}

/** 追问链稳定重排：追问移到母题之后（母题不在队列时保持原位）；成环安全。 */
function chainSort(queue: QueueCandidate[]): QueueCandidate[] {
  if (!queue.some((c) => c.followUpOf)) return queue;
  const pos = new Map(queue.map((c, i) => [c.qid, i]));
  const byBankId = new Map(queue.map((c) => [`${c.bankPath}\u0000${c.id}`, c]));
  const keyOf = (c: QueueCandidate): { root: number; depth: number } => {
    let depth = 0;
    let cursor = c;
    const seen = new Set<string>([c.qid]);
    while (cursor.followUpOf) {
      const parent = byBankId.get(`${cursor.bankPath}\u0000${cursor.followUpOf}`);
      if (!parent || seen.has(parent.qid)) break;
      seen.add(parent.qid);
      cursor = parent;
      depth += 1;
    }
    return { root: pos.get(cursor.qid) ?? pos.get(c.qid) ?? 0, depth };
  };
  const decorated = queue.map((c, i) => ({ c, i, key: keyOf(c) }));
  decorated.sort((a, b) => a.key.root - b.key.root || a.key.depth - b.key.depth || a.i - b.i);
  return decorated.map((d) => d.c);
}

export function buildQueue(input: BuildQueueInput): QueueEntry[] {
  const pool = input.candidates.filter((c) => matches(c, input.filters));
  const due: QueueCandidate[] = [];
  const fresh: QueueCandidate[] = [];
  for (const c of pool) {
    const s = input.srsByQid.get(c.qid);
    if (!s) fresh.push(c);
    else if (s.dueAt <= input.now) due.push(c);
  }
  due.sort((a, b) => {
    const sa = input.srsByQid.get(a.qid)!;
    const sb = input.srsByQid.get(b.qid)!;
    return sa.dueAt - sb.dueAt || sa.lastAt - sb.lastAt;
  });
  fresh.sort((a, b) => a.bankIndex - b.bankIndex || a.line - b.line);

  const quota = Math.max(0, input.newPerDay - Math.max(0, input.newIntroducedToday));
  const seen = new Set<string>();
  const merged = [...due, ...fresh.slice(0, quota)].filter((c) => {
    if (seen.has(c.qid)) return false;
    seen.add(c.qid);
    return true;
  });
  const capped = input.sessionSize > 0 ? merged.slice(0, input.sessionSize) : merged;
  return chainSort(capped).map((c) => ({ qid: c.qid, bankPath: c.bankPath, id: c.id }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/srs.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/srs.ts tests/unit/srs.test.ts
git commit -m "feat: 记忆调度纯函数（四档判分、日界到期、队列组装与追问链排序）"
```

---

### Task 3: 数据层（IndexedDB v2 + `src/data/memory.ts`）

**Files:**
- Modify: `src/data/db.ts`（`SCHEMA_VER = 2`，upgrade 增三个 store）
- Create: `src/data/memory.ts`
- Test: `tests/unit/memory.test.ts`、`tests/unit/db-migrate.test.ts`
- Modify: `tests/unit/db.test.ts`（「版本冲突自愈」用例改为打开 version 3，否则与 v2 同版不再冲突）

**Interfaces:**
- Consumes: `kvGet`/`kvSet`/`openDb`（db.ts）、`serialize`（serialize.ts）、`dayStart`/`addDays`/`isMastered`/`Verdict`/`SrsState`/`MAX_STAGE`（srs.ts）
- Produces（后续任务按此签名使用）：
  - `interface LlmConfig { baseUrl: string; apiKey: string; model: string }`
  - `interface MemoryFilters { kinds: string[]; chapters: string[]; types: string[]; tags: string[]; difficulty: string[] }`
  - `interface MemorySelection { banks: string[]; filters: MemoryFilters; sessionSize: number; newPerDay: number }`
  - `const SESSION_SIZE_CHOICES = [0, 10, 20, 50]`（0 = 不限）、`const DEFAULT_SELECTION: MemorySelection`
  - `interface MemoryAttempt { id?: number; qid; bankPath; idLabel; ts; mode: 'ai'|'self'|'choice'; score: number|null; verdict: Verdict; answer: string; hit: string[]; missed: string[]; picked?: string[]; correct?: string[]; comment: string; durationMs: number; hintUsed: boolean; revealed: boolean }`
  - `interface MemorySession { createdAt: number; items: { qid: string; bankPath: string; id: string }[]; index: number; answered: number; scores: number[]; startedAt: number }`
  - `sanitizeSelection(raw: unknown): MemorySelection`、`getSelection()`、`saveSelection(sel)`
  - `sanitizeLlmConfig(raw: unknown): LlmConfig | undefined`、`getLlmConfig()`、`saveLlmConfig(cfg)`
  - `sanitizeSrs(raw: unknown): SrsState | null`、`sanitizeAttempt(raw: unknown): MemoryAttempt | null`
  - `loadSrsMap(): Promise<Map<string, SrsState>>`、`putSrs(s: SrsState)`
  - `appendAttempt(a: Omit<MemoryAttempt, 'id'>)`、`listAttempts(opts?: { limit?: number; bankPath?: string })`
  - `getSession()`、`saveSession(s)`、`clearSession()`
  - `clearTrainingData()`（清 mem_srs / mem_attempts / memSession，保留题库缓存、模型配置与选择）
  - `exportMemory(): Promise<string>`、`importMemory(json: string): Promise<{ srs: number; attempts: number }>`
  - `interface MemoryStats {...}`、`summarize(attempts: MemoryAttempt[], srs: SrsState[], now?: number): MemoryStats`

- [ ] **Step 1: 写失败测试**

`tests/unit/memory.test.ts`：

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, kvGet, kvSet, openDb } from '../../src/data/db';
import {
  DEFAULT_SELECTION, SESSION_SIZE_CHOICES, appendAttempt, clearSession, clearTrainingData,
  exportMemory, getLlmConfig, getSelection, getSession, importMemory, listAttempts, loadSrsMap,
  putSrs, sanitizeAttempt, sanitizeLlmConfig, sanitizeSelection, sanitizeSrs, saveLlmConfig,
  saveSelection, saveSession, summarize,
  type MemoryAttempt,
} from '../../src/data/memory';
import type { SrsState } from '../../src/lib/srs';

const NOW = new Date(2026, 9, 19, 15, 30).getTime();
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => { await clearAllData(); });

function attempt(extra: Partial<MemoryAttempt> = {}): MemoryAttempt {
  return {
    qid: 'q1', bankPath: 'b.jsonl', idLabel: 'Q1', ts: NOW, mode: 'ai', score: 80, verdict: 'good',
    answer: 'a', hit: [], missed: [], comment: '', durationMs: 1000, hintUsed: false, revealed: false, ...extra,
  };
}

function srs(qid: string, extra: Partial<SrsState> = {}): SrsState {
  return {
    qid, bankPath: 'b.jsonl', id: qid, stage: 0, dueAt: NOW, lastAt: NOW, firstAt: NOW,
    lastScore: null, verdict: 'again', reps: 1, lapses: 0, ...extra,
  };
}

describe('sanitizeSelection', () => {
  it('非对象回退默认；非法字段回退、白名单与钳制', () => {
    expect(sanitizeSelection(null)).toEqual(DEFAULT_SELECTION);
    expect(sanitizeSelection([1])).toEqual(DEFAULT_SELECTION);
    const s = sanitizeSelection({
      banks: ['a.jsonl', 3, ''],
      filters: { kinds: ['qa', 'x'], chapters: 'nope', types: [1], tags: ['t'], difficulty: [] },
      sessionSize: 999, newPerDay: 999,
    });
    expect(s.banks).toEqual(['a.jsonl']);
    expect(s.filters).toEqual({ kinds: ['qa'], chapters: [], types: [], tags: ['t'], difficulty: [] });
    expect(s.sessionSize).toBe(20);
    expect(s.newPerDay).toBe(50);
    expect(SESSION_SIZE_CHOICES).toContain(sanitizeSelection({ sessionSize: 0 }).sessionSize);
  });
  it('读写往返', async () => {
    expect(await getSelection()).toEqual(DEFAULT_SELECTION);
    await saveSelection({ banks: ['b.jsonl'], filters: { kinds: ['single'], chapters: [], types: [], tags: [], difficulty: [] }, sessionSize: 10, newPerDay: 5 });
    const back = await getSelection();
    expect(back).toMatchObject({ banks: ['b.jsonl'], sessionSize: 10, newPerDay: 5 });
  });
});

describe('sanitizeLlmConfig / 读写', () => {
  it('三字段齐全才有效，否则 undefined；读写往返', async () => {
    expect(sanitizeLlmConfig(null)).toBeUndefined();
    expect(sanitizeLlmConfig({ baseUrl: 'https://x', apiKey: '', model: 'm' })).toBeUndefined();
    const cfg = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
    expect(sanitizeLlmConfig(cfg)).toEqual(cfg);
    expect(await getLlmConfig()).toBeUndefined();
    await saveLlmConfig(cfg);
    expect(await getLlmConfig()).toEqual(cfg);
  });
});

describe('进度与记录', () => {
  it('putSrs / loadSrsMap 往返', async () => {
    await putSrs(srs('q1', { stage: 2 }));
    await putSrs(srs('q2'));
    const map = await loadSrsMap();
    expect(map.size).toBe(2);
    expect(map.get('q1')?.stage).toBe(2);
  });

  it('appendAttempt / listAttempts：按时间倒序、bank 过滤、limit', async () => {
    await appendAttempt(attempt({ qid: 'a', ts: NOW - 10 }));
    await appendAttempt(attempt({ qid: 'b', ts: NOW, bankPath: 'c.jsonl' }));
    await appendAttempt(attempt({ qid: 'c', ts: NOW - 5 }));
    const all = await listAttempts();
    expect(all.map((a) => a.qid)).toEqual(['b', 'c', 'a']);
    expect((await listAttempts({ bankPath: 'c.jsonl' })).map((a) => a.qid)).toEqual(['b']);
    expect((await listAttempts({ limit: 2 })).map((a) => a.qid)).toEqual(['b', 'c']);
  });

  it('会话读写与清理', async () => {
    const session = { createdAt: NOW, items: [{ qid: 'q1', bankPath: 'b.jsonl', id: 'Q1' }], index: 0, answered: 0, scores: [], startedAt: NOW };
    await saveSession(session);
    expect((await getSession())?.items).toHaveLength(1);
    await clearSession();
    expect(await getSession()).toBeUndefined();
  });

  it('clearTrainingData 只清训练数据，保留模型配置 / 选择 / 题库缓存', async () => {
    await putSrs(srs('q1'));
    await appendAttempt(attempt());
    await saveSession({ createdAt: NOW, items: [], index: 0, answered: 0, scores: [], startedAt: NOW });
    await saveLlmConfig({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
    await saveSelection({ ...DEFAULT_SELECTION, banks: ['b.jsonl'] });
    await kvSet('llmConfig-keep', 1);
    await (await openDb()).put('mem_banks', { path: 'b.jsonl' }, 'b.jsonl');

    await clearTrainingData();
    expect(await loadSrsMap()).toEqual(new Map());
    expect(await listAttempts()).toEqual([]);
    expect(await getSession()).toBeUndefined();
    expect(await getLlmConfig()).toBeDefined();
    expect((await getSelection()).banks).toEqual(['b.jsonl']);
    expect((await openDb()).get('mem_banks', 'b.jsonl')).toBeDefined();
  });
});

describe('sanitizeSrs / sanitizeAttempt', () => {
  it('非法输入返回 null；字段钳制', () => {
    expect(sanitizeSrs(null)).toBeNull();
    expect(sanitizeSrs({ qid: 'x' })).toBeNull();
    const s = sanitizeSrs({ qid: 'q', bankPath: 'b', id: 'Q1', stage: 99, verdict: 'nope', reps: -3 });
    expect(s).toMatchObject({ stage: 6, verdict: 'again', reps: 0 });
    expect(sanitizeAttempt(null)).toBeNull();
    const a = sanitizeAttempt({ qid: 'q', bankPath: 'b', idLabel: 'Q1', ts: 1, mode: 'nope', verdict: 'nope', score: 'x', hit: [1, 'ok'] });
    expect(a).toMatchObject({ mode: 'ai', verdict: 'again', score: null, hit: ['ok'] });
  });
});

describe('导出 / 导入', () => {
  it('导出格式与不含模型配置；导入合并：srs 取新、attempts 去重', async () => {
    await putSrs(srs('q1', { lastAt: 100, stage: 1 }));
    await appendAttempt(attempt({ ts: 100 }));
    await saveLlmConfig({ baseUrl: 'https://x', apiKey: 'secret', model: 'm' });
    const json = await exportMemory();
    expect(json).not.toContain('secret');
    expect(JSON.parse(json)).toMatchObject({ app: 'md-reader', kind: 'memory', version: 1 });

    await clearAllData();
    const res = await importMemory(json);
    expect(res).toEqual({ srs: 1, attempts: 1 });
    const again = await importMemory(json); // 幂等：重复导入不重复追加
    expect(again).toEqual({ srs: 0, attempts: 0 });

    // 本地较新时不被覆盖
    await putSrs(srs('q1', { lastAt: 999, stage: 5 }));
    await importMemory(json);
    expect((await loadSrsMap()).get('q1')?.stage).toBe(5);
  });

  it('非法文件抛出可读错误', async () => {
    await expect(importMemory('not json')).rejects.toThrow('文件不是合法 JSON');
    await expect(importMemory('{"kind":"x"}')).rejects.toThrow('不是记忆训练数据文件');
  });
});

describe('summarize', () => {
  it('平均分只算 AI；档位分布、连续天数、今日已练、到期分布、14 天趋势', () => {
    const attempts = [
      attempt({ qid: 'a', ts: NOW, mode: 'ai', score: 80, verdict: 'good' }),
      attempt({ qid: 'b', ts: NOW, mode: 'choice', score: null, verdict: 'again' }),
      attempt({ qid: 'c', ts: NOW - DAY, mode: 'self', score: null, verdict: 'hard' }),
      attempt({ qid: 'd', ts: NOW - 3 * DAY, mode: 'ai', score: 90, verdict: 'excellent' }),
    ];
    const states = [
      srs('a', { dueAt: NOW - 1, stage: 6, verdict: 'good' }),
      srs('b', { dueAt: NOW + 2 * DAY }),
      srs('c', { dueAt: NOW + 5 * DAY }),
      srs('d', { dueAt: NOW + 20 * DAY, stage: 4 }),
    ];
    const st = summarize(attempts, states, NOW);
    expect(st.practiced).toBe(4);
    expect(st.mastered).toBe(1);
    expect(st.avgAiScore).toBe(85);
    expect(st.verdictCounts).toEqual({ excellent: 1, good: 1, hard: 1, again: 1 });
    expect(st.streak).toBe(2);
    expect(st.practicedToday).toBe(2);
    expect(st.dueToday).toBe(1);
    expect(st.due3).toBe(2);
    expect(st.due7).toBe(3);
    expect(st.trend).toHaveLength(14);
    expect(st.trend[13]).toMatchObject({ count: 2, avgScore: 80 });
  });
});
```

`tests/unit/db-migrate.test.ts`：

```ts
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { kvGet, openDb } from '../../src/data/db';

describe('IndexedDB v1 → v2 升级', () => {
  it('旧数据保留，新 store 可用', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mdreader', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['files', 'blobs', 'kv']) db.createObjectStore(name);
      };
      req.onsuccess = () => {
        const db = req.result;
        const put = db.transaction('kv', 'readwrite').objectStore('kv').put(42, 'legacy');
        put.onsuccess = () => { db.close(); resolve(); };
        put.onerror = () => reject(put.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    expect(db.objectStoreNames.contains('mem_banks')).toBe(true);
    expect(db.objectStoreNames.contains('mem_srs')).toBe(true);
    expect(db.objectStoreNames.contains('mem_attempts')).toBe(true);
    expect(await kvGet('legacy')).toBe(42);
  });
});
```

`tests/unit/db.test.ts` 修改：把「openDb 版本冲突时自愈」用例里的 `indexedDB.open('mdreader', 2)` 改为 `indexedDB.open('mdreader', 3)`（否则与 `SCHEMA_VER = 2` 同版，不再构成 VersionError 冲突）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/memory.test.ts tests/unit/db-migrate.test.ts`
Expected: FAIL（`src/data/memory.ts` 不存在 / `mem_srs` store 不存在）

- [ ] **Step 3: 修改 `src/data/db.ts`（v2）**

```ts
const DB_NAME = 'mdreader';
const SCHEMA_VER = 2;

function open(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, SCHEMA_VER, {
    upgrade(db, oldVersion) {
      for (const name of ['files', 'blobs', 'kv'] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('mem_banks')) db.createObjectStore('mem_banks');
        if (!db.objectStoreNames.contains('mem_srs')) db.createObjectStore('mem_srs');
        if (!db.objectStoreNames.contains('mem_attempts')) db.createObjectStore('mem_attempts', { autoIncrement: true });
      }
    },
  });
}
```

（其余函数不动；`clearAllData()` 语义不变——删库重建会一并清掉 `mem_*`。）

- [ ] **Step 4: 实现 `src/data/memory.ts`**

```ts
/**
 * 记忆训练数据层：选择配置 / 模型配置（kv）、进度（mem_srs）、记录（mem_attempts）、
 * 会话（kv memSession）、统计、导出/导入。数据只存本机。
 */
import { kvGet, kvSet, openDb } from './db';
import { serialize } from './serialize';
import { addDays, dayStart, isMastered, MAX_STAGE, type SrsState, type Verdict } from '../lib/srs';

export interface LlmConfig { baseUrl: string; apiKey: string; model: string }

export interface MemoryFilters {
  kinds: string[];
  chapters: string[];
  types: string[];
  tags: string[];
  difficulty: string[];
}

export interface MemorySelection {
  banks: string[];
  filters: MemoryFilters;
  /** 0 = 不限。 */
  sessionSize: number;
  newPerDay: number;
}

export const SESSION_SIZE_CHOICES = [0, 10, 20, 50];

export const DEFAULT_SELECTION: MemorySelection = {
  banks: [],
  filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] },
  sessionSize: 20,
  newPerDay: 10,
};

export interface MemoryAttempt {
  id?: number;
  qid: string;
  bankPath: string;
  idLabel: string;
  ts: number;
  mode: 'ai' | 'self' | 'choice';
  score: number | null;
  verdict: Verdict;
  answer: string;
  hit: string[];
  missed: string[];
  picked?: string[];
  correct?: string[];
  comment: string;
  durationMs: number;
  hintUsed: boolean;
  revealed: boolean;
}

export interface MemorySession {
  createdAt: number;
  items: { qid: string; bankPath: string; id: string }[];
  index: number;
  answered: number;
  scores: number[];
  startedAt: number;
}

export interface MemoryStats {
  practiced: number;
  mastered: number;
  avgAiScore: number | null;
  verdictCounts: Record<Verdict, number>;
  streak: number;
  practicedToday: number;
  dueToday: number;
  due3: number;
  due7: number;
  trend: { day: number; count: number; avgScore: number | null }[];
}

const SELECTION_KEY = 'memSelection';
const LLM_KEY = 'llmConfig';
const SESSION_KEY = 'memSession';
const VERDICTS: Verdict[] = ['excellent', 'good', 'hard', 'again'];
const MODES: MemoryAttempt['mode'][] = ['ai', 'self', 'choice'];

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) if (typeof item === 'string' && item.trim()) out.push(item.trim());
  return out;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function sanitizeSelection(raw: unknown): MemorySelection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SELECTION, filters: { ...DEFAULT_SELECTION.filters } };
  const r = raw as Record<string, unknown>;
  const f = (r.filters && typeof r.filters === 'object' && !Array.isArray(r.filters)) ? r.filters as Record<string, unknown> : {};
  const sessionSize = SESSION_SIZE_CHOICES.includes(num(r.sessionSize, 20)) ? num(r.sessionSize, 20) : 20;
  const newPerDay = Math.min(50, Math.max(0, Math.round(num(r.newPerDay, 10))));
  return {
    banks: strArray(r.banks),
    filters: {
      kinds: strArray(f.kinds).filter((k) => ['qa', 'single', 'multiple'].includes(k)),
      chapters: strArray(f.chapters),
      types: strArray(f.types),
      tags: strArray(f.tags),
      difficulty: strArray(f.difficulty),
    },
    sessionSize,
    newPerDay,
  };
}

export async function getSelection(): Promise<MemorySelection> {
  return sanitizeSelection(await kvGet(SELECTION_KEY));
}

export function saveSelection(sel: MemorySelection): Promise<void> {
  return serialize(() => kvSet(SELECTION_KEY, sanitizeSelection(sel)));
}

export function sanitizeLlmConfig(raw: unknown): LlmConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : '';
  const model = typeof r.model === 'string' ? r.model.trim() : '';
  return baseUrl && apiKey && model ? { baseUrl, apiKey, model } : undefined;
}

export async function getLlmConfig(): Promise<LlmConfig | undefined> {
  return sanitizeLlmConfig(await kvGet(LLM_KEY));
}

export function saveLlmConfig(cfg: LlmConfig): Promise<void> {
  return serialize(() => kvSet(LLM_KEY, { baseUrl: cfg.baseUrl.trim(), apiKey: cfg.apiKey.trim(), model: cfg.model.trim() }));
}

export function sanitizeSrs(raw: unknown): SrsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.qid !== 'string' || !r.qid) return null;
  if (typeof r.bankPath !== 'string' || typeof r.id !== 'string') return null;
  const verdict = VERDICTS.includes(r.verdict as Verdict) ? (r.verdict as Verdict) : 'again';
  const stage = Math.min(MAX_STAGE, Math.max(0, Math.round(num(r.stage, 0))));
  const lastAt = num(r.lastAt, 0);
  return {
    qid: r.qid,
    bankPath: r.bankPath,
    id: r.id,
    stage,
    dueAt: num(r.dueAt, 0),
    lastAt,
    firstAt: num(r.firstAt, lastAt),
    lastScore: typeof r.lastScore === 'number' && Number.isFinite(r.lastScore) ? r.lastScore : null,
    verdict,
    reps: Math.max(0, Math.round(num(r.reps, 0))),
    lapses: Math.max(0, Math.round(num(r.lapses, 0))),
  };
}

export function sanitizeAttempt(raw: unknown): MemoryAttempt | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.qid !== 'string' || !r.qid) return null;
  if (typeof r.bankPath !== 'string') return null;
  const mode = MODES.includes(r.mode as MemoryAttempt['mode']) ? (r.mode as MemoryAttempt['mode']) : 'ai';
  const verdict = VERDICTS.includes(r.verdict as Verdict) ? (r.verdict as Verdict) : 'again';
  return {
    ...(typeof r.id === 'number' ? { id: r.id } : {}),
    qid: r.qid,
    bankPath: r.bankPath,
    idLabel: typeof r.idLabel === 'string' ? r.idLabel : '',
    ts: num(r.ts, 0),
    mode,
    score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null,
    verdict,
    answer: typeof r.answer === 'string' ? r.answer : '',
    hit: strArray(r.hit),
    missed: strArray(r.missed),
    ...(Array.isArray(r.picked) ? { picked: strArray(r.picked) } : {}),
    ...(Array.isArray(r.correct) ? { correct: strArray(r.correct) } : {}),
    comment: typeof r.comment === 'string' ? r.comment : '',
    durationMs: Math.max(0, Math.round(num(r.durationMs, 0))),
    hintUsed: r.hintUsed === true,
    revealed: r.revealed === true,
  };
}

export async function loadSrsMap(): Promise<Map<string, SrsState>> {
  const all = (await (await openDb()).getAll('mem_srs')) as unknown[];
  const map = new Map<string, SrsState>();
  for (const item of all) {
    const s = sanitizeSrs(item);
    if (s) map.set(s.qid, s);
  }
  return map;
}

export async function putSrs(state: SrsState): Promise<void> {
  await (await openDb()).put('mem_srs', state, state.qid);
}

export async function appendAttempt(a: Omit<MemoryAttempt, 'id'>): Promise<void> {
  await (await openDb()).add('mem_attempts', a);
}

export async function listAttempts(opts: { limit?: number; bankPath?: string } = {}): Promise<MemoryAttempt[]> {
  let all = ((await (await openDb()).getAll('mem_attempts')) as unknown[])
    .map(sanitizeAttempt)
    .filter((a): a is MemoryAttempt => a !== null);
  if (opts.bankPath) all = all.filter((a) => a.bankPath === opts.bankPath);
  all.sort((a, b) => b.ts - a.ts || (b.id ?? 0) - (a.id ?? 0));
  return opts.limit ? all.slice(0, opts.limit) : all;
}

export async function getSession(): Promise<MemorySession | undefined> {
  const raw = await kvGet<MemorySession>(SESSION_KEY);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return undefined;
  return raw;
}

export function saveSession(s: MemorySession): Promise<void> {
  return serialize(() => kvSet(SESSION_KEY, s));
}

export async function clearSession(): Promise<void> {
  await (await openDb()).delete('kv', SESSION_KEY);
}

/** 清除训练进度与记录、会话；保留题库缓存、模型配置与范围选择。 */
export async function clearTrainingData(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'mem_attempts', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('mem_srs').clear(),
    tx.objectStore('mem_attempts').clear(),
    tx.objectStore('kv').delete(SESSION_KEY),
    tx.done,
  ]);
}

export async function exportMemory(): Promise<string> {
  const db = await openDb();
  const [srs, attempts] = await Promise.all([db.getAll('mem_srs'), db.getAll('mem_attempts')]);
  return JSON.stringify({ app: 'md-reader', kind: 'memory', version: 1, exportedAt: Date.now(), srs, attempts }, null, 2);
}

export async function importMemory(json: string): Promise<{ srs: number; attempts: number }> {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('文件不是合法 JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data as { kind?: unknown }).kind !== 'memory') {
    throw new Error('不是记忆训练数据文件');
  }
  const rawSrs = Array.isArray((data as { srs?: unknown }).srs) ? (data as { srs: unknown[] }).srs : [];
  const rawAttempts = Array.isArray((data as { attempts?: unknown }).attempts) ? (data as { attempts: unknown[] }).attempts : [];

  const db = await openDb();
  const tx = db.transaction(['mem_srs', 'mem_attempts'], 'readwrite');
  const srsStore = tx.objectStore('mem_srs');
  const attStore = tx.objectStore('mem_attempts');
  let srsImported = 0;
  let attemptsImported = 0;

  const existingSrs = new Map(((await srsStore.getAll()) as SrsState[]).map((s) => [s.qid, s]));
  for (const item of rawSrs) {
    const s = sanitizeSrs(item);
    if (!s) continue;
    const cur = existingSrs.get(s.qid);
    if (cur && cur.lastAt >= s.lastAt) continue;
    await srsStore.put(s, s.qid);
    srsImported += 1;
  }

  const existingKeys = new Set(((await attStore.getAll()) as MemoryAttempt[]).map((a) => `${a.qid}|${a.ts}|${a.mode}`));
  for (const item of rawAttempts) {
    const a = sanitizeAttempt(item);
    if (!a) continue;
    const key = `${a.qid}|${a.ts}|${a.mode}`;
    if (existingKeys.has(key)) continue;
    const { id: _ignored, ...rest } = a;
    await attStore.add(rest);
    existingKeys.add(key);
    attemptsImported += 1;
  }
  await tx.done;
  return { srs: srsImported, attempts: attemptsImported };
}

export function summarize(attempts: MemoryAttempt[], srs: SrsState[], now: number = Date.now()): MemoryStats {
  const verdictCounts: Record<Verdict, number> = { excellent: 0, good: 0, hard: 0, again: 0 };
  for (const a of attempts) verdictCounts[a.verdict] += 1;

  const aiScores = attempts.filter((a) => a.mode === 'ai' && typeof a.score === 'number') as (MemoryAttempt & { score: number })[];
  const avgAiScore = aiScores.length
    ? Math.round((aiScores.reduce((s, a) => s + a.score, 0) / aiScores.length) * 10) / 10
    : null;

  const today = dayStart(now);
  const practicedToday = attempts.filter((a) => a.ts >= today).length;

  const days = new Set(attempts.map((a) => dayStart(a.ts)));
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  let dueToday = 0;
  let due3 = 0;
  let due7 = 0;
  const in3 = addDays(today, 3);
  const in7 = addDays(today, 7);
  for (const s of srs) {
    if (s.dueAt <= now) dueToday += 1;
    if (s.dueAt <= in3) due3 += 1;
    if (s.dueAt <= in7) due7 += 1;
  }

  const trend: MemoryStats['trend'] = [];
  for (let i = 13; i >= 0; i--) {
    const from = addDays(today, -i);
    const to = addDays(from, 1);
    const inDay = attempts.filter((a) => a.ts >= from && a.ts < to);
    const ai = inDay.filter((a) => a.mode === 'ai' && typeof a.score === 'number') as (MemoryAttempt & { score: number })[];
    trend.push({
      day: from,
      count: inDay.length,
      avgScore: ai.length ? Math.round(ai.reduce((s, a) => s + a.score, 0) / ai.length) : null,
    });
  }

  return {
    practiced: new Set(attempts.map((a) => a.qid)).size,
    mastered: srs.filter(isMastered).length,
    avgAiScore,
    verdictCounts,
    streak,
    practicedToday,
    dueToday,
    due3,
    due7,
    trend,
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/unit/memory.test.ts tests/unit/db-migrate.test.ts tests/unit/db.test.ts`
Expected: PASS

- [ ] **Step 6: 全量单测回归 + 提交**

Run: `npm test`
Expected: 全绿（含既有 200 条）

```bash
git add src/data/db.ts src/data/memory.ts tests/unit/memory.test.ts tests/unit/db-migrate.test.ts tests/unit/db.test.ts
git commit -m "feat: IndexedDB v2 与记忆训练数据层（进度/记录/统计/导出导入）"
```

---

### Task 4: 题库索引与按需拉取（`src/data/qbankIndex.ts`）

**Files:**
- Create: `src/data/qbankIndex.ts`
- Test: `tests/unit/qbank-index.test.ts`

**Interfaces:**
- Consumes: `parseBankText`/`BankQuestion`/`ParseWarning`（qbank.ts）、`kvGet`/`getBlob`/`putBlob`/`openDb`（db.ts）、`GitHubClient`（仅类型：`Pick<GitHubClient, 'getBlobText'>`）
- Produces（后续任务按此签名使用）：
  - `interface BankMeta { path: string; name: string; sha: string; size: number; fetched: boolean; questionCount: number | null; issueCount: number | null }`
  - `interface ParsedBank { path: string; sha: string; name: string; parsedAt: number; questions: BankQuestion[]; warnings: ParseWarning[] }`
  - `bankName(path: string): string`
  - `listBanks(): Promise<BankMeta[]>`
  - `getParsedBank(path: string): Promise<ParsedBank | undefined>`
  - `ensureBankLoaded(path: string, client: Pick<GitHubClient, 'getBlobText'>): Promise<ParsedBank>`（`config` 从 kv 读取；不依赖 React）

- [ ] **Step 1: 写失败测试** `tests/unit/qbank-index.test.ts`

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllData, kvSet, openDb, putBlob } from '../../src/data/db';
import { bankName, ensureBankLoaded, listBanks } from '../../src/data/qbankIndex';

const BANK_PATH = '题库/示例.jsonl';
const QA_LINE = JSON.stringify({ id: 'Q1.1', type: '概念', question: '什么是事件循环？', answer: '- 事件循环…' });
const SC_LINE = JSON.stringify({
  id: 'Q1.2', kind: 'single', type: '概念', question: '选哪个？',
  options: [{ key: 'A', text: '对' }, { key: 'B', text: '错' }], correct: ['A'],
});
const BANK_TEXT = `${QA_LINE}\n${SC_LINE}\n坏行\n`;
const CFG = { owner: 'o', repo: 'r', branch: 'main' };

function treeWith(entries: { path: string; sha: string }[]) {
  return { syncedAt: 1, entries: entries.map((e) => ({ path: e.path, sha: e.sha, size: 100, type: 'blob' })) };
}

beforeEach(async () => { await clearAllData(); });

describe('bankName / listBanks', () => {
  it('bankName 去目录与扩展名', () => {
    expect(bankName('题库/Node 卷.jsonl')).toBe('Node 卷');
    expect(bankName('a.JSONL')).toBe('a');
  });

  it('只列 .jsonl、排除 archive/、按路径排序', async () => {
    await kvSet('tree', treeWith([
      { path: 'b.md', sha: 's1' },
      { path: 'archive/旧.jsonl', sha: 's2' },
      { path: '题库/B卷.jsonl', sha: 's3' },
      { path: '题库/A卷.jsonl', sha: 's4' },
    ]));
    const banks = await listBanks();
    expect(banks.map((b) => b.path)).toEqual(['题库/A卷.jsonl', '题库/B卷.jsonl']);
    expect(banks[0]).toMatchObject({ name: 'A卷', fetched: false, questionCount: null, issueCount: null });
  });

  it('缓存与 sha 一致时标记 fetched 并带题量/问题数', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-1' }]));
    await (await openDb()).put('mem_banks', {
      path: BANK_PATH, sha: 'sha-1', name: '示例', parsedAt: 1,
      questions: [{ qid: 'q_x' }], warnings: [{ line: 3, kind: 'invalid-json', message: 'x' }],
    }, BANK_PATH);
    const [bank] = await listBanks();
    expect(bank).toMatchObject({ fetched: true, questionCount: 1, issueCount: 1 });
  });
});

describe('ensureBankLoaded', () => {
  it('拉取 → 解析 → 缓存；二次调用不再请求', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-1' }]));
    await kvSet('config', CFG);
    const client = { getBlobText: vi.fn(async () => BANK_TEXT) };

    const first = await ensureBankLoaded(BANK_PATH, client);
    expect(client.getBlobText).toHaveBeenCalledTimes(1);
    expect(first.questions).toHaveLength(2);
    expect(first.warnings).toHaveLength(1);
    expect(first.questions[0].qid).toBeTruthy();

    const second = await ensureBankLoaded(BANK_PATH, client);
    expect(client.getBlobText).toHaveBeenCalledTimes(1);
    expect(second.questions).toHaveLength(2);
  });

  it('sha 变化后重新解析；优先用 blobs 缓存文本（不再请求）', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-2' }]));
    await kvSet('config', CFG);
    const updated = `${JSON.stringify({ id: 'Q9', type: '概念', question: '新题？', answer: '- 新答' })}\n`;
    await putBlob('sha-2', new Blob([updated], { type: 'application/json' }));
    const client = { getBlobText: vi.fn(async () => { throw new Error('should not be called'); }) };

    const parsed = await ensureBankLoaded(BANK_PATH, client);
    expect(client.getBlobText).not.toHaveBeenCalled();
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].id).toBe('Q9');
  });

  it('离线且无缓存 → 可读错误；不在目录树 → 先更新目录', async () => {
    await kvSet('tree', treeWith([{ path: BANK_PATH, sha: 'sha-1' }]));
    await kvSet('config', CFG);
    const failing = { getBlobText: vi.fn(async () => { throw new Error('network down'); }) };
    await expect(ensureBankLoaded(BANK_PATH, failing)).rejects.toThrow('题库首次获取需要联网');
    await expect(ensureBankLoaded('不存在.jsonl', failing)).rejects.toThrow('请先更新目录');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/qbank-index.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/data/qbankIndex.ts`**

```ts
/**
 * 题库索引：目录树中的 .jsonl（排除 archive/）→ 按需拉取 / 解析 / 按 sha 缓存。
 * 原文缓存在 blobs（同 sha 同内容），解析结果缓存在 mem_banks。
 */
import type { GitHubClient } from './github';
import { getBlob, kvGet, openDb, putBlob } from './db';
import { parseBankText, type BankQuestion, type ParseWarning } from '../lib/qbank';

export interface BankMeta {
  path: string;
  name: string;
  sha: string;
  size: number;
  fetched: boolean;
  questionCount: number | null;
  issueCount: number | null;
}

export interface ParsedBank {
  path: string;
  sha: string;
  name: string;
  parsedAt: number;
  questions: BankQuestion[];
  warnings: ParseWarning[];
}

interface TreeEntryLite { path: string; sha: string; size: number; type: string }
interface TreeCache { entries: TreeEntryLite[] }
interface RepoRef { owner: string; repo: string; branch: string }

export function bankName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.jsonl$/i, '');
}

function isBankEntry(e: TreeEntryLite): boolean {
  return /\.jsonl$/i.test(e.path) && !e.path.startsWith('archive/');
}

export async function getParsedBank(path: string): Promise<ParsedBank | undefined> {
  return (await openDb()).get('mem_banks', path) as Promise<ParsedBank | undefined>;
}

export async function listBanks(): Promise<BankMeta[]> {
  const tree = await kvGet<TreeCache>('tree');
  const entries = (tree?.entries ?? []).filter(isBankEntry).sort((a, b) => a.path.localeCompare(b.path));
  const metas: BankMeta[] = [];
  for (const e of entries) {
    const cached = await getParsedBank(e.path);
    const fresh = cached && cached.sha === e.sha;
    metas.push({
      path: e.path,
      name: bankName(e.path),
      sha: e.sha,
      size: e.size,
      fetched: Boolean(fresh),
      questionCount: fresh ? cached!.questions.length : null,
      issueCount: fresh ? cached!.warnings.length : null,
    });
  }
  return metas;
}

export async function ensureBankLoaded(
  path: string,
  client: Pick<GitHubClient, 'getBlobText'>,
): Promise<ParsedBank> {
  const tree = await kvGet<TreeCache>('tree');
  const entry = tree?.entries.find((e) => e.path === path);
  if (!entry) throw new Error('题库不在本地目录树中，请先更新目录');

  const cached = await getParsedBank(path);
  if (cached && cached.sha === entry.sha) return cached;

  let text: string | null = null;
  const blob = await getBlob(entry.sha);
  if (blob) text = await blob.blob.text();

  if (text === null) {
    const cfg = await kvGet<RepoRef>('config');
    if (!cfg) throw new Error('未配置仓库，请先在设置中填写');
    try {
      text = await client.getBlobText(cfg.owner, cfg.repo, entry.sha);
    } catch {
      throw new Error('题库首次获取需要联网，请连网后重试');
    }
    await putBlob(entry.sha, new Blob([text], { type: 'application/json' }));
  }

  const { questions, warnings } = parseBankText(text);
  const parsed: ParsedBank = { path, sha: entry.sha, name: bankName(path), parsedAt: Date.now(), questions, warnings };
  await (await openDb()).put('mem_banks', parsed, path);
  return parsed;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/qbank-index.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/data/qbankIndex.ts tests/unit/qbank-index.test.ts
git commit -m "feat: 题库索引与按需拉取（blob 原文缓存 + sha 解析缓存 + 体检计数）"
```

---

### Task 5: 模型客户端（`src/data/llm.ts`）

**Files:**
- Create: `src/data/llm.ts`
- Test: `tests/unit/llm.test.ts`

**Interfaces:**
- Consumes: `LlmConfig`（memory.ts，仅类型）、`verdictFromScore`/`Verdict`（srs.ts）
- Produces（后续任务按此签名使用）：
  - `type LlmErrorKind = 'auth' | 'notfound' | 'ratelimit' | 'timeout' | 'network' | 'server' | 'parse'`
  - `class LlmError extends Error { kind; status? }`
  - `interface ScoreInput { type; chapter?; question; prompt?; answer; userAnswer }`
  - `interface ScoreResult { score: number; verdict: Verdict; hit: string[]; missed: string[]; comment: string }`
  - `const DEFAULT_TIMEOUT_MS = 45_000`
  - `isLlmConfigured(cfg: LlmConfig | undefined | null): cfg is LlmConfig`
  - `chatCompletionsUrl(baseUrl: string): string`
  - `truncateText(text: string, max: number): string`
  - `extractScoreJson(text: string): unknown | null`、`toScoreResult(raw: unknown): ScoreResult | null`
  - `scoreAnswer(cfg, input, opts?: { signal?; timeoutMs?; fetchImpl? }): Promise<ScoreResult>`（解析失败自动重试一次）
  - `testConnection(cfg, opts?): Promise<void>`

- [ ] **Step 1: 写失败测试** `tests/unit/llm.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  LlmError, chatCompletionsUrl, extractScoreJson, isLlmConfigured, scoreAnswer, testConnection, toScoreResult,
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

  it('LlmError 可识别', async () => {
    const fetchImpl = vi.fn(async () => chat('x', 401));
    const err = await scoreAnswer(CFG, INPUT, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
  });
});

describe('testConnection', () => {
  it('2xx 视为可用；401 抛 auth', async () => {
    await expect(testConnection(CFG, { fetchImpl: vi.fn(async () => chat('pong')) })).resolves.toBeUndefined();
    await expect(testConnection(CFG, { fetchImpl: vi.fn(async () => chat('x', 401)) })).rejects.toMatchObject({ kind: 'auth' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/llm.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/data/llm.ts`**

```ts
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

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmRequestOpts { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch }

export function isLlmConfigured(cfg: LlmConfig | undefined | null): cfg is LlmConfig {
  return Boolean(cfg && cfg.baseUrl.trim() && cfg.apiKey.trim() && cfg.model.trim());
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
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

async function requestChat(cfg: LlmConfig, messages: ChatMessage[], opts: LlmRequestOpts): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  if (opts.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    let res: Response;
    try {
      res = await fetchImpl(chatCompletionsUrl(cfg.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 }),
        signal: controller.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;               // 外部取消：原样抛出，页面忽略
      if (controller.signal.aborted) throw new LlmError('timeout', '请求超时');
      throw new LlmError('network', '网络不可用（也可能是服务端未允许跨域）');
    }
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', 'Key 无效或无权限', res.status);
    if (res.status === 404) throw new LlmError('notfound', 'URL 或模型名不存在', 404);
    if (res.status === 429) throw new LlmError('ratelimit', '限流，请稍后重试', 429);
    if (res.status >= 500) throw new LlmError('server', `服务端错误 ${res.status}`, res.status);
    if (!res.ok) throw new LlmError('server', `请求失败 ${res.status}`, res.status);

    let data: unknown;
    try { data = await res.json(); } catch { throw new LlmError('parse', '响应不是合法 JSON'); }
    const content = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new LlmError('parse', '响应缺少内容');
    return content;
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
  await requestChat(cfg, [{ role: 'user', content: 'ping（仅测试连通性，请直接回复 pong）' }], opts);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/llm.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/data/llm.ts tests/unit/llm.test.ts
git commit -m "feat: 模型客户端（OpenAI 兼容评分契约、脏 JSON 重试、错误映射、测试连接）"
```

---

### Task 6: 概览页与入口（路由 / 首页入口 / CSP / 题库选择 / 模型设置）

**Files:**
- Modify: `src/app/nav.ts`、`src/App.tsx`、`src/pages/HomePage.tsx`、`index.html`
- Create: `src/pages/MemoryPage.tsx`、`src/components/memory/LlmConfigForm.tsx`、`src/styles/memory.css`
- Modify: `tests/e2e/fixtures.ts`（新增题库 blob + `readStore` 辅助）
- Test: `tests/e2e/memory.spec.ts`（用例 1）

**Interfaces:**
- Consumes: T1–T5 全部模块；`useToken`、`useSync`、`GitHubClient`、`showToast`
- Produces（后续任务按此使用）：
  - `MEMORY = '#/memory'`、`MEMORY_TRAIN = '#/memory/train'`、`MEMORY_RECORDS = '#/memory/records'`（nav.ts）
  - `MemoryPage`（`#/memory`）、`LlmConfigForm({ cfg, onChange })`
  - fixture：`BANK_PATH`、`BANK_TEXT`、`readStore(page, storeName, key?)`

- [ ] **Step 1: 扩展 e2e fixtures**

在 `tests/e2e/fixtures.ts` 中：

1) 顶部常量区新增题库（注意：`.jsonl` 不进 `files` store，不影响既有 `.tree-item` = 3 的断言）：

```ts
/** 记忆助手 e2e 题库：5 道合法题（问答 ×2、单选、多选、追问）+ 1 行坏行。 */
export const BANK_PATH = '题库/示例题库.jsonl';
export const BANK_TEXT = [
  JSON.stringify({ id: 'Q1.1', type: '概念', chapter: '1. 基础', question: '什么是事件循环？', hint: '想 libuv', answer: '- 事件循环负责调度异步回调。\n- 由 libuv 提供。', tags: ['事件循环'] }),
  JSON.stringify({ id: 'Q1.2', type: '概念', chapter: '1. 基础', question: '什么是微任务？', answer: '- Promise 回调进入微任务队列。' }),
  JSON.stringify({ id: 'Q2.1', kind: 'single', type: '辨析', chapter: '2. 进阶', question: '负责事件循环的内置依赖库是？', options: [{ key: 'A', text: 'libuv' }, { key: 'B', text: 'V8' }], correct: ['A'], answer: 'libuv 提供事件循环与线程池。' }),
  JSON.stringify({ id: 'Q2.2', kind: 'multiple', type: '辨析', chapter: '2. 进阶', question: '以下哪些是内置依赖库？', options: [{ key: 'A', text: 'V8' }, { key: 'B', text: 'libuv' }, { key: 'C', text: 'React' }], correct: ['A', 'B'] }),
  JSON.stringify({ id: 'Q2.3', type: '追问', chapter: '2. 进阶', question: 'poll 阻塞时来了 I/O 会怎样？', answer: '- 会被唤醒处理。', followUpOf: 'Q1.1' }),
  '坏行',
].join('\n') + '\n';
```

2) `TREE` 追加一条（放最后）：

```ts
  { path: BANK_PATH, mode: '100644', type: 'blob', sha: 'sha-bank', size: BANK_TEXT.length },
```

3) `DOCS`（sha → 正文）追加：

```ts
  'sha-bank': BANK_TEXT,
```

4) 文件末尾新增通用 store 读取辅助（供记忆用例断言 `mem_srs` / `mem_attempts`）：

```ts
/** 读取任意 object store 的全部记录（无 key）或单条（有 key）；失败返回 null。 */
export async function readStore(page: Page, store: string, key?: string): Promise<unknown> {
  return page.evaluate(
    (args) =>
      new Promise<unknown>((resolve) => {
        const req = indexedDB.open('mdreader');
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction(args.store, 'readonly');
            const op = args.key === undefined ? tx.objectStore(args.store).getAll() : tx.objectStore(args.store).get(args.key);
            op.onsuccess = () => { resolve(op.result ?? null); db.close(); };
            op.onerror = () => { resolve(null); db.close(); };
          } catch { resolve(null); db.close(); }
        };
        req.onerror = () => resolve(null);
      }),
    { store, key },
  );
}
```

- [ ] **Step 2: 写失败 e2e（用例 1）** `tests/e2e/memory.spec.ts`

```ts
import { expect, test } from '@playwright/test';
import { configureAndSync, readKv } from './fixtures';

test('记忆助手：入口可见、题库拉取体检、选择持久化', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: '记忆助手' }).click();
  await expect(page.getByRole('heading', { name: '记忆助手', level: 1 })).toBeVisible();
  await expect(page.getByText('未配置模型，将使用「对照参考答案 + 自评」模式。')).toBeVisible();

  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await expect(bank).toContainText('未获取');

  await bank.getByRole('checkbox').check();
  await expect(bank).toContainText('5 题');
  await expect(bank).toContainText('1 处问题');

  // 选择落库
  await expect.poll(async () => (await readKv(page, 'memSelection') as { banks?: string[] } | undefined)?.banks)
    .toEqual(['题库/示例题库.jsonl']);

  // 筛选选项来自已加载题库
  await expect(page.getByRole('group', { name: '题型' })).toContainText('概念');

  // 刷新后仍勾选、题量仍在（缓存命中，无需再拉取）
  await page.reload();
  await expect(bank.getByRole('checkbox')).toBeChecked();
  await expect(bank).toContainText('5 题');
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx playwright test tests/e2e/memory.spec.ts -g "入口可见"`
Expected: FAIL（首页无「记忆助手」入口 / 路由不存在）

- [ ] **Step 4: 实现（分四小步）**

4a. `src/app/nav.ts` 追加：

```ts
export const MEMORY = '#/memory';
export const MEMORY_TRAIN = '#/memory/train';
export const MEMORY_RECORDS = '#/memory/records';
```

4b. `src/App.tsx`：import 三个页面并注册路由：

```tsx
    { path: 'memory', element: <MemoryPage /> },
    { path: 'memory/train', element: <MemoryTrainPage /> },
    { path: 'memory/records', element: <MemoryRecordsPage /> },
```

（`MemoryTrainPage` / `MemoryRecordsPage` 在 T7 / T9 实现；本任务先各建一个占位导出，T7/T9 再替换为完整实现——占位内容为 `export default function MemoryXPage() { return null; }`。）

4c. `index.html` CSP 行改为：

```html
      content="default-src 'self'; connect-src 'self' https:; img-src 'self' data: blob: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'none'"
```

4d. `src/pages/HomePage.tsx`：import `MEMORY`，在标题右侧设置图标前新增入口：

```tsx
        <a className="home-settings" href={MEMORY} aria-label="记忆助手" title="记忆助手">
          <MemoryIcon />
        </a>
```

并在 `SettingsIcon` 旁新增图标组件：

```tsx
/** 记忆助手入口图标（卡片列表意象）。 */
function MemoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
        d="M5 4h11a1 1 0 0 1 1 1v11H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Zm12 3h2a1 1 0 0 1 1 1v9a3 3 0 0 1-3 3H7M8 8h6M8 12h6"
      />
    </svg>
  );
}
```

- [ ] **Step 6: 实现 `src/components/memory/LlmConfigForm.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { LlmError, isLlmConfigured, testConnection } from '../../data/llm';
import type { LlmConfig } from '../../data/memory';
import { showToast } from '../../lib/toast';

const EMPTY: LlmConfig = { baseUrl: '', apiKey: '', model: '' };

function errorText(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  return err instanceof Error ? err.message : '连接失败';
}

/** 模型设置（spec §9）：保存只在通过校验后进行；测试连接复用同一配置。 */
export default function LlmConfigForm(props: { cfg: LlmConfig | undefined; onChange: (cfg: LlmConfig) => void }) {
  const [draft, setDraft] = useState<LlmConfig>(props.cfg ?? EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (props.cfg) setDraft(props.cfg); }, [props.cfg]);

  const onSave = () => {
    if (!isLlmConfigured(draft)) { showToast('请先完整填写 URL / Key / 模型名', { kind: 'error' }); return; }
    props.onChange(draft);
    showToast('已保存');
  };

  const onTest = async () => {
    if (!isLlmConfigured(draft)) { showToast('请先完整填写 URL / Key / 模型名', { kind: 'error' }); return; }
    setBusy(true);
    try {
      await testConnection(draft);
      showToast('连接成功');
    } catch (err) {
      showToast(`连接失败：${errorText(err)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="memory-card" aria-labelledby="memory-llm-title">
      <h2 id="memory-llm-title" className="memory-card-title">模型设置（AI 评分）</h2>
      <label className="memory-field">
        <span>Base URL</span>
        <input value={draft.baseUrl} placeholder="https://api.example.com/v1" autoComplete="off"
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
      </label>
      <label className="memory-field">
        <span>API Key</span>
        <input type="password" value={draft.apiKey} placeholder="仅存本机" autoComplete="off"
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
      </label>
      <label className="memory-field">
        <span>模型名</span>
        <input value={draft.model} placeholder="如 deepseek-chat" autoComplete="off"
          onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
      </label>
      <div className="memory-row" style={{ marginTop: 10 }}>
        <button type="button" className="memory-primary" style={{ width: 'auto' }} disabled={busy} onClick={onSave}>保存</button>
        <button type="button" className="memory-chip" disabled={busy} onClick={() => void onTest()}>
          {busy ? '测试中…' : '测试连接'}
        </button>
      </div>
      <p className="memory-note">
        问答评分时会把题干、参考答案与你的作答发送到你填写的地址；Key 仅保存在本机。
        直连需服务端允许浏览器跨域（CORS），Ollama 需配置 <code>OLLAMA_ORIGINS</code>。
      </p>
    </section>
  );
}
```

- [ ] **Step 7: 实现 `src/pages/MemoryPage.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOME, MEMORY_RECORDS, MEMORY_TRAIN, toRouterPath } from '../app/nav';
import LlmConfigForm from '../components/memory/LlmConfigForm';
import { GitHubClient } from '../data/github';
import { isLlmConfigured } from '../data/llm';
import {
  SESSION_SIZE_CHOICES, getLlmConfig, getSelection, loadSrsMap, listAttempts,
  saveLlmConfig, saveSelection, saveSession, summarize,
  type LlmConfig, type MemoryAttempt, type MemorySelection,
} from '../data/memory';
import { ensureBankLoaded, getParsedBank, listBanks, type BankMeta, type ParsedBank } from '../data/qbankIndex';
import { buildQueue, dayStart, isMastered, type QueueCandidate, type SrsState } from '../lib/srs';
import { showToast } from '../lib/toast';
import { useSync } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';
import '../styles/memory.css';

const KIND_OPTIONS = [
  { value: 'qa', label: '问答' },
  { value: 'single', label: '单选' },
  { value: 'multiple', label: '多选' },
];

function FilterRow(props: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  single?: boolean;
}) {
  const { label, options, selected, onToggle, single } = props;
  return (
    <div className="memory-row">
      <span className="memory-row-label">{label}</span>
      <div className="memory-chips" role="group" aria-label={label}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role={single ? 'radio' : 'checkbox'}
              aria-checked={on}
              className={on ? 'memory-chip memory-chip-on' : 'memory-chip'}
              onClick={() => onToggle(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MemoryPage() {
  const navigate = useNavigate();
  const { token } = useToken();
  const { lastSyncAt } = useSync();

  const [banks, setBanks] = useState<BankMeta[] | null>(null);
  const [selection, setSelection] = useState<MemorySelection | null>(null);
  const [parsed, setParsed] = useState<Map<string, ParsedBank>>(new Map());
  const [srsList, setSrsList] = useState<SrsState[]>([]);
  const [attempts, setAttempts] = useState<MemoryAttempt[]>([]);
  const [llm, setLlm] = useState<LlmConfig | undefined>();
  const [loadingBank, setLoadingBank] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sel = await getSelection();
      const [srs, att, cfg] = await Promise.all([loadSrsMap(), listAttempts(), getLlmConfig()]);
      if (cancelled) return;
      setSelection(sel);
      setSrsList([...srs.values()]);
      setAttempts(att);
      setLlm(cfg);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listBanks().then(
      (list) => { if (!cancelled) setBanks(list); },
      () => { if (!cancelled) setBanks([]); },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

  // 已缓存题库的解析结果（筛选选项与进度视图）
  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    void (async () => {
      const map = new Map<string, ParsedBank>();
      for (const path of selection.banks) {
        const p = await getParsedBank(path).catch(() => undefined);
        if (p) map.set(path, p);
      }
      if (!cancelled) setParsed(map);
    })();
    return () => { cancelled = true; };
  }, [selection]);

  const stats = useMemo(() => summarize(attempts, srsList, Date.now()), [attempts, srsList]);

  const filterOptions = useMemo(() => {
    const chapters = new Set<string>();
    const types = new Set<string>();
    const tags = new Set<string>();
    const difficulty = new Set<string>();
    for (const bank of parsed.values()) {
      for (const q of bank.questions) {
        if (q.chapter) chapters.add(q.chapter);
        types.add(q.type);
        for (const t of q.tags ?? []) tags.add(t);
        if (q.difficulty) difficulty.add(q.difficulty);
      }
    }
    return {
      chapters: [...chapters].sort(),
      types: [...types].sort(),
      tags: [...tags].sort(),
      difficulty: [...difficulty].sort(),
    };
  }, [parsed]);

  const progress = useMemo(() => {
    const srs = new Map(srsList.map((s) => [s.qid, s]));
    return [...parsed.entries()].map(([path, bank]) => {
      let practiced = 0;
      let mastered = 0;
      for (const q of bank.questions) {
        const s = srs.get(q.qid);
        if (s) {
          practiced += 1;
          if (isMastered(s)) mastered += 1;
        }
      }
      return { path, name: bank.name, total: bank.questions.length, practiced, mastered };
    });
  }, [parsed, srsList]);

  const updateSelection = useCallback((next: MemorySelection) => {
    setSelection(next);
    void saveSelection(next);
  }, []);

  const onToggleBank = useCallback(async (path: string, on: boolean) => {
    if (!selection) return;
    const banksNext = on ? [...selection.banks, path] : selection.banks.filter((p) => p !== path);
    updateSelection({ ...selection, banks: banksNext });
    if (!on || parsed.has(path)) return;
    if (!token) { showToast('未配置访问 Token，无法获取题库', { kind: 'error' }); return; }
    setLoadingBank(path);
    try {
      const bank = await ensureBankLoaded(path, new GitHubClient(token));
      setParsed((prev) => new Map(prev).set(path, bank));
      if (bank.warnings.length) showToast(`题库已加载：${bank.questions.length} 题，${bank.warnings.length} 处问题`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '题库获取失败', { kind: 'error' });
    } finally {
      setLoadingBank(null);
    }
  }, [parsed, selection, token, updateSelection]);

  const onStart = useCallback(async () => {
    if (!selection || starting) return;
    if (!selection.banks.length) { setMsg('请先选择至少一个题库'); return; }
    if (!token) { setMsg('未配置访问 Token，无法获取题库'); return; }
    setStarting(true);
    setMsg(null);
    try {
      const client = new GitHubClient(token);
      const loaded: ParsedBank[] = [];
      for (const path of selection.banks) loaded.push(await ensureBankLoaded(path, client));

      const candidates: QueueCandidate[] = [];
      loaded.forEach((bank, bankIndex) => {
        for (const q of bank.questions) {
          candidates.push({
            qid: q.qid, bankPath: bank.path, id: q.id, kind: q.kind, type: q.type,
            ...(q.chapter ? { chapter: q.chapter } : {}),
            ...(q.tags ? { tags: q.tags } : {}),
            ...(q.difficulty ? { difficulty: q.difficulty } : {}),
            ...(q.followUpOf ? { followUpOf: q.followUpOf } : {}),
            bankIndex, line: q.line,
          });
        }
      });

      const srsMap = await loadSrsMap();
      const now = Date.now();
      const newIntroducedToday = [...srsMap.values()].filter((s) => s.firstAt >= dayStart(now)).length;
      const queue = buildQueue({
        candidates, srsByQid: srsMap, filters: selection.filters,
        sessionSize: selection.sessionSize, newPerDay: selection.newPerDay, newIntroducedToday, now,
      });
      if (!queue.length) { setMsg('当前范围没有到期或新题可练，试试调整范围或稍后再来'); return; }

      await saveSession({ createdAt: now, items: queue, index: 0, answered: 0, scores: [], startedAt: now });
      navigate(toRouterPath(MEMORY_TRAIN));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '开始训练失败');
    } finally {
      setStarting(false);
    }
  }, [navigate, selection, starting, token]);

  const toggleFilter = useCallback((key: keyof MemorySelection['filters'], value: string) => {
    if (!selection) return;
    const cur = selection.filters[key];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    updateSelection({ ...selection, filters: { ...selection.filters, [key]: next } });
  }, [selection, updateSelection]);

  const llmReady = isLlmConfigured(llm);

  return (
    <main className="memory">
      <a className="memory-back" href={HOME}>← 返回首页</a>
      <header className="memory-header">
        <h1 className="memory-title">记忆助手</h1>
        <a className="memory-link" href={MEMORY_RECORDS}>训练记录</a>
      </header>

      <section className="memory-card" aria-labelledby="memory-today-title">
        <h2 id="memory-today-title" className="memory-card-title">今日</h2>
        <div className="memory-stats">
          <div className="memory-stat"><b>{stats.dueToday}</b><span>待复习</span></div>
          <div className="memory-stat"><b>{stats.practicedToday}</b><span>已练</span></div>
          <div className="memory-stat"><b>{stats.streak}</b><span>连续天数</span></div>
          <div className="memory-stat"><b>{stats.avgAiScore ?? '—'}</b><span>近 7 天均分</span></div>
        </div>
        <button type="button" className="memory-primary" onClick={() => void onStart()} disabled={starting}>
          {starting ? '准备中…' : '开始训练'}
        </button>
        {msg && <p className="memory-note" role="status">{msg}</p>}
        {!llmReady && <p className="memory-note">未配置模型，将使用「对照参考答案 + 自评」模式。</p>}
      </section>

      <section className="memory-card" aria-labelledby="memory-banks-title">
        <h2 id="memory-banks-title" className="memory-card-title">题库</h2>
        {banks === null ? (
          <p className="memory-note">加载中…</p>
        ) : banks.length === 0 ? (
          <p className="memory-note">目录树中没有 .jsonl 题库，请先到首页「更新目录」。</p>
        ) : (
          <ul className="memory-banks">
            {banks.map((b) => (
              <li key={b.path} className="memory-bank">
                <label>
                  <input
                    type="checkbox"
                    checked={selection?.banks.includes(b.path) ?? false}
                    disabled={starting}
                    onChange={(e) => void onToggleBank(b.path, e.target.checked)}
                  />
                  <span className="memory-bank-name">{b.name}</span>
                  <span className="memory-bank-meta">
                    {loadingBank === b.path ? '加载中…' : b.fetched ? `${b.questionCount} 题${b.issueCount ? ` · ${b.issueCount} 处问题` : ''}` : '未获取'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {parsed.size > 0 && selection && (
          <div className="memory-filters">
            <FilterRow label="形态" options={KIND_OPTIONS} selected={selection.filters.kinds} onToggle={(v) => toggleFilter('kinds', v)} />
            {filterOptions.types.length > 0 && (
              <FilterRow label="题型" options={filterOptions.types.map((t) => ({ value: t, label: t }))} selected={selection.filters.types} onToggle={(v) => toggleFilter('types', v)} />
            )}
            {filterOptions.chapters.length > 0 && (
              <FilterRow label="章节" options={filterOptions.chapters.map((c) => ({ value: c, label: c }))} selected={selection.filters.chapters} onToggle={(v) => toggleFilter('chapters', v)} />
            )}
            {filterOptions.tags.length > 0 && (
              <FilterRow label="标签" options={filterOptions.tags.map((t) => ({ value: t, label: t }))} selected={selection.filters.tags} onToggle={(v) => toggleFilter('tags', v)} />
            )}
            {filterOptions.difficulty.length > 0 && (
              <FilterRow label="难度" options={filterOptions.difficulty.map((d) => ({ value: d, label: d }))} selected={selection.filters.difficulty} onToggle={(v) => toggleFilter('difficulty', v)} />
            )}
          </div>
        )}
      </section>

      <section className="memory-card" aria-labelledby="memory-settings-title">
        <h2 id="memory-settings-title" className="memory-card-title">训练设置</h2>
        <div className="memory-filters">
          <FilterRow
            label="每次题量"
            options={SESSION_SIZE_CHOICES.map((n) => ({ value: String(n), label: n === 0 ? '不限' : String(n) }))}
            selected={[String(selection?.sessionSize ?? 20)]}
            onToggle={(v) => selection && updateSelection({ ...selection, sessionSize: Number(v) })}
            single
          />
          <div className="memory-row">
            <span className="memory-row-label">每日新题</span>
            <input
              type="number" min={0} max={50}
              value={selection?.newPerDay ?? 10}
              aria-label="每日新题上限"
              onChange={(e) => {
                if (!selection) return;
                const n = Math.min(50, Math.max(0, Math.round(Number(e.target.value) || 0)));
                updateSelection({ ...selection, newPerDay: n });
              }}
            />
          </div>
        </div>
      </section>

      <LlmConfigForm
        cfg={llm}
        onChange={(next) => { setLlm(next); void saveLlmConfig(next); }}
      />

      {progress.length > 0 && (
        <section className="memory-card" aria-labelledby="memory-progress-title">
          <h2 id="memory-progress-title" className="memory-card-title">进度</h2>
          <ul className="memory-progress">
            {progress.map((p) => (
              <li key={p.path}>
                <span className="memory-bank-name">{p.name}</span>
                <span className="memory-bank-meta">已练 {p.practiced}/{p.total} · 已掌握 {p.mastered}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="memory-footnote">训练记录仅保存在本机浏览器；AI 评分时作答会发送到你填写的模型地址。</p>
    </main>
  );
}
```

注意：`LlmConfigForm` 的 `onChange` 只更新本地状态，落库由表单内的「保存」触发——为此表单 `props.onChange` 收到的 cfg 需要写库。上面 MemoryPage 只 `setLlm` 未写库，**计划执行时在 onChange 里补 `void saveLlmConfig(next);`**（`saveLlmConfig` 需加入 memory.ts 的 import 列表）。

- [ ] **Step 8: 运行 e2e 用例 1 通过**

Run: `npx playwright test tests/e2e/memory.spec.ts -g "入口可见"`
Expected: PASS

- [ ] **Step 9: 实现 `src/styles/memory.css`（基础版，后续任务只增不改）**

```css
/* 记忆助手（v1.3）：沿用既有令牌与「软影白卡 + 组标签」形态。 */
.memory {
  max-width: 640px;
  margin: 0 auto;
  padding: 16px 16px calc(40px + env(safe-area-inset-bottom, 0px));
}
.memory-back { display: inline-flex; align-items: center; min-height: 32px; color: var(--acc-text); font-size: 14px; text-decoration: none; }
.memory-header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.memory-title { margin: 8px 0 4px; font-size: 24px; }
.memory-link { color: var(--acc-text); font-size: 14px; }

.memory-card {
  margin: 18px 0 0; padding: 6px 16px 16px;
  border-radius: var(--r-card); background: var(--card); box-shadow: var(--shadow-card);
}
.memory-card-title { margin: 10px 0 6px; font-size: 12.5px; font-weight: 500; color: var(--ink2); letter-spacing: 0.04em; }
.memory-note { margin: 8px 0 0; color: var(--ink2); font-size: 13px; line-height: 1.6; }

.memory-stats { display: flex; gap: 8px; margin: 6px 0 12px; }
.memory-stat { flex: 1; text-align: center; padding: 10px 4px; border-radius: var(--r-ctl); background: var(--shell); }
.memory-stat b { display: block; font-size: 20px; }
.memory-stat span { color: var(--ink2); font-size: 12px; }

.memory-primary {
  width: 100%; min-height: 44px; border: 0; border-radius: var(--r-ctl);
  background: var(--acc-fill); color: #fff; font: inherit; font-size: 15px; cursor: pointer;
}
.memory-primary:disabled { opacity: .6; cursor: default; }

.memory-banks { list-style: none; margin: 4px 0 0; padding: 0; }
.memory-bank { padding: 6px 0; border-top: 1px solid var(--line); }
.memory-bank:first-child { border-top: 0; }
.memory-bank label { display: flex; align-items: center; gap: 10px; min-height: 36px; }
.memory-bank input[type='checkbox'] { width: 18px; height: 18px; accent-color: var(--acc-fill); }
.memory-bank-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.memory-bank-meta { color: var(--ink2); font-size: 12.5px; white-space: nowrap; }

.memory-filters { margin-top: 10px; display: grid; gap: 8px; }
.memory-row { display: flex; align-items: center; gap: 8px; }
.memory-row-label { flex: none; width: 76px; color: var(--ink2); font-size: 13px; }
.memory-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.memory-chip {
  min-height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--card); color: var(--ink); font: inherit; font-size: 12.5px; cursor: pointer;
}
.memory-chip-on { border-color: var(--acc); color: var(--acc-text); background: rgba(31, 63, 212, .08); }
.memory-row input[type='number'] { width: 72px; min-height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--r-ctl); font: inherit; }
.memory-field { display: grid; gap: 4px; margin: 8px 0 0; }
.memory-field span { color: var(--ink2); font-size: 13px; }
.memory-field input { min-height: 40px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--r-ctl); font: inherit; }
.memory-progress { list-style: none; margin: 4px 0 0; padding: 0; }
.memory-progress li { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); }
.memory-progress li:first-child { border-top: 0; }
.memory-footnote { margin: 16px 0 0; color: var(--ink2); font-size: 12.5px; line-height: 1.6; }
```

- [ ] **Step 10: 全量单测 + 类型检查 + 既有 e2e 回归（含既有 25 条）+ 提交**

Run: `npm test && npm run typecheck && npx playwright test`
Expected: 全绿

```bash
git add src/app/nav.ts src/App.tsx src/pages/HomePage.tsx src/pages/MemoryPage.tsx src/components/memory/LlmConfigForm.tsx src/styles/memory.css index.html tests/e2e/fixtures.ts tests/e2e/memory.spec.ts
git commit -m "feat: 记忆助手入口与概览页（题库选择/筛选、训练设置、模型设置、CSP 放宽）"
```

---

### Task 7: 训练页（问答链路：AI 评分 / 自评降级 / 提示 / 会话恢复）

**Files:**
- Create: `src/lib/hints.ts`、`src/components/memory/MarkdownBlock.tsx`、`src/pages/MemoryTrainPage.tsx`（替换 T6 占位）
- Test: `tests/unit/hints.test.ts`；`tests/e2e/memory.spec.ts`（用例 2、3）

**Interfaces:**
- Consumes: T1–T6 全部模块、`renderDoc`（markdown/render.ts）、`listFilesMeta`（db.ts）
- Produces：
  - `extractHintKeywords(answer: string): string[]`（hints.ts，≤5 个、去重）
  - `MarkdownBlock({ text, path, knownPaths, className? })`
  - `MemoryTrainPage`：状态机 `loading → answering → scoring → result → finished`；提问/结果/结束三段视图；`memory-question` / `memory-answer` / `memory-score` / `memory-meta` class 供 e2e 定位

- [ ] **Step 1: 写失败单测** `tests/unit/hints.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { extractHintKeywords } from '../../src/lib/hints';

describe('extractHintKeywords', () => {
  it('提取行内代码、加粗词、列表首句短语；去重并限量 5 个', () => {
    const answer = [
      '- 当没有待执行的 `setImmediate` 时，poll 会阻塞。',
      '- 阻塞时长 = min(最近定时器, **平台最大等待时间**)。',
      '- `setImmediate` 与 `nextTick` 的关系：本轮之后。',
      '- 关键点：空闲时 CPU 接近 0。',
      '- 第五点：多余内容不应出现。',
    ].join('\n');
    const keys = extractHintKeywords(answer);
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(keys[0]).toBe('setImmediate');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('空答案回退空数组；无结构化元素时取首句前 40 字', () => {
    expect(extractHintKeywords('')).toEqual([]);
    const long = '这是一段没有代码和加粗的很长很长的答案文本，用来验证回退到首句前四十个字符的行为是否正确。';
    const keys = extractHintKeywords(long);
    expect(keys).toHaveLength(1);
    expect(keys[0].length).toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/hints.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/lib/hints.ts`**

```ts
/** 提示关键词提取（spec §8.2 L2）：行内代码 → 加粗词 → 列表首句短语；去重、限量 5 个。 */
export function extractHintKeywords(answer: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const m of answer.matchAll(/`([^`\n]+)`/g)) push(m[1]);
  for (const m of answer.matchAll(/\*\*([^*\n]+)\*\*/g)) push(m[1]);
  for (const line of answer.split('\n')) {
    const lead = line.replace(/^\s*(?:[-*+]|\d+[.、)])\s*/, '').split(/[：:，,。；;（(]/)[0].trim();
    if (lead && lead.length <= 20) push(lead);
    if (out.length >= 5) break;
  }
  if (!out.length && answer.trim()) push(answer.trim().slice(0, 40));
  return out.slice(0, 5);
}
```

- [ ] **Step 4: 写失败 e2e（用例 2、3）**

追加到 `tests/e2e/memory.spec.ts`（import 改为 `import { configureAndSync, readKv, readStore, writeKv } from './fixtures';`）：

```ts
const QA_ONLY_SELECTION = {
  banks: ['题库/示例题库.jsonl'],
  filters: { kinds: ['qa'], chapters: [], types: ['概念'], tags: [], difficulty: [] },
  sessionSize: 20, newPerDay: 10,
};

test('问答训练：AI 评分 → 命中/遗漏与参考答案 → 记录落库 → 下一题', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);
  await writeKv(page, 'llmConfig', { baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' });
  await page.route('https://llm.example/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: 82, hit: ['事件循环调度'], missed: ['libuv'], comment: '基本正确' }) } }] }),
    }),
  );

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();

  await expect(page).toHaveURL(/#\/memory\/train$/);
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');

  await page.getByLabel('作答').fill('事件循环负责调度异步回调，由 libuv 支持。');
  await page.getByRole('button', { name: '提交' }).click();

  await expect(page.locator('.memory-score')).toContainText('82');
  await expect(page.getByText('基本正确')).toBeVisible();
  await expect(page.locator('.memory-answer')).toContainText('事件循环负责调度异步回调');

  expect(await readStore(page, 'mem_srs')).toMatchObject([{ qid: expect.any(String), stage: 1 }]);
  expect(await readStore(page, 'mem_attempts')).toMatchObject([{ mode: 'ai', score: 82, verdict: 'good' }]);

  await page.getByRole('button', { name: '下一题' }).click();
  await expect(page.locator('.memory-question')).toContainText('什么是微任务？');
});

test('自评降级与提示：hint 优先、刷新恢复、查看答案后自评落库', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');

  await page.getByRole('button', { name: '提示' }).click();
  await expect(page.getByText('想 libuv')).toBeVisible();

  await page.reload();
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');

  await page.getByRole('button', { name: '查看参考答案' }).click();
  await expect(page.locator('.memory-answer')).toContainText('事件循环负责调度异步回调');
  await page.getByRole('button', { name: '会', exact: true }).click();
  await expect(page.getByText('已记录（自评）')).toBeVisible();

  expect(await readStore(page, 'mem_attempts')).toMatchObject([{ mode: 'self', verdict: 'good', revealed: true }]);
  expect(await readStore(page, 'mem_srs')).toMatchObject([{ stage: 1 }]);
});
```

- [ ] **Step 5: 运行确认失败**

Run: `npx playwright test tests/e2e/memory.spec.ts -g "问答训练"`
Expected: FAIL（训练页为空占位）

- [ ] **Step 6: 实现 `src/components/memory/MarkdownBlock.tsx`**

```tsx
import { useMemo } from 'react';
import { renderDoc } from '../../markdown/render';

/** 轻量 markdown 渲染块：题库题干 / 题面 / 答案复用阅读器渲染管线。 */
export default function MarkdownBlock(props: { text: string; path: string; knownPaths: Set<string>; className?: string }) {
  const html = useMemo(
    () => renderDoc(props.text, { path: props.path, knownPaths: props.knownPaths }).html,
    [props.text, props.path, props.knownPaths],
  );
  return (
    <div
      className={props.className ? `memory-md ${props.className}` : 'memory-md'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 7: 实现 `src/pages/MemoryTrainPage.tsx`（第 1/2 段：导入 / 状态 / 逻辑）**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MEMORY, toRouterPath } from '../app/nav';
import MarkdownBlock from '../components/memory/MarkdownBlock';
import { listFilesMeta } from '../data/db';
import { LlmError, isLlmConfigured, scoreAnswer } from '../data/llm';
import {
  appendAttempt, clearSession, getLlmConfig, getSession, loadSrsMap, putSrs, saveSession,
  type LlmConfig, type MemorySession,
} from '../data/memory';
import { getParsedBank } from '../data/qbankIndex';
import { extractHintKeywords } from '../lib/hints';
import type { BankQuestion } from '../lib/qbank';
import { VERDICT_LABELS, nextState, type SrsState, type Verdict } from '../lib/srs';
import { showToast } from '../lib/toast';
import '../styles/memory.css';

interface QueueView { bankPath: string; bankName: string; question: BankQuestion }
type Phase = 'loading' | 'answering' | 'scoring' | 'result' | 'finished';
interface ResultState {
  score: number | null;
  verdict: Verdict;
  hit: string[];
  missed: string[];
  comment: string;
  mode: 'ai' | 'self' | 'choice';
}

export default function MemoryTrainPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<MemorySession | null>(null);
  const [views, setViews] = useState<Map<string, QueueView>>(new Map());
  const [knownPaths, setKnownPaths] = useState<Set<string>>(new Set());
  const [llm, setLlm] = useState<LlmConfig | undefined>();
  const [srsMap, setSrsMap] = useState<Map<string, SrsState>>(new Map());
  const [answerText, setAnswerText] = useState('');
  const [result, setResult] = useState<ResultState | null>(null);
  const [awaitingSelf, setAwaitingSelf] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const questionStartedAt = useRef(Date.now());
  const abortRef = useRef<AbortController | null>(null);

  // 载入会话 + 已缓存题库（离线可用；题目不在题库时的跳过在视图层处理）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await getSession();
      const [cfg, srsDb, metas] = await Promise.all([getLlmConfig(), loadSrsMap(), listFilesMeta()]);
      if (cancelled) return;
      if (!s || s.items.length === 0) { navigate(toRouterPath(MEMORY)); return; }
      setSession(s);
      setLlm(cfg);
      setSrsMap(srsDb);
      setKnownPaths(new Set(metas.map((m) => m.path)));

      const viewsNext = new Map<string, QueueView>();
      for (const path of [...new Set(s.items.map((i) => i.bankPath))]) {
        const bank = await getParsedBank(path).catch(() => undefined);
        if (!bank) continue;
        for (const q of bank.questions) viewsNext.set(q.qid, { bankPath: path, bankName: bank.name, question: q });
      }
      if (cancelled) return;
      setViews(viewsNext);
      const missing = s.items.filter((i) => !viewsNext.has(i.qid)).length;
      if (missing) showToast(`有 ${missing} 道题已不在题库中，将自动跳过`);
      setPhase('answering');
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const currentIndex = useMemo(() => {
    if (!session) return null;
    for (let i = session.index; i < session.items.length; i++) {
      if (views.has(session.items[i].qid)) return i;
    }
    return null;
  }, [session, views]);

  const current = session && currentIndex !== null ? views.get(session.items[currentIndex].qid) ?? null : null;

  const resetQuestionState = useCallback(() => {
    setAnswerText('');
    setResult(null);
    setAwaitingSelf(false);
    setRevealed(false);
    setHintLevel(0);
    setError(null);
    questionStartedAt.current = Date.now();
  }, []);

  /** 落库（进度 + 记录）并更新会话计数；最后一题时清空会话。 */
  const persist = useCallback(async (args: {
    verdict: Verdict;
    mode: ResultState['mode'];
    score: number | null;
    hit?: string[];
    missed?: string[];
    comment?: string;
    revealed?: boolean;
  }) => {
    if (!session || currentIndex === null || !current) return;
    const q = current.question;
    const now = Date.now();
    const prev = srsMap.get(q.qid);
    const state = nextState(prev, args.verdict, now, { qid: q.qid, bankPath: current.bankPath, id: q.id, score: args.score });
    await putSrs(state);
    await appendAttempt({
      qid: q.qid, bankPath: current.bankPath, idLabel: q.id, ts: now, mode: args.mode,
      score: args.score, verdict: args.verdict, answer: answerText.trim(),
      hit: args.hit ?? [], missed: args.missed ?? [], comment: args.comment ?? '',
      durationMs: now - questionStartedAt.current, hintUsed: hintLevel > 0, revealed: args.revealed ?? revealed,
    });
    setSrsMap((prevMap) => new Map(prevMap).set(q.qid, state));

    const nextSession = { ...session, answered: session.answered + 1, scores: args.score !== null ? [...session.scores, args.score] : session.scores };
    setSession(nextSession);
    if (currentIndex + 1 >= session.items.length) await clearSession();
    else await saveSession(nextSession);
  }, [answerText, current, currentIndex, hintLevel, revealed, session, srsMap]);

  const onSubmit = useCallback(async () => {
    if (!session || currentIndex === null || !current) return;
    const q = current.question;
    if (q.kind !== 'qa') return; // 选择题在 Task 8 接入
    const text = answerText.trim();
    if (!text) return;
    setError(null);

    if (isLlmConfigured(llm) && navigator.onLine) {
      setPhase('scoring');
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await scoreAnswer(llm, {
          type: q.type,
          ...(q.chapter ? { chapter: q.chapter } : {}),
          question: q.question,
          ...(q.prompt ? { prompt: q.prompt } : {}),
          answer: q.answer ?? '',
          userAnswer: text,
        }, { signal: ac.signal });
        await persist({ verdict: res.verdict, mode: 'ai', score: res.score, hit: res.hit, missed: res.missed, comment: res.comment });
        setResult({ ...res, mode: 'ai' });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') { setPhase('answering'); return; }
        setError(err instanceof LlmError ? `评分失败：${err.message}` : '评分失败，可重试或改为自评');
        setAwaitingSelf(true);
      } finally {
        abortRef.current = null;
      }
      setPhase('result');
      return;
    }

    setAwaitingSelf(true);
    setPhase('result');
  }, [answerText, current, currentIndex, llm, persist, session]);

  const onSelfVerdict = useCallback(async (verdict: Verdict) => {
    await persist({ verdict, mode: 'self', score: null, revealed: true });
    setResult({ score: null, verdict, hit: [], missed: [], comment: '', mode: 'self' });
    setAwaitingSelf(false);
  }, [persist]);

  const onReveal = useCallback(() => {
    abortRef.current?.abort();
    setRevealed(true);
    setAwaitingSelf(true);
    setResult(null);
    setPhase('result');
  }, []);

  const onNext = useCallback(() => {
    if (!session || currentIndex === null) { setPhase('finished'); return; }
    let next: number | null = null;
    for (let i = currentIndex + 1; i < session.items.length; i++) {
      if (views.has(session.items[i].qid)) { next = i; break; }
    }
    if (next === null) {
      setSession((s) => (s ? { ...s, index: s.items.length } : s));
      setPhase('finished');
      return;
    }
    const advanced = { ...session, index: next };
    setSession(advanced);
    void saveSession(advanced);
    resetQuestionState();
    setPhase('answering');
  }, [currentIndex, resetQuestionState, session, views]);

  const onHint = useCallback(() => setHintLevel((l) => Math.min(2, l + 1)), []);

  const hintText = useMemo(() => {
    if (!current || hintLevel === 0) return null;
    const q = current.question;
    if (hintLevel === 1) {
      return q.hint ?? `这是一道【${q.type}】题${q.chapter ? `，属于「${q.chapter}」` : ''}`;
    }
    const keys = extractHintKeywords(q.answer ?? '');
    return keys.length ? keys.join(' · ') : null;
  }, [current, hintLevel]);

  // —— 渲染段（第 2/2 段继续）——

  if (phase === 'loading') {
    return <main className="memory"><p className="memory-note">加载中…</p></main>;
  }

  if (phase === 'finished') {
    const scores = session?.scores ?? [];
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return (
      <main className="memory">
        <section className="memory-card" aria-labelledby="memory-finished-title">
          <h2 id="memory-finished-title" className="memory-card-title">本次训练完成</h2>
          <div className="memory-stats">
            <div className="memory-stat"><b>{session?.answered ?? 0}</b><span>已练题数</span></div>
            <div className="memory-stat"><b>{avg ?? '—'}</b><span>平均分（AI）</span></div>
          </div>
          <button type="button" className="memory-primary" onClick={() => navigate(toRouterPath(MEMORY))}>返回概览</button>
        </section>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="memory">
        <section className="memory-card">
          <p className="memory-note">没有可继续的题目（题库可能已更新）。</p>
          <button type="button" className="memory-primary" onClick={() => navigate(toRouterPath(MEMORY))}>返回概览</button>
        </section>
      </main>
    );
  }

  const q = current.question;

  if (phase === 'result') {
    return (
      <main className="memory">
        <header className="memory-header">
          <button type="button" className="memory-back" onClick={() => navigate(toRouterPath(MEMORY))}>← 返回概览</button>
        </header>
        <section className="memory-card" aria-labelledby="memory-result-title">
          <h2 id="memory-result-title" className="memory-card-title">{current.bankName} · {q.id} · 【{q.type}】</h2>
          <MarkdownBlock className="memory-question" text={q.question} path={current.bankPath} knownPaths={knownPaths} />
          {error && <p className="memory-note" role="alert">{error}</p>}

          {result ? (
            <div className="memory-result">
              <div className="memory-score">{result.mode === 'ai' ? result.score : VERDICT_LABELS[result.verdict]}</div>
              <p className="memory-verdict">
                {result.mode === 'self'
                  ? `${VERDICT_LABELS[result.verdict]} · 已记录（自评）`
                  : VERDICT_LABELS[result.verdict]}
              </p>
              {result.hit.length > 0 && <p className="memory-note">命中要点：{result.hit.join('、')}</p>}
              {result.missed.length > 0 && <p className="memory-note">遗漏要点：{result.missed.join('、')}</p>}
              {result.comment && <p className="memory-note">{result.comment}</p>}
            </div>
          ) : awaitingSelf ? (
            <div className="memory-self">
              <p className="memory-note">{error ? '可重试评分，或对照参考答案自评：' : '对照参考答案，给自己评一档：'}</p>
              <div className="memory-row">
                <button type="button" className="memory-chip" onClick={() => void onSelfVerdict('good')}>会</button>
                <button type="button" className="memory-chip" onClick={() => void onSelfVerdict('hard')}>模糊</button>
                <button type="button" className="memory-chip" onClick={() => void onSelfVerdict('again')}>不会</button>
              </div>
            </div>
          ) : null}

          {q.answer && (
            <MarkdownBlock className="memory-answer" text={q.answer} path={current.bankPath} knownPaths={knownPaths} />
          )}

          <div className="memory-row" style={{ marginTop: 12 }}>
            {result && (
              <button type="button" className="memory-primary" style={{ width: 'auto' }} onClick={onNext}>下一题</button>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="memory">
      <header className="memory-header">
        <button type="button" className="memory-back" onClick={() => navigate(toRouterPath(MEMORY))}>← 暂时离开</button>
        <span className="memory-bank-meta">第 {(session?.answered ?? 0) + 1} / {session?.items.length ?? 0} 题</span>
      </header>
      <section className="memory-card" aria-labelledby="memory-question-title">
        <h2 id="memory-question-title" className="memory-card-title">
          {current.bankName} · {q.chapter ?? '未分章'} · {q.id} · 【{q.type}】
        </h2>
        <MarkdownBlock className="memory-question" text={q.question} path={current.bankPath} knownPaths={knownPaths} />
        {q.prompt && <MarkdownBlock className="memory-prompt" text={q.prompt} path={current.bankPath} knownPaths={knownPaths} />}
        {hintText && <p className="memory-hint" role="status">提示：{hintText}</p>}
        <textarea
          className="memory-input"
          aria-label="作答"
          rows={5}
          value={answerText}
          placeholder="用自己的话作答…"
          onChange={(e) => setAnswerText(e.target.value)}
        />
        <div className="memory-row">
          <button type="button" className="memory-primary" style={{ width: 'auto' }} onClick={() => void onSubmit()} disabled={!answerText.trim() || phase === 'scoring'}>
            {phase === 'scoring' ? '评分中…' : '提交'}
          </button>
          <button type="button" className="memory-chip" onClick={onHint} disabled={hintLevel >= 2}>
            提示
          </button>
          <button type="button" className="memory-chip" onClick={onReveal}>查看参考答案</button>
        </div>
      </section>
    </main>
  );
}
```

需要在 `src/styles/memory.css` 追加（Step 9 一并写入）：

```css
.memory-md { font-size: 15px; line-height: 1.7; }
.memory-md p { margin: 6px 0; }
.memory-md pre { overflow-x: auto; }
.memory-hint { margin: 8px 0 0; padding: 8px 10px; border-radius: var(--r-ctl); background: rgba(31, 63, 212, .08); color: var(--acc-text); font-size: 13px; }
.memory-input { width: 100%; margin-top: 10px; padding: 10px; border: 1px solid var(--line); border-radius: var(--r-ctl); font: inherit; font-size: 15px; line-height: 1.6; resize: vertical; }
.memory-result { margin-top: 10px; }
.memory-score { font-size: 32px; font-weight: 600; }
.memory-verdict { margin: 2px 0 0; color: var(--ink2); font-size: 13px; }
.memory-answer { margin-top: 12px; padding: 10px 12px; border-radius: var(--r-ctl); background: var(--shell); }
.memory-self { margin-top: 10px; }
```

- [ ] **Step 8: 运行相关测试通过**

Run: `npx vitest run tests/unit/hints.test.ts && npx playwright test tests/e2e/memory.spec.ts`
Expected: 全部 PASS（含用例 1–3）

- [ ] **Step 9: 全量回归 + 提交**

Run: `npm test && npm run typecheck && npx playwright test`
Expected: 全绿

```bash
git add src/lib/hints.ts src/components/memory/MarkdownBlock.tsx src/pages/MemoryTrainPage.tsx src/styles/memory.css tests/unit/hints.test.ts tests/e2e/memory.spec.ts
git commit -m "feat: 训练页问答链路（AI 评分、自评降级、分层提示、会话恢复）"
```

---

### Task 8: 选择题与追问链（本地判分、排除提示、母题上下文）

**Files:**
- Modify: `src/pages/MemoryTrainPage.tsx`（选择题分支、判分、选项状态、追问面板）、`src/styles/memory.css`（选项样式）
- Modify: `tests/e2e/memory.spec.ts`（用例 4）

**Interfaces:**
- Consumes: `verdictFromChoice`（srs.ts）、`BankOption`（qbank.ts）
- Produces: `memory-options` / `memory-option-*` / `memory-parent` class；`mode: 'choice'` 记录含 `picked` / `correct` 快照

- [ ] **Step 1: 写失败 e2e（用例 4）**

追加到 `tests/e2e/memory.spec.ts`：

```ts
const ALL_KINDS_SELECTION = {
  banks: ['题库/示例题库.jsonl'],
  filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] },
  sessionSize: 20, newPerDay: 10,
};

test('选择题本地判分与追问链：链排序、母题展开、单选错选、多选漏选', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', ALL_KINDS_SELECTION);

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();

  // 第 1 题：问答题（Q1.1）
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await page.getByRole('button', { name: '会', exact: true }).click();
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 2 题：追问链排序——母题 Q1.1 在队列中，追问紧随其后
  await expect(page.locator('.memory-question')).toContainText('poll 阻塞时来了 I/O');
  await expect(page.getByText('追问自 Q1.1')).toBeVisible();
  await page.getByRole('button', { name: '查看母题 Q1.1' }).click();
  await expect(page.getByText('母题上下文，不计入本次记录。')).toBeVisible();
  await expect(page.locator('.memory-parent-body')).toContainText('什么是事件循环？');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await page.getByRole('button', { name: '会', exact: true }).click();
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 3 题：Q1.2（问答），快速跳过
  await expect(page.locator('.memory-question')).toContainText('什么是微任务？');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await page.getByRole('button', { name: '会', exact: true }).click();
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 4 题：单选（Q2.1）——选错 → 错选、选项着色、记录 picked/correct
  await expect(page.locator('.memory-question')).toContainText('负责事件循环的内置依赖库是？');
  await expect(page.locator('.memory-option')).toHaveCount(2);
  await page.locator('.memory-option').filter({ hasText: 'V8' }).click();
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.memory-score')).toContainText('错选');
  await expect(page.locator('.memory-option-correct')).toContainText('libuv');
  await expect(page.locator('.memory-option-wrong')).toContainText('V8');
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 5 题：多选（Q2.2）——只选 A → 漏选
  await expect(page.locator('.memory-question')).toContainText('以下哪些是内置依赖库？');
  await page.locator('.memory-option').filter({ hasText: 'V8' }).click();
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.memory-score')).toContainText('漏选');

  const attempts = await readStore(page, 'mem_attempts') as { mode: string; verdict: string; picked?: string[]; correct?: string[] }[];
  const choice = attempts.find((a) => a.mode === 'choice');
  expect(choice).toMatchObject({ verdict: 'again', picked: ['B'], correct: ['A'] });
  const last = attempts.find((a) => a.mode === 'choice' && a.picked?.includes('A') && (a.correct?.length ?? 0) === 2);
  expect(last).toMatchObject({ verdict: 'hard', correct: ['A', 'B'] });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/memory.spec.ts -g "选择题本地判分"`
Expected: FAIL（无选项 UI / 追问徽标）

- [ ] **Step 3: 实现（对 `src/pages/MemoryTrainPage.tsx` 做以下 6 处修改）**

3a. import 区追加：

```ts
import { verdictFromChoice } from '../lib/srs';
```

（合并进已有 `../lib/srs` 的 import 行即可：`import { VERDICT_LABELS, nextState, verdictFromChoice, type SrsState, type Verdict } from '../lib/srs';`）

3b. `ResultState` 增加可选 `picked`：

```ts
interface ResultState {
  score: number | null;
  verdict: Verdict;
  hit: string[];
  missed: string[];
  comment: string;
  mode: 'ai' | 'self' | 'choice';
  picked?: string[];
}
```

3c. 组件内新增状态与重置：

```tsx
  const [picked, setPicked] = useState<string[]>([]);
  const [eliminated, setEliminated] = useState<string | null>(null);
```

`resetQuestionState` 内追加：

```tsx
    setPicked([]);
    setEliminated(null);
```

3d. `persist` 参数与记录写入：args 类型增加 `picked?: string[]`；`appendAttempt` 调用改为：

```tsx
    await appendAttempt({
      qid: q.qid, bankPath: current.bankPath, idLabel: q.id, ts: now, mode: args.mode,
      score: args.score, verdict: args.verdict, answer: answerText.trim(),
      hit: args.hit ?? [], missed: args.missed ?? [], comment: args.comment ?? '',
      durationMs: now - questionStartedAt.current, hintUsed: hintLevel > 0, revealed: args.revealed ?? revealed,
      ...(args.picked ? { picked: args.picked } : {}),
      ...(q.correct ? { correct: q.correct } : {}),
    });
```

3e. `onSubmit` 开头加入选择题分支（放在 `if (q.kind !== 'qa') return;` 之前，并删除该行）：

```tsx
    if (q.kind === 'single' || q.kind === 'multiple') {
      const verdict = verdictFromChoice(q.kind, picked, q.correct ?? []);
      await persist({ verdict, mode: 'choice', score: null, picked });
      setResult({ score: null, verdict, hit: [], missed: [], comment: '', mode: 'choice', picked: [...picked] });
      setPhase('result');
      return;
    }
```

3f. `onHint` 替换为选择题 L2（排除一个错误选项）逻辑：

```tsx
  const onHint = useCallback(() => {
    if (!current) return;
    const q = current.question;
    if (q.kind !== 'qa' && hintLevel >= 1) {
      const wrong = (q.options ?? []).map((o) => o.key).filter((k) => !(q.correct ?? []).includes(k));
      if (wrong.length >= 2) {
        const key = wrong[Math.floor(Math.random() * wrong.length)];
        setEliminated(key);
        setPicked((prev) => prev.filter((k) => k !== key));
      }
      setHintLevel(2);
      return;
    }
    setHintLevel((l) => Math.min(2, l + 1));
  }, [current, hintLevel]);
```

`hintText` memo 保持问答逻辑：把首行条件改为 `if (!current || hintLevel === 0 || current.question.kind !== 'qa') return null;`，并新增：

```tsx
  const hintTextChoice = useMemo(() => {
    if (!current || hintLevel === 0 || current.question.kind === 'qa') return null;
    const q = current.question;
    if (hintLevel === 1) return q.hint ?? `这是一道【${q.type}】题${q.chapter ? `，属于「${q.chapter}」` : ''}`;
    return null;
  }, [current, hintLevel]);
```

3g. 母题视图与组件：

```tsx
  const parentView = useMemo(() => {
    const followUp = current?.question.followUpOf;
    if (!followUp || !current) return null;
    for (const v of views.values()) {
      if (v.bankPath === current.bankPath && v.question.id === followUp) return v;
    }
    return null;
  }, [current, views]);
```

文件底部（`MemoryTrainPage` 之外）新增组件：

```tsx
/** 追问的母题上下文面板（只读，不计入本次记录）。 */
function FollowUpPanel(props: { followUpOf: string; parent: QueueView | null; knownPaths: Set<string> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="memory-parent">
      <button type="button" className="memory-chip" onClick={() => setOpen((v) => !v)}>
        {open ? '收起母题' : `查看母题 ${props.followUpOf}`}
      </button>
      {open && props.parent && (
        <div className="memory-parent-body">
          <MarkdownBlock text={props.parent.question.question} path={props.parent.bankPath} knownPaths={props.knownPaths} />
          {props.parent.question.answer && (
            <MarkdownBlock className="memory-answer" text={props.parent.question.answer} path={props.parent.bankPath} knownPaths={props.knownPaths} />
          )}
          <p className="memory-note">母题上下文，不计入本次记录。</p>
        </div>
      )}
      {open && !props.parent && <p className="memory-note">母题不在当前题库缓存中。</p>}
    </div>
  );
}

/** 选择题结果文案：正确 / 漏选 / 错选。 */
function choiceOutcomeLabel(verdict: Verdict): string {
  if (verdict === 'excellent') return '正确';
  if (verdict === 'hard') return '漏选';
  return '错选';
}
```

3h. 答题视图：文本输入改为按形态分支；追问面板加入；提交禁用条件按形态：

把答题视图中 `<textarea …/>` 一段替换为：

```tsx
        {q.kind === 'qa' ? (
          <textarea
            className="memory-input"
            aria-label="作答"
            rows={5}
            value={answerText}
            placeholder="用自己的话作答…"
            onChange={(e) => setAnswerText(e.target.value)}
          />
        ) : (
          <div className="memory-options" role="group" aria-label="选项">
            {q.options?.map((o) => {
              const on = picked.includes(o.key);
              const off = eliminated === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role={q.kind === 'single' ? 'radio' : 'checkbox'}
                  aria-checked={on}
                  disabled={off}
                  className={`memory-option${on ? ' memory-option-on' : ''}${off ? ' memory-option-eliminated' : ''}`}
                  onClick={() => {
                    if (q.kind === 'single') setPicked([o.key]);
                    else setPicked((prev) => (prev.includes(o.key) ? prev.filter((k) => k !== o.key) : [...prev, o.key]));
                  }}
                >
                  <span className="memory-option-key">{o.key}</span>
                  <span className="memory-option-text">{o.text}</span>
                </button>
              );
            })}
          </div>
        )}
```

在题面附件之后、作答区之前插入：

```tsx
        {q.followUpOf && <FollowUpPanel followUpOf={q.followUpOf} parent={parentView} knownPaths={knownPaths} />}
        {hintTextChoice && <p className="memory-hint" role="status">提示：{hintTextChoice}</p>}
        {eliminated && <p className="memory-hint" role="status">已排除选项 {eliminated}</p>}
```

提交按钮禁用条件改为：

```tsx
          disabled={(q.kind === 'qa' ? !answerText.trim() : picked.length === 0) || phase === 'scoring'}
```

3i. 结果视图：追问面板 + 选择题选项着色 + 首行大字与文案：

在结果视图 `<MarkdownBlock className="memory-question" …/>` 后插入：

```tsx
          {q.followUpOf && <FollowUpPanel followUpOf={q.followUpOf} parent={parentView} knownPaths={knownPaths} />}
```

`<div className="memory-score">…</div>` 改为：

```tsx
              <div className="memory-score">
                {result.mode === 'ai' ? result.score : result.mode === 'choice' ? choiceOutcomeLabel(result.verdict) : VERDICT_LABELS[result.verdict]}
              </div>
```

`<p className="memory-verdict">…</p>` 改为：

```tsx
              <p className="memory-verdict">
                {result.mode === 'ai' && VERDICT_LABELS[result.verdict]}
                {result.mode === 'self' && `${VERDICT_LABELS[result.verdict]} · 已记录（自评）`}
                {result.mode === 'choice' && `${VERDICT_LABELS[result.verdict]} · 已记录（本地判分）`}
              </p>
```

在 `{result.hit.length > 0 && …}` 之前插入选择题选项回放：

```tsx
              {result.mode === 'choice' && q.options && (
                <div className="memory-options">
                  {q.options.map((o) => {
                    const isCorrect = (q.correct ?? []).includes(o.key);
                    const pickedIt = (result.picked ?? []).includes(o.key);
                    const cls = `memory-option${isCorrect ? ' memory-option-correct' : pickedIt ? ' memory-option-wrong' : ''}`;
                    return (
                      <div key={o.key} className={cls}>
                        <span className="memory-option-key">{o.key}</span>
                        <span className="memory-option-text">{o.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
```

3j. `src/styles/memory.css` 追加：

```css
.memory-options { display: grid; gap: 8px; margin-top: 10px; }
.memory-option {
  display: flex; align-items: flex-start; gap: 8px; width: 100%;
  padding: 10px; border: 1px solid var(--line); border-radius: var(--r-ctl);
  background: var(--card); color: var(--ink); font: inherit; font-size: 14px;
  text-align: left; cursor: pointer;
}
.memory-option-on { border-color: var(--acc); background: rgba(31, 63, 212, .08); }
.memory-option-eliminated { opacity: .45; text-decoration: line-through; cursor: default; }
.memory-option-correct { border-color: #2f7d4f; background: rgba(47, 125, 79, .10); }
.memory-option-wrong { border-color: var(--danger); background: rgba(192, 57, 43, .08); }
.memory-option-key { flex: none; font-weight: 600; color: var(--ink2); }
.memory-parent { margin-top: 10px; }
.memory-parent-body { margin-top: 8px; padding: 10px 12px; border-radius: var(--r-ctl); background: var(--shell); }
```

- [ ] **Step 4: 运行 e2e 全部记忆用例通过**

Run: `npx playwright test tests/e2e/memory.spec.ts`
Expected: 全部 PASS（用例 1–4）

- [ ] **Step 5: 全量回归 + 提交**

Run: `npm test && npm run typecheck && npx playwright test`
Expected: 全绿

```bash
git add src/pages/MemoryTrainPage.tsx src/styles/memory.css tests/e2e/memory.spec.ts
git commit -m "feat: 选择题本地判分与追问链（选项状态、排除提示、母题上下文、链排序出题）"
```

---

### Task 9: 记录与统计页（`src/pages/MemoryRecordsPage.tsx`）

**Files:**
- Create: `src/pages/MemoryRecordsPage.tsx`（替换 T6 占位）
- Modify: `src/styles/memory.css`
- Modify: `tests/e2e/memory.spec.ts`（用例 5）

**Interfaces:**
- Consumes: T3 的 `summarize` / `listAttempts` / `loadSrsMap` / `exportMemory` / `importMemory` / `clearTrainingData`；`VERDICT_LABELS`
- Produces: `memory-records` / `memory-record` / `memory-verdicts` / `memory-trend` class

- [ ] **Step 1: 写失败 e2e（用例 5）**

追加到 `tests/e2e/memory.spec.ts`：

```ts
test('记录页：统计与明细、清除训练数据', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);
  await writeKv(page, 'llmConfig', { baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' });
  await page.route('https://llm.example/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: 82, hit: ['要点'], missed: [], comment: '不错' }) } }] }),
    }),
  );

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();
  await page.getByLabel('作答').fill('我的回答');
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.memory-score')).toContainText('82');

  await page.goto('./#/memory/records');
  await expect(page.locator('.memory-stat').filter({ hasText: '平均分' }).locator('b')).toHaveText('82');
  await expect(page.locator('.memory-record')).toContainText('Q1.1');
  await expect(page.locator('.memory-record')).toContainText('82 分');

  // 展开明细
  await page.locator('.memory-record').first().click();
  await expect(page.getByText('作答：我的回答')).toBeVisible();

  // 清除（确认框接受）
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '清除训练数据' }).click();
  await expect(page.getByText('还没有训练记录。')).toBeVisible();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx playwright test tests/e2e/memory.spec.ts -g "记录页"`
Expected: FAIL（记录页为空占位）

- [ ] **Step 3: 实现 `src/pages/MemoryRecordsPage.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HOME } from '../app/nav';
import {
  clearTrainingData, exportMemory, importMemory, listAttempts, loadSrsMap, summarize,
  type MemoryAttempt, type SrsState,
} from '../data/memory';
import { VERDICT_LABELS, type Verdict } from '../lib/srs';
import { showToast } from '../lib/toast';
import '../styles/memory.css';

const VERDICT_ORDER: Verdict[] = ['excellent', 'good', 'hard', 'again'];

function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function MemoryRecordsPage() {
  const [attempts, setAttempts] = useState<MemoryAttempt[]>([]);
  const [srs, setSrs] = useState<SrsState[]>([]);
  const [bankFilter, setBankFilter] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [att, srsMap] = await Promise.all([listAttempts({ limit: 500 }), loadSrsMap()]);
    setAttempts(att);
    setSrs([...srsMap.values()]);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const stats = useMemo(() => summarize(attempts, srs, Date.now()), [attempts, srs]);
  const banks = useMemo(() => [...new Set(attempts.map((a) => a.bankPath))].sort(), [attempts]);
  const shown = useMemo(
    () => (bankFilter ? attempts.filter((a) => a.bankPath === bankFilter) : attempts).slice(0, 100),
    [attempts, bankFilter],
  );
  const trendMax = Math.max(1, ...stats.trend.map((t) => t.count));

  const onExport = async () => {
    try {
      const json = await exportMemory();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `md-reader-memory-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('导出失败', { kind: 'error' });
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const r = await importMemory(await file.text());
      showToast(`导入进度 ${r.srs} 条、记录 ${r.attempts} 条`);
      await reload();
    } catch (err) {
      showToast(err instanceof Error ? `导入失败：${err.message}` : '导入失败', { kind: 'error' });
    }
  };

  const onClear = async () => {
    if (clearing) return;
    if (!window.confirm('确定清除全部训练进度与记录吗？此操作不可恢复（题库缓存与模型配置会保留）。')) return;
    setClearing(true);
    try {
      await clearTrainingData();
      await reload();
      showToast('训练数据已清除');
    } catch {
      showToast('清除失败，请重试', { kind: 'error' });
    } finally {
      setClearing(false);
    }
  };

  return (
    <main className="memory">
      <a className="memory-back" href={HOME}>← 返回首页</a>
      <header className="memory-header">
        <h1 className="memory-title">训练记录</h1>
        <a className="memory-link" href="#/memory">记忆助手</a>
      </header>

      <section className="memory-card" aria-labelledby="records-stats-title">
        <h2 id="records-stats-title" className="memory-card-title">统计</h2>
        <div className="memory-stats">
          <div className="memory-stat"><b>{stats.practiced}</b><span>已练</span></div>
          <div className="memory-stat"><b>{stats.mastered}</b><span>已掌握</span></div>
          <div className="memory-stat"><b>{stats.avgAiScore ?? '—'}</b><span>平均分</span></div>
          <div className="memory-stat"><b>{stats.streak}</b><span>连续天数</span></div>
        </div>
        <p className="memory-note">到期：今日 {stats.dueToday} · 3 天内 {stats.due3} · 7 天内 {stats.due7}</p>
        <ul className="memory-verdicts">
          {VERDICT_ORDER.map((v) => (
            <li key={v}><span>{VERDICT_LABELS[v]}</span><b>{stats.verdictCounts[v]}</b></li>
          ))}
        </ul>
        <div className="memory-trend" aria-label="近 14 天趋势">
          {stats.trend.map((t) => (
            <div key={t.day} className="memory-trend-col" title={`${fmtDay(t.day)}：${t.count} 题`}>
              <i style={{ height: `${Math.round((t.count / trendMax) * 100)}%` }} />
              <span>{fmtDay(t.day)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="memory-card" aria-labelledby="records-list-title">
        <h2 id="records-list-title" className="memory-card-title">记录（最近 100 条）</h2>
        {banks.length > 0 && (
          <div className="memory-row">
            <span className="memory-row-label">题库</span>
            <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} aria-label="按题库筛选">
              <option value="">全部</option>
              {banks.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="memory-note">还没有训练记录。</p>
        ) : (
          <ul className="memory-records">
            {shown.map((a, i) => (
              <li key={a.id ?? `${a.qid}-${a.ts}-${i}`}>
                <button
                  type="button"
                  className="memory-record"
                  onClick={() => setOpenId(a.id !== undefined && openId === a.id ? null : (a.id ?? null))}
                >
                  <span className="memory-record-label">{a.idLabel} · {a.mode === 'ai' ? `${a.score} 分` : VERDICT_LABELS[a.verdict]}</span>
                  <span className="memory-bank-meta">{new Date(a.ts).toLocaleString('zh-CN', { hour12: false })}</span>
                </button>
                {a.id !== undefined && openId === a.id && (
                  <div className="memory-record-body">
                    {a.answer && <p className="memory-note">作答：{a.answer}</p>}
                    {a.picked && <p className="memory-note">选择：{a.picked.join('、')}{a.correct ? `（正确：${a.correct.join('、')}）` : ''}</p>}
                    {a.hit.length > 0 && <p className="memory-note">命中要点：{a.hit.join('、')}</p>}
                    {a.missed.length > 0 && <p className="memory-note">遗漏要点：{a.missed.join('、')}</p>}
                    {a.comment && <p className="memory-note">{a.comment}</p>}
                    <p className="memory-note">
                      用时 {Math.round(a.durationMs / 1000)} 秒
                      {a.hintUsed ? ' · 用过提示' : ''}
                      {a.revealed ? ' · 看过答案' : ''}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="memory-card" aria-labelledby="records-data-title">
        <h2 id="records-data-title" className="memory-card-title">数据</h2>
        <div className="memory-row">
          <button type="button" className="memory-chip" onClick={() => void onExport()}>导出 JSON</button>
          <button type="button" className="memory-chip" onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <button type="button" className="memory-chip memory-danger" onClick={() => void onClear()} disabled={clearing}>
            {clearing ? '清除中…' : '清除训练数据'}
          </button>
        </div>
        <input
          ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="导入训练数据文件"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = '';
          }}
        />
        <p className="memory-note">导出不含模型 Key；导入按「进度取新、记录去重」合并。</p>
      </section>
    </main>
  );
}
```

`src/styles/memory.css` 追加：

```css
.memory-verdicts { list-style: none; display: flex; gap: 8px; margin: 10px 0 0; padding: 0; }
.memory-verdicts li { flex: 1; display: flex; justify-content: space-between; padding: 6px 8px; border-radius: var(--r-ctl); background: var(--shell); font-size: 13px; }
.memory-trend { display: flex; gap: 2px; align-items: flex-end; height: 72px; margin-top: 10px; }
.memory-trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; height: 100%; }
.memory-trend-col i { width: 100%; min-height: 2px; border-radius: 3px 3px 0 0; background: var(--acc); }
.memory-trend-col span { font-size: 9px; color: var(--ink2); white-space: nowrap; transform: rotate(-45deg); }
.memory-records { list-style: none; margin: 4px 0 0; padding: 0; }
.memory-records li { border-top: 1px solid var(--line); }
.memory-records li:first-child { border-top: 0; }
.memory-record { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 8px 0; border: 0; background: none; font: inherit; font-size: 14px; color: var(--ink); text-align: left; cursor: pointer; }
.memory-record-label { min-width: 0; overflow-wrap: anywhere; }
.memory-record-body { padding: 4px 0 10px; }
.memory-danger { color: var(--danger); border-color: var(--danger); }
.memory-row select { min-height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--r-ctl); font: inherit; }
```

- [ ] **Step 4: 运行 e2e 全部记忆用例通过**

Run: `npx playwright test tests/e2e/memory.spec.ts`
Expected: 全部 PASS（用例 1–5）

- [ ] **Step 5: 提交**

```bash
git add src/pages/MemoryRecordsPage.tsx src/styles/memory.css tests/e2e/memory.spec.ts
git commit -m "feat: 训练记录与统计页（趋势、档位分布、导出导入、清除训练数据）"
```

---

### Task 10: 文档同步、版本号与整体验收

**Files:**
- Modify: `PRODUCT.md`、`README.md`、`package.json`、`src/pages/SettingsPage.tsx`
- Create: `docs/acceptance-2026-10-19-memory-assistant.md`

- [ ] **Step 1: `package.json` 版本号 → `1.3.0`**

- [ ] **Step 2: `PRODUCT.md` 四处修订**

1) Capabilities 的「已有能力」结尾追加：`记忆助手（v1.3）：JSONL 题库（问答/单选/多选/追问）、艾宾浩斯调度、AI 评分与自评降级、本地训练记录与统计。`
2) Product Principles 第 1 条替换为：

```markdown
1. 内容与凭据默认不出本机：正文、Token、训练记录默认只在本机；记忆训练的 AI 评分（仅问答）会把「题干 + 参考答案 + 作答」发送到用户自己配置的模型地址，选择题与其余内容不外发，且可完全离线自评。
```

3) Constraints 中 CSP 行替换为：`CSP：connect-src 允许 'self' 与任意 HTTPS（模型直连所需）；script-src 'self' 不变。`
4) 「未来方向」列表中删除已实现的「阅读页多标签」保持不变、把「题库直读 JSONL」记为待办（若原文无则不新增）。

- [ ] **Step 3: `README.md` 修订**

功能清单追加一条：

```markdown
- 记忆助手：从仓库 JSONL 题库（问答 / 单选 / 多选 / 追问）按艾宾浩斯间隔训练，AI 评分（可配 OpenAI 兼容接口）或离线自评，本地训练记录与统计（`#/memory`）；
```

文档区追加 spec / plan 链接：

```markdown
- 记忆助手设计：[`docs/specs/2026-10-19-memory-assistant-design.md`](docs/specs/2026-10-19-memory-assistant-design.md)
- 记忆助手实施计划：[`docs/plans/2026-10-19-md-reader-memory-assistant-implementation.md`](docs/plans/2026-10-19-md-reader-memory-assistant-implementation.md)
```

- [ ] **Step 4: `src/pages/SettingsPage.tsx` 危险区文案**

`window.confirm` 文案改为：

```ts
    if (!window.confirm('确定清除全部数据吗？将删除本机全部缓存、收藏、阅读进度、记忆训练数据与 Token，且不可恢复。')) return;
```

- [ ] **Step 5: 新增真机验收清单 `docs/acceptance-2026-10-19-memory-assistant.md`**

```markdown
# 记忆助手真机验收清单（v1.3）

> 日期：2026-10-19 · 验收环境：安卓手机 PWA（主屏幕应用），桌面浏览器辅助。
> 通过标准：以下逐项通过；任一项不通过则记录现象与复现步骤后回到修复。

## 1. 入口与题库

- [ ] 首页头部「记忆助手」入口可见、可点，进入 `#/memory`。
- [ ] 先在首页「更新目录」完成同步；记忆助手题库列表显示仓库中的 `.jsonl`（名称、未获取）。
- [ ] 勾选题库：拉取成功并显示「N 题 · M 处问题」（与仓库内容一致）。
- [ ] 断网后刷新：已拉取题库仍可用（显示题量与问题数）。

## 2. 训练（问答）

- [ ] 开始训练后按「到期优先 → 新题」出题；题面、题型、章节展示正确。
- [ ] 提示：优先展示题库 hint；再次点击给出关键词；不影响评分。
- [ ] 配置真实模型（Base URL / Key / 模型名）→ 测试连接成功；提交作答得到分数、命中/遗漏要点与点评，文案合理。
- [ ] 未配置模型或断网：可「查看参考答案 → 自评 会/模糊/不会」，训练与调度继续。
- [ ] 中途离开再进入 / 刷新页面：会话恢复同一题。

## 3. 训练（选择与追问）

- [ ] 单选：答对记「优秀」、答错记「不会」；选项着色正确。
- [ ] 多选：全对「优秀」、漏选「勉强」、错选「不会」。
- [ ] 追问题显示「追问自 QX」，可展开母题上下文（不计入记录）；母题与追问在同一队列时相邻出题。

## 4. 记录与数据

- [ ] 记录页统计（已练 / 已掌握 / 平均分 / 连续天数 / 到期分布 / 14 天趋势）与训练行为一致。
- [ ] 记录明细可展开看作答、选择、点评与用时。
- [ ] 导出 JSON 成功、可导入；导入不含模型 Key。
- [ ] 「清除训练数据」后进度与记录清空，题库缓存与模型配置保留。

## 5. 回归与边界

- [ ] 阅读、搜索、高亮、同步、设置等既有功能无回归。
- [ ] 清除全部数据（设置页危险区）后回到引导页，记忆数据一并清空。
- [ ] 飞行模式 + 冷启动：训练（已缓存题库）与自评可用；AI 评分给出可读错误并降级自评。
```

- [ ] **Step 6: 全量验证**

Run: `npm test && npm run typecheck && npm run build && npm run test:e2e`
Expected: 全绿（单测含新增用例；e2e 含 memory 5 条用例）

- [ ] **Step 7: 提交**

```bash
git add PRODUCT.md README.md package.json src/pages/SettingsPage.tsx docs/acceptance-2026-10-19-memory-assistant.md
git commit -m "docs: 记忆助手文档同步、验收清单与版本号 1.3.0"
```

---

## 计划自审（作者已核对）

- spec §1–§14 与附录 A 均映射到任务：题库标准 → T1/T4；调度 → T2；数据 → T3；模型 → T5；页面/入口/CSP → T6；训练（问答/选择/追问）→ T7/T8；记录统计 → T9；文档与验收 → T10。
- 类型/命名一致性：`qid`、`SrsState`、`QueueCandidate`、`verdictFromChoice`、`VERDICT_LABELS`、`memSelection`/`llmConfig`/`memSession` 键名在全部任务中一致。
- 无占位符：每个代码步骤均为可执行内容；页面两个大文件按「第 1/2 段 + 第 2/2 段」与「按 3a–3j 修改」给出完整实现。
- 既有测试影响面：仅 `tests/unit/db.test.ts` 的版本冲突用例需要改（T3）；e2e 既有断言不受 .jsonl 影响（不进 `files` store）。
