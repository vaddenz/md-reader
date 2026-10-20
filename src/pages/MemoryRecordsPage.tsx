import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HOME } from '../app/nav';
import {
  attemptKey, clearTrainingData, exportMemory, getSelection, importMemory, listAttempts, loadSrsMap, summarize,
  type MemoryAttempt,
} from '../data/memory';
import { listBanks, type BankMeta } from '../data/qbankIndex';
import { VERDICT_LABELS, type SrsState, type Verdict } from '../lib/srs';
import { showToast } from '../lib/toast';
import '../styles/memory.css';

const VERDICT_ORDER: Verdict[] = ['excellent', 'good', 'hard', 'again'];

function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 导出文件名用的本地日期戳（YYYYMMDD，避免 UTC 与本地日期差一天）。 */
function localStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 已选题库中已缓存题库的题量和；无已选题库或全部未缓存时返回 null（界面显示「—」）。 */
function totalCachedQuestions(selected: string[], banks: BankMeta[]): number | null {
  const cached = banks.filter((b) => selected.includes(b.path) && b.fetched && b.questionCount !== null);
  return cached.length ? cached.reduce((sum, b) => sum + (b.questionCount ?? 0), 0) : null;
}

export default function MemoryRecordsPage() {
  const [attempts, setAttempts] = useState<MemoryAttempt[]>([]);
  const [srs, setSrs] = useState<SrsState[]>([]);
  const [totalQuestions, setTotalQuestions] = useState<number | null>(null);
  const [bankFilter, setBankFilter] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    // 全量读取：统计 / 档位分布 / 趋势 / 题库下拉与「已掌握」的全量 srs 口径保持一致；
    // 显示列表再用 shown 截断到最近 100 条。
    const [att, srsMap, selection, banks] = await Promise.all([
      listAttempts(), loadSrsMap(), getSelection(), listBanks(),
    ]);
    setAttempts(att);
    setSrs([...srsMap.values()]);
    setTotalQuestions(totalCachedQuestions(selection.banks, banks));
    setOpenKey(null);
    // 筛选项指向的题库可能已随导入/清除消失：回退到「全部」，避免空列表误报。
    const available = new Set(att.map((a) => a.bankPath));
    setBankFilter((f) => (f && !available.has(f) ? '' : f));
  }, []);

  useEffect(() => {
    void reload().catch(() => showToast('读取训练数据失败', { kind: 'error' }));
  }, [reload]);

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
      a.download = `md-reader-memory-${localStamp()}.json`;
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
          <div className="memory-stat"><b>{totalQuestions ?? '—'}</b><span>总题数</span></div>
          <div className="memory-stat"><b>{stats.practiced}</b><span>已练</span></div>
          <div className="memory-stat"><b>{stats.mastered}</b><span>已掌握</span></div>
          <div className="memory-stat"><b>{stats.avgAiScore ?? '—'}</b><span>平均分</span></div>
          <div className="memory-stat"><b>{stats.streak}</b><span>连续天数</span></div>
        </div>
        <p className="memory-note">到期：今日 {stats.dueToday} · 3 天内 {stats.due3} · 7 天内 {stats.due7}</p>
        <ul className="memory-verdicts">
          {VERDICT_ORDER.map((v) => (
            <li key={v}><span className={`memory-verdict-${v}`}>{VERDICT_LABELS[v]}</span><b>{stats.verdictCounts[v]}</b></li>
          ))}
        </ul>
        <div className="memory-trend" aria-label="近 14 天趋势">
          {stats.trend.map((t, i) => (
            <div key={t.day} className="memory-trend-col" title={`${fmtDay(t.day)}：${t.count} 题`}>
              {t.count > 0 && <i style={{ height: `${Math.round((t.count / trendMax) * 100)}%` }} />}
              {/* 14 列放不下完整日期：隔列显示，并在显示最后一列时隐藏倒数第二列，避免相邻挤压 */}
              <span>{(i % 2 === 0 && i !== stats.trend.length - 2) || i === stats.trend.length - 1 ? fmtDay(t.day) : ''}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="memory-card" aria-labelledby="records-list-title">
        <h2 id="records-list-title" className="memory-card-title">记录（最近 100 条）</h2>
        {banks.length > 0 && (
          <div className="memory-row">
            <span className="memory-row-label">题库</span>
            <select value={bankFilter} onChange={(e) => { setBankFilter(e.target.value); setOpenKey(null); }} aria-label="按题库筛选">
              <option value="">全部</option>
              {banks.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="memory-note">还没有训练记录。</p>
        ) : (
          <ul className="memory-records">
            {shown.map((a) => (
              <li key={attemptKey(a)}>
                <button
                  type="button"
                  className="memory-record"
                  onClick={() => setOpenKey(openKey === attemptKey(a) ? null : attemptKey(a))}
                >
                  <span className="memory-record-label">{a.idLabel} · {a.mode === 'ai' ? `${a.score} 分` : VERDICT_LABELS[a.verdict]}</span>
                  <span className="memory-bank-meta">{new Date(a.ts).toLocaleString('zh-CN', { hour12: false })}</span>
                </button>
                {openKey === attemptKey(a) && (
                  <div className="memory-record-body">
                    {a.answer && <p className="memory-note">作答：{a.answer}</p>}
                    {a.picked && <p className="memory-note">选择：{a.picked.join('、')}{a.correct ? `（正确：${a.correct.join('、')}）` : ''}</p>}
                    {a.hit.length > 0 && <p className="memory-note">命中要点：{a.hit.join('、')}</p>}
                    {a.missed.length > 0 && <p className="memory-note">遗漏要点：{a.missed.join('、')}</p>}
                    {a.comment && <p className="memory-note">{a.comment}</p>}
                    <p className="memory-note">
                      用时 {a.durationMs < 1000 ? '<1 秒' : `${Math.round(a.durationMs / 1000)} 秒`}
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
