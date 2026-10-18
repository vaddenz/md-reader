import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { HOME, toRouterPath } from '../app/nav';
import { keyFromLocation, rememberScroll, takeScroll } from '../app/scroll';
import BackToSource from '../components/BackToSource';
import DocHeader from '../components/DocHeader';
import PrevNext from '../components/PrevNext';
import TocDrawer from '../components/TocDrawer';
import TreeDrawer from '../components/TreeDrawer';
import { DEFAULT_REPO } from '../constants';
import { getFile, kvGet, listFilesMeta, touchFile, type FileMeta, type TreeEntry } from '../data/db';
import { GitHubClient } from '../data/github';
import { downloadDocText } from '../data/sync';
import { highlightInContainer } from '../markdown/highlight';
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
  const location = useLocation();
  const locationKey = keyFromLocation(location);
  const from = (location.state as { from?: string } | null)?.from;
  const { token } = useToken();
  const params = useParams();
  const raw = params['*'] ?? '';
  const path = raw.includes('%') ? safeDecode(raw) : raw;
  const [searchParams] = useSearchParams();
  const to = searchParams.get('to') ?? '';
  const q = searchParams.get('q') ?? '';
  // 命中序号：片段↔正文命中非严格 1:1，越界回退第一处（下方 ?? marks[0]）。
  const iRaw = searchParams.get('i') ?? '';
  const markIndex = /^\d+$/.test(iRaw) ? Number(iRaw) : 0;

  const [state, setState] = useState<PageState>({ kind: 'loading', path });
  const [metas, setMetas] = useState<FileMeta[]>([]);
  const [metasLoaded, setMetasLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
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
  const ready = rendered !== null;
  const html = rendered?.html ?? '';

  // 目录抽屉只列 h1–h4（brief 约定）；没有这样的标题时不显示入口。
  const tocHeadings = useMemo(
    () => (rendered?.headings ?? []).filter((h) => h.level <= 4),
    [rendered],
  );
  // 两个抽屉互斥：打开一个先收起另一个，避免叠加。
  const openToc = useCallback(() => { setTreeOpen(false); setTocOpen(true); }, []);
  const openTree = useCallback(() => { setTocOpen(false); setTreeOpen(true); }, []);
  const closeToc = useCallback(() => setTocOpen(false), []);
  const closeTree = useCallback(() => setTreeOpen(false), []);

  // 换文档（如浏览器前进/后退）时关闭抽屉，避免展示上一篇的目录/高亮。
  useEffect(() => { setTocOpen(false); setTreeOpen(false); }, [path]);

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

  // 持续记录当前历史条目的滚动位置（rAF 节流）。仅在正文就绪时记录：
  // 切换文档的加载间隙页面会变矮，浏览器把 scrollY 钳制到新高度，
  // 此时记录会覆盖掉导航前刚记住的真实位置（T16 关键细节）。
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    let scheduled = false;
    const save = () => {
      scheduled = false;
      rememberScroll(locationKey, window.scrollY);
    };
    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      frame = window.requestAnimationFrame(save);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scheduled) window.cancelAnimationFrame(frame);
    };
  }, [locationKey, ready]);

  // 历史滚动恢复：回到本条目（浏览器返回/「返回来源」）时优先还原记录的位置；
  // 新打开时：?to= 锚点 > ?q= 第 i 处命中（越界回退第一处）> 页首。
  // 高亮在正文注入 + 懒加载启动（上一个 effect）之后执行：先清理旧命中再重新高亮。
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (container) {
      for (const old of container.querySelectorAll('mark.search-mark')) old.replaceWith(...old.childNodes);
    }
    const marks = container && q ? highlightInContainer(container, q) : [];
    const saved = takeScroll(locationKey);
    if (saved !== undefined) {
      const frame = window.requestAnimationFrame(() => {
        window.scrollTo(0, saved);
        rememberScroll(locationKey, saved); // 恢复期间若被钳制值覆盖，用真实值写回
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (to) document.getElementById(to)?.scrollIntoView();
    else if (marks.length) (marks[markIndex] ?? marks[0]).scrollIntoView();
    else if (!q) window.scrollTo(0, 0);
  }, [ready, to, q, markIndex, locationKey]);

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
    // 站内互链（render 加了 .in-app-link）：拦截原生 hash 导航，记录当前滚动位置，
    // 并带上来源 state 交给 react-router（「返回来源」依赖 location.state.from）。
    const inApp = el.closest<HTMLAnchorElement>('a.in-app-link');
    if (inApp) {
      const href = inApp.getAttribute('href') ?? '';
      if (href.startsWith('#/')) {
        e.preventDefault();
        rememberScroll(locationKey, window.scrollY);
        navigate(toRouterPath(href), { state: { from: location.pathname + location.search } });
        return;
      }
    }
    // 同页锚点（render 约定 href="#slug"）：hash 路由会把 #slug 当路由解析成 404，必须原地拦截后滚动。
    const anchor = el.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('#/')) {
        e.preventDefault(); // 不改 URL、不产生历史记录
        const id = safeDecode(href.slice(1));
        if (id) document.getElementById(id)?.scrollIntoView();
      }
      return;
    }
    const btn = el.closest<HTMLElement>('button.code-copy');
    if (btn) void copyCode(btn);
  }, [copyCode, location.pathname, location.search, locationKey, navigate]);

  // 文件树抽屉选中文档：收起抽屉、记住当前位置，再经 react-router 导航。
  const openDocFromTree = useCallback((href: string) => {
    setTreeOpen(false);
    rememberScroll(locationKey, window.scrollY);
    navigate(toRouterPath(href));
  }, [locationKey, navigate]);

  const title = cur.kind === 'ready' ? cur.title : '';

  return (
    <>
      <DocHeader
        title={title}
        onOpenToc={tocHeadings.length > 0 ? openToc : undefined}
        onOpenTree={metas.length > 0 ? openTree : undefined}
      />
      {from && <BackToSource />}
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
      {tocOpen && <TocDrawer headings={tocHeadings} onClose={closeToc} />}
      {treeOpen && (
        <TreeDrawer metas={metas} currentPath={path} onSelect={openDocFromTree} onClose={closeTree} />
      )}
    </>
  );
}
