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
      // 同步刷新该题库的体检计数，列表不必等下一次同步/reload 才显示「N 题 · M 处问题」
      setBanks((prev) => prev?.map((b) => (b.path === path
        ? { ...b, fetched: true, questionCount: bank.questions.length, issueCount: bank.warnings.length }
        : b)) ?? prev);
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
