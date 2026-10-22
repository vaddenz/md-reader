import { describe, expect, it } from 'vitest';
import { sanitizeTtsPrefs } from '../../src/tts/prefs';
import { DEFAULT_TTS_PREFS } from '../../src/tts/types';

describe('sanitizeTtsPrefs', () => {
  it('空值/非法值回到默认', () => {
    expect(sanitizeTtsPrefs(undefined)).toEqual(DEFAULT_TTS_PREFS);
    expect(sanitizeTtsPrefs([])).toEqual(DEFAULT_TTS_PREFS);
    expect(sanitizeTtsPrefs({ rate: NaN, skipCode: 'yes' })).toEqual(DEFAULT_TTS_PREFS);
  });

  it('engine 只接受 system / local', () => {
    expect(sanitizeTtsPrefs({ engine: 'local' }).engine).toBe('local');
    expect(sanitizeTtsPrefs({ engine: 'other' }).engine).toBe('system');
    expect(DEFAULT_TTS_PREFS.engine).toBe('system');
  });

  it('钳制语速，保留合法布尔与 voiceKey', () => {
    const prefs = sanitizeTtsPrefs({
      engine: 'local',
      rate: 9,
      voiceKey: 'zh-cn|婷婷',
      skipCode: false,
      readTable: true,
      keepAwake: false,
      localOnly: false,
    });
    expect(prefs.engine).toBe('local');
    expect(prefs.rate).toBe(2);
    expect(prefs.voiceKey).toBe('zh-cn|婷婷');
    expect(prefs.skipCode).toBe(false);
    expect(prefs.readTable).toBe(true);
    expect(prefs.keepAwake).toBe(false);
    expect(prefs.localOnly).toBe(false);
  });

  it('语速下限 0.75', () => {
    expect(sanitizeTtsPrefs({ rate: 0.1 }).rate).toBe(0.75);
  });
});
