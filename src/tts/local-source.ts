import type { SpeakOptions, SpeakResult, SpeechSource } from './types';

interface WorkerAudioMessage {
  type: 'audio';
  requestId: number;
  samples: Float32Array;
  sampleRate: number;
  synthMs: number;
  audioMs: number;
}

interface WorkerReadyMessage {
  type: 'ready';
  sampleRate: number;
  numSpeakers: number;
  loadMs: number;
}

interface WorkerErrorMessage {
  type: 'error';
  requestId?: number;
  message: string;
  phase?: string;
}

type WorkerMessage = WorkerAudioMessage | WorkerReadyMessage | WorkerErrorMessage;

interface SynthResult {
  samples: Float32Array;
  sampleRate: number;
  synthMs: number;
  audioMs: number;
}

const WORKER_URL = `${import.meta.env.BASE_URL}tts/tts-worker.js`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 本地 Matcha 引擎：Worker 里跑 sherpa-onnx WASM，主线程用 Web Audio 播放。
 * `pause()` 用 AudioContext.suspend()，句内位置由音频时钟保留。
 */
export class LocalSource implements SpeechSource {
  readonly kind = 'local' as const;
  readonly supportsMidSentencePause = true;

  private worker: Worker | null = null;
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private rate = 1;
  private gen = 0;
  private requestSeq = 0;
  private playing = false;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private pending = new Map<number, (result: SpeakResult | SynthResult) => void>();
  private cache = new Map<string, SynthResult>();
  private prefetchKeys = new Map<number, string>();

  init(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise<void>((resolve, reject) => {
      try {
        if (typeof AudioContext === 'undefined') throw new Error('当前浏览器不支持 Web Audio');
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      } catch (err) {
        this.initPromise = null;
        reject(err);
        return;
      }
      const worker = new Worker(WORKER_URL);
      this.worker = worker;
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        this.initPromise = null;
        reject(new Error(message));
      };
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'ready') {
          this.ready = true;
          settled = true;
          resolve();
          return;
        }
        if (data.type === 'error') {
          if (data.requestId != null) {
            const pending = this.pending.get(data.requestId);
            if (pending) {
              this.pending.delete(data.requestId);
              this.prefetchKeys.delete(data.requestId);
              pending({ ok: false, error: data.message });
            }
          } else {
            fail(data.message);
          }
          return;
        }
        if (data.type === 'audio') {
          const pending = this.pending.get(data.requestId);
          if (!pending) return;
          this.pending.delete(data.requestId);
          const result: SynthResult = {
            samples: data.samples,
            sampleRate: data.sampleRate,
            synthMs: data.synthMs,
            audioMs: data.audioMs,
          };
          const prefetchKey = this.prefetchKeys.get(data.requestId);
          if (prefetchKey) {
            this.prefetchKeys.delete(data.requestId);
            this.cache.set(prefetchKey, result);
            return;
          }
          pending(result);
        }
      };
      worker.onerror = (event) => fail(event.message || '本地语音 worker 加载失败');
      worker.postMessage({ type: 'init' });
    });
    return this.initPromise;
  }

  private synth(text: string, rate: number): Promise<SynthResult | SpeakResult> {
    const key = `${rate}|${text}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    if (!this.worker) return Promise.resolve({ ok: false, error: 'local-not-ready' });
    const requestId = ++this.requestSeq;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      this.worker?.postMessage({ type: 'synth', requestId, text, rate });
    });
  }

  prefetch(text: string, options: SpeakOptions): void {
    if (!this.ready || !this.worker) return;
    const key = `${options.rate}|${text}`;
    if (this.cache.has(key)) return;
    const requestId = ++this.requestSeq;
    this.prefetchKeys.set(requestId, key);
    this.pending.set(requestId, () => {});
    this.worker.postMessage({ type: 'synth', requestId, text, rate: options.rate });
  }

  async speak(text: string, options: SpeakOptions): Promise<SpeakResult> {
    if (!this.ready) {
      try {
        await this.init();
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    }
    const gen = this.gen;
    const rate = options.rate || this.rate;
    const result = await this.synth(text, rate);
    if (gen !== this.gen) return { ok: false, error: 'canceled' };
    if ('ok' in result) return result;
    if (!this.ctx) return { ok: false, error: 'local-not-ready' };
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = ctx.createBuffer(1, result.samples.length, result.sampleRate);
    buffer.getChannelData(0).set(result.samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.source = source;
    return new Promise<SpeakResult>((resolve) => {
      let settled = false;
      const done = (value: SpeakResult) => {
        if (settled) return;
        settled = true;
        if (this.source === source) this.source = null;
        this.playing = false;
        resolve(value);
      };
      source.onended = () => done({ ok: true });
      options.onStart?.();
      this.playing = true;
      try {
        source.start();
      } catch (err) {
        done({ ok: false, error: errorMessage(err) });
      }
    });
  }

  pause(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  stop(): void {
    this.gen++;
    const source = this.source;
    this.source = null;
    this.playing = false;
    if (source) {
      try {
        source.stop();
      } catch {
        // 已停止
      }
    }
    for (const [, resolve] of this.pending) resolve({ ok: false, error: 'canceled' });
    this.pending.clear();
    this.prefetchKeys.clear();
    this.cache.clear();
    void this.ctx?.resume();
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  get speaking(): boolean {
    return this.playing;
  }

  dispose(): void {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
