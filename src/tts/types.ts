/** 朗读功能的数据类型与默认偏好。 */

export interface TtsPrefs {
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
