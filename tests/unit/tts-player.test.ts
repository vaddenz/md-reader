// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TtsPlayer } from '../../src/tts/player';
import type { Chunk, PlayerSnapshot, SpeakOptions, SpeakResult, SpeechSource, TtsEngine } from '../../src/tts/types';

class FakeSource implements SpeechSource {
  readonly kind: TtsEngine = 'system';
  readonly supportsMidSentencePause: boolean = false;
  speaking = false;
  paused = false;
  calls: string[] = [];
  private resolvers: Array<(r: SpeakResult) => void> = [];

  setRate(): void {}

  speak(text: string, opts: SpeakOptions): Promise<SpeakResult> {
    this.calls.push(text);
    this.speaking = true;
    opts.onStart?.();
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.speaking = false;
    const pending = this.resolvers;
    this.resolvers = [];
    for (const resolve of pending) resolve({ ok: false, error: 'canceled' });
  }

  finish(): void {
    this.speaking = false;
    this.resolvers.shift()?.({ ok: true });
  }

  fail(error: string): void {
    this.speaking = false;
    this.resolvers.shift()?.({ ok: false, error });
  }
}

function chunk(text: string): Chunk {
  return {
    text,
    raw: text,
    lang: 'zh-CN',
    block: document.createElement('p'),
    ranges: [],
    kind: 'text',
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makePlayer(count = 3) {
  const source = new FakeSource();
  const states: PlayerSnapshot[] = [];
  const currents: number[] = [];
  const positions: number[] = [];
  const player = new TtsPlayer({
    source,
    onChange: (s) => states.push(s),
    onCurrent: (i) => currents.push(i),
    onPosition: (n) => positions.push(n),
  });
  player.setChunks(Array.from({ length: count }, (_, i) => chunk(`c${i}`)));
  return { player, source, states, currents, positions };
}

class FakeLocalSource extends FakeSource {
  override readonly kind: TtsEngine = 'local';
  override readonly supportsMidSentencePause = true;
}

describe('TtsPlayer', () => {
  it('本地引擎的 pause/resume 直接调用底层 AudioContext', () => {
    const source = new FakeLocalSource();
    const player = new TtsPlayer({ source });
    player.setChunks([chunk('c0'), chunk('c1')]);
    player.playFrom(0);
    player.pause();
    expect(player.snapshot.state).toBe('paused');
    expect(source.paused).toBe(true);
    player.resume();
    expect(player.snapshot.state).toBe('playing');
    expect(source.paused).toBe(false);
    player.stop();
  });

  it('顺序播放并在 end 后推进', async () => {
    const { player, source, currents, positions } = makePlayer(3);
    player.playFrom(0);
    expect(source.calls).toEqual(['c0']);
    source.finish();
    await flush();
    expect(source.calls).toEqual(['c0', 'c1']);
    expect(currents).toEqual([0, 1]);
    expect(positions).toContain(1);
    player.stop();
  });

  it('原生 pause/resume 不丢句内位置', async () => {
    const { player, source } = makePlayer(2);
    player.playFrom(0);
    player.pause();
    expect(player.snapshot.state).toBe('paused');
    expect(source.paused).toBe(true);
    player.resume();
    expect(player.snapshot.state).toBe('playing');
    expect(source.paused).toBe(false);
    source.finish();
    await flush();
    expect(source.calls).toEqual(['c0', 'c1']);
    player.stop();
  });

  it('页面隐藏：当前句播完再暂停，亮屏继续下一句', async () => {
    const { player, source } = makePlayer(3);
    player.playFrom(0);
    player.requestPauseAfterCurrent();
    source.finish();
    await flush();
    expect(player.snapshot.state).toBe('paused');
    expect(source.calls).toEqual(['c0']);
    player.handleVisible();
    expect(player.snapshot.state).toBe('playing');
    expect(source.calls).toEqual(['c0', 'c1']);
    player.stop();
  });

  it('停止会取消当前并回到 idle', async () => {
    const { player, source } = makePlayer(2);
    player.playFrom(0);
    player.stop();
    expect(player.snapshot.state).toBe('idle');
    expect(source.speaking).toBe(false);
    await flush();
    expect(source.calls).toEqual(['c0']);
  });

  it('not-allowed 进入 blocked', async () => {
    const { player, source } = makePlayer(2);
    player.playFrom(0);
    source.fail('not-allowed');
    await flush();
    expect(player.snapshot.state).toBe('blocked');
    expect(player.snapshot.error).toContain('拦截');
  });

  it('睡眠定时在当前句结束后停止', async () => {
    const { player, source } = makePlayer(3);
    player.playFrom(0);
    player.setStopAfterCurrent(true);
    source.finish();
    await flush();
    expect(player.snapshot.state).toBe('ended');
    expect(source.calls).toEqual(['c0']);
  });
});
