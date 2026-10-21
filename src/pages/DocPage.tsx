import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { HOME, SETUP, toRouterPath } from '../app/nav';
import { keyFromLocation, rememberScroll, takeScroll } from '../app/scroll';
import AppearanceSheet from '../components/AppearanceSheet';
import BackToSource from '../components/BackToSource';
import DocHeader from '../components/DocHeader';
import FloatingTocButton from '../components/FloatingTocButton';
import NoteEditor from '../components/NoteEditor';
import NotesDrawer from '../components/NotesDrawer';
import PrevNext from '../components/PrevNext';
import RelatedDocs from '../components/RelatedDocs';
import SelectionMenu from '../components/SelectionMenu';
import TocDrawer from '../components/TocDrawer';
import TreeDrawer from '../components/TreeDrawer';
import TtsBar from '../components/TtsBar';
import TtsSheet from '../components/TtsSheet';
import { appearanceStyle, DEFAULT_APPEARANCE, getAppearance, type ReaderAppearance } from '../data/appearance';
import { getFile, kvGet, kvSet, listFilesMeta, touchFile, type FileMeta, type TreeEntry } from '../data/db';
import { GitHubClient, GitHubError } from '../data/github';
import { addHighlight, getDocHighlights, removeHighlights, type HighlightRecord } from '../data/highlights';
import { addNote, getDocNotes, removeNotes, updateNote, type NoteRecord } from '../data/notes';
import { getFavorites, getProgress, toggleFavorite } from '../data/prefs';
import { activeRepo } from '../data/repos';
import { downloadDocText } from '../data/sync';
import { useReadingProgress } from '../hooks/useReadingProgress';
import { useTts } from '../tts/useTts';
import { AUTH_EXPIRED_TEXT, QUOTA_TEXT, isQuotaError } from '../lib/errors';
import { menuActionsFor, type MenuContext } from '../lib/selection-menu';
import { showToast } from '../lib/toast';
import { highlightInContainer } from '../markdown/highlight';
import { applyHighlights, buildHaystack, contentRange, rangeIntersectsExcluded, removeMarks, selectionToAnchor, visibleText, wrapRange } from '../markdown/highlights';
import { hydrateImages } from '../markdown/images';
import { hydrateMermaid } from '../markdown/mermaid';
import { applyNotes } from '../markdown/notes';
import { renderDoc } from '../markdown/render';
import { useOrientation } from '../state/OrientationContext';
import { useSync } from '../state/SyncContext';
import { useTabs } from '../state/TabsContext';
import { useToken } from '../state/TokenContext';

type PageState =
  | { kind: 'loading'; path: string }
  | { kind: 'downloading'; path: string }
  | { kind: 'missing'; path: string }
  | { kind: 'download-failed'; path: string }
  | { kind: 'ready'; path: string; title: string; text: string };

/** 右键菜单状态：触点位置 + 判定上下文 + 选区锚点（无选区为 null）+ 打开时的选区快照/矩形 + 点中的高亮 id。 */
interface MenuState {
  x: number; y: number;
  ctx: MenuContext;
  sel: { anchor: { exact: string; prefix: string; suffix: string }; start: number; end: number } | null;
  markId: string | null; // 无选区时点中的高亮记录 id（「清除高亮」用）
  range: Range | null; // 打开时的实时选区（菜单随 selectionchange 变化自动关闭）
  rect: DOMRect | null; // 打开时的选区矩形（菜单避开选区定位；无选区为 null）
}

const COPY_LABEL = '复制';
const COPY_RESET_MS = 1500;
const EMPTY_NOTES: NoteRecord[] = [];

type NoteEditorState =
  | { kind: 'create'; anchor: { exact: string; prefix: string; suffix: string } }
  | { kind: 'edit'; note: NoteRecord };

/** 路由参数通常已被 react-router 解码；仍含 % 时兜底再解一次，非法编码原样使用。 */
function safeDecode(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** 选区是否等价于当前正文容器内、由「全选」建立的选区（对象同一或边界一致）；跨根/已卸载/已塌缩视为不等。 */
function sameSelectionRange(sel: Selection | null, range: Range | null, container: HTMLElement): boolean {
  if (!range || !sel || sel.rangeCount !== 1) return false;
  const cur = sel.getRangeAt(0);
  if (!container.contains(cur.commonAncestorContainer)) return false; // 旧文档的残留选区
  if (cur.collapsed) return false; // 旧「全选」Range 在正文换新后塌缩到容器起点：不代表当前存在全选选区
  if (cur === range) return true;
  try {
    return cur.compareBoundaryPoints(Range.START_TO_START, range) === 0
      && cur.compareBoundaryPoints(Range.END_TO_END, range) === 0;
  } catch {
    return false;
  }
}

export default function DocPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationKey = keyFromLocation(location);
  const from = (location.state as { from?: string } | null)?.from;
  const { token } = useToken();
  const { lastSyncAt } = useSync();
  const { state: orientation, toggleLandscape, flip } = useOrientation();
  const { loaded: tabsLoaded, ensureTab, setTitle: setTabTitle } = useTabs();
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
  // null = 收藏状态尚未读取（不渲染星标按钮，避免先闪未收藏态）。
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [appearance, setAppearance] = useState<ReaderAppearance>(DEFAULT_APPEARANCE);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // 同步应用后自增，触发高亮/笔记重锚（正文 DOM 不变，只增删 mark）。
  const [syncTick, setSyncTick] = useState(0);
  const [notesDoc, setNotesDoc] = useState<{ path: string; list: NoteRecord[] }>({ path: '', list: [] });
  const [notePositions, setNotePositions] = useState<{
    path: string;
    positions: Map<string, { start: number; end: number }>;
  } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null);
  const [ttsOpen, setTtsOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const copyTimers = useRef(new Map<HTMLElement, number>());
  // 已渲染高亮：记录 id → haystack 区间（右键菜单判定相交/清除时使用，T10 消费）。
  const appliedRef = useRef(new Map<string, { start: number; end: number }>());
  // 「全选」建立的选区范围：DOM Range 无法跳过中间的排除区（连续区间），
  // 复制时据此识别全选选区并改用 visibleText 过滤（见下方 copy 监听）。
  const selectAllRangeRef = useRef<Range | null>(null);

  // 目录元数据（knownPaths 判定互链 + 上下篇排序）；就绪前不渲染正文，避免互链被误判为死链。
  // 同步完成（lastSyncAt 变化）后重读：抽屉内「更新目录」的结果即时反映到文件树（与首页同口径）。
  useEffect(() => {
    let cancelled = false;
    void listFilesMeta().then(
      (list) => { if (!cancelled) { setMetas(list); setMetasLoaded(true); } },
      () => { if (!cancelled) setMetasLoaded(true); },
    );
    return () => { cancelled = true; };
  }, [lastSyncAt]);

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
      const cfg = activeRepo();
      if (cancelled) return;
      if (!token) { setState({ kind: 'download-failed', path }); return; }
      try {
        const text = await downloadDocText(new GitHubClient(token), cfg, path);
        if (!cancelled) setState({ kind: 'ready', path, title: rec.title, text });
      } catch (err) {
        if (cancelled) return;
        if (isQuotaError(err)) {
          // 存储超限（写入 IndexedDB 失败）单独提示，其余走「需联网下载」重试态
          showToast(QUOTA_TEXT, { kind: 'error' });
        } else if (err instanceof GitHubError && err.kind === 'auth') {
          // 过期文档按需下载遇 401：与同步同口径——提示重新授权并跳引导页（缓存保留）
          showToast(AUTH_EXPIRED_TEXT, { kind: 'error' });
          navigate(toRouterPath(`${SETUP}?reauth=1`));
          return;
        }
        setState({ kind: 'download-failed', path });
      }
    })();
    return () => { cancelled = true; };
    // 依赖不含 navigate：其身份随路由变化，入依赖会在同文档内导航（如 ?q= 变化）时重复触发下载。
    // 闭包中的旧实例执行绝对路径导航仍然有效（与 SyncContext 自动同步同口径）。
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
  // 文档切换的加载间隙不把上一篇的笔记套到新正文上。
  const notes = useMemo(
    () => (notesDoc.path === path ? notesDoc.list : EMPTY_NOTES),
    [notesDoc, path],
  );

  // 目录抽屉只列 h1–h4（brief 约定）；无标题时入口仍显示，抽屉内呈现空态（2026-10-20 用户裁定）。
  const tocHeadings = useMemo(
    () => (rendered?.headings ?? []).filter((h) => h.level <= 4),
    [rendered],
  );
  // 两个抽屉互斥：打开一个先收起另一个，避免叠加。
  const openToc = useCallback(() => { setTreeOpen(false); setTocOpen(true); }, []);
  const openTree = useCallback(() => { setTocOpen(false); setTreeOpen(true); }, []);
  const closeToc = useCallback(() => setTocOpen(false), []);
  const closeTree = useCallback(() => setTreeOpen(false), []);

  // 换文档（如浏览器前进/后退）时关闭抽屉与右键菜单，并清掉上一篇的选区/高亮引用，避免被旧选区劫持复制。
  useEffect(() => {
    setTocOpen(false);
    setTreeOpen(false);
    setMenu(null);
    setNotesOpen(false);
    setNoteEditor(null);
    selectAllRangeRef.current = null;
    appliedRef.current = new Map();
  }, [path]);

  // 收藏状态：随文档切换重新读取；读取失败按未收藏处理（按钮仍可用）。
  useEffect(() => {
    let cancelled = false;
    void getFavorites().then(
      (list) => { if (!cancelled) setFavorite(list.includes(path)); },
      () => { if (!cancelled) setFavorite(false); },
    );
    return () => { cancelled = true; };
  }, [path]);

  const toggleFav = useCallback(() => {
    void toggleFavorite(path).then(
      (list) => setFavorite(list.includes(path)),
      () => {},
    );
  }, [path]);

  // 阅读排版（T1 外观模块）：挂载时读取一次并应用为 .doc-content 的 CSS 变量；读取失败保持默认口径。
  useEffect(() => {
    let cancelled = false;
    void getAppearance().then((a) => { if (!cancelled) setAppearance(a); });
    return () => { cancelled = true; };
  }, []);

  // 图片管线：由仓库路径查 kv.tree 的 sha，再按当前配置鉴权取字节（blob 缓存由管线内部处理）。
  const fetchBlob = useCallback(async (repoPath: string): Promise<Blob> => {
    if (!token) throw new Error('未配置 Token');
    const tree = await kvGet<{ entries: TreeEntry[] }>('tree');
    const sha = tree?.entries.find((e) => e.path === repoPath)?.sha;
    if (!sha) throw new Error('图片不在本地目录树中');
    const cfg = activeRepo();
    return new GitHubClient(token).getBlobBytes(cfg.owner, cfg.repo, sha);
  }, [token]);

  // 正文注入后：图片 / mermaid 懒加载，并刷新过期时钟；换文档或卸载时清理。
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !html) return;
    const stopImages = hydrateImages(container, { fetchBlob });
    const stopMermaid = hydrateMermaid(container);
    void touchFile(path).catch(() => {});
    void kvSet('lastDoc', path).catch(() => {}); // 记住最近打开的文档（后续任务可用）
    return () => {
      stopImages();
      stopMermaid();
    };
  }, [html, path, fetchBlob]);

  // 同步应用后重锚高亮：先移除现有 mark（DOM 结构不变、不滚动），再由下方 effect 重新读取应用。
  useEffect(() => {
    const onApplied = () => {
      const el = contentRef.current;
      if (el && appliedRef.current.size) {
        removeMarks(el, [...appliedRef.current.keys()]);
        appliedRef.current = new Map();
      }
      setSyncTick((v) => v + 1);
    };
    window.addEventListener('mdreader:sync-applied', onApplied);
    return () => window.removeEventListener('mdreader:sync-applied', onApplied);
  }, []);

  // 高亮重锚：每次正文注入（打开/同步更新）后，异步读记录并锚定；DOM 已被替换为干净正文。
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !html) return;
    let cancelled = false;
    void getDocHighlights(path).then(
      (records) => {
        const el = contentRef.current;
        if (cancelled || !el) return;
        appliedRef.current = applyHighlights(el, records);
      },
      () => {
        // 读取失败：静默清空已应用状态（避免残留区间；不打扰用户）。
        if (!cancelled) appliedRef.current = new Map();
      },
    );
    return () => { cancelled = true; };
  }, [html, path, syncTick]);

  // 笔记：正文注入/同步后读取；与高亮共用 TextQuote 锚定口径。
  useEffect(() => {
    let cancelled = false;
    void getDocNotes(path).then(
      (list) => { if (!cancelled) setNotesDoc({ path, list }); },
      () => { if (!cancelled) setNotesDoc({ path, list: [] }); },
    );
    return () => { cancelled = true; };
  }, [path, syncTick]);

  // 笔记符号：记录变化（新增/编辑/同步）后先移除旧符号再重锚；未命中的孤儿保留记录但不渲染。
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !html) return;
    const positions = applyNotes(container, notes);
    setNotePositions({ path, positions });
  }, [html, path, notes]);

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
  // 新打开时优先级：scroll 记忆 > ?to= 锚点 > ?q= 第 i 处命中（越界回退第一处）> 进度比例（spec §1.4）> 页首。
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
      const restoreFrame = window.requestAnimationFrame(() => {
        window.scrollTo(0, saved);
        rememberScroll(locationKey, saved); // 恢复期间若被钳制值覆盖，用真实值写回
      });
      return () => window.cancelAnimationFrame(restoreFrame);
    }
    if (to) {
      document.getElementById(to)?.scrollIntoView();
      return;
    }
    if (q) {
      if (marks.length) (marks[markIndex] ?? marks[0]).scrollIntoView();
      return;
    }
    // 无 scroll 记忆、无 ?to/?q：按已保存进度默认落位（spec §1.4，v1.x 行为）。
    // ratio ≤ 5% 视为「已在首屏」，不滚动。
    let cancelled = false;
    let frame = 0;
    void getProgress(path).catch(() => undefined).then((rec) => {
      if (cancelled || !rec || rec.ratio <= 0.05) return;
      frame = window.requestAnimationFrame(() => {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.round(rec.ratio * max));
        rememberScroll(locationKey, window.scrollY); // 落位写回记忆，下次同条目直接命中记忆分支
      });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [ready, to, q, markIndex, locationKey, path]);

  // 阅读进度记录：滚动比例节流写入（含 visibilitychange 与卸载补写）。
  useReadingProgress(path, { enabled: ready, container: contentRef });

  // 文档朗读：系统 TTS + 句级高亮 + 断点。只朗读正文，不读代码/图表。
  const tts = useTts({ path, containerRef: contentRef, ready });

  useEffect(() => {
    setTtsOpen(false);
  }, [path]);

  // 多标签登记（spec §3.2）：载入完成后确保当前文档在标签中并聚焦。
  useEffect(() => {
    if (!tabsLoaded) return;
    ensureTab(path);
  }, [tabsLoaded, path, ensureTab]);

  // 就绪后回填标签标题（切换器显示用）；同样等待载入，避免「就绪早于恢复」时回填丢失（无标签可改名）。
  useEffect(() => {
    if (!tabsLoaded) return;
    if (cur.kind === 'ready' && cur.title) setTabTitle(path, cur.title);
  }, [tabsLoaded, cur, path, setTabTitle]);

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
    const noteMark = el.closest<HTMLElement>('button.note-mark');
    if (noteMark) {
      e.preventDefault(); // 笔记符号可能落在链接内：阻止链接导航
      const id = noteMark.getAttribute('data-note-id');
      const note = notes.find((n) => n.id === id);
      if (note) setNoteEditor({ kind: 'edit', note });
      return;
    }
    const dead = el.closest('a[data-dead]');
    if (dead) {
      e.preventDefault(); // 目标不存在的链接停留原处，仅提示（spec §6.1-2）
      showToast(dead.getAttribute('data-dead') || '文件不存在');
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
  }, [copyCode, location.pathname, location.search, locationKey, navigate, notes]);

  // 右键/长按（spec §6）：正文内始终压制原生菜单，按选区/目标算出菜单项与选区锚点。
  const onContentContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = contentRef.current;
    if (!container) return;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    const inContainer = !!range && container.contains(range.commonAncestorContainer);
    const excluded = !!range && inContainer && rangeIntersectsExcluded(container, range);
    const selInfo = range && inContainer && !excluded ? selectionToAnchor(container, range) : null;
    let intersects = false;
    if (selInfo) {
      for (const r of appliedRef.current.values()) {
        if (selInfo.start < r.end && r.start < selInfo.end) { intersects = true; break; }
      }
    }
    const markEl = (e.target as Element).closest('mark.hl');
    setMenu({
      x: e.clientX, y: e.clientY,
      ctx: {
        hasSelection: !!range && inContainer, // 有选区（含排除区；能否高亮由 selectionInExcluded 决定）
        selectionInExcluded: excluded,
        selectionIntersectsHighlight: intersects,
        targetOnHighlight: !!markEl,
      },
      sel: selInfo,
      markId: markEl?.getAttribute('data-hl-id') ?? null,
      // 快照须克隆：选区被拖动/改写时浏览器会原地变更 live Range 的边界，
      // 存 live 对象会让「变化后」与快照同体而无法察觉。
      range: range ? range.cloneRange() : null,
      rect: range ? range.getBoundingClientRect() : null,
    });
  }, []);

  const onMenuAction = useCallback((id: string) => {
    const current = menu;
    setMenu(null);
    const container = contentRef.current;
    if (!current || !container) return;
    const sel = window.getSelection();

    if (id === 'read-aloud') {
      if (current.range) tts.startFromSelection(current.range);
      sel?.removeAllRanges();
      return;
    }

    if (id === 'copy') {
      // 全选选区（Range 含中间排除区）改用可见文本，避免带入「复制」按钮等界面文本。
      const text = sameSelectionRange(sel, selectAllRangeRef.current, container) ? visibleText(container) : (sel?.toString() ?? '');
      void navigator.clipboard.writeText(text).then(
        () => showToast('已复制'),
        () => showToast('复制失败', { kind: 'error' }),
      );
      return;
    }
    if (id === 'note') {
      if (!current.sel) return;
      setNoteEditor({ kind: 'create', anchor: current.sel.anchor });
      sel?.removeAllRanges();
      return;
    }
    if (id === 'select-all') {
      const r = contentRange(container);
      if (r) {
        selectAllRangeRef.current = r;
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
      return;
    }
    if (id === 'clear') {
      const ids: string[] = [];
      if (current.sel) {
        for (const [recId, r] of appliedRef.current) {
          if (current.sel.start < r.end && r.start < current.sel.end) ids.push(recId);
        }
      } else if (current.markId) {
        ids.push(current.markId); // 无选区、点在高亮上
      }
      if (ids.length) {
        removeMarks(container, ids);
        for (const rid of ids) appliedRef.current.delete(rid);
        void removeHighlights(path, ids).catch(() => {});
      }
      sel?.removeAllRanges();
      return;
    }
    if (id.startsWith('hl:')) {
      const color = id.slice(3);
      if (!current.sel) return;
      // 1) 清除与选区相交的已渲染高亮
      const overlapIds: string[] = [];
      for (const [recId, r] of appliedRef.current) {
        if (current.sel.start < r.end && r.start < current.sel.end) overlapIds.push(recId);
      }
      if (overlapIds.length) {
        removeMarks(container, overlapIds);
        for (const rid of overlapIds) appliedRef.current.delete(rid);
        void removeHighlights(path, overlapIds).catch(() => {});
      }
      // 2) 包裹新高亮（DOM 变化后重建 haystack）
      const haystack = buildHaystack(container);
      const record: HighlightRecord = {
        id: crypto.randomUUID(),
        exact: current.sel.anchor.exact,
        prefix: current.sel.anchor.prefix,
        suffix: current.sel.anchor.suffix,
        decorations: [{ kind: 'bg', color }],
        createdAt: Date.now(),
      };
      const cls = `hl hl-${color}`;
      wrapRange(container, haystack, current.sel.start, current.sel.end, cls, record.id);
      appliedRef.current.set(record.id, { start: current.sel.start, end: current.sel.end });
      void addHighlight(path, record).catch(() => showToast('高亮保存失败', { kind: 'error' }));
      window.getSelection()?.removeAllRanges();
      return;
    }
  }, [menu, path, tts]);

  // 原生复制（Cmd/Ctrl+C）兜底：全选选区含中间排除区（Range 是连续区间），
  // 复制时改写为可见文本，避免代码块内「复制」按钮等界面文本混入剪贴板。
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const container = contentRef.current;
      if (!container || !sameSelectionRange(window.getSelection(), selectAllRangeRef.current, container)) return;
      e.clipboardData?.setData('text/plain', visibleText(container));
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  // 文件树抽屉选中文档：收起抽屉、记住当前位置，再经 react-router 导航。
  const openDocFromTree = useCallback((href: string) => {
    setTreeOpen(false);
    rememberScroll(locationKey, window.scrollY);
    navigate(toRouterPath(href));
  }, [locationKey, navigate]);

  // ⋯ 菜单导航（搜索/设置）：离开阅读页前记住滚动，与互链/抽屉跳转同口径。
  const remember = useCallback(() => rememberScroll(locationKey, window.scrollY), [locationKey]);

  const reloadNotes = useCallback(async () => {
    const list = await getDocNotes(path).catch(() => null);
    if (list) setNotesDoc({ path, list });
  }, [path]);

  const saveNoteEditor = useCallback(async (body: string) => {
    if (!noteEditor) return;
    if (noteEditor.kind === 'create') {
      await addNote(path, noteEditor.anchor, body);
      showToast('笔记已保存');
    } else {
      const rec = await updateNote(path, noteEditor.note.id, body);
      if (!rec) {
        showToast('这条笔记已不存在', { kind: 'error' });
        setNoteEditor(null);
        await reloadNotes();
        return;
      }
      showToast('笔记已更新');
    }
    await reloadNotes();
    setNoteEditor(null);
  }, [noteEditor, path, reloadNotes]);

  const deleteNoteEditor = useCallback(async () => {
    if (!noteEditor || noteEditor.kind !== 'edit') return;
    await removeNotes(path, [noteEditor.note.id]);
    await reloadNotes();
    setNoteEditor(null);
    showToast('笔记已删除');
  }, [noteEditor, path, reloadNotes]);

  // 列表跳转：先关抽屉再打开编辑面板，尽量把锚点符号滚到视口中央（孤儿笔记无符号，直接编辑）。
  const openNoteFromList = useCallback((note: NoteRecord) => {
    setNotesOpen(false);
    setNoteEditor({ kind: 'edit', note });
    window.requestAnimationFrame(() => {
      const container = contentRef.current;
      if (!container) return;
      const mark = [...container.querySelectorAll<HTMLElement>('button.note-mark')]
        .find((btn) => btn.dataset.noteId === note.id);
      mark?.scrollIntoView({ block: 'center' });
    });
  }, []);

  const title = cur.kind === 'ready' ? cur.title : '';
  const ttsBarVisible = tts.state !== 'idle' && tts.state !== 'unsupported';

  return (
    <>
      <DocHeader
        title={title}
        onOpenTree={metas.length > 0 ? openTree : undefined}
        favorite={favorite === true}
        onToggleFavorite={favorite === null ? undefined : toggleFav}
        onOpenAppearance={() => setAppearanceOpen(true)}
        onOpenNotes={() => setNotesOpen(true)}
        noteCount={notes.length}
        onOpenTts={ready ? () => {
          if (!tts.supported) {
            showToast('当前浏览器不支持朗读', { kind: 'error' });
            return;
          }
          if (tts.state === 'playing' || tts.state === 'paused') tts.toggle();
          else if (tts.state === 'ended') tts.start(0);
          else tts.start();
        } : undefined}
        ttsActive={tts.state === 'playing' || tts.state === 'paused'}
        orientation={orientation}
        onToggleOrientation={toggleLandscape}
        onFlipOrientation={flip}
        remember={remember}
      />
      {ready && !tocOpen && (
        <FloatingTocButton onOpen={openToc} />
      )}
      {from && <BackToSource />}
      {ready ? (
        <div
          key="content"
          className="doc-content"
          ref={contentRef}
          style={appearanceStyle(appearance)}
          onClick={onContentClick}
          onContextMenu={onContentContextMenu}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div key="state" className="doc-content">
          {cur.kind === 'missing' ? (
            <div className="doc-state">
              <p>文档不存在或尚未同步</p>
              <p className="doc-state-path">{path}</p>
              <button type="button" className="doc-state-btn" onClick={() => navigate(toRouterPath(HOME))}>
                返回首页
              </button>
            </div>
          ) : cur.kind === 'download-failed' ? (
            <div className="doc-state">
              <p>该文档未缓存，需联网下载后阅读</p>
              <p className="doc-state-path">{path}</p>
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
      {ready && <RelatedDocs path={path} />}
      {ready && <PrevNext path={path} metas={metas} />}
      {ttsBarVisible && (
        <TtsBar
          state={tts.state}
          current={tts.current}
          total={tts.total}
          rate={tts.rate}
          remainingSeconds={tts.remainingSeconds}
          following={tts.following}
          sleepMinutes={tts.sleepMinutes}
          error={tts.error}
          onToggle={() => {
            if (tts.state === 'ended') tts.start(0);
            else tts.toggle();
          }}
          onPrev={tts.prev}
          onNext={tts.next}
          onOpen={() => setTtsOpen(true)}
          onClose={() => {
            tts.stop();
            setTtsOpen(false);
          }}
          onResumeFollow={tts.resumeFollow}
        />
      )}
      {ttsBarVisible && <div className="tts-bottom-space" aria-hidden="true" />}
      {ttsOpen && (
        <TtsSheet
          state={tts.state}
          prefs={tts.prefs}
          voiceOptions={tts.voiceOptions}
          hasAnyVoice={tts.voices.length > 0}
          selectedVoice={tts.selectedVoice}
          loadingVoices={tts.loadingVoices}
          sleepMinutes={tts.sleepMinutes}
          error={tts.error}
          onClose={() => setTtsOpen(false)}
          onSetRate={tts.setRate}
          onSetVoiceKey={tts.setVoiceKey}
          onSetPrefs={tts.setPrefs}
          onSetSleepMinutes={tts.setSleepMinutes}
          onRestart={() => tts.start(0)}
          onStop={() => {
            tts.stop();
            setTtsOpen(false);
          }}
          onRefreshVoices={tts.refreshVoices}
          onOpenToc={() => {
            tts.pause();
            setTtsOpen(false);
            openToc();
          }}
        />
      )}
      {tocOpen && <TocDrawer headings={tocHeadings} onClose={closeToc} />}
      {appearanceOpen && (
        <AppearanceSheet
          value={appearance}
          onChange={setAppearance}
          onClose={() => setAppearanceOpen(false)}
        />
      )}
      {treeOpen && (
        <TreeDrawer metas={metas} currentPath={path} onSelect={openDocFromTree} onClose={closeTree} />
      )}
      {notesOpen && (
        <NotesDrawer
          notes={notes}
          positions={notePositions && notePositions.path === path ? notePositions.positions : null}
          onSelect={openNoteFromList}
          onClose={() => setNotesOpen(false)}
        />
      )}
      {noteEditor && (
        <NoteEditor
          key={noteEditor.kind === 'edit' ? noteEditor.note.id : 'create'}
          mode={noteEditor.kind}
          anchor={noteEditor.kind === 'create' ? noteEditor.anchor.exact : noteEditor.note.exact}
          initialBody={noteEditor.kind === 'edit' ? noteEditor.note.body : ''}
          onSave={saveNoteEditor}
          onDelete={noteEditor.kind === 'edit' ? deleteNoteEditor : undefined}
          onClose={() => setNoteEditor(null)}
        />
      )}
      {menu && (
        <SelectionMenu
          x={menu.x} y={menu.y}
          rect={menu.rect}
          selectionSnapshot={menu.range}
          actions={menuActionsFor(menu.ctx)}
          onAction={onMenuAction}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
