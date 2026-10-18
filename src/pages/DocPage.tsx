import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { HOME, toRouterPath } from '../app/nav';
import DocHeader from '../components/DocHeader';
import PrevNext from '../components/PrevNext';
import { DEFAULT_REPO } from '../constants';
import { getFile, kvGet, listFilesMeta, touchFile, type FileMeta, type TreeEntry } from '../data/db';
import { GitHubClient } from '../data/github';
import { downloadDocText } from '../data/sync';
import { hydrateImages } from '../markdown/images';
import { hydrateMermaid } from '../markdown/mermaid';
import { renderDoc } from '../markdown/render';
import type { RepoConfig } from '../state/SyncContext';
import { useToken } from '../state/TokenContext';

type PageState =
  | { kind: 'loading'; path: string }
  | { kind: 'downloading'; path: string }
  | { kind: 'missing'; path: string }
  | { kind: 'download-failed'; path: string }
  | { kind: 'ready'; path: string; title: string; text: string };

const COPY_LABEL = '复制';
const COPY_RESET_MS = 1500;

/** 路由参数通常已被 react-router 解码；仍含 % 时兜底再解一次，非法编码原样使用。 */
function safeDecode(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export default function DocPage() {
  const navigate = useNavigate();
  const { token } = useToken();
  const params = useParams();
  const raw = params['*'] ?? '';
  const path = raw.includes('%') ? safeDecode(raw) : raw;
  const [searchParams] = useSearchParams();
  const to = searchParams.get('to') ?? '';

  const [state, setState] = useState<PageState>({ kind: 'loading', path });
  const [metas, setMetas] = useState<FileMeta[]>([]);
  const [metasLoaded, setMetasLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const copyTimers = useRef(new Map<HTMLElement, number>());

  // 目录元数据（knownPaths 判定互链 + 上下篇排序）；就绪前不渲染正文，避免互链被误判为死链。
  useEffect(() => {
    let cancelled = false;
    void listFilesMeta().then(
      (list) => { if (!cancelled) { setMetas(list); setMetasLoaded(true); } },
      () => { if (!cancelled) setMetasLoaded(true); },
    );
    return () => { cancelled = true; };
  }, []);

  // 三分支：无记录 → 不存在；text === null（已过期）→ 联网按需下载；正常 → 直接渲染。
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading', path });
    void (async () => {
      const rec = await getFile(path).catch(() => undefined);
      if (cancelled) return;
      if (!rec) { setState({ kind: 'missing', path }); return; }
      if (rec.text !== null) { setState({ kind: 'ready', path, title: rec.title, text: rec.text }); return; }

      setState({ kind: 'downloading', path });
      const cfg = (await kvGet<RepoConfig>('config').catch(() => undefined)) ?? DEFAULT_REPO;
      if (cancelled) return;
      if (!token) { setState({ kind: 'download-failed', path }); return; }
      try {
        const text = await downloadDocText(new GitHubClient(token), cfg, path);
        if (!cancelled) setState({ kind: 'ready', path, title: rec.title, text });
      } catch {
        if (!cancelled) setState({ kind: 'download-failed', path });
      }
    })();
    return () => { cancelled = true; };
  }, [path, token, retry]);

  // 换文档后、新状态就绪前，旧状态不参与渲染（避免闪出上一篇的正文/状态）。
  const cur: PageState = state.path === path ? state : { kind: 'loading', path };

  const knownPaths = useMemo(() => new Set(metas.map((m) => m.path)), [metas]);
  const rendered = useMemo(
    () => (cur.kind === 'ready' && metasLoaded ? renderDoc(cur.text, { path, knownPaths }) : null),
    [cur, metasLoaded, knownPaths, path],
  );
  const html = rendered?.html ?? '';

  // 图片管线：由仓库路径查 kv.tree 的 sha，再按当前配置鉴权取字节（blob 缓存由管线内部处理）。
  const fetchBlob = useCallback(async (repoPath: string): Promise<Blob> => {
    if (!token) throw new Error('未配置 Token');
    const tree = await kvGet<{ entries: TreeEntry[] }>('tree');
    const sha = tree?.entries.find((e) => e.path === repoPath)?.sha;
    if (!sha) throw new Error('图片不在本地目录树中');
    const cfg = (await kvGet<RepoConfig>('config').catch(() => undefined)) ?? DEFAULT_REPO;
    return new GitHubClient(token).getBlobBytes(cfg.owner, cfg.repo, sha);
  }, [token]);

  // 正文注入后：图片 / mermaid 懒加载，并刷新过期时钟；换文档或卸载时清理。
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !html) return;
    const stopImages = hydrateImages(container, { fetchBlob });
    const stopMermaid = hydrateMermaid(container);
    void touchFile(path).catch(() => {});
    return () => {
      stopImages();
      stopMermaid();
    };
  }, [html, path, fetchBlob]);

  // ?to= 锚点滚动；无锚点回到页首（T16 将替换为历史滚动位置恢复）。
  useEffect(() => {
    if (!html) return;
    if (to) document.getElementById(to)?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [html, to, path]);

  // 卸载时清掉复制按钮的回退定时器。
  useEffect(() => () => {
    for (const timer of copyTimers.current.values()) window.clearTimeout(timer);
    copyTimers.current.clear();
  }, []);

  const copyCode = useCallback(async (btn: HTMLElement) => {
    const text = btn.closest('.code-block')?.querySelector('pre')?.textContent ?? '';
    let label = '复制失败';
    try {
      await navigator.clipboard.writeText(text);
      label = '已复制';
    } catch {
      // 剪贴板不可用（非安全上下文 / 权限拒绝）：仅改按钮文案，不抛出
    }
    btn.textContent = label;
    const old = copyTimers.current.get(btn);
    if (old !== undefined) window.clearTimeout(old);
    copyTimers.current.set(btn, window.setTimeout(() => {
      copyTimers.current.delete(btn);
      btn.textContent = COPY_LABEL;
    }, COPY_RESET_MS));
  }, []);

  const onContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as Element;
    const dead = el.closest('a[data-dead]');
    if (dead) {
      e.preventDefault(); // 目标不存在的链接停留原处（提示文案留待 T22）
      return;
    }
    const btn = el.closest<HTMLElement>('button.code-copy');
    if (btn) void copyCode(btn);
  }, [copyCode]);

  const title = cur.kind === 'ready' ? cur.title : '';
  const ready = rendered !== null;

  return (
    <>
      <DocHeader title={title} />
      {ready ? (
        <div
          key="content"
          className="doc-content"
          ref={contentRef}
          onClick={onContentClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div key="state" className="doc-content">
          {cur.kind === 'missing' ? (
            <div className="doc-state">
              <p>文档不存在或尚未同步</p>
              <button type="button" className="doc-state-btn" onClick={() => navigate(toRouterPath(HOME))}>
                返回首页
              </button>
            </div>
          ) : cur.kind === 'download-failed' ? (
            <div className="doc-state">
              <p>该文档未缓存，需联网下载后阅读</p>
              <button type="button" className="doc-state-btn" onClick={() => setRetry((n) => n + 1)}>
                重试
              </button>
            </div>
          ) : (
            <div className="doc-state" role="status">
              <p>{cur.kind === 'downloading' ? '正在下载文档…' : '加载中…'}</p>
            </div>
          )}
        </div>
      )}
      {ready && <PrevNext path={path} metas={metas} />}
    </>
  );
}
