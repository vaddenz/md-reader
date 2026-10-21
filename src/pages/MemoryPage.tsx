import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HOME, MEMORY_RECORDS, MEMORY_TRAIN, SETTINGS_MEMORY, toRouterPath } from '../app/nav';
import MemoryChips from '../components/memory/MemoryChips';
import { GitHubClient } from '../data/github';
import { isLlmConfigured } from '../data/llm';
import {
  getLlmConfig, getSelection, loadSrsMap, listAttempts,
  saveSelection, saveSession, summarize,
  type LlmConfig, type MemoryAttempt, type MemorySelection,
} from '../data/memory';
import { ensureBankLoaded, getParsedBank, listBanks, bankName, type BankMeta, type ParsedBank } from '../data/qbankIndex';
import { loadBadQuestionMap, unmarkBadQuestion, type BadQuestion } from '../data/badQuestions';
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

/** 惰性 Token：所选题库全部已缓存时可离线开始训练，真正需要拉取时才要求 Token。 */
function clientFor(token: string | null): Pick<GitHubClient, 'getBlobText'> {
  return token
    ? new GitHubClient(token)
    : { getBlobText: () => Promise.reject(new Error('未配置访问 Token，无法获取题库')) };
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
  const [badQuestions, setBadQuestions] = useState<Map<string, BadQuestion>>(new Map());
  const [loadingBanks, setLoadingBanks] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** 自动拉取去重：key = 路径 + sha（sha 变化＝题库更新，允许再自动拉一次）。 */
  const autoTried = useRef(new Set<string>());

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

  // 坏题标记：同步可能从其它设备带来变更，所以随 lastSyncAt 一起重读。
  useEffect(() => {
    let cancelled = false;
    void loadBadQuestionMap().then(
      (map) => { if (!cancelled) setBadQuestions(map); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

  // 已缓存题库的解析结果（筛选选项与进度视图）；只采用与目录树 sha 一致的缓存，
  // 同步后 sha 变化 → 旧解析立即失效（避免「行显示未获取、筛选/进度却用旧解析」）。
  useEffect(() => {
    if (!selection || !banks) return;
    let cancelled = false;
    void (async () => {
      const shaByPath = new Map(banks.map((b) => [b.path, b.sha]));
      const map = new Map<string, ParsedBank>();
      for (const path of selection.banks) {
        const sha = shaByPath.get(path);
        if (!sha) continue;
        const p = await getParsedBank(path).catch(() => undefined);
        if (p && p.sha === sha) map.set(path, p);
      }
      if (!cancelled) setParsed(map);
    })();
    return () => { cancelled = true; };
  }, [selection, banks]);

  /** 解析成功后的统一收尾：更新筛选/进度的数据源 + 题库列表体检计数（无需等下一次同步/reload）。 */
  const applyParsedMeta = useCallback((path: string, bank: ParsedBank) => {
    setParsed((prev) => new Map(prev).set(path, bank));
    setBanks((prev) => prev?.map((b) => (b.path === path
      ? { ...b, fetched: true, questionCount: bank.questions.length, issueCount: bank.warnings.length }
      : b)) ?? prev);
  }, []);

  /** 拉取（或命中缓存）并落到解析缓存 + 列表计数：自动加载 / 手动勾选 / 开始训练共用。 */
  const loadBank = useCallback(async (path: string, client: Pick<GitHubClient, 'getBlobText'>) => {
    const bank = await ensureBankLoaded(path, client);
    applyParsedMeta(path, bank);
    return bank;
  }, [applyParsedMeta]);

  const setBankLoading = useCallback((path: string, on: boolean) => {
    setLoadingBanks((prev) => (on
      ? (prev.includes(path) ? prev : [...prev, path])
      : prev.filter((p) => p !== path)));
  }, []);

  // 已选中但解析缓存缺失/过期的题库：进入概览页后自动按需拉取。
  // 仅在线且有 Token 时执行；失败静默（保留「未获取」，可取消/重勾手动重试，不刷 toast）。
  // 不做取消：结果按「路径 + 目录树 sha」落库，parsed/列表在 banks 变化后自洽重建；
  // 这样 StrictMode 的「挂载→清理→再挂载」不会把第一次已发出的拉取结果丢掉（去重靠 autoTried）。
  useEffect(() => {
    if (!selection || !token || !banks || typeof navigator === 'undefined' || !navigator.onLine) return;
    const pending = banks.filter(
      (b) => selection.banks.includes(b.path) && !b.fetched && !autoTried.current.has(`${b.path}\u0000${b.sha}`),
    );
    if (!pending.length) return;
    const client = clientFor(token);
    void (async () => {
      for (const b of pending) {
        autoTried.current.add(`${b.path}\u0000${b.sha}`);
        setBankLoading(b.path, true);
        try {
          await loadBank(b.path, client);
        } catch {
          // 静默失败：列表保持「未获取」
        } finally {
          setBankLoading(b.path, false);
        }
      }
    })();
  }, [banks, loadBank, selection, setBankLoading, token]);

  const stats = useMemo(() => {
    const activeAttempts = attempts.filter((a) => !badQuestions.has(a.qid));
    const activeSrs = srsList.filter((s) => !badQuestions.has(s.qid));
    return summarize(activeAttempts, activeSrs, Date.now());
  }, [attempts, badQuestions, srsList]);

  const filterOptions = useMemo(() => {
    const chapters = new Set<string>();
    const types = new Set<string>();
    const tags = new Set<string>();
    const difficulty = new Set<string>();
    for (const bank of parsed.values()) {
      for (const q of bank.questions) {
        if (badQuestions.has(q.qid)) continue;
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
  }, [badQuestions, parsed]);

  const progress = useMemo(() => {
    const srs = new Map(srsList.map((s) => [s.qid, s]));
    return [...parsed.entries()].map(([path, bank]) => {
      let practiced = 0;
      let mastered = 0;
      let total = 0;
      for (const q of bank.questions) {
        if (badQuestions.has(q.qid)) continue;
        total += 1;
        const s = srs.get(q.qid);
        if (s) {
          practiced += 1;
          if (isMastered(s)) mastered += 1;
        }
      }
      return {
        path, name: bank.name, total, practiced, mastered,
        excluded: bank.questions.length - total,
      };
    });
  }, [badQuestions, parsed, srsList]);

  const badCountByBank = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of badQuestions.values()) {
      counts.set(record.bankPath, (counts.get(record.bankPath) ?? 0) + 1);
    }
    return counts;
  }, [badQuestions]);

  const badList = useMemo(
    () => [...badQuestions.values()].sort(
      (a, b) => a.bankPath.localeCompare(b.bankPath) || a.id.localeCompare(b.id),
    ),
    [badQuestions],
  );

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
    setBankLoading(path, true);
    try {
      await loadBank(path, new GitHubClient(token));
    } catch (err) {
      showToast(err instanceof Error ? err.message : '题库获取失败', { kind: 'error' });
    } finally {
      setBankLoading(path, false);
    }
  }, [loadBank, parsed, selection, setBankLoading, token, updateSelection]);

  const onStart = useCallback(async () => {
    if (!selection || starting) return;
    if (!selection.banks.length) { setMsg('请先选择至少一个题库'); return; }
    setStarting(true);
    setMsg(null);
    try {
      const client = clientFor(token);
      if (!token) {
        const metas = await listBanks();
        const allCached = selection.banks.every((path) => metas.find((m) => m.path === path)?.fetched === true);
        if (!allCached) throw new Error('未配置访问 Token，无法获取题库');
      }

      const loaded: ParsedBank[] = [];
      for (const path of selection.banks) {
        loaded.push(await loadBank(path, client));
      }

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
      const newIntroducedToday = [...srsMap.values()]
        .filter((s) => !badQuestions.has(s.qid) && s.firstAt >= dayStart(now)).length;
      const queue = buildQueue({
        candidates, srsByQid: srsMap, filters: selection.filters, excludedQids: new Set(badQuestions.keys()),
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
  }, [badQuestions, loadBank, navigate, selection, starting, token]);

  const onUnmark = useCallback(async (qid: string) => {
    try {
      await unmarkBadQuestion(qid);
      setBadQuestions((prev) => {
        const next = new Map(prev);
        next.delete(qid);
        return next;
      });
      showToast('已恢复该题');
    } catch {
      showToast('恢复失败，请重试', { kind: 'error' });
    }
  }, []);

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
        <div className="memory-header-links">
          <a className="memory-link" href={MEMORY_RECORDS}>训练记录</a>
          <a className="memory-link" href={SETTINGS_MEMORY}>设置</a>
        </div>
      </header>

      <section className="memory-card" aria-labelledby="memory-today-title">
        <h2 id="memory-today-title" className="memory-card-title">今日</h2>
        <div className="memory-stats">
          <div className="memory-stat"><b>{stats.dueToday}</b><span>待复习</span></div>
          <div className="memory-stat"><b>{stats.practicedToday}</b><span>已练</span></div>
          <div className="memory-stat"><b>{stats.streak}</b><span>连续天数</span></div>
          <div className="memory-stat"><b>{stats.avgAiScore7d ?? '—'}</b><span>近 7 天均分</span></div>
        </div>
        <button type="button" className="memory-primary" onClick={() => void onStart()} disabled={starting}>
          {starting ? '准备中…' : '开始训练'}
        </button>
        {msg && <p className="memory-note" role="status">{msg}</p>}
        {!llmReady && (
          <p className="memory-note">未配置模型，将使用「对照参考答案 + 自评」模式。</p>
        )}
      </section>

      <section className="memory-card" aria-labelledby="memory-banks-title">
        <h2 id="memory-banks-title" className="memory-card-title">题库</h2>
        {banks === null ? (
          <p className="memory-note">加载中…</p>
        ) : banks.length === 0 ? (
          <p className="memory-note">目录树中没有 .jsonl 题库，请先到首页「更新目录」。</p>
        ) : (
          <ul className="memory-banks">
            {banks.map((b) => {
              const badCount = badCountByBank.get(b.path) ?? 0;
              return (
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
                      {loadingBanks.includes(b.path) ? '加载中…' : b.fetched ? `${b.questionCount} 题${badCount ? ` · ${badCount} 道坏题` : ''}${b.issueCount ? ` · ${b.issueCount} 处问题` : ''}` : '未获取'}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {parsed.size > 0 && selection && (
          <div className="memory-filters">
            <MemoryChips label="形态" options={KIND_OPTIONS} selected={selection.filters.kinds} onToggle={(v) => toggleFilter('kinds', v)} />
            {filterOptions.types.length > 0 && (
              <MemoryChips label="题型" options={filterOptions.types.map((t) => ({ value: t, label: t }))} selected={selection.filters.types} onToggle={(v) => toggleFilter('types', v)} />
            )}
            {filterOptions.chapters.length > 0 && (
              <MemoryChips label="章节" options={filterOptions.chapters.map((c) => ({ value: c, label: c }))} selected={selection.filters.chapters} onToggle={(v) => toggleFilter('chapters', v)} />
            )}
            {filterOptions.tags.length > 0 && (
              <MemoryChips label="标签" options={filterOptions.tags.map((t) => ({ value: t, label: t }))} selected={selection.filters.tags} onToggle={(v) => toggleFilter('tags', v)} />
            )}
            {filterOptions.difficulty.length > 0 && (
              <MemoryChips label="难度" options={filterOptions.difficulty.map((d) => ({ value: d, label: d }))} selected={selection.filters.difficulty} onToggle={(v) => toggleFilter('difficulty', v)} />
            )}
          </div>
        )}
      </section>

      {progress.length > 0 && (
        <section className="memory-card" aria-labelledby="memory-progress-title">
          <h2 id="memory-progress-title" className="memory-card-title">进度</h2>
          <ul className="memory-progress">
            {progress.map((p) => (
              <li key={p.path}>
                <span className="memory-bank-name">{p.name}</span>
                <span className="memory-bank-meta">已练 {p.practiced}/{p.total} · 已掌握 {p.mastered}</span>
                {p.excluded > 0 && (
                  <span className="memory-bank-sub">题库 {p.total + p.excluded} 题，{p.excluded} 道坏题已排除</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {badList.length > 0 && (
        <section className="memory-card" aria-labelledby="memory-bad-title">
          <details className="memory-bad-manage">
            <summary id="memory-bad-title" className="memory-card-title">已标记坏题 · {badList.length} 道</summary>
            <ul className="memory-bad-list">
              {badList.map((b) => {
                const q = parsed.get(b.bankPath)?.questions.find((item) => item.qid === b.qid);
                return (
                  <li key={b.qid}>
                    <span className="memory-bad-text">
                      <b>{bankName(b.bankPath)} · {b.id}</b>
                      {q ? ` · ${q.question.replace(/\s+/g, ' ').slice(0, 60)}` : ''}
                    </span>
                    <button type="button" className="memory-restore" onClick={() => void onUnmark(b.qid)}>恢复</button>
                  </li>
                );
              })}
            </ul>
            <p className="memory-note">恢复后该题会重新进入抽题范围；原有进度不受影响。</p>
          </details>
        </section>
      )}

      <p className="memory-footnote">训练记录仅保存在本机浏览器；AI 评分时作答会发送到你填写的模型地址。</p>
    </main>
  );
}
