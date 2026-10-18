// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { clearAllData, getBlob, kvSet, putBlob, type TreeEntry } from '../../src/data/db';
import { hydrateImages } from '../../src/markdown/images';

const blob = (s = 'x') => new Blob([s], { type: 'image/png' });

function seedTree(entries: Array<Pick<TreeEntry, 'path' | 'sha'>>) {
  return kvSet('tree', { entries: entries.map((e) => ({ ...e, size: 1, type: 'blob' as const })) });
}

function container(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

/** 等待已 resolve 的拉取走完 putBlob 等异步事务。 */
const flush = () => new Promise((r) => setTimeout(r, 20));

let n = 0;
let createObjectURL: Mock<(b: Blob) => string>;
let revokeObjectURL: Mock<(u: string) => void>;

beforeEach(async () => {
  await clearAllData();
  n = 0;
  createObjectURL = vi.fn((_b: Blob) => `blob:fake-${++n}`);
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  targets: Element[] = [];
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.targets.push(el); }
  unobserve(el: Element) { this.targets = this.targets.filter((t) => t !== el); }
  disconnect() { this.disconnected = true; this.targets = []; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  root = null;
  rootMargin = '';
  thresholds: number[] = [];
  trigger(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

describe('hydrateImages', () => {
  it('为 data-repo-src 图片设置 src 并移除属性，清理时 revoke', async () => {
    await seedTree([{ path: 'a/b.png', sha: 'sha1' }]);
    const el = container('<img class="md-img" data-repo-src="a/b.png" alt="x">');
    const fetchBlob = vi.fn(async () => blob());
    const cleanup = hydrateImages(el, { fetchBlob });
    await vi.waitFor(() => expect(el.querySelector('img')!.src).toContain('blob:fake'));
    expect(fetchBlob).toHaveBeenCalledWith('a/b.png');
    expect(el.querySelector('img')!.hasAttribute('data-repo-src')).toBe(false);
    expect(await getBlob('sha1')).toBeDefined(); // 拉取结果写回缓存
    cleanup();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('命中本地 blob 缓存时不发起网络请求', async () => {
    await seedTree([{ path: 'a/b.png', sha: 'sha1' }]);
    // 用 Node Blob：jsdom 的 Blob 不是 Node 的 structuredClone 可识别的类型，
    // fake-indexeddb 存取后会退化成空对象，无法断言缓存内容。
    const cached = new NodeBlob(['cached'], { type: 'image/png' });
    await putBlob('sha1', cached as unknown as Blob);
    const el = container('<img class="md-img" data-repo-src="a/b.png" alt="x">');
    const fetchBlob = vi.fn(async () => blob());
    const cleanup = hydrateImages(el, { fetchBlob });
    await vi.waitFor(() => expect(el.querySelector('img')!.src).toContain('blob:fake'));
    expect(fetchBlob).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const used = createObjectURL.mock.calls[0][0];
    expect(used.size).toBe(cached.size);
    expect(used.type).toBe('image/png');
    cleanup();
  });

  it('目录树中找不到 sha 时跳过该图片，保留 alt 且不标错', async () => {
    await seedTree([{ path: 'other.png', sha: 'sha9' }]);
    const el = container(
      '<img class="md-img" data-repo-src="a/b.png" alt="x"><img class="md-img" data-repo-src="other.png" alt="o">',
    );
    const fetchBlob = vi.fn(async () => blob());
    const cleanup = hydrateImages(el, { fetchBlob });
    const [img, other] = [...el.querySelectorAll('img')];
    // other.png 有 sha：等它完成，即证明同一批 sha 查询已落定
    await vi.waitFor(() => expect(other.src).toContain('blob:fake'));
    expect(fetchBlob).not.toHaveBeenCalledWith('a/b.png');
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.getAttribute('data-repo-src')).toBe('a/b.png');
    expect(img.alt).toBe('x');
    expect(img.classList.contains('md-img-error')).toBe(false);
    cleanup();
  });

  it('拉取失败时保留 alt 并标记 md-img-error', async () => {
    await seedTree([{ path: 'a/b.png', sha: 'sha1' }]);
    const el = container('<img class="md-img" data-repo-src="a/b.png" alt="x">');
    const fetchBlob = vi.fn(async () => { throw new Error('network'); });
    const cleanup = hydrateImages(el, { fetchBlob });
    await vi.waitFor(() => expect(el.querySelector('img')!.classList.contains('md-img-error')).toBe(true));
    const img = el.querySelector('img')!;
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.alt).toBe('x');
    cleanup();
  });

  it('外链图片（无 data-repo-src）不被处理', async () => {
    const el = container('<img class="md-img" src="https://o/x.png" alt="x">');
    const fetchBlob = vi.fn(async () => blob());
    const cleanup = hydrateImages(el, { fetchBlob });
    expect(fetchBlob).not.toHaveBeenCalled();
    expect(el.querySelector('img')!.getAttribute('src')).toBe('https://o/x.png');
    cleanup();
  });

  it('清理时 revoke 全部创建的 ObjectURL', async () => {
    await seedTree([{ path: 'a.png', sha: 's1' }, { path: 'b.png', sha: 's2' }]);
    const el = container('<img class="md-img" data-repo-src="a.png" alt="a"><img class="md-img" data-repo-src="b.png" alt="b">');
    const fetchBlob = vi.fn(async () => blob());
    const cleanup = hydrateImages(el, { fetchBlob });
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    cleanup();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-2');
  });

  it('清理发生在拉取途中时不创建泄漏的 ObjectURL', async () => {
    await seedTree([{ path: 'a.png', sha: 's1' }]);
    let resolveFetch!: (b: Blob) => void;
    const fetchBlob = vi.fn(() => new Promise<Blob>((r) => { resolveFetch = r; }));
    const el = container('<img class="md-img" data-repo-src="a.png" alt="a">');
    const cleanup = hydrateImages(el, { fetchBlob });
    await vi.waitFor(() => expect(fetchBlob).toHaveBeenCalled());
    cleanup();
    resolveFetch(blob());
    await flush();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(el.querySelector('img')!.hasAttribute('src')).toBe(false);
  });

  it('有 IntersectionObserver 时仅加载进入 400px 视口的图片，清理时断开', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    FakeIntersectionObserver.instances = [];
    await seedTree([{ path: 'a.png', sha: 's1' }, { path: 'b.png', sha: 's2' }]);
    const el = container('<img class="md-img" data-repo-src="a.png" alt="a"><img class="md-img" data-repo-src="b.png" alt="b">');
    const fetchBlob = vi.fn(async () => blob());
    const cleanup = hydrateImages(el, { fetchBlob });

    const io = FakeIntersectionObserver.instances[0];
    expect(io.options).toEqual({ rootMargin: '400px' });
    expect(io.targets).toHaveLength(2);
    const [imgA, imgB] = [...el.querySelectorAll('img')];

    io.trigger([{ target: imgA, isIntersecting: true }]);
    await vi.waitFor(() => expect(imgA.src).toContain('blob:fake'));
    expect(fetchBlob).toHaveBeenCalledTimes(1);
    expect(io.targets).toEqual([imgB]);
    expect(imgB.hasAttribute('src')).toBe(false);

    io.trigger([{ target: imgB, isIntersecting: true }]);
    await vi.waitFor(() => expect(imgB.src).toContain('blob:fake'));
    expect(fetchBlob).toHaveBeenCalledTimes(2);

    cleanup();
    expect(io.disconnected).toBe(true);
  });
});
