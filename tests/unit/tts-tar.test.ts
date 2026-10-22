import { describe, expect, it } from 'vitest';
import { parseTar } from '../../src/tts/tar';

function header(name: string, size: number): Uint8Array {
  const bytes = new Uint8Array(512);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode(name).subarray(0, 100), 0);
  const octal = size.toString(8).padStart(11, '0');
  bytes.set(encoder.encode(octal), 124);
  bytes[156] = '0'.charCodeAt(0);
  return bytes;
}

function makeTar(entries: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const data = encoder.encode(entry.content);
    parts.push(header(entry.name, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('parseTar', () => {
  it('解析普通文件并保留路径与内容', () => {
    const tar = makeTar([
      { name: 'espeak-ng-data/phontab', content: 'abc' },
      { name: 'espeak-ng-data/lang/gmw/en', content: 'hello' },
    ]);
    const entries = parseTar(tar);
    expect(entries.map((entry) => entry.path)).toEqual([
      'espeak-ng-data/phontab',
      'espeak-ng-data/lang/gmw/en',
    ]);
    expect(new TextDecoder().decode(entries[0].data)).toBe('abc');
    expect(new TextDecoder().decode(entries[1].data)).toBe('hello');
  });

  it('忽略目录项与空数据', () => {
    const tar = makeTar([{ name: 'espeak-ng-data/', content: '' }]);
    expect(parseTar(tar)).toEqual([]);
  });
});
