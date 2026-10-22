/** tar / tar.gz 解析与 OPFS 解压（只依赖浏览器原生 DecompressionStream）。 */

export interface TarEntry {
  path: string;
  data: Uint8Array;
}

function readString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

/** 解析未压缩的 tar 数据；目录项被忽略。 */
export function parseTar(tar: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    let empty = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break;
    const name = readString(header, 0, 100);
    const size = Number.parseInt(readString(header, 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    if (name && !name.endsWith('/') && (type === '0' || type === '\0')) {
      entries.push({ path: name.replace(/^\.\//, ''), data: tar.subarray(dataStart, dataStart + size) });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

type DirHandle = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: BufferSource | Blob | string): Promise<void>; close(): Promise<void> }>;
  }>;
};

async function ensureDir(root: DirHandle, parts: string[]): Promise<DirHandle> {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

/** 把 gzip 压缩的 tar 解压到 OPFS 目录；返回写入的文件数。 */
export async function extractTarGz(
  compressed: Uint8Array,
  target: DirHandle,
  stripPrefix?: string,
): Promise<number> {
  const Ctor = (globalThis as { DecompressionStream?: new (format: string) => unknown }).DecompressionStream;
  if (!Ctor) throw new Error('当前浏览器不支持 DecompressionStream，无法解压语音包');
  const stream = new Blob([compressed as unknown as BlobPart]).stream().pipeThrough(new Ctor('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>);
  const tar = new Uint8Array(await new Response(stream).arrayBuffer());
  const entries = parseTar(tar);
  let count = 0;
  for (const entry of entries) {
    let relative = entry.path;
    if (stripPrefix && relative.startsWith(stripPrefix)) relative = relative.slice(stripPrefix.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const file = parts.pop() as string;
    const dir = await ensureDir(target, parts);
    const handle = await dir.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    await writable.write(entry.data as unknown as BufferSource);
    await writable.close();
    count++;
  }
  return count;
}
