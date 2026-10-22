import type { SpeakOptions, SpeakResult, SpeechSource } from './types';

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.75, rate));
}

/** 对 `window.speechSynthesis` 的薄封装：一次一句、可取消、保留 utterance 引用。 */
export class SystemSource implements SpeechSource {
  readonly kind = 'system' as const;
  readonly supportsMidSentencePause = false;
  private readonly synth: SpeechSynthesis;
  private readonly pending = new Map<SpeechSynthesisUtterance, (r: SpeakResult) => void>();

  constructor(synth: SpeechSynthesis) {
    this.synth = synth;
  }

  speak(text: string, opts: SpeakOptions): Promise<SpeakResult> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = clampRate(opts.rate);
      u.volume = 1;
      u.pitch = 1;
      if (opts.voice) {
        u.voice = opts.voice;
        u.lang = opts.voice.lang;
      } else {
        // Edge Android 可能返回空语音列表，但默认语音仍能读；显式给中文提示。
        u.lang = 'zh-CN';
      }

      let settled = false;
      let started = false;
      let startTimer = 0;
      const done = (result: SpeakResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startTimer);
        this.pending.delete(u);
        resolve(result);
      };

      u.onstart = () => {
        started = true;
        window.clearTimeout(startTimer);
        opts.onStart?.();
      };
      u.onend = () => done({ ok: true });
      u.onerror = (e) => {
        const reason = e.error;
        if (reason === 'canceled' || reason === 'interrupted') done({ ok: false, error: 'canceled' });
        else done({ ok: false, error: reason });
      };

      // 启动兜底：某些实现 speak() 后不触发任何事件；避免 async 循环永久悬挂。
      startTimer = window.setTimeout(() => {
        if (started || settled) return;
        this.synth.cancel();
        done({ ok: false, error: 'start-timeout' });
      }, 3000);

      // 持有引用，避免 Chrome 上 utterance 被 GC 后事件不触发。
      this.pending.set(u, done);
      try {
        this.synth.speak(u);
      } catch (e) {
        done({ ok: false, error: e instanceof Error ? e.message : 'synthesis-failed' });
      }
    });
  }

  pause(): void {
    this.synth.pause();
  }

  resume(): void {
    this.synth.resume();
  }

  get speaking(): boolean {
    return this.synth.speaking;
  }

  get paused(): boolean {
    return this.synth.paused;
  }

  setRate(_rate: number): void {
    // 语速在 speak() 时传入，这里不需要保存。
  }

  dispose(): void {
    this.stop();
  }

  /** 取消当前与队列；所有 pending Promise 以 canceled 结束，避免 async 循环悬挂。 */
  stop(): void {
    this.synth.cancel();
    const pending = [...this.pending.entries()];
    this.pending.clear();
    for (const [, done] of pending) done({ ok: false, error: 'canceled' });
  }
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
