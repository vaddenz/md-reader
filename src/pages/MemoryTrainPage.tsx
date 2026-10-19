import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MEMORY, toRouterPath } from '../app/nav';
import MarkdownBlock from '../components/memory/MarkdownBlock';
import { listFilesMeta } from '../data/db';
import { LlmError, isLlmConfigured, scoreAnswer } from '../data/llm';
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

  // 结束视图的档位分布：读取本次会话开始之后的记录（含自评与选择题）。
  useEffect(() => {
    if (phase !== 'finished' || !session) return;
    let cancelled = false;
    void listAttempts().then((all) => {
      if (cancelled) return;
      const counts: Record<Verdict, number> = { ...EMPTY_VERDICT_COUNTS };
      for (const a of all) if (a.ts >= session.startedAt) counts[a.verdict] += 1;
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

  const hintText = useMemo(() => {
    if (!current || hintLevel === 0 || current.question.kind !== 'qa') return null;
    const q = current.question;
    if (hintLevel === 1) {
      return q.hint ?? `这是一道【${q.type}】题${q.chapter ? `，属于「${q.chapter}」` : ''}`;
    }
    const keys = extractHintKeywords(q.answer ?? '');
    return keys.length ? keys.join(' · ') : null;
  }, [current, hintLevel]);

  const hintTextChoice = useMemo(() => {
    if (!current || hintLevel === 0 || current.question.kind === 'qa') return null;
    const q = current.question;
    // L2 排除后 L1 文案保留（无足够错误项时避免提示区空转）。
    return q.hint ?? `这是一道【${q.type}】题${q.chapter ? `，属于「${q.chapter}」` : ''}`;
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
      <main className="memory">
        <section className="memory-card" aria-labelledby="memory-finished-title">
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
                <span>{VERDICT_LABELS[v]}</span>
              </div>
            ))}
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
          {q.followUpOf && <FollowUpPanel followUpOf={q.followUpOf} parent={parentView} knownPaths={knownPaths} />}
          {error && <p className="memory-note" role="alert">{error}</p>}

          {result ? (
            <div className="memory-result">
              <div className="memory-score">
                {result.mode === 'ai' ? result.score : result.mode === 'choice' ? choiceOutcomeLabel(result.verdict) : VERDICT_LABELS[result.verdict]}
              </div>
              <p className="memory-verdict">
                {result.mode === 'ai' && VERDICT_LABELS[result.verdict]}
                {result.mode === 'self' && `${VERDICT_LABELS[result.verdict]} · 已记录（自评）`}
                {result.mode === 'choice' && `${VERDICT_LABELS[result.verdict]} · 已记录（本地判分）`}
              </p>
              {result.mode === 'choice' && q.options && (
                <div className="memory-options">
                  {q.options.map((o) => {
                    const isCorrect = (q.correct ?? []).includes(o.key);
                    const pickedIt = (result.picked ?? []).includes(o.key);
                    const eliminatedIt = result.eliminated === o.key;
                    const cls = `memory-option${isCorrect ? ' memory-option-correct' : pickedIt ? ' memory-option-wrong' : eliminatedIt ? ' memory-option-eliminated' : ''}`;
                    return (
                      <div key={o.key} className={cls}>
                        <span className="memory-option-key">{o.key}</span>
                        <span className="memory-option-text">{o.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {result.hit.length > 0 && <p className="memory-note">命中要点：{result.hit.join('、')}</p>}
              {result.missed.length > 0 && <p className="memory-note">遗漏要点：{result.missed.join('、')}</p>}
              {result.comment && <p className="memory-note">{result.comment}</p>}
            </div>
          ) : awaitingSelf ? (
            <div className="memory-self">
              <p className="memory-note">{error ? '可重试评分，或对照参考答案自评：' : '对照参考答案，给自己评一档：'}</p>
              <div className="memory-row">
                <button type="button" className="memory-chip" onClick={() => void onSelfVerdict('good')} disabled={saving}>会</button>
                <button type="button" className="memory-chip" onClick={() => void onSelfVerdict('hard')} disabled={saving}>模糊</button>
                <button type="button" className="memory-chip" onClick={() => void onSelfVerdict('again')} disabled={saving}>不会</button>
              </div>
            </div>
          ) : null}

          {q.answer && (
            <MarkdownBlock className="memory-answer" text={q.answer} path={current.bankPath} knownPaths={knownPaths} />
          )}

          <div className="memory-row" style={{ marginTop: 12 }}>
            {result && (
              <>
                <button type="button" className="memory-primary" style={{ width: 'auto' }} onClick={() => void onNext()}>下一题</button>
                <button type="button" className="memory-chip" onClick={() => void onEnd()}>结束训练</button>
              </>
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
        <span className="memory-meta memory-bank-meta">第 {(session?.answered ?? 0) + 1} / {session?.items.length ?? 0} 题</span>
      </header>
      <section className="memory-card" aria-labelledby="memory-question-title">
        <h2 id="memory-question-title" className="memory-card-title">
          {current.bankName} · {q.chapter ?? '未分章'} · {q.id} · 【{q.type}】
        </h2>
        <MarkdownBlock className="memory-question" text={q.question} path={current.bankPath} knownPaths={knownPaths} />
        {error && <p className="memory-note" role="alert">{error}</p>}
        {q.prompt && <MarkdownBlock className="memory-prompt" text={q.prompt} path={current.bankPath} knownPaths={knownPaths} />}
        {q.followUpOf && <FollowUpPanel followUpOf={q.followUpOf} parent={parentView} knownPaths={knownPaths} />}
        {hintText && <p className="memory-hint" role="status">提示：{hintText}</p>}
        {hintTextChoice && <p className="memory-hint" role="status">提示：{hintTextChoice}</p>}
        {eliminated && <p className="memory-hint" role="status">已排除选项 {eliminated}</p>}
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
        <div className="memory-row">
          <button type="button" className="memory-primary" style={{ width: 'auto' }} onClick={() => void onSubmit()} disabled={(q.kind === 'qa' ? !answerText.trim() : picked.length === 0 || saving) || phase === 'scoring'}>
            {phase === 'scoring' ? '评分中…' : '提交'}
          </button>
          <button type="button" className="memory-chip" onClick={onHint} disabled={hintLevel >= 2}>
            {hintLevel >= 2 ? '已给足提示' : '提示'}
          </button>
          <button type="button" className="memory-chip" onClick={onReveal} disabled={q.kind !== 'qa' && saving}>查看参考答案</button>
        </div>
      </section>
    </main>
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
