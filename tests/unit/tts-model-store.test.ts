import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelManifest } from '../../src/tts/model-manifest';

vi.mock('../../src/data/db', () => ({
  kvGet: vi.fn(async () => undefined),
  kvSet: vi.fn(async () => undefined),
}));

import { deleteModel, downloadModel, isModelReady, loadModelInfo } from '../../src/tts/model-store';

interface FakeFile {
  data: Uint8Array;
}

class FakeDir {
  dirs = new Map<string, FakeDir>();
  files = new Map<string, FakeFile>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error('not found');
    const dir = new FakeDir();
    this.dirs.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>;
    getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  }> {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = { data: new Uint8Array() };
      this.files.set(name, file);
    }
    if (!file) throw new Error('not found');
    const target = file;
    return {
      async createWritable() {
        return {
          async write(data: BufferSource) {
            const view = ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
              : new Uint8Array(data as ArrayBuffer);
            target.data = new Uint8Array(view);
          },
          async close() {},
        };
      },
      async getFile() {
        return {
          async arrayBuffer() {
            return target.data.buffer.slice(target.data.byteOffset, target.data.byteOffset + target.data.byteLength) as ArrayBuffer;
          },
        };
      },
    };
  }

  async removeEntry(name: string): Promise<void> {
    this.dirs.delete(name);
    this.files.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, FakeDir | unknown]> {
    for (const [name, dir] of this.dirs) yield [name, dir];
    for (const [name, file] of this.files) yield [name, file];
  }
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const root = new FakeDir();

beforeEach(() => {
  vi.stubGlobal('navigator', {
    storage: {
      estimate: async () => ({ quota: 1024 * 1024 * 1024, usage: 0 }),
      persist: async () => true,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function manifestFor(contents: string[]): Promise<ModelManifest> {
  return {
    id: 'test-model',
    version: '1',
    sampleRate: 16000,
    storageDir: 'tts/test-model/v1',
    files: await Promise.all(
      contents.map(async (content, index) => {
        const data = bytes(content);
        return {
          path: `file-${index}.bin`,
          size: data.length,
          sha256: await sha256(data),
          url: `https://example.com/file-${index}.bin`,
        };
      }),
    ),
  };
}

describe('model-store', () => {
  it('下载成功写入 OPFS 并保存元数据', async () => {
    const manifest = await manifestFor(['hello', 'world']);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const index = Number(url.match(/file-(\d+)/)?.[1] ?? 0);
      const data = bytes(index === 0 ? 'hello' : 'world');
      return new Response(data as unknown as BodyInit, { status: 200, headers: { 'content-length': String(data.length) } });
    }));
    const info = await downloadModel(manifest, { root: root as never });
    expect(info.size).toBe(10);
    const dir = await root.getDirectoryHandle('tts').then((d) => d.getDirectoryHandle('test-model')).then((d) => d.getDirectoryHandle('v1'));
    expect(await dir.getFileHandle('file-0.bin').then((f) => f.getFile()).then((f) => f.arrayBuffer())).toBeInstanceOf(ArrayBuffer);
  });

  it('SHA 校验失败时删除已写入文件并抛错', async () => {
    const manifest = await manifestFor(['hello']);
    manifest.files[0].sha256 = '0'.repeat(64);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes('hello') as unknown as BodyInit, { status: 200 })));
    await expect(downloadModel(manifest, { root: root as never })).rejects.toThrow('校验失败');
    expect(await isModelReady(root as never)).toBe(false);
  });

  it('loadModelInfo 非法数据返回 null', async () => {
    const { kvGet } = await import('../../src/data/db');
    vi.mocked(kvGet).mockResolvedValueOnce({ id: 1 });
    expect(await loadModelInfo()).toBeNull();
  });

  it('deleteModel 清除 OPFS 与元数据', async () => {
    const { kvGet, kvSet } = await import('../../src/data/db');
    vi.mocked(kvGet).mockResolvedValue({
      id: 'test-model',
      version: '1',
      storageDir: 'tts/test-model/v1',
      size: 10,
      downloadedAt: 1,
    });
    await deleteModel(root as never);
    expect(vi.mocked(kvSet)).toHaveBeenCalledWith('tts.model', null);
  });
});
