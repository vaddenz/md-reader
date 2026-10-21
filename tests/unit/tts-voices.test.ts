import { describe, expect, it } from 'vitest';
import { listVoices, normalizeLang, pickDefaultVoice, voiceKey, type VoiceLike } from '../../src/tts/voices';

function voice(partial: Partial<VoiceLike> & Pick<VoiceLike, 'name' | 'lang'>): VoiceLike {
  return { localService: true, default: false, ...partial };
}

describe('normalizeLang', () => {
  it('下划线转连字符并小写', () => {
    expect(normalizeLang('zh_CN')).toBe('zh-cn');
    expect(normalizeLang('en-US')).toBe('en-us');
  });
  it('空值安全', () => {
    expect(normalizeLang('')).toBe('');
    expect(normalizeLang(undefined as unknown as string)).toBe('');
  });
});

describe('voiceKey', () => {
  it('语言 + 名称，语言归一化', () => {
    expect(voiceKey(voice({ name: '婷婷', lang: 'zh_CN' }))).toBe('zh-cn|婷婷');
  });
});

describe('pickDefaultVoice', () => {
  it('本地 zh-CN 优先', () => {
    const local = voice({ name: 'local', lang: 'zh-CN' });
    const network = voice({ name: 'net', lang: 'zh-CN', localService: false });
    expect(pickDefaultVoice([network, local])).toBe(local);
  });
  it('zh-CN 优先于 zh-TW', () => {
    const tw = voice({ name: 'tw', lang: 'zh-TW' });
    const cn = voice({ name: 'cn', lang: 'zh-CN' });
    expect(pickDefaultVoice([tw, cn])).toBe(cn);
  });
  it('没有中文返回 null（由系统默认语音兜底）', () => {
    expect(pickDefaultVoice([voice({ name: 'en', lang: 'en-US' })])).toBeNull();
    expect(pickDefaultVoice([])).toBeNull();
  });
});

describe('listVoices', () => {
  it('只列中文、本地优先、zh-CN 在前', () => {
    const list = listVoices(
      [
        voice({ name: 'en', lang: 'en-US' }),
        voice({ name: 'tw', lang: 'zh-TW' }),
        voice({ name: 'net', lang: 'zh-CN', localService: false }),
        voice({ name: 'cn', lang: 'zh-CN' }),
      ],
      false,
    );
    expect(list.map((v) => v.name)).toEqual(['cn', 'net', 'tw']);
  });

  it('localOnly 时只留本地', () => {
    const list = listVoices(
      [
        voice({ name: 'net', lang: 'zh-CN', localService: false }),
        voice({ name: 'cn', lang: 'zh-CN' }),
      ],
      true,
    );
    expect(list.map((v) => v.name)).toEqual(['cn']);
  });

  it('无中文返回空数组，不报错', () => {
    expect(listVoices([voice({ name: 'en', lang: 'en-US' })], false)).toEqual([]);
  });
});
