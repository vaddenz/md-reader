import { getBlob, kvGet, putBlob, type TreeEntry } from '../data/db';

export interface ImageDeps {
  /** 按仓库路径鉴权拉取图片字节（T13 用 GitHubClient.getBlobBytes + 仓库配置实现）。 */
  fetchBlob(path: string): Promise<Blob>;
}

/**
 * 为容器内每个 `img.md-img[data-repo-src]` 挂上图片管线：
 * 进入视口 400px 内 → 由 `kv.tree` 查 sha → 本地 blob 缓存命中则直接用，
 * 否则 `deps.fetchBlob` 拉取并写回缓存 → `URL.createObjectURL` 赋给 src。
 * 返回清理函数：revoke 全部 ObjectURL 并断开观察。
 */
export function hydrateImages(container: HTMLElement, deps: ImageDeps): () => void {
  const urls: string[] = [];
  const started = new WeakSet<HTMLImageElement>();
  let disposed = false;
  let observer: IntersectionObserver | null = null;

  // 目录树一次读取、全部图片共享；读取失败按“找不到 sha”处理（跳过，保留 alt）。
  let treePromise: Promise<Map<string, string> | null> | null = null;
  const shaFor = (path: string): Promise<string | undefined> => {
    treePromise ??= kvGet<{ entries: TreeEntry[] }>('tree').then(
      (tree) => (tree ? new Map(tree.entries.map((e) => [e.path, e.sha])) : null),
      () => null,
    );
    return treePromise.then((map) => map?.get(path));
  };

  const load = async (img: HTMLImageElement): Promise<void> => {
    const path = img.getAttribute('data-repo-src');
    if (!path) return;
    const sha = await shaFor(path);
    if (!sha) return; // 目录树中无此文件：跳过，保留 alt 文本
    try {
      let blob = (await getBlob(sha))?.blob;
      if (!blob) {
        blob = await deps.fetchBlob(path);
        await putBlob(sha, blob);
      }
      if (disposed) return; // 拉取途中已被清理：不再创建会泄漏的 ObjectURL
      const url = URL.createObjectURL(blob);
      urls.push(url);
      img.src = url;
      img.removeAttribute('data-repo-src');
    } catch {
      if (!disposed) img.classList.add('md-img-error'); // 失败非致命：alt 仍然可见
    }
  };

  const start = (img: HTMLImageElement): void => {
    if (started.has(img)) return;
    started.add(img);
    void load(img);
  };

  const images = [...container.querySelectorAll<HTMLImageElement>('img.md-img[data-repo-src]')];

  if (typeof IntersectionObserver === 'undefined') {
    // jsdom 等无 IO 环境：立即处理全部图片
    for (const img of images) start(img);
  } else {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          start(entry.target as HTMLImageElement);
        }
      },
      { rootMargin: '400px' },
    );
    for (const img of images) observer.observe(img);
  }

  return () => {
    disposed = true;
    observer?.disconnect();
    observer = null;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.length = 0;
  };
}
