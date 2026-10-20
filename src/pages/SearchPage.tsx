import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { docHref, goBackOrHome } from '../app/nav';
import { listFilesMeta, type FileMeta } from '../data/db';
import { GitHubClient } from '../data/github';
import { activeRepo } from '../data/repos';
import { searchDocs, type SearchHit } from '../data/search';
import { loadCachedTexts } from '../data/searchCache';
import { downloadDocText } from '../data/sync';
import { QUOTA_TEXT, isQuotaError } from '../lib/errors';
import { runPool } from '../lib/pool';
import { showToast } from '../lib/toast';
import { termRanges } from '../markdown/highlight';
import { useSync } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';
import '../styles/search.css';

/** 输入即时搜索防抖（规格 §7）。 */
const DEBOUNCE_MS = 200;

/** 片段文本渲染：命中词用 <mark> 包裹（位置由 termRanges 计算）。 */
function renderSnippet(text: string, query: string): ReactNode {
  const ranges = termRanges(text, query);
  if (!ranges.length) return text;
  const nodes: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, k) => {
    if (r.start > pos) nodes.push(text.slice(pos, r.start));
    nodes.push(<mark key={k}>{text.slice(r.start, r.end)}</mark>);
    pos = r.end;
  });
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}

/**
 * 搜索页：查询词以 URL `?q=` 为唯一来源（输入框 200ms 防抖写回 URL）。
 * 未缓存（已过期）文档不参与搜索，可一键「纳入全文搜索」按需下载（并发 4）后重搜。
 */
export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const query = q.trim();
  const { lastSyncAt } = useSync();
  const { token } = useToken();

  const [input, setInput] = useState(q);
  const [metas, setMetas] = useState<FileMeta[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(0);
  const [reload, setReload] = useState(0);
  const lastWritten = useRef(q);

  // URL → 输入框（返回/前进等外部变化）；自己写入的值不回灌，避免打断正在输入的内容。
  useEffect(() => {
    if (q !== lastWritten.current) {
      lastWritten.current = q;
      setInput(q);
    }
  }, [q]);

  // 输入框 → URL：防抖、replace（输入过程不产生历史条目）。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = input.trim() ? input : '';
      if (next === q) return;
      lastWritten.current = next;
      setSearchParams(next ? { q: next } : {}, { replace: true });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input, q, setSearchParams]);

  // 查询执行：读已缓存正文（模块缓存自愈，含按需下载/过期）→ searchDocs；
  // lastSyncAt 变化（同步完成）自动重跑。
  useEffect(() => {
    if (!query) {
      setMetas([]);
      setHits(null);
      return;
    }
    let cancelled = false;
    setHits(null);
    void (async () => {
      const list = await listFilesMeta().catch(() => [] as FileMeta[]);
      if (cancelled) return;
      setMetas(list);
      const docs = await loadCachedTexts();
      if (cancelled) return;
      setHits(searchDocs(docs, query));
    })();
    return () => { cancelled = true; };
  }, [query, lastSyncAt, reload]);

  const uncached = metas.filter((m) => !m.cached);

  // 纳入全文搜索：对未缓存文档并发 4 下载（刷新 lastUsedAt），完成后重建缓存并重搜。
  const includeUncached = useCallback(async () => {
    if (busy || !token || !uncached.length) return;
    setBusy({ done: 0, total: uncached.length });
    setFailed(0);
    const cfg = activeRepo();
    const client = new GitHubClient(token);
    let bad = 0;
    let quota = false;
    await runPool(uncached, 4, async (m) => {
      try {
        await downloadDocText(client, cfg, m.path);
      } catch (err) {
        bad++;
        if (isQuotaError(err)) quota = true; // 写入超限：下载失败会逐篇累积，提示只需一次
      }
      setBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
    });
    setFailed(bad);
    setBusy(null);
    if (quota) showToast(QUOTA_TEXT, { kind: 'error' });
    setReload((n) => n + 1); // 重新列元数据并重搜（缓存按命中数自愈）
  }, [busy, token, uncached]);

  return (
    <main className="search-page">
      <div className="search-bar">
        <svg className="search-bar-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M15.4 15.4 21 21" />
        </svg>
        <input
          className="search-input"
          type="search"
          value={input}
          placeholder="搜索文档关键词"
          aria-label="搜索关键词"
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="button"
          className="search-cancel"
          onClick={() => goBackOrHome(navigate)}
        >
          取消
        </button>
      </div>

      {!query && !input.trim() ? (
        <p className="search-hint">输入关键词搜索全部已缓存文档</p>
      ) : (
        <>
          {uncached.length > 0 && (
            <div className="search-uncached">
              <span>{uncached.length} 篇文档未缓存（已过期），未参与搜索</span>
              <button
                type="button"
                className="search-include"
                disabled={busy !== null || !token}
                onClick={() => void includeUncached()}
              >
                {busy ? `纳入中 ${busy.done}·共 ${busy.total}` : '纳入全文搜索'}
              </button>
            </div>
          )}
          {failed > 0 && (
            <p className="search-failed" role="alert">{failed} 篇文档下载失败，可稍后重试</p>
          )}
          {hits === null ? (
            <p className="search-status" role="status">搜索中…</p>
          ) : hits.length === 0 ? (
            <p className="search-empty">未找到匹配的文档</p>
          ) : (
            <ul className="search-results">
              {hits.map((hit) => (
                <li key={hit.path} className="search-result">
                  <a className="search-result-title" href={docHref(hit.path, { q, i: 0 })}>
                    {hit.title}
                  </a>
                  <div className="search-result-meta">
                    <span className="search-result-path">{hit.path}</span>
                    <span className="search-result-count">命中 {hit.count} 处</span>
                  </div>
                  <ul className="search-snippet-list">
                    {hit.snippets.slice(0, 2).map((s, i) => (
                      <li key={`${s.start}:${i}`}>
                        <a className="search-snippet" href={docHref(hit.path, { q, i })}>
                          {renderSnippet(s.text, query)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
