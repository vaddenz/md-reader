import { SystemSource } from './system-source';
import type { Chunk, PlayerSnapshot, PlayerState } from './types';

export interface PlayerOptions {
  source?: SystemSource;
  onChange?: (snapshot: PlayerSnapshot) => void;
  onCurrent?: (index: number, chunk: Chunk) => void;
  onPosition?: (nextIndex: number) => void;
}

/**
 * 顺序播放器：一次一句，`await speak()` 后再下一句。
 * 顺序播放让「锁屏读完当前句再停」天然成立，也避免预排队列在后台继续读。
 */
export class TtsPlayer {
  private readonly source: SystemSource;
  private readonly onChange: (snapshot: PlayerSnapshot) => void;
  private readonly onCurrent: (index: number, chunk: Chunk) => void;
  private readonly onPosition: (nextIndex: number) => void;

  private chunks: Chunk[] = [];
  private gen = 0;
  private state: PlayerState = 'idle';
  private index = 0;
  private rate = 1;
  private voice: SpeechSynthesisVoice | null = null;
  private error = '';

  private pauseAfterCurrent = false;
  private pausedByVisibility = false;
  private pausedIndex = 0;
  private nativePauseFailed = false;
  private stopAfterCurrent = false;
  private consecutiveErrors = 0;

  constructor(opts: PlayerOptions = {}) {
    this.source = opts.source ?? new SystemSource(window.speechSynthesis);
    this.onChange = opts.onChange ?? (() => {});
    this.onCurrent = opts.onCurrent ?? (() => {});
    this.onPosition = opts.onPosition ?? (() => {});
  }

  get snapshot(): PlayerSnapshot {
    return { state: this.state, index: this.index, total: this.chunks.length, ...(this.error ? { error: this.error } : {}) };
  }

  get currentIndex(): number {
    return this.index;
  }

  get total(): number {
    return this.chunks.length;
  }

  setChunks(chunks: Chunk[]): void {
    this.stop();
    this.chunks = chunks;
    this.index = 0;
    this.emit();
  }

  setRate(rate: number): void {
    if (rate === this.rate) return;
    this.rate = rate;
    if (this.state === 'playing') this.playFrom(this.index);
    else if (this.state === 'paused') this.nativePauseFailed = true;
  }

  setVoice(voice: SpeechSynthesisVoice | null): void {
    this.voice = voice;
    if (this.state === 'playing') this.playFrom(this.index);
    else if (this.state === 'paused') this.nativePauseFailed = true;
  }

  playFrom(index: number): void {
    if (this.chunks.length === 0) {
      this.chunks = [];
      this.state = 'ended';
      this.emit();
      return;
    }
    const target = Math.max(0, Math.min(this.chunks.length - 1, Math.floor(index)));
    this.cancelPlayback();
    this.index = target;
    this.pausedIndex = target;
    this.pauseAfterCurrent = false;
    this.pausedByVisibility = false;
    this.nativePauseFailed = false;
    this.stopAfterCurrent = false;
    this.consecutiveErrors = 0;
    this.error = '';
    this.state = 'playing';
    this.emit();
    void this.run(target, this.gen);
  }

  pause(): void {
    this.pauseInternal(false);
  }

  /** 页面隐藏：让当前句播完再暂停。 */
  requestPauseAfterCurrent(): void {
    if (this.state !== 'playing') return;
    this.pauseAfterCurrent = true;
    this.pausedByVisibility = true;
    if (!this.source.speaking) this.pauseInternal(true);
  }

  /** 页面重新可见：只有「因可见性暂停」才自动继续。 */
  handleVisible(): void {
    if (!this.pausedByVisibility) return;
    if (this.state === 'paused') {
      this.pausedByVisibility = false;
      this.resume();
    } else if (this.state === 'playing') {
      // 当前句还没播完就亮屏：取消「读完再停」，并防御性地 resume 一次
      this.pauseAfterCurrent = false;
      this.pausedByVisibility = false;
      this.source.resume();
    }
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.pausedByVisibility = false;
    if (!this.nativePauseFailed && this.source.speaking) {
      this.source.resume();
      this.state = 'playing';
      this.emit();
      return;
    }
    // 平台把 pause 当停止，或当前句已结束：从当前句重播。
    this.playFrom(this.pausedIndex);
  }

  stop(): void {
    this.cancelPlayback();
    this.state = 'idle';
    this.error = '';
    this.pauseAfterCurrent = false;
    this.pausedByVisibility = false;
    this.stopAfterCurrent = false;
    this.emit();
  }

  next(): void {
    if (this.chunks.length === 0) return;
    this.playFrom(Math.min(this.chunks.length - 1, this.index + 1));
  }

  prev(): void {
    if (this.chunks.length === 0) return;
    this.playFrom(Math.max(0, this.index - 1));
  }

  /** 睡眠定时：当前句结束后停止。 */
  setStopAfterCurrent(stop: boolean): void {
    this.stopAfterCurrent = stop;
  }

  private pauseInternal(preserveVisibility: boolean): void {
    if (this.state !== 'playing') return;
    this.pausedIndex = this.index;
    if (!preserveVisibility) this.pausedByVisibility = false;
    this.nativePauseFailed = false;
    this.source.pause();
    this.state = 'paused';
    this.emit();
    window.setTimeout(() => {
      if (this.state !== 'paused') return;
      // Edge 实测 pause 有效但 paused 属性为 false；用 speaking 判断是否被当成停止。
      if (!this.source.speaking) this.nativePauseFailed = true;
    }, 150);
  }

  private async run(from: number, gen: number): Promise<void> {
    for (let i = from; i < this.chunks.length; i++) {
      if (gen !== this.gen || this.state !== 'playing') return;
      this.index = i;
      this.emit();
      this.onCurrent(i, this.chunks[i]);

      const result = await this.source.speak(this.chunks[i].text, {
        rate: this.rate,
        voice: this.voice,
        onStart: () => {
          if (gen === this.gen) {
            this.index = i;
            this.emit();
          }
        },
      });

      if (gen !== this.gen) return;

      if (!result.ok) {
        if (result.error === 'canceled') return;
        if (result.error === 'not-allowed') {
          this.fail('blocked', '浏览器拦截了朗读，请点按继续');
          return;
        }
        if (result.error === 'language-unavailable') {
          this.fail('no-voice', '系统没有可用的中文语音');
          return;
        }
        if (result.error === 'start-timeout') {
          this.fail('error', '朗读没有开始，请重试');
          return;
        }
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= 3) {
          this.fail('error', `朗读失败：${result.error ?? '未知错误'}`);
          return;
        }
        continue;
      }
      this.consecutiveErrors = 0;

      // 暂停在 speak 期间发生：不要推进；若平台把 pause 当停止，resume 会重播本句。
      const stateAfterSpeak = this.state as PlayerState;
      if (stateAfterSpeak !== 'playing') {
        if (stateAfterSpeak === 'paused') this.pausedIndex = i;
        return;
      }

      if (this.stopAfterCurrent) {
        this.stopAfterCurrent = false;
        this.source.stop();
        this.state = 'ended';
        this.emit();
        return;
      }

      if (this.pauseAfterCurrent) {
        this.pauseAfterCurrent = false;
        this.pausedIndex = Math.min(i + 1, this.chunks.length - 1);
        this.source.stop();
        this.state = 'paused';
        this.emit();
        return;
      }

      this.onPosition(Math.min(i + 1, this.chunks.length - 1));
    }

    if (gen === this.gen) {
      this.state = 'ended';
      this.emit();
    }
  }

  private cancelPlayback(): void {
    this.gen++;
    this.source.stop();
  }

  private fail(state: PlayerState, error: string): void {
    this.gen++;
    this.source.stop();
    this.error = error;
    this.state = state;
    this.emit();
  }

  private emit(): void {
    this.onChange(this.snapshot);
  }
}
