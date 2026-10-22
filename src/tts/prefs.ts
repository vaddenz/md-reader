import { kvGet, kvSet } from '../data/db';
import { clampRate } from './system-source';
import { DEFAULT_TTS_PREFS, type TtsPosition, type TtsPrefs } from './types';

const PREFS_KEY = 'tts.prefs';
const posKey = (path: string) => `tts.pos.${path}`;

export function sanitizeTtsPrefs(raw: unknown): TtsPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_TTS_PREFS };
  const v = raw as Partial<TtsPrefs>;
  return {
    engine: v.engine === 'local' ? 'local' : 'system',
    rate: typeof v.rate === 'number' && Number.isFinite(v.rate) ? clampRate(v.rate) : DEFAULT_TTS_PREFS.rate,
    voiceKey: typeof v.voiceKey === 'string' && v.voiceKey ? v.voiceKey : null,
    skipCode: typeof v.skipCode === 'boolean' ? v.skipCode : DEFAULT_TTS_PREFS.skipCode,
    readTable: typeof v.readTable === 'boolean' ? v.readTable : DEFAULT_TTS_PREFS.readTable,
    keepAwake: typeof v.keepAwake === 'boolean' ? v.keepAwake : DEFAULT_TTS_PREFS.keepAwake,
    localOnly: typeof v.localOnly === 'boolean' ? v.localOnly : DEFAULT_TTS_PREFS.localOnly,
  };
}

export async function loadTtsPrefs(): Promise<TtsPrefs> {
  try {
    return sanitizeTtsPrefs(await kvGet<unknown>(PREFS_KEY));
  } catch {
    return { ...DEFAULT_TTS_PREFS };
  }
}

export async function saveTtsPrefs(prefs: TtsPrefs): Promise<void> {
  await kvSet(PREFS_KEY, prefs);
}

export async function loadTtsPosition(path: string): Promise<TtsPosition | null> {
  try {
    const raw = await kvGet<unknown>(posKey(path));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const v = raw as Partial<TtsPosition>;
    if (typeof v.index !== 'number' || !Number.isInteger(v.index) || v.index < 0) return null;
    return {
      index: v.index,
      char: typeof v.char === 'number' && Number.isFinite(v.char) ? v.char : 0,
      updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveTtsPosition(path: string, index: number): Promise<void> {
  if (!path) return;
  await kvSet(posKey(path), { index: Math.max(0, Math.floor(index)), char: 0, updatedAt: Date.now() } satisfies TtsPosition);
}
