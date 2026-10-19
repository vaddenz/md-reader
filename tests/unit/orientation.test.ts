// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_TARGET, applyOrientation, sanitizeOrientation } from '../../src/lib/orientation';

describe('sanitizeOrientation', () => {
  it('合法值保留，非法回退默认 portrait', () => {
    expect(sanitizeOrientation('landscape')).toBe('landscape');
    expect(sanitizeOrientation('landscape-flipped')).toBe('landscape-flipped');
    expect(sanitizeOrientation('portrait')).toBe('portrait');
    expect(sanitizeOrientation('diagonal')).toBe('portrait');
    expect(sanitizeOrientation(null)).toBe('portrait');
  });
});
describe('LOCK_TARGET', () => {
  it('三态映射到系统锁定值', () => {
    expect(LOCK_TARGET).toEqual({
      portrait: 'portrait', landscape: 'landscape-primary', 'landscape-flipped': 'landscape-secondary',
    });
  });
});

/* ---------------------------------------------------------------------------
 * applyOrientation：全屏降级（平台事实：lock 需要全屏上下文）。
 * jsdom 不实现 fullscreen / screen.orientation，用例内自建 stub 并在 afterEach 还原。
 * ------------------------------------------------------------------------- */

interface OrientationStubs {
  /** 按调用顺序记录 lock:<target> / requestFullscreen / exitFullscreen。 */
  events: string[];
  lockCalls: string[];
  fsEl: Element | null;
  restore(): void;
}

let stubs: OrientationStubs | null = null;

function stubOrientation(opts: {
  lock: (target: string) => Promise<void>;
  /** 初始是否处于全屏（模拟已进入全屏的状态）。 */
  fullscreen?: boolean;
  requestFullscreen?: () => Promise<void>;
}): OrientationStubs {
  const events: string[] = [];
  const lockCalls: string[] = [];
  const s: OrientationStubs = { events, lockCalls, fsEl: opts.fullscreen ? document.documentElement : null, restore: () => {} };

  const screenDesc = Object.getOwnPropertyDescriptor(screen, 'orientation');
  Object.defineProperty(screen, 'orientation', {
    configurable: true,
    value: {
      lock: (t: string) => { events.push(`lock:${t}`); lockCalls.push(t); return opts.lock(t); },
      unlock: () => Promise.resolve(),
    },
  });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => s.fsEl });
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: () => {
      events.push('requestFullscreen');
      if (opts.requestFullscreen) return opts.requestFullscreen();
      s.fsEl = document.documentElement;
      return Promise.resolve();
    },
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: () => {
      events.push('exitFullscreen');
      s.fsEl = null;
      return Promise.resolve();
    },
  });

  s.restore = () => {
    if (screenDesc) Object.defineProperty(screen, 'orientation', screenDesc);
    else delete (screen as { orientation?: unknown }).orientation;
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  };
  stubs = s;
  return s;
}

afterEach(() => {
  stubs?.restore();
  stubs = null;
});

describe('applyOrientation（全屏降级）', () => {
  it('lock 直接成功：返回 true，不请求全屏', async () => {
    const s = stubOrientation({ lock: () => Promise.resolve() });
    await expect(applyOrientation('landscape')).resolves.toBe(true);
    expect(s.events).toEqual(['lock:landscape-primary']);
    expect(s.fsEl).toBeNull();
  });

  it('lock 被拒且未全屏：先请求全屏再重试成功（顺序 lock → requestFullscreen → lock）', async () => {
    let n = 0;
    const s = stubOrientation({ lock: () => (++n === 1 ? Promise.reject(new Error('requires fullscreen')) : Promise.resolve()) });
    await expect(applyOrientation('landscape')).resolves.toBe(true);
    expect(s.events).toEqual(['lock:landscape-primary', 'requestFullscreen', 'lock:landscape-primary']);
  });

  it('lock 被拒且请求全屏也失败：返回 false', async () => {
    const s = stubOrientation({
      lock: () => Promise.reject(new Error('requires fullscreen')),
      requestFullscreen: () => Promise.reject(new Error('fullscreen denied')),
    });
    await expect(applyOrientation('landscape')).resolves.toBe(false);
    expect(s.events).toEqual(['lock:landscape-primary', 'requestFullscreen']);
  });

  it('已在全屏且 lock 仍被拒：不再请求全屏，返回 false', async () => {
    const s = stubOrientation({ lock: () => Promise.reject(new Error('denied')), fullscreen: true });
    await expect(applyOrientation('landscape-flipped')).resolves.toBe(false);
    expect(s.events).toEqual(['lock:landscape-secondary']);
  });

  it('portrait 且在全屏：先退出全屏再尽力锁定；锁失败返回 false 且不请求全屏', async () => {
    const s = stubOrientation({ lock: () => Promise.reject(new Error('denied')), fullscreen: true });
    await expect(applyOrientation('portrait')).resolves.toBe(false);
    expect(s.events).toEqual(['exitFullscreen', 'lock:portrait']);
  });

  it('portrait 且在全屏：退出全屏后锁定成功返回 true', async () => {
    const s = stubOrientation({ lock: () => Promise.resolve(), fullscreen: true });
    await expect(applyOrientation('portrait')).resolves.toBe(true);
    expect(s.events).toEqual(['exitFullscreen', 'lock:portrait']);
  });

  it('缺少 screen.orientation：返回 false 且不抛错', async () => {
    delete (screen as { orientation?: unknown }).orientation;
    await expect(applyOrientation('landscape')).resolves.toBe(false);
  });
});
