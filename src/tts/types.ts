/** 朗读功能的数据类型与默认偏好。 */

export type TtsEngine = 'system' | 'local';

export interface TtsPrefs {
  /** 播放引擎：系统 TTS 或本地离线语音包。 */
  engine: TtsEngine;
  /** 语速 0.75–2.0。 */
  rate: number;
  /** 选中的语音 `${lang}|${name}`；null = 系统默认。 */
  voiceKey: string | null;
  /** 跳过代码块（默认 true）。 */
  skipCode: boolean;
  /** 朗读表格（默认 false）。 */
  readTable: boolean;
  /** 播放时保持屏幕常亮（默认 true）。 */
  keepAwake: boolean;
  /** 只列本地语音（默认 true）。 */
  localOnly: boolean;
}

export const DEFAULT_TTS_PREFS: TtsPrefs = {
  engine: 'system',
  rate: 1,
  voiceKey: null,
  skipCode: true,
  readTable: false,
  keepAwake: true,
  localOnly: true,
};

export interface TtsPosition {
  /** chunk 索引。 */
  index: number;
  /** 句内字符偏移；系统 TTS 恒为 0。 */
  char: number;
  updatedAt: number;
}

export type ChunkKind = 'text' | 'heading' | 'list' | 'quote' | 'table';

export interface Chunk {
  /** 送进 TTS 的清洗后文本。 */
  text: string;
  /** 原始文本（用于调试/统计，不送 TTS）。 */
  raw: string;
  lang: string;
  block: HTMLElement;
  ranges: Range[];
  kind: ChunkKind;
}

export type PlayerState =
  | 'idle'
  | 'preparing'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'blocked'
  | 'no-voice'
  | 'unsupported'
  | 'error';

export interface PlayerSnapshot {
  state: PlayerState;
  index: number;
  total: number;
  error?: string;
}

export interface SpeakResult {
  ok: boolean;
  error?: string;
}

export interface SpeakOptions {
  rate: number;
  /** 系统语音用；null = 系统默认。 */
  voice?: SpeechSynthesisVoice | null;
  /** 本地引擎的说话人 id；Matcha 恒为 0。 */
  sid?: number;
  /** 这一句真正开始播放时触发。 */
  onStart?: () => void;
}

/** Player 依赖的引擎接口：系统 TTS 与本地 WASM 各实现一份。 */
export interface SpeechSource {
  readonly kind: TtsEngine;
  /** true 表示 pause()/resume() 能保留句内位置（本地 AudioContext）。 */
  readonly supportsMidSentencePause: boolean;
  /** 可选：引擎预热（本地 WASM/worker 初始化）。 */
  init?(): Promise<void>;
  /** 播放一句；resolve 表示这句播完或被 stop 取消。 */
  speak(text: string, options: SpeakOptions): Promise<SpeakResult>;
  /** 预取下一句（本地引擎用；系统引擎可选实现）。 */
  prefetch?(text: string, options: SpeakOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
  setVoice?(voice: SpeechSynthesisVoice | null): void;
  readonly speaking: boolean;
  /** 释放底层资源（worker、AudioContext）。 */
  dispose?(): void;
}
