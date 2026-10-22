/** OPFS 的最小封装：目录遍历、写入、删除；只在安全上下文可用。 */

export interface OpfsFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BufferSource | Blob | string): Promise<void>; close(): Promise<void> }>;
}

export interface OpfsDirHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, OpfsDirHandle | OpfsFileHandle]>;
}

export function opfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

export async function getOpfsRoot(): Promise<OpfsDirHandle> {
  if (!opfsSupported()) throw new Error('当前浏览器不支持 OPFS');
  return (await navigator.storage.getDirectory()) as unknown as OpfsDirHandle;
}

/** 逐级创建目录；path 用 `/` 分隔。 */
export async function ensureOpfsDir(root: OpfsDirHandle, path: string): Promise<OpfsDirHandle> {
  let dir = root;
  for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: true });
  return dir;
}

export async function opfsFileExists(root: OpfsDirHandle, path: string): Promise<boolean> {
  const parts = path.split('/').filter(Boolean);
  const file = parts.pop();
  if (!file) return false;
  try {
    const dir = await ensureOpfsDir(root, parts.join('/'));
    await dir.getFileHandle(file);
    return true;
  } catch {
    return false;
  }
}

export async function writeOpfsFile(root: OpfsDirHandle, path: string, data: BufferSource): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const file = parts.pop();
  if (!file) throw new Error(`无效文件路径：${path}`);
  const dir = await ensureOpfsDir(root, parts.join('/'));
  const handle = await dir.getFileHandle(file, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function removeOpfsDir(root: OpfsDirHandle, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  const dir = await ensureOpfsDir(root, parts.join('/'));
  try {
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // 目录不存在时忽略
  }
}

/** 递归列出目录下所有文件，返回相对 base 的路径。 */
export async function walkOpfsFiles(dir: OpfsDirHandle, base = ''): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = base ? `${base}/${name}` : name;
    if (typeof (handle as OpfsDirHandle).entries === 'function') {
      out.push(...(await walkOpfsFiles(handle as OpfsDirHandle, path)));
    } else {
      out.push(path);
    }
  }
  return out;
}
