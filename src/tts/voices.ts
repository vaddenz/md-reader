/** 系统语音列表：归一化、筛选、默认选择。Edge Android 可能返回空列表（但默认语音仍可用）。 */

export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export function normalizeLang(lang: string): string {
  return String(lang || '').replace(/_/g, '-').toLowerCase();
}

export function voiceKey(v: VoiceLike): string {
  return `${normalizeLang(v.lang)}|${v.name}`;
}

/** 默认中文语音：本地优先、zh-CN 优先；没有中文返回 null（由系统默认语音兜底）。 */
export function pickDefaultVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const lang = normalizeLang(v.lang);
    if (!lang.startsWith('zh')) continue;
    let score = v.localService ? 100 : 0;
    if (lang === 'zh-cn') score += 30;
    else if (lang === 'zh-tw') score += 20;
    else if (lang === 'zh-hk') score += 10;
    else score += 5;
    if (v.default) score += 1;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/** 语音面板列表：中文优先；localOnly 时只留本地语音。 */
export function listVoices<T extends VoiceLike>(voices: readonly T[], localOnly: boolean): T[] {
  return voices
    .filter((v) => normalizeLang(v.lang).startsWith('zh'))
    .filter((v) => !localOnly || v.localService)
    .slice()
    .sort((a, b) => {
      const la = normalizeLang(a.lang);
      const lb = normalizeLang(b.lang);
      if (la !== lb) return la === 'zh-cn' ? -1 : lb === 'zh-cn' ? 1 : la.localeCompare(lb);
      if (a.localService !== b.localService) return a.localService ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * 加载语音列表。`getVoices()` 可能异步填充；空列表不是错误，超时后返回 []，
 * 调用方应继续用 `lang='zh-CN'` 尝试默认语音。
 */
export function loadVoices(synth: SpeechSynthesis, timeoutMs = 10000): Promise<SpeechSynthesisVoice[]> {
  const initial = synth.getVoices();
  if (initial.length > 0) return Promise.resolve(initial);

  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    let interval = 0;

    const cleanup = () => {
      synth.removeEventListener('voiceschanged', onChange);
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve(synth.getVoices());
    };
    const check = () => {
      if (synth.getVoices().length > 0) finish();
    };
    const onChange = () => check();

    synth.addEventListener('voiceschanged', onChange);
    interval = window.setInterval(check, 250);
    timer = window.setTimeout(finish, timeoutMs);
  });
}
