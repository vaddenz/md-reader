import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MEMORY, toRouterPath } from '../app/nav';
import MarkdownBlock from '../components/memory/MarkdownBlock';
import { listFilesMeta } from '../data/db';
import { LlmError, beginOpencodeSession, isLlmConfigured, scoreAnswer } from '../data/llm';
import {
  appendAttempt, clearSession, getLlmConfig, getSession, listAttempts, loadSrsMap, putSrs, saveSession,
  type LlmConfig, type MemorySession,
} from '../data/memory';
import { getParsedBank } from '../data/qbankIndex';
import { extractHintKeywords } from '../lib/hints';
import type { BankQuestion } from '../lib/qbank';
import { VERDICT_LABELS, nextState, verdictFromChoice, type SrsState, type Verdict } from '../lib/srs';
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
  picked?: string[];
  eliminated?: string;
}

const EMPTY_VERDICT_COUNTS: Record<Verdict, number> = { excellent: 0, good: 0, hard: 0, again: 0 };

export default function MemoryTrainPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<MemorySession | null>(null);
  const [views, setViews] = useState<Map<string, QueueView>>(new Map());
  const [knownPaths, setKnownPaths] = useState<Set<string>>(new Set());
  const [llm, setLlm] = useState<LlmConfig | undefined>();
  const [srsMap, setSrsMap] = useState<Map<string, SrsState>>(new Map());
  const [answerText, setAnswerText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [eliminated, setEliminated] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [awaitingSelf, setAwaitingSelf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** 模型流式返回的思考内容（与正式回答分开显示）。 */
  const [thinking, setThinking] = useState('');
  const [sessionVerdicts, setSessionVerdicts] = useState<Record<Verdict, number> | null>(null);
  const questionStartedAt = useRef(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  /** 「查看参考答案」发起的取消：区分于其它取消，取消后保留 onReveal 设置的 result + 自评视图。 */
  const revealRequestedRef = useRef(false);

  // 载入会话 + 已缓存题库（离线可用；题目不在题库时的跳过在视图层处理）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await getSession();
      const [cfg, srsDb, metas] = await Promise.all([getLlmConfig(), loadSrsMap(), listFilesMeta()]);
      if (cancelled) return;
      if (!s || s.items.length === 0) { navigate(toRouterPath(MEMORY)); return; }
      // 一轮训练一个 OpenCode 会话：整轮评分复用同一 session ID，便于服务端复用提示词缓存。
      beginOpencodeSession();
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

  // 没有可继续的题目（题库更新导致队列全部失效）：清空会话，避免下次进入时死路。
  // 依赖 currentIndex / session 变化，避免每次渲染重复 clearSession。
  useEffect(() => {
    if (phase === 'loading' || phase === 'finished' || !session || currentIndex !== null) return;
    void clearSession();
  }, [currentIndex, phase, session]);

  // 结束视图的档位分布：只统计本次会话队列内题目、且发生在会话开始之后的记录。
  useEffect(() => {
    if (phase !== 'finished' || !session) return;
    let cancelled = false;
    const qids = new Set(session.items.map((i) => i.qid));
    void listAttempts().then((all) => {
      if (cancelled) return;
      const counts: Record<Verdict, number> = { ...EMPTY_VERDICT_COUNTS };
      for (const a of all) if (a.ts >= session.startedAt && qids.has(a.qid)) counts[a.verdict] += 1;
      setSessionVerdicts(counts);
    });
    return () => { cancelled = true; };
  }, [phase, session]);

  const resetQuestionState = useCallback(() => {
    setAnswerText('');
    setPicked([]);
    setEliminated(null);
    setResult(null);
    setAwaitingSelf(false);
    setRevealed(false);
    setHintLevel(0);
    setError(null);
    setThinking('');
    revealRequestedRef.current = false;
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
    picked?: string[];
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
      ...(args.picked ? { picked: args.picked } : {}),
      ...(q.correct ? { correct: q.correct } : {}),
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
    if (q.kind === 'single' || q.kind === 'multiple') {
      if (saving) return;
      const verdict = verdictFromChoice(q.kind, picked, q.correct ?? []);
      setError(null);
      setSaving(true);
      try {
        await persist({ verdict, mode: 'choice', score: null, picked });
        setResult({
          score: null, verdict, hit: [], missed: [], comment: '', mode: 'choice', picked: [...picked],
          ...(eliminated ? { eliminated } : {}),
        });
        setPhase('result');
      } catch {
        setError('保存失败，请重试');
      } finally {
        setSaving(false);
      }
      return;
    }
    const text = answerText.trim();
    if (!text) return;
    setError(null);

    if (isLlmConfigured(llm) && navigator.onLine) {
      setPhase('scoring');
      setThinking('');
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
        }, { signal: ac.signal, onDelta: (d) => { if (d.reasoning) setThinking((prev) => prev + d.reasoning); } });
        await persist({ verdict: res.verdict, mode: 'ai', score: res.score, hit: res.hit, missed: res.missed, comment: res.comment });
        setResult({ ...res, mode: 'ai' });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          // 查看参考答案触发的取消：不改回作答视图，让 onReveal 设置的 result + 自评视图生效；
          // 其它取消（无 reveal 意图）维持原行为：回到作答视图。
          if (!revealRequestedRef.current) setPhase('answering');
          return;
        }
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
  }, [answerText, current, currentIndex, eliminated, llm, persist, picked, saving, session]);

  const onSelfVerdict = useCallback(async (verdict: Verdict) => {
    setSaving(true);
    try {
      await persist({ verdict, mode: 'self', score: null, revealed: true });
      setResult({ score: null, verdict, hit: [], missed: [], comment: '', mode: 'self' });
      setAwaitingSelf(false);
      setError(null);
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [persist]);

  const onReveal = useCallback(() => {
    revealRequestedRef.current = true; // 先标记「查看参考答案」意图，再取消在途评分
    abortRef.current?.abort();
    setRevealed(true);
    const q = current?.question;
    if (q && q.kind !== 'qa') {
      // 选择题提交前查看参考答案：直接按「不会」记录并展示解析（spec §8.3）。
      if (saving) return;
      setError(null);
      setSaving(true);
      void (async () => {
        try {
          await persist({ verdict: 'again', mode: 'choice', score: null, picked, revealed: true });
          setResult({
            score: null, verdict: 'again', hit: [], missed: [], comment: '', mode: 'choice', picked: [...picked],
            ...(eliminated ? { eliminated } : {}),
          });
          setPhase('result');
        } catch {
          setError('保存失败，请重试');
        } finally {
          setSaving(false);
        }
      })();
      return;
    }
    setAwaitingSelf(true);
    setResult(null);
    setPhase('result');
  }, [current, eliminated, persist, picked, saving]);

  const onNext = useCallback(async () => {
    if (!session || currentIndex === null) { setPhase('finished'); return; }
    let next: number | null = null;
    for (let i = currentIndex + 1; i < session.items.length; i++) {
      if (views.has(session.items[i].qid)) { next = i; break; }
    }
    if (next === null) {
      setSession((s) => (s ? { ...s, index: s.items.length } : s));
      setPhase('finished');
      await clearSession();
      return;
    }
    const advanced = { ...session, index: next };
    setSession(advanced);
    void saveSession(advanced);
    resetQuestionState();
    setPhase('answering');
  }, [currentIndex, resetQuestionState, session, views]);

  /** 结束训练：清空会话并回到概览（结果视图的次级按钮）。 */
  const onEnd = useCallback(async () => {
    await clearSession();
    navigate(toRouterPath(MEMORY));
  }, [navigate]);

  const onHint = useCallback(() => {
    if (!current || hintLevel >= 2) return;
    const q = current.question;
    if (q.kind === 'qa') {
      setHintLevel((l) => Math.min(2, l + 1));
      return;
    }
    // 选择题：作者提示占 L1；排除一个错误项占 L2。没有作者提示时第一次就排除。
    const wantEliminate = q.hint ? hintLevel >= 1 : true;
    if (wantEliminate) {
      const wrong = (q.options ?? [])
        .map((o) => o.key)
        .filter((k) => !(q.correct ?? []).includes(k) && k !== eliminated);
      if (wrong.length >= 2) {
        const key = wrong[Math.floor(Math.random() * wrong.length)];
        setEliminated(key);
        setPicked((prev) => prev.filter((k) => k !== key));
      } else if (!q.hint) {
        setHintLevel(2);
        return;
      }
    }
    setHintLevel((l) => Math.min(2, l + 1));
  }, [current, eliminated, hintLevel]);

  const hintText = useMemo(() => {
    if (!current || hintLevel === 0) return null;
    const q = current.question;
    if (q.kind !== 'qa') {
      // 选择题：L1 给作者提示；没有作者提示时直接走排除法（见 onHint），不显示重复的题型/章节。
      return q.hint && hintLevel === 1 ? q.hint : null;
    }
    const keys = extractHintKeywords(q.answer ?? '');
    const keyLine = keys.length ? `关键词：${keys.join(' · ')}` : '';
    const preview = q.answer ? `先回忆：${q.answer.replace(/^[\s>*\-+]+/, '').slice(0, 50)}…` : '';
    if (hintLevel === 1) {
      return q.hint || keyLine || (preview || `这是一道【${q.type}】题${q.chapter ? `，属于「${q.chapter}」` : ''}`);
    }
    return (q.hint ? (keyLine || preview) : preview) || null;
  }, [current, hintLevel]);

  const parentView = useMemo(() => {
    const followUp = current?.question.followUpOf;
    if (!followUp || !current) return null;
    for (const v of views.values()) {
      if (v.bankPath === current.bankPath && v.question.id === followUp) return v;
    }
    return null;
  }, [current, views]);

  // —— 渲染段（第 2/2 段继续）——

  if (phase === 'loading') {
    return <main className="memory"><p className="memory-note">加载中…</p></main>;
  }

  if (phase === 'finished') {
    const scores = session?.scores ?? [];
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return (
      <main className="memory memory-train">
        <section className="memory-card memory-train-card" aria-labelledby="memory-finished-title">
          <div className="memory-zone-question">
            <h2 id="memory-finished-title" className="memory-card-title">本次训练完成</h2>
            <div className="memory-stats">
              <div className="memory-stat"><b>{session?.answered ?? 0}</b><span>已练题数</span></div>
              <div className="memory-stat"><b>{avg ?? '—'}</b><span>平均分（AI）</span></div>
            </div>
            <h3 className="memory-card-title">档位分布</h3>
            <div className="memory-stats">
              {(['excellent', 'good', 'hard', 'again'] as Verdict[]).map((v) => (
                <div key={v} className="memory-stat">
                  <b>{(sessionVerdicts ?? EMPTY_VERDICT_COUNTS)[v]}</b>
                  <span className={`memory-verdict-${v}`}>{VERDICT_LABELS[v]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="memory-zone-answer">
            <div className="memory-actions">
              <button type="button" className="memory-primary" onClick={() => navigate(toRouterPath(MEMORY))}>返回概览</button>
              <button type="button" className="memory-secondary" onClick={() => navigate(toRouterPath(MEMORY))}>继续训练</button>
            </div>
          </div>
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
      <main className="memory memory-train">
        <header className="memory-header">
          <button type="button" className="memory-back" onClick={() => navigate(toRouterPath(MEMORY))}>← 返回概览</button>
        </header>
        <section className="memory-card memory-train-card" aria-labelledby="memory-result-title">
          <div className="memory-zone-question">
            <h2 id="memory-result-title" className="memory-card-title">{current.bankName} · {q.id} · 【{q.type}】</h2>
            <MarkdownBlock className="memory-question" text={q.question} path={current.bankPath} knownPaths={knownPaths} />
            {q.followUpOf && <FollowUpPanel followUpOf={q.followUpOf} parent={parentView} knownPaths={knownPaths} />}
            {error && <p className="memory-note" role="alert">{error}</p>}

            {result && (
              <div className="memory-result">
                <div className="memory-score">
                  {result.mode === 'ai' ? result.score : result.mode === 'choice' ? choiceOutcomeLabel(result.verdict) : VERDICT_LABELS[result.verdict]}
                </div>
                <p className={`memory-verdict memory-verdict-${result.verdict}`}>
                  {result.mode === 'ai' && VERDICT_LABELS[result.verdict]}
                  {result.mode === 'self' && `${VERDICT_LABELS[result.verdict]} · 已记录（自评）`}
                  {result.mode === 'choice' && `${VERDICT_LABELS[result.verdict]} · 已记录（本地判分）`}
                </p>
                {result.mode === 'choice' && q.options && (
                  <OptionList q={q} picked={result.picked ?? []} eliminated={result.eliminated} />
                )}
                {result.hit.length > 0 && <p className="memory-note">命中要点：{result.hit.join('、')}</p>}
                {result.missed.length > 0 && <p className="memory-note">遗漏要点：{result.missed.join('、')}</p>}
                {result.comment && <p className="memory-note">{result.comment}</p>}
              </div>
            )}

            {thinking && (
              <details className="memory-thinking">
                <summary>查看思考过程</summary>
                <div className="memory-thinking-body">{thinking}</div>
              </details>
            )}

            {q.answer && (
              <MarkdownBlock className="memory-answer" text={q.answer} path={current.bankPath} knownPaths={knownPaths} />
            )}
          </div>
          <div className="memory-zone-answer">
            {!result && awaitingSelf && (
              <div className="memory-self">
                <p className="memory-note">{error ? '可重试评分，或对照参考答案自评：' : '对照参考答案，给自己评一档：'}</p>
                <div className="memory-actions-row memory-grade">
                  <button type="button" className="memory-secondary" onClick={() => void onSelfVerdict('good')} disabled={saving}>会</button>
                  <button type="button" className="memory-secondary" onClick={() => void onSelfVerdict('hard')} disabled={saving}>模糊</button>
                  <button type="button" className="memory-secondary" onClick={() => void onSelfVerdict('again')} disabled={saving}>不会</button>
                </div>
              </div>
            )}
            {result && (
              <div className="memory-actions">
                <button type="button" className="memory-primary" onClick={() => void onNext()}>下一题</button>
                <button type="button" className="memory-secondary" onClick={() => void onEnd()}>结束训练</button>
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="memory memory-train">
      <header className="memory-header">
        <button type="button" className="memory-back" onClick={() => navigate(toRouterPath(MEMORY))}>← 暂时离开</button>
        <span className="memory-meta memory-bank-meta">第 {(currentIndex ?? 0) + 1} / {session?.items.length ?? 0} 题</span>
      </header>
      <section className="memory-card memory-train-card" aria-labelledby="memory-question-title">
        <div className="memory-zone-question">
          <h2 id="memory-question-title" className="memory-card-title">
            {current.bankName} · {q.chapter ?? '未分章'} · {q.id} · 【{q.type}】
          </h2>
          <MarkdownBlock className="memory-question" text={q.question} path={current.bankPath} knownPaths={knownPaths} />
          {error && <p className="memory-note" role="alert">{error}</p>}
          {q.prompt && <MarkdownBlock className="memory-prompt" text={q.prompt} path={current.bankPath} knownPaths={knownPaths} />}
          {q.followUpOf && <FollowUpPanel followUpOf={q.followUpOf} parent={parentView} knownPaths={knownPaths} />}
          {hintText && <p className="memory-hint" role="status">提示：{hintText}</p>}
          {eliminated && <p className="memory-hint" role="status">已排除选项 {eliminated}</p>}
        </div>
        <div className="memory-zone-answer">
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
            <OptionList
              q={q}
              picked={picked}
              eliminated={eliminated}
              onPick={(key) => {
                if (q.kind === 'single') setPicked([key]);
                else setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
              }}
            />
          )}
          <div className="memory-actions">
            <button type="button" className="memory-primary" onClick={() => void onSubmit()} disabled={(q.kind === 'qa' ? !answerText.trim() : picked.length === 0 || saving) || phase === 'scoring'}>
              {phase === 'scoring' ? '评分中…' : '提交'}
            </button>
            <div className="memory-textactions">
              <button type="button" className="memory-textlink" onClick={onHint} disabled={hintLevel >= 2}>
                {hintLevel >= 2 ? '已给足提示' : '提示'}
              </button>
              <button type="button" className="memory-textlink" onClick={onReveal} disabled={q.kind !== 'qa' && saving}>
                查看参考答案
              </button>
            </div>
          </div>
          {phase === 'scoring' && (
            <div className="memory-stream" aria-live="polite">
              <p className="memory-note">{thinking ? '模型思考中…' : '正在请求模型…'}</p>
              {thinking && (
                <details className="memory-thinking" open>
                  <summary>思考过程</summary>
                  <div className="memory-thinking-body">{thinking}</div>
                </details>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** 选项列表：答题态（可点）与结果回放态（着色）共用同一套着色优先级：正确 > 误选 > 已排除。 */
function OptionList(props: {
  q: BankQuestion;
  picked: string[];
  eliminated?: string | null;
  onPick?: (key: string) => void;
}) {
  const { q, picked, eliminated, onPick } = props;
  return (
    <div className="memory-options" role={onPick ? 'group' : undefined} aria-label={onPick ? '选项' : undefined}>
      {q.options?.map((o) => {
        const isCorrect = (q.correct ?? []).includes(o.key);
        const pickedIt = picked.includes(o.key);
        const eliminatedIt = eliminated === o.key;
        const cls = `memory-option${
          onPick
            ? `${pickedIt ? ' memory-option-on' : ''}${eliminatedIt ? ' memory-option-eliminated' : ''}`
            : `${isCorrect ? ' memory-option-correct' : pickedIt ? ' memory-option-wrong' : eliminatedIt ? ' memory-option-eliminated' : ''}`
        }`;
        const tag = onPick
          ? ''
          : eliminatedIt
            ? '已排除'
            : isCorrect
              ? (pickedIt ? '已选 · 正确' : '漏选')
              : pickedIt
                ? '误选'
                : '';
        const mark = onPick ? '' : eliminatedIt ? '–' : isCorrect ? '✓' : pickedIt ? '✕' : '';
        const inner = (
          <>
            {!onPick && <span className="memory-option-mark">{mark}</span>}
            <span className="memory-option-key">{o.key}</span>
            <span className="memory-option-text">{o.text}</span>
            {tag && <span className="memory-option-tag">{tag}</span>}
          </>
        );
        return onPick ? (
          <button
            key={o.key}
            type="button"
            role={q.kind === 'single' ? 'radio' : 'checkbox'}
            aria-checked={pickedIt}
            disabled={eliminatedIt}
            className={cls}
            onClick={() => onPick(o.key)}
          >
            {inner}
          </button>
        ) : (
          <div key={o.key} className={`${cls} memory-option-static`}>{inner}</div>
        );
      })}
    </div>
  );
}

/** 追问的母题上下文面板（只读，不计入本次记录）。 */
function FollowUpPanel(props: { followUpOf: string; parent: QueueView | null; knownPaths: Set<string> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="memory-parent">
      <span className="memory-parent-ref">追问自 {props.followUpOf}</span>
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
