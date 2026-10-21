import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { buildChunks, estimateSeconds } from './segment';
import { TtsPlayer } from './player';
import { clampRate, speechSupported } from './system-source';
import { loadTtsPosition, loadTtsPrefs, saveTtsPosition, saveTtsPrefs, sanitizeTtsPrefs } from './prefs';
import { listVoices, loadVoices, pickDefaultVoice, voiceKey } from './voices';
import {
  DEFAULT_TTS_PREFS,
  type Chunk,
  type PlayerSnapshot,
  type PlayerState,
  type TtsPrefs,
} from './types';

export interface UseTtsOptions {
  path: string;
  containerRef: RefObject<HTMLElement>;
  ready: boolean;
}

export interface UseTtsResult {
  supported: boolean;
  state: PlayerState;
  current: number;
  total: number;
  error: string;
  prefs: TtsPrefs;
  rate: number;
  voices: SpeechSynthesisVoice[];
  voiceOptions: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  loadingVoices: boolean;
  hasResume: boolean;
  following: boolean;
  sleepMinutes: number | 'off';
  remainingSeconds: number;
  start: (from?: number) => void;
  startFromSelection: (range: Range) => void;
  startFromViewport: () => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setRate: (rate: number) => void;
  setVoiceKey: (key: string | null) => void;
  setPrefs: (patch: Partial<TtsPrefs>) => void;
  setSleepMinutes: (minutes: number | 'off') => void;
  refreshVoices: () => void;
  resumeFollow: () => void;
}

let lastHighlightBlock: HTMLElement | null = null;

function applyHighlight(chunk: Chunk): void {
  const registry = (CSS as unknown as {
    highlights?: { set: (name: string, highlight: unknown) => void; delete: (name: string) => void };
  }).highlights;
  const HighlightCtor = (window as unknown as {
    Highlight?: new (...ranges: Range[]) => unknown;
  }).Highlight;

  try {
    if (registry && HighlightCtor && chunk.ranges.length > 0) {
      registry.set('tts-current', new HighlightCtor(...chunk.ranges));
      return;
    }
  } catch {
    // Range 因 DOM 变更失效时退回块级高亮
  }
  lastHighlightBlock?.classList.remove('tts-current-block');
  chunk.block.classList.add('tts-current-block');
  lastHighlightBlock = chunk.block;
}

function clearHighlightDom(): void {
  try {
    const registry = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights;
    registry?.delete('tts-current');
  } catch {
    // 忽略高亮清理失败
  }
  lastHighlightBlock?.classList.remove('tts-current-block');
  lastHighlightBlock = null;
}

function chunkRect(chunk: Chunk): DOMRect {
  return chunk.ranges[0]?.getBoundingClientRect() ?? chunk.block.getBoundingClientRect();
}

function scrollChunkIntoView(chunk: Chunk): void {
  const rect = chunkRect(chunk);
  if (rect.top >= 80 && rect.bottom <= window.innerHeight - 120) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  chunk.block.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}

function firstVisibleIndex(chunks: Chunk[]): number {
  const vh = window.innerHeight;
  for (let i = 0; i < chunks.length; i++) {
    const rect = chunkRect(chunks[i]);
    if (rect.bottom > 56 && rect.top < vh - 120) return i;
  }
  return 0;
}

function selectionIndex(chunks: Chunk[], range: Range): number {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const byRect = chunks.findIndex((c) =>
      c.ranges.some((r) => {
        const rr = r.getBoundingClientRect();
        return rr.bottom > rect.top && rr.top < rect.bottom && rr.right > rect.left && rr.left < rect.right;
      }),
    );
    if (byRect >= 0) return byRect;
  }
  const node = range.commonAncestorContainer;
  return chunks.findIndex((c) => c.block.contains(node));
}

function persist(path: string, index: number): void {
  void saveTtsPosition(path, index).catch(() => {});
}

/** 阅读页朗读控制器：系统 TTS + 句级高亮 + 自动跟随 + 断点。 */
export function useTts({ path, containerRef, ready }: UseTtsOptions): UseTtsResult {
  const supported = speechSupported();
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>(() => ({
    state: supported ? 'idle' : 'unsupported',
    index: 0,
    total: 0,
  }));
  const snapshotRef = useRef(snapshot);
  const handleSnapshot = useCallback((next: PlayerSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const [prefs, setPrefsState] = useState<TtsPrefs>(DEFAULT_TTS_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [hasResume, setHasResume] = useState(false);
  const [following, setFollowing] = useState(true);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const [sleepMinutes, setSleepMinutesState] = useState<number | 'off'>('off');

  const playerRef = useRef<TtsPlayer | null>(null);
  const chunksRef = useRef<Chunk[]>([]);
  const pathRef = useRef(path);
  const resumeRef = useRef<number | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const followRef = useRef(true);
  const followTimerRef = useRef(0);
  pathRef.current = path;

  // 播放器只创建一次；动态数据通过 ref 传入。
  useEffect(() => {
    if (!supported) return;
    const player = new TtsPlayer({
      onChange: handleSnapshot,
      onCurrent: (index, chunk) => {
        applyHighlight(chunk);
        if (followRef.current) scrollChunkIntoView(chunk);
        persist(pathRef.current, index);
        resumeRef.current = index;
        setHasResume(index > 0);
      },
      onPosition: (next) => {
        persist(pathRef.current, next);
        resumeRef.current = next;
        setHasResume(next > 0);
      },
    });
    playerRef.current = player;
    return () => {
      player.stop();
      playerRef.current = null;
      clearHighlightDom();
    };
  }, [supported, handleSnapshot]);

  // 偏好
  useEffect(() => {
    let cancelled = false;
    void loadTtsPrefs().then((p) => {
      if (cancelled) return;
      prefsRef.current = p;
      setPrefsState(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 语音列表
  const refreshVoices = useCallback(() => {
    if (!supported) return;
    setLoadingVoices(true);
    void loadVoices(window.speechSynthesis, 4000).then((list) => {
      setVoices(list);
      setLoadingVoices(false);
    });
  }, [supported]);

  useEffect(() => {
    refreshVoices();
  }, [refreshVoices]);

  // 语音包在页面打开后才安装/切换时，也能收到更新。
  useEffect(() => {
    if (!supported) return;
    const onChange = () => setVoices(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange);
  }, [supported]);

  const voiceOptions = useMemo(() => listVoices(voices, prefs.localOnly), [voices, prefs.localOnly]);
  const selectedVoice = useMemo(() => {
    const found = voiceOptions.find((v) => voiceKey(v) === prefs.voiceKey);
    return found ?? pickDefaultVoice(voiceOptions);
  }, [voiceOptions, prefs.voiceKey]);

  const remainingSeconds = useMemo(() => {
    const chunks = chunksRef.current;
    let total = 0;
    for (let i = snapshot.index; i < chunks.length; i++) total += estimateSeconds(chunks[i].text, prefs.rate);
    return total;
  }, [snapshot.index, snapshot.total, prefs.rate]);

  useEffect(() => {
    voiceRef.current = selectedVoice;
    playerRef.current?.setVoice(selectedVoice);
  }, [selectedVoice]);

  // 文档/就绪状态变化：停止旧朗读、重建索引、加载断点
  useEffect(() => {
    chunksRef.current = [];
    resumeRef.current = null;
    setHasResume(false);
    playerRef.current?.stop();
    clearHighlightDom();
    handleSnapshot({ state: supported ? 'idle' : 'unsupported', index: 0, total: 0 });
    if (!ready || !supported) return;
    let cancelled = false;
    void loadTtsPosition(path).then((pos) => {
      if (cancelled || !pos || pos.index <= 0) return;
      resumeRef.current = pos.index;
      setHasResume(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path, ready, supported, handleSnapshot]);

  // 跳过代码/表格开关变化：旧索引失效
  useEffect(() => {
    chunksRef.current = [];
    playerRef.current?.stop();
    clearHighlightDom();
  }, [prefs.skipCode, prefs.readTable]);

  // 隐藏时让当前句播完再暂停；回前台自动继续（仅可见性暂停）
  useEffect(() => {
    const onVisibility = () => {
      setVisible(document.visibilityState === 'visible');
      const player = playerRef.current;
      if (!player) return;
      if (document.visibilityState === 'hidden') player.requestPauseAfterCurrent();
      else player.handleVisible();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Wake Lock
  useEffect(() => {
    if (!prefs.keepAwake || snapshot.state !== 'playing' || !visible) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;
    void navigator.wakeLock
      .request('screen')
      .then((s) => {
        if (cancelled) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void sentinel?.release().catch(() => {});
    };
  }, [prefs.keepAwake, snapshot.state, visible]);

  // 用户手动滚动后暂停跟随 8 秒
  useEffect(() => {
    const pauseFollow = () => {
      followRef.current = false;
      setFollowing(false);
      window.clearTimeout(followTimerRef.current);
      followTimerRef.current = window.setTimeout(() => {
        followRef.current = true;
        setFollowing(true);
      }, 8000);
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) pauseFollow();
    };
    window.addEventListener('wheel', pauseFollow, { passive: true });
    window.addEventListener('touchmove', pauseFollow, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', pauseFollow);
      window.removeEventListener('touchmove', pauseFollow);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(followTimerRef.current);
    };
  }, []);

  const resumeFollow = useCallback(() => {
    followRef.current = true;
    setFollowing(true);
    window.clearTimeout(followTimerRef.current);
    const chunk = chunksRef.current[snapshotRef.current.index];
    if (chunk) scrollChunkIntoView(chunk);
  }, []);

  // 睡眠定时
  useEffect(() => {
    if (sleepMinutes === 'off') {
      playerRef.current?.setStopAfterCurrent(false);
      return;
    }
    const id = window.setTimeout(() => {
      playerRef.current?.setStopAfterCurrent(true);
      setSleepMinutesState('off');
    }, sleepMinutes * 60_000);
    return () => window.clearTimeout(id);
  }, [sleepMinutes]);

  const ensureChunks = useCallback((): Chunk[] => {
    if (chunksRef.current.length > 0) return chunksRef.current;
    const el = containerRef.current;
    if (!el) return [];
    const list = buildChunks(el, {
      skipCode: prefsRef.current.skipCode,
      readTable: prefsRef.current.readTable,
    });
    chunksRef.current = list;
    if (list.length > 0) handleSnapshot({ ...snapshotRef.current, total: list.length });
    return list;
  }, [containerRef, handleSnapshot]);

  const start = useCallback(
    (from?: number) => {
      if (!supported) {
        handleSnapshot({ state: 'unsupported', index: 0, total: 0 });
        return;
      }
      const player = playerRef.current;
      if (!player) return;
      const list = ensureChunks();
      if (list.length === 0) {
        handleSnapshot({ state: 'ended', index: 0, total: 0 });
        return;
      }
      const target =
        from ?? (resumeRef.current != null && resumeRef.current > 0 ? resumeRef.current : firstVisibleIndex(list));
      const index = Math.max(0, Math.min(list.length - 1, target));
      player.setChunks(list);
      player.setRate(clampRate(prefsRef.current.rate));
      player.setVoice(voiceRef.current);
      player.playFrom(index);
      resumeRef.current = index;
      setHasResume(index > 0);
      persist(pathRef.current, index);
    },
    [supported, ensureChunks, handleSnapshot],
  );

  const startFromSelection = useCallback(
    (range: Range) => {
      const list = ensureChunks();
      const index = selectionIndex(list, range);
      start(index >= 0 ? index : 0);
    },
    [ensureChunks, start],
  );

  const startFromViewport = useCallback(() => {
    const list = ensureChunks();
    start(firstVisibleIndex(list));
  }, [ensureChunks, start]);

  const pause = useCallback(() => playerRef.current?.pause(), []);
  const resume = useCallback(() => playerRef.current?.resume(), []);

  const stop = useCallback(() => {
    playerRef.current?.stop();
    clearHighlightDom();
    persist(pathRef.current, snapshotRef.current.index);
  }, []);

  const toggle = useCallback(() => {
    const state = snapshotRef.current.state;
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
    else start();
  }, [pause, resume, start]);

  const next = useCallback(() => {
    const state = snapshotRef.current.state;
    if (state === 'playing' || state === 'paused') playerRef.current?.next();
    else start(snapshotRef.current.index + 1);
  }, [start]);

  const prev = useCallback(() => {
    const state = snapshotRef.current.state;
    if (state === 'playing' || state === 'paused') playerRef.current?.prev();
    else start(snapshotRef.current.index - 1);
  }, [start]);

  const setRate = useCallback((rate: number) => {
    const nextRate = clampRate(rate);
    setPrefsState((prev) => {
      const next = { ...prev, rate: nextRate };
      prefsRef.current = next;
      void saveTtsPrefs(next).catch(() => {});
      return next;
    });
    playerRef.current?.setRate(nextRate);
  }, []);

  const setVoiceKey = useCallback(
    (key: string | null) => {
      setPrefsState((prev) => {
        const next = { ...prev, voiceKey: key };
        prefsRef.current = next;
        void saveTtsPrefs(next).catch(() => {});
        return next;
      });
      const picked = key ? voiceOptions.find((v) => voiceKey(v) === key) ?? null : pickDefaultVoice(voiceOptions);
      voiceRef.current = picked;
      playerRef.current?.setVoice(picked);
    },
    [voiceOptions],
  );

  const setPrefs = useCallback((patch: Partial<TtsPrefs>) => {
    setPrefsState((prev) => {
      const next = sanitizeTtsPrefs({ ...prev, ...patch });
      prefsRef.current = next;
      void saveTtsPrefs(next).catch(() => {});
      return next;
    });
    if (patch.skipCode !== undefined || patch.readTable !== undefined) {
      chunksRef.current = [];
      playerRef.current?.stop();
      clearHighlightDom();
    }
  }, []);

  const setSleepMinutes = useCallback((minutes: number | 'off') => {
    setSleepMinutesState(minutes);
  }, []);

  useEffect(() => {
    if (['idle', 'ended', 'error', 'blocked', 'no-voice', 'unsupported'].includes(snapshot.state)) {
      clearHighlightDom();
    }
  }, [snapshot.state]);

  return {
    supported,
    state: snapshot.state,
    current: snapshot.index,
    total: snapshot.total,
    error: snapshot.error ?? '',
    prefs,
    rate: prefs.rate,
    voices,
    voiceOptions,
    selectedVoice,
    loadingVoices,
    hasResume,
    following,
    sleepMinutes,
    remainingSeconds,
    start,
    startFromSelection,
    startFromViewport,
    toggle,
    pause,
    resume,
    stop,
    next,
    prev,
    setRate,
    setVoiceKey,
    setPrefs,
    setSleepMinutes,
    refreshVoices,
    resumeFollow,
  };
}
